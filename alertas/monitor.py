#!/usr/bin/env python3
import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

"""
Sistema de Alertas ANP — Monitor Principal

Comportamento default (sem --base):
    Pula automaticamente as "bases heavy" listadas em _HEAVY_BASES (ex: sindicom),
    que exigem Playwright + Chromium e são desproporcional para runs a cada 2h.
    Essas bases têm workflows ETL dedicados que cuidam da detecção real.

    python alertas/monitor.py                         # todas as bases (exceto heavy)
    python alertas/monitor.py --base anp_ppi          # base específica
    python alertas/monitor.py --base anp_cdp_producao_poco  # roda normalmente (leve)
    python alertas/monitor.py --loop --intervalo 30   # loop a cada 30 min
"""
import argparse
import time
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
from bases.sindicom                 import Sindicom
from bases.precos_distribuicao      import PrecosDistribuicao

# Bases que requerem dependências pesadas (Playwright + Chromium).
# São puladas no run default (a cada 2h) porque o custo é desproporcional e cada
# uma delas tem um workflow ETL dedicado que detecta novidades no ritmo correto.
# Para rodar manualmente: python alertas/monitor.py --base <slug>
#
# NOTA: anp_cdp_producao_poco foi REMOVIDA deste conjunto em 2026-05.
# Ela agora é leve: lê sessão do Supabase (alertas_session) e usa requests puro
# via _replay.py (Frente B), sem Selenium nem ddddocr. O capture Selenium mensal
# continua exclusivo do etl_anp_cdp.yml.
_HEAVY_BASES = {
    "sindicom",  # Playwright + Chromium — SINDICOM atualiza 1×/mês via etl_sindicom.yml
}

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
    Sindicom(),
    PrecosDistribuicao(),
]

_BY_SLUG = {m.slug: m for m in MONITORES}


def rodar(base_filter=None):
    if base_filter:
        if base_filter not in _BY_SLUG:
            print(f"Base '{base_filter}' não encontrada.")
            print(f"Disponíveis: {', '.join(_BY_SLUG)}")
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
    print(f"Concluído: {novidades}/{len(monitores)} base(s) com novidade")
    return novidades


def main():
    ap = argparse.ArgumentParser(description="Monitor de bases ANP/MDIC/SINDICOM")
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
