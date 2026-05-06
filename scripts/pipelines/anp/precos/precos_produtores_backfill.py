#!/usr/bin/env python3
"""
precos_produtores_backfill.py
==============================
Backfill historico ANP Precos Produtores de
DADOS/anp_precos_produtores/precos_produtores_consolidado.parquet
para a tabela anp_precos_produtores no Supabase.

Lê o parquet consolidado local (2002–2026), deduplica pela PK
(data_inicio, produto, regiao) e upserta via ON CONFLICT DO UPDATE.
Idempotente: pode rodar 2x sem duplicar linhas.

O parquet local tem mais produtos do que o que a ANP disponibiliza no
formato XLS atual (asfaltenos, óleos combustíveis, etc.). Este script
garante que tudo que está no consolidado local chega ao Supabase.

Uso:
    python scripts/pipelines/anp/precos/precos_produtores_backfill.py
    python scripts/pipelines/anp/precos/precos_produtores_backfill.py --desde 2002-01-01
    python scripts/pipelines/anp/precos/precos_produtores_backfill.py --ate 2015-12-31

Credenciais: SUPABASE_URL + SUPABASE_SERVICE_KEY (env ou .env na raiz do projeto)
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

_PARQUET = (
    Path(__file__).resolve().parent.parent.parent.parent.parent
    / "DADOS" / "anp_precos_produtores" / "precos_produtores_consolidado.parquet"
)
_BATCH = 500
_PK = ["data_inicio", "produto", "regiao"]


def _get_creds() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        # scripts/pipelines/anp/precos/ is 4 levels below project root
        project_root = Path(__file__).resolve().parent.parent.parent.parent
        for env_file in [
            project_root / ".env",
            project_root / ".env.local",
            Path.cwd() / ".env",
        ]:
            if env_file.exists():
                for line in env_file.read_text(encoding="utf-8").splitlines():
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


def _load_parquet(parquet_path: Path, desde: str | None, ate: str | None) -> list[dict]:
    print(f"Lendo parquet: {parquet_path}")
    df = pd.read_parquet(parquet_path)
    print(f"  {len(df):,} linhas brutas")

    df["data_inicio"] = pd.to_datetime(df["data_inicio"], errors="coerce")
    df["data_fim"] = pd.to_datetime(df["data_fim"], errors="coerce")

    if desde:
        df = df[df["data_inicio"] >= pd.Timestamp(desde)]
    if ate:
        df = df[df["data_inicio"] <= pd.Timestamp(ate)]

    df = df.dropna(subset=["data_inicio", "produto", "regiao"])

    # Deduplica pela PK antes do upsert
    before = len(df)
    df = df.drop_duplicates(subset=_PK)
    after = len(df)
    if before != after:
        print(f"  Deduplicados: {before:,} -> {after:,}")

    print(f"  {after:,} registros apos filtro/dedup")
    print(f"  data_inicio range: {df['data_inicio'].min().date()} -> {df['data_inicio'].max().date()}")

    records = []
    for _, row in df.iterrows():
        records.append({
            "data_inicio": str(row["data_inicio"].date()),
            "data_fim":    str(row["data_fim"].date()) if pd.notna(row["data_fim"]) else str(row["data_inicio"].date()),
            "produto":     str(row["produto"]),
            "unidade":     str(row["unidade"]) if pd.notna(row.get("unidade")) else None,
            "regiao":      str(row["regiao"]),
            "preco":       float(row["preco"]) if pd.notna(row.get("preco")) else None,
        })
    return records


def _upsert(sb, records: list[dict]) -> int:
    total = 0
    n_batches = math.ceil(len(records) / _BATCH)
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table("anp_precos_produtores").upsert(
            batch, on_conflict="data_inicio,produto,regiao"
        ).execute()
        total += len(batch)
        print(f"  [{i // _BATCH + 1}/{n_batches}] {total:,}/{len(records):,} upserted", end="\r")
    print()
    return total


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--parquet", default=str(_PARQUET), help="Caminho do parquet consolidado")
    ap.add_argument("--desde", type=str, default=None, metavar="YYYY-MM-DD", help="Filtrar a partir desta data")
    ap.add_argument("--ate",   type=str, default=None, metavar="YYYY-MM-DD", help="Filtrar ate esta data (inclusive)")
    args = ap.parse_args()

    parquet_path = Path(args.parquet)
    if not parquet_path.exists():
        print(f"Erro: parquet nao encontrado em {parquet_path}")
        sys.exit(1)

    records = _load_parquet(parquet_path, args.desde, args.ate)
    if not records:
        print("Nenhum registro para upsert.")
        sys.exit(0)

    url, key = _get_creds()
    sb = create_client(url, key)

    print(f"\nUpsertando {len(records):,} registros em anp_precos_produtores...")
    total = _upsert(sb, records)
    print(f"Concluido: {total:,} registros upserted em anp_precos_produtores")


if __name__ == "__main__":
    main()
