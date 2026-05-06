#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
01_extract_replay_only.py — ANP/CDP extração via replay de sessão APEX.

Usado pelo CI (etl_anp_cdp.yml). Não usa Selenium nem CAPTCHA.

Fluxo:
  1. Ler session do Supabase (alertas_session WHERE base='anp_cdp')
  2. Para cada ambiente × período, chamar replay_download()
  3. Se status == "expired" → exit(1) com mensagem clara (re-capture manual necessária)
  4. Atualizar last_used_at no banco após uso bem-sucedido

Uso:
  python 01_extract_replay_only.py --periodo 04/2025 --output output/anp
  python 01_extract_replay_only.py --de 01/2025 --ate 04/2025 --ambiente M --output output/anp
  python 01_extract_replay_only.py --output output/anp          # automático: 2 meses atrás
"""

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# _replay.py é co-localizado nesta pasta
sys.path.insert(0, str(Path(__file__).parent))
from _replay import replay_download, ReplayResult

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _parse_periodo(s: str) -> tuple[int, int]:
    """'MM/YYYY' → (month, year)."""
    mm, yyyy = s.split("/")
    return int(mm), int(yyyy)


def _periodo_range(de: str, ate: str) -> list[str]:
    """Gera lista de períodos MM/YYYY entre de e ate (inclusive)."""
    mm_de, yy_de = _parse_periodo(de)
    mm_ate, yy_ate = _parse_periodo(ate)
    result = []
    mm, yy = mm_de, yy_de
    while (yy, mm) <= (yy_ate, mm_ate):
        result.append(f"{mm:02d}/{yy}")
        mm += 1
        if mm > 12:
            mm = 1
            yy += 1
    return result


def _auto_periodo() -> str:
    """Padrão do schedule: 2 meses atrás."""
    now = datetime.now(timezone.utc)
    mm = now.month - 2
    yy = now.year
    if mm <= 0:
        mm += 12
        yy -= 1
    return f"{mm:02d}/{yy}"


def _get_supabase_client():
    """Cria cliente Supabase com service key (bypass RLS)."""
    try:
        from supabase import create_client
    except ImportError:
        print("[ERRO] supabase-py não instalado. Execute: pip install supabase")
        sys.exit(1)
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("[ERRO] SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios.")
        sys.exit(1)
    return create_client(url, key)


def _fetch_session(supa) -> dict:
    """Busca session da tabela alertas_session. Falha explicitamente se ausente."""
    try:
        res = supa.table("alertas_session").select("session").eq("base", "anp_cdp").single().execute()
    except Exception as e:
        print(f"[ERRO] Falha ao buscar session do Supabase: {e}")
        print("  → Execute localmente: python 01_extract.py --capture --periodo MM/YYYY")
        print("  → Depois atualize alertas_session via SQL ou upsert manual.")
        sys.exit(1)
    if not res.data or not res.data.get("session"):
        print("[ERRO] Nenhuma session encontrada para base='anp_cdp' em alertas_session.")
        print("  → Faça a captura manual: python 01_extract.py --capture --periodo MM/YYYY")
        sys.exit(1)
    return res.data["session"]


def _update_last_used(supa) -> None:
    """Atualiza last_used_at no banco (best-effort, não falha o job se der erro)."""
    try:
        supa.table("alertas_session").update(
            {"last_used_at": datetime.now(timezone.utc).isoformat()}
        ).eq("base", "anp_cdp").execute()
        print("[INFO] last_used_at atualizado.")
    except Exception as e:
        print(f"[WARN] Não foi possível atualizar last_used_at: {e}")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="ANP CDP — replay-only (sem Selenium)")
    grp = parser.add_mutually_exclusive_group()
    grp.add_argument("--periodo", help="Período único MM/YYYY")
    grp.add_argument("--de", help="Período inicial MM/YYYY (lote)")
    parser.add_argument("--ate", help="Período final MM/YYYY (usado com --de)")
    parser.add_argument(
        "--ambiente",
        default="todos",
        choices=["M", "S", "T", "todos"],
        help="Ambiente: M=Mar, S=Pre-Sal, T=Terra, todos=M+S+T",
    )
    parser.add_argument("--output", default="output/anp", help="Diretório de saída")
    args = parser.parse_args()

    # ── Resolver períodos ──────────────────────────────────────────────────────
    if args.periodo:
        periodos = [args.periodo]
    elif args.de:
        ate = args.ate or args.de
        periodos = _periodo_range(args.de, ate)
    else:
        periodos = [_auto_periodo()]

    # ── Resolver ambientes ─────────────────────────────────────────────────────
    ambientes = ["M", "S", "T"] if args.ambiente == "todos" else [args.ambiente]

    print(f"[INFO] Períodos: {periodos}")
    print(f"[INFO] Ambientes: {ambientes}")
    print(f"[INFO] Output: {args.output}")

    # ── Buscar session do Supabase ─────────────────────────────────────────────
    supa = _get_supabase_client()
    session_data = _fetch_session(supa)
    print(f"[INFO] Session carregada (captured_at={session_data.get('captured_at', '?')})")

    # ── Replay ────────────────────────────────────────────────────────────────
    Path(args.output).mkdir(parents=True, exist_ok=True)
    failures = []
    successes = []

    for periodo in periodos:
        for ambiente in ambientes:
            print(f"\n[INFO] Processando {periodo} / {ambiente} ...")
            result: ReplayResult = replay_download(
                session_data=session_data,
                periodo=periodo,
                ambiente=ambiente,
                output_dir=args.output,
            )
            if result.status == "ok":
                print(f"  [OK] {result.message}")
                successes.append((periodo, ambiente, result.csv_path))
            elif result.status == "expired":
                # Sessão expirou — este é um erro fatal que requer intervenção manual
                print(f"\n[FATAL] Sessão APEX expirou: {result.message}")
                print("  → Para renovar a sessão:")
                print("    1. Localmente: python scripts/pipelines/anp/cdp/01_extract.py --capture --periodo MM/YYYY")
                print("    2. Copie output/anp/session.json para o banco:")
                print("       UPDATE alertas_session SET session = <json>, captured_at = now()")
                print("       WHERE base = 'anp_cdp';")
                sys.exit(2)  # código 2 = sessão expirada (distinto de erro genérico)
            else:
                print(f"  [ERRO] {result.message}")
                failures.append((periodo, ambiente, result.message))

    # ── Sumário ───────────────────────────────────────────────────────────────
    print(f"\n[SUMÁRIO] {len(successes)} ok, {len(failures)} falhas")
    if successes:
        print("  Arquivos gerados:")
        for p, a, path in successes:
            print(f"    {path}")
        _update_last_used(supa)

    if failures:
        print("  Falhas:")
        for p, a, msg in failures:
            print(f"    {p}/{a}: {msg}")
        sys.exit(1)


if __name__ == "__main__":
    main()
