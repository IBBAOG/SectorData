#!/usr/bin/env python3
import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

"""
Sistema de Alertas ANP — Monitor Principal

Comportamento default (sem --base):
    Pula automaticamente as "bases heavy" listadas em _HEAVY_BASES,
    que exigem Playwright + Chromium e são desproporcional para runs a cada 2h.
    Essas bases têm workflows ETL dedicados que cuidam da detecção real.

    python alertas/monitor.py                         # todas as bases (exceto heavy)
    python alertas/monitor.py --base anp_ppi          # base específica
    python alertas/monitor.py --base anp_cdp_producao_poco  # roda normalmente (leve)
    python alertas/monitor.py --loop --intervalo 30   # loop a cada 30 min

Meta-alert (stale-base canary):
    At the end of every run, queries alertas_estado for any base with updated_at
    older than 48 hours and sends a single digest email listing them.
    A 24-hour debounce (stored as _meta_stale_check in alertas_estado) prevents spam.
"""
import argparse
import os
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from bases.anp_lpc_ultimas          import AnpLpcUltimas
from bases.anp_sintese_semanal      import AnpSinteseSemanal
from bases.anp_ppi                  import AnpPpi
from bases.anp_precos_produtores    import AnpPrecosProdutores
from bases.anp_desembaracos         import AnpDesembaracos
from bases.anp_dados_abertos_ie     import AnpDadosAbertosIE
from bases.anp_painel_combustiveis  import AnpPainelCombustiveis
from bases.anp_glp                  import AnpGlp
from bases.mdic_comex               import MdicComex
from bases.anp_cdp_producao_poco    import AnpCdpProducaoPoco
from bases.precos_distribuicao      import PrecosDistribuicao
from bases.etl_workflow_stuck       import EtlWorkflowStuck

# Bases que requerem dependências pesadas (Playwright + Chromium).
# São puladas no run default (a cada 2h) porque o custo é desproporcional e cada
# uma delas tem um workflow ETL dedicado que detecta novidades no ritmo correto.
# Para rodar manualmente: python alertas/monitor.py --base <slug>
#
# NOTA: anp_cdp_producao_poco foi REMOVIDA deste conjunto em 2026-05.
# Ela agora é leve: lê sessão do Supabase (alertas_session) e usa requests puro
# via _replay.py (Frente B), sem Selenium nem ddddocr. O capture Selenium mensal
# continua exclusivo do etl_anp_cdp.yml.
_HEAVY_BASES: set[str] = set()  # no heavy bases currently active

MONITORES = [
    AnpLpcUltimas(),
    AnpSinteseSemanal(),
    AnpPpi(),
    AnpPrecosProdutores(),
    AnpDesembaracos(),
    AnpDadosAbertosIE(),
    AnpPainelCombustiveis(),
    AnpGlp(),
    MdicComex(),
    AnpCdpProducaoPoco(),
    PrecosDistribuicao(),
    EtlWorkflowStuck(),
]

_BY_SLUG = {m.slug: m for m in MONITORES}


_STALE_THRESHOLD_HOURS = 48
_META_STALE_DEBOUNCE_HOURS = 24
_META_SLUG = "_meta_stale_check"


def _check_stale_bases_and_alert(base_filter: str | None):
    """
    Query alertas_estado for bases silent for more than _STALE_THRESHOLD_HOURS hours.
    Sends a single digest email if any are found, with a _META_STALE_DEBOUNCE_HOURS debounce.
    Skipped when base_filter is set (single-base runs are manual/debug, not worth meta-alerting).
    """
    if base_filter:
        return  # Only run meta-check on full runs

    url = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()
    if not url or not key:
        print("[meta] SUPABASE_URL/SERVICE_KEY not set — skipping stale-base check.")
        return

    import requests as _req

    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    # --- Debounce: check when we last sent a stale-base alert ---
    try:
        resp = _req.get(
            f"{url}/rest/v1/alertas_estado",
            headers=headers,
            params={"base": f"eq.{_META_SLUG}", "select": "estado,updated_at"},
            timeout=10,
        )
        meta_rows = resp.json() if resp.ok else []
    except Exception as e:
        print(f"[meta] Could not query stale-check debounce row: {e}")
        return

    now_utc = datetime.now(timezone.utc)
    if meta_rows:
        last_sent_str = (meta_rows[0].get("estado") or {}).get("last_sent")
        if last_sent_str:
            try:
                last_sent = datetime.fromisoformat(last_sent_str.replace("Z", "+00:00"))
                elapsed_h = (now_utc - last_sent).total_seconds() / 3600
                if elapsed_h < _META_STALE_DEBOUNCE_HOURS:
                    print(f"[meta] Stale-check debounce active ({elapsed_h:.1f}h < {_META_STALE_DEBOUNCE_HOURS}h). Skipping.")
                    return
            except ValueError:
                pass

    # --- Query all alertas_estado rows ---
    try:
        resp = _req.get(
            f"{url}/rest/v1/alertas_estado",
            headers=headers,
            params={"select": "base,updated_at"},
            timeout=10,
        )
        all_rows = resp.json() if resp.ok else []
    except Exception as e:
        print(f"[meta] Could not query alertas_estado: {e}")
        return

    stale = []
    for row in all_rows:
        base = row.get("base", "")
        if base.startswith("_"):
            continue  # skip internal meta rows
        updated_str = row.get("updated_at") or ""
        if not updated_str:
            stale.append((base, "never"))
            continue
        try:
            updated_at = datetime.fromisoformat(updated_str.replace("Z", "+00:00"))
            elapsed_h = (now_utc - updated_at).total_seconds() / 3600
            if elapsed_h > _STALE_THRESHOLD_HOURS:
                stale.append((base, f"{elapsed_h:.0f}h ago ({updated_str[:16]})"))
        except ValueError:
            stale.append((base, f"unparseable timestamp: {updated_str}"))

    if not stale:
        print(f"[meta] All bases updated within {_STALE_THRESHOLD_HOURS}h. No stale alert needed.")
        return

    # --- Send digest email ---
    print(f"[meta] {len(stale)} stale base(s) detected — sending digest alert.")
    lines = "\n".join(f"  - {b}: last updated {t}" for b, t in stale)
    msg = (
        f"{len(stale)} alert base(s) have been silent for more than {_STALE_THRESHOLD_HOURS} hours:\n\n"
        f"{lines}\n\n"
        f"Check the GHA alertas_monitor.yml run logs for errors."
    )

    alertas_dir = Path(__file__).parent
    sys.path.insert(0, str(alertas_dir))
    try:
        from notificador import enviar_alerta  # type: ignore
        enviar_alerta(
            f"[ALERTAS] {len(stale)} base(s) silent for >{_STALE_THRESHOLD_HOURS}h",
            msg,
        )
    except Exception as e:
        print(f"[meta] Failed to send stale-base digest: {e}")
        return

    # --- Persist debounce timestamp ---
    try:
        _req.post(
            f"{url}/rest/v1/alertas_estado",
            headers={**headers, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"},
            json={"base": _META_SLUG, "estado": {"last_sent": now_utc.isoformat()}, "updated_at": now_utc.isoformat()},
            timeout=10,
        )
    except Exception as e:
        print(f"[meta] Could not persist stale-check debounce: {e}")


def rodar(base_filter=None):
    if base_filter:
        if base_filter not in _BY_SLUG:
            print(f"Base '{base_filter}' nao encontrada.")
            print(f"Disponiveis: {', '.join(_BY_SLUG)}")
            sys.exit(1)
        # Filtro explícito: roda exatamente o que foi pedido, mesmo se for heavy.
        monitores = [_BY_SLUG[base_filter]]
    else:
        # Run default: pula bases heavy para manter o monitor leve nos runs a cada 2h.
        skipped = [m.slug for m in MONITORES if m.slug in _HEAVY_BASES]
        if skipped:
            print(f"[skip] Bases heavy puladas no run default: {', '.join(skipped)}")
            print(f"[skip]   Para rodar manualmente: python alertas/monitor.py --base <slug>")
        monitores = [m for m in MONITORES if m.slug not in _HEAVY_BASES]

    novidades = 0
    for m in monitores:
        if m.run():
            novidades += 1

    print(f"\n{'─' * 52}")
    print(f"Concluido: {novidades}/{len(monitores)} base(s) com novidade")

    # Meta-alert: notify if any base has been silent for more than 48h
    _check_stale_bases_and_alert(base_filter)

    return novidades


def main():
    ap = argparse.ArgumentParser(description="Monitor de bases ANP/MDIC")
    ap.add_argument("--base",      help="Slug da base (ex: anp_ppi)")
    ap.add_argument("--loop",      action="store_true", help="Rodar em loop")
    ap.add_argument("--intervalo", type=int, default=30, metavar="MIN",
                    help="Intervalo em minutos no modo --loop (default: 30)")
    args = ap.parse_args()

    if args.loop:
        print(f"Modo loop — verificando a cada {args.intervalo} min. Ctrl+C para parar.\n")
        while True:
            print(f"{'=' * 52}")
            print(f"{time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            rodar(args.base)
            time.sleep(args.intervalo * 60)
    else:
        rodar(args.base)


if __name__ == "__main__":
    main()
