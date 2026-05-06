#!/usr/bin/env python3
"""
upload_supabase.py — MDIC Comex
Lê o Parquet consolidado e faz upsert na tabela mdic_comex do Supabase.

Uso (backfill local ou incremental em CI):
    python alertas/scripts/mdic_comex/upload_supabase.py
    python alertas/scripts/mdic_comex/upload_supabase.py --parquet CAMINHO

Credenciais (env vars; fallback para .env na raiz do projeto):
    SUPABASE_URL
    SUPABASE_SERVICE_KEY
"""
import argparse
import math
import os
import sys
from pathlib import Path

import pandas as pd
from supabase import create_client

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_DEFAULT_PARQUET = Path(__file__).parents[3] / "DADOS" / "mdic_comex" / "comex_consolidado.parquet"
_BATCH = 500


def _get_creds() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        env_path = Path(__file__).parents[3] / ".env"
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


def _clean(records: list[dict]) -> list[dict]:
    """Converte float NaN para None e garante tipos corretos."""
    clean = []
    for r in records:
        row = {}
        for k, v in r.items():
            if isinstance(v, float) and math.isnan(v):
                row[k] = None
            elif hasattr(v, "item"):  # numpy scalar
                row[k] = v.item()
            else:
                row[k] = v
        clean.append(row)
    return clean


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--parquet", type=Path, default=_DEFAULT_PARQUET,
                    help="Caminho do Parquet consolidado")
    args = ap.parse_args()

    if not args.parquet.exists():
        print(f"Parquet nao encontrado: {args.parquet}")
        sys.exit(1)

    print(f"Lendo {args.parquet.name}...")
    df = pd.read_parquet(args.parquet)
    print(f"  {len(df):,} linhas brutas")

    df = df.dropna(subset=["ano", "mes", "flow", "ncm_codigo", "pais"])
    df["ano"] = df["ano"].astype(int)
    df["mes"] = df["mes"].astype(int)
    print(f"  {len(df):,} linhas apos limpeza")

    records = _clean(df.to_dict(orient="records"))

    url, key = _get_creds()
    sb = create_client(url, key)

    total = 0
    batches = math.ceil(len(records) / _BATCH)
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table("mdic_comex").upsert(
            batch, on_conflict="ano,mes,flow,ncm_codigo,pais"
        ).execute()
        total += len(batch)
        batch_num = i // _BATCH + 1
        print(f"  [{batch_num}/{batches}] {total:,}/{len(records):,} registros")

    print(f"Concluido: {total:,} registros upserted em mdic_comex")


if __name__ == "__main__":
    main()
