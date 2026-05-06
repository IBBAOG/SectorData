#!/usr/bin/env python3
"""
mdic_comex_backfill.py
======================
Backfill historico MDIC Comex de DADOS/mdic_comex/comex_consolidado.parquet
para a tabela mdic_comex no Supabase.

Lê o parquet consolidado local (1997–2026), deduplica pela PK
(ano, mes, flow, ncm_codigo, pais) e upserta via ON CONFLICT DO UPDATE.
Idempotente: pode rodar 2x sem duplicar linhas.

Uso:
    python scripts/pipelines/mdic_comex_backfill.py
    python scripts/pipelines/mdic_comex_backfill.py --desde 1997  # ano inicial
    python scripts/pipelines/mdic_comex_backfill.py --ate 2023    # ano final

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
    Path(__file__).resolve().parent.parent.parent.parent
    / "DADOS" / "mdic_comex" / "comex_consolidado.parquet"
)
_BATCH = 500
_PK = ["ano", "mes", "flow", "ncm_codigo", "pais"]


def _get_creds() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        # scripts/pipelines/ is 2 levels below project root; try project root .env
        project_root = Path(__file__).resolve().parent.parent.parent
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


def _load_parquet(parquet_path: Path, desde_ano: int, ate_ano: int) -> list[dict]:
    print(f"Lendo parquet: {parquet_path}")
    df = pd.read_parquet(parquet_path)
    print(f"  {len(df):,} linhas brutas, anos {int(df['ano'].min())}-{int(df['ano'].max())}")

    # Filtrar por ano se especificado
    if desde_ano:
        df = df[df["ano"] >= desde_ano]
    if ate_ano:
        df = df[df["ano"] <= ate_ano]

    # Garantir tipos corretos
    df["ano"] = pd.to_numeric(df["ano"], errors="coerce").astype("Int16")
    df["mes"] = pd.to_numeric(df["mes"], errors="coerce").astype("Int8")

    # Deduplica pela PK antes do upsert (regra anti-padrão do projeto)
    before = len(df)
    df = df.dropna(subset=_PK)
    df = df.drop_duplicates(subset=_PK)
    after = len(df)
    if before != after:
        print(f"  Deduplicados: {before:,} -> {after:,}")

    print(f"  {after:,} registros apos filtro/dedup para upload")

    records = []
    for _, row in df.iterrows():
        records.append({
            "ano":          int(row["ano"]),
            "mes":          int(row["mes"]),
            "flow":         str(row["flow"]),
            "ncm_codigo":   str(row["ncm_codigo"]),
            "ncm_nome":     str(row["ncm_nome"]) if pd.notna(row.get("ncm_nome")) else None,
            "pais":         str(row["pais"]),
            "volume_kg":    float(row["volume_kg"]) if pd.notna(row.get("volume_kg")) else None,
            "valor_fob_usd": float(row["valor_fob_usd"]) if pd.notna(row.get("valor_fob_usd")) else None,
        })
    return records


def _upsert(sb, records: list[dict]) -> int:
    total = 0
    n_batches = math.ceil(len(records) / _BATCH)
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table("mdic_comex").upsert(
            batch, on_conflict="ano,mes,flow,ncm_codigo,pais"
        ).execute()
        total += len(batch)
        print(f"  [{i // _BATCH + 1}/{n_batches}] {total:,}/{len(records):,} upserted", end="\r")
    print()
    return total


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--parquet", default=str(_PARQUET), help="Caminho do parquet consolidado")
    ap.add_argument("--desde", type=int, default=0, metavar="ANO", help="Filtrar a partir deste ano")
    ap.add_argument("--ate", type=int, default=0, metavar="ANO", help="Filtrar ate este ano (inclusive)")
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

    print(f"\nUpsertando {len(records):,} registros em mdic_comex...")
    total = _upsert(sb, records)
    print(f"Concluido: {total:,} registros upserted em mdic_comex")


if __name__ == "__main__":
    main()
