#!/usr/bin/env python3
"""
mdic_comex_sync.py
==================
Script de CI para sincronizar os últimos meses do MDIC Comex Stat com o Supabase.

Baixa import + export dos 3 NCMs de petróleo/combustíveis para os últimos N meses
e faz upsert na tabela mdic_comex (ON CONFLICT DO UPDATE). Idempotente.

Uso:
    python scripts/mdic_comex_sync.py               # últimos 3 meses
    python scripts/mdic_comex_sync.py --meses 6     # últimos 6 meses
    python scripts/mdic_comex_sync.py --desde 2026-01  # a partir de YYYY-MM

Credenciais (env vars; fallback para .env na raiz):
    SUPABASE_URL
    SUPABASE_SERVICE_KEY
"""
import argparse
import math
import os
import sys
import time
from datetime import date
from pathlib import Path

import requests
from supabase import create_client

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_API     = "https://api-comexstat.mdic.gov.br/general"
_HEADERS = {"Content-Type": "application/json", "Accept": "application/json"}
_NCMS    = ["27090010", "27101259", "27101921"]
_BATCH   = 500
_RETRIES = 4
_BACKOFF = [2, 5, 12, 30]


# ── Credentials ───────────────────────────────────────────────────────────────

def _get_creds() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        env_path = Path(__file__).parent.parent / ".env"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip()
                if k == "SUPABASE_URL" and not url:
                    url = v
                if k == "SUPABASE_SERVICE_KEY" and not key:
                    key = v
    if not url or not key:
        print("Erro: SUPABASE_URL ou SUPABASE_SERVICE_KEY nao definidos")
        sys.exit(1)
    return url, key


# ── MDIC API ──────────────────────────────────────────────────────────────────

def _post_retry(flow: str, pf: str, pt: str) -> list[dict]:
    payload = {
        "flow":        flow,
        "monthDetail": True,
        "period":      {"from": pf, "to": pt},
        "filters":     [{"filter": "ncm", "values": _NCMS}],
        "details":     ["ncm", "country"],
        "metrics":     ["metricFOB", "metricKG"],
    }
    for attempt in range(_RETRIES):
        try:
            r = requests.post(_API, headers=_HEADERS, json=payload, timeout=60)
            if r.status_code == 200:
                rows = r.json().get("data", {}).get("list", []) or []
                if rows:
                    return rows
        except Exception as e:
            print(f"    [aviso] tentativa {attempt + 1} falhou: {e}")
        if attempt < _RETRIES - 1:
            time.sleep(_BACKOFF[attempt])
    return []


def _normalizar(rows: list[dict], flow: str) -> list[dict]:
    out = []
    for r in rows:
        try:
            ano = int(str(r.get("year", "")).strip())
            mes = int(str(r.get("monthNumber", "")).strip())
        except (ValueError, TypeError):
            continue
        ncm_codigo = str(r.get("coNcm") or r.get("ncm_codigo") or "").strip()
        ncm_nome   = str(r.get("ncm") or r.get("ncm_nome") or "").strip() or None
        pais       = str(r.get("country") or r.get("pais") or "").strip()

        def _num(key):
            v = r.get(key)
            try:
                f = float(v)
                return None if math.isnan(f) else f
            except (TypeError, ValueError):
                return None

        volume_kg     = _num("metricKG")    or _num("volume_kg")
        valor_fob_usd = _num("metricFOB")   or _num("valor_fob_usd")

        if not ncm_codigo or not pais:
            continue
        out.append({
            "ano": ano, "mes": mes, "flow": flow,
            "ncm_codigo": ncm_codigo, "ncm_nome": ncm_nome,
            "pais": pais,
            "volume_kg": volume_kg, "valor_fob_usd": valor_fob_usd,
        })
    return out


def _meses_range(desde: str | None, n: int) -> list[tuple[str, str]]:
    """Retorna lista de períodos (pf, pt) = (YYYY-MM, YYYY-MM) para cada mês."""
    hoje = date.today().replace(day=1)
    if desde:
        ano_i, mes_i = map(int, desde.split("-"))
        inicio = date(ano_i, mes_i, 1)
    else:
        inicio = hoje
        for _ in range(n - 1):
            inicio = (inicio.replace(day=1) - __import__("datetime").timedelta(days=1)).replace(day=1)

    meses = []
    cur = inicio
    while cur <= hoje:
        meses.append(cur.strftime("%Y-%m"))
        # avança um mês
        if cur.month == 12:
            cur = date(cur.year + 1, 1, 1)
        else:
            cur = date(cur.year, cur.month + 1, 1)
    return [(m, m) for m in meses]


# ── Upsert ────────────────────────────────────────────────────────────────────

def _upsert(sb, records: list[dict]):
    total = 0
    batches = math.ceil(len(records) / _BATCH)
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table("mdic_comex").upsert(
            batch, on_conflict="ano,mes,flow,ncm_codigo,pais"
        ).execute()
        total += len(batch)
        print(f"  [{i // _BATCH + 1}/{batches}] {total:,}/{len(records):,}")
    return total


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--meses",  type=int, default=3,
                    help="Quantos meses recentes baixar (default: 3)")
    ap.add_argument("--desde",  type=str, default=None,
                    help="Mês inicial YYYY-MM (ignora --meses)")
    args = ap.parse_args()

    periodos = _meses_range(args.desde, args.meses)
    print(f"Períodos: {periodos[0][0]} → {periodos[-1][1]} ({len(periodos)} meses)")

    url, key = _get_creds()
    sb = create_client(url, key)

    all_records: list[dict] = []
    for pf, pt in periodos:
        for flow in ("import", "export"):
            print(f"  API {flow} {pf}...", end=" ", flush=True)
            rows = _post_retry(flow, pf, pt)
            normed = _normalizar(rows, flow)
            print(f"{len(normed):,} linhas")
            all_records.extend(normed)

    if not all_records:
        print("Nenhum dado obtido. Encerrando.")
        sys.exit(0)

    print(f"\nTotal: {len(all_records):,} registros")
    print("Upserting no Supabase...")
    total = _upsert(sb, all_records)
    print(f"Concluido: {total:,} registros upserted em mdic_comex")


if __name__ == "__main__":
    main()
