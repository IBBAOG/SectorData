#!/usr/bin/env python3
"""
lpc_backfill.py
===============
Backfill historico ANP LPC de DADOS/anp_lpc_ultimas/lpc_consolidado.parquet
para a tabela anp_lpc no Supabase.

O parquet local tem dados granulares por posto desde 2004. O sync incremental
(lpc_sync.py) baixa apenas as semanas disponíveis na página ANP (últimas ~18
meses). Este script preenche o gap histórico de 2004 a 2022.

Estratégia:
  1. Lê o parquet consolidado (24M linhas de postos).
  2. Identifica a data_fim de cada semana como o max(data_coleta) do grupo.
  3. Filtra apenas semanas com data_fim < max(data_fim) já em Supabase (backfill
     apenas do que está faltando).
  4. Agrega por (data_fim, produto, estado) → preco_medio_venda, n_postos.
  5. Upserta em batches via ON CONFLICT DO UPDATE. Idempotente.

Uso:
    python scripts/pipelines/anp/lpc_backfill.py
    python scripts/pipelines/anp/lpc_backfill.py --from-date 2010-01-01  # so partir dessa data
    python scripts/pipelines/anp/lpc_backfill.py --full                  # reprocessa tudo (ignorar max Supabase)

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
    / "DADOS" / "anp_lpc_ultimas" / "lpc_consolidado.parquet"
)
_BATCH = 500

_ESTADO_PARA_UF = {
    "ACRE": "AC", "ALAGOAS": "AL", "AMAPA": "AP", "AMAZONAS": "AM",
    "BAHIA": "BA", "CEARA": "CE", "DISTRITO FEDERAL": "DF",
    "ESPIRITO SANTO": "ES", "GOIAS": "GO", "MARANHAO": "MA",
    "MATO GROSSO": "MT", "MATO GROSSO DO SUL": "MS", "MINAS GERAIS": "MG",
    "PARA": "PA", "PARAIBA": "PB", "PARANA": "PR", "PERNAMBUCO": "PE",
    "PIAUI": "PI", "RIO DE JANEIRO": "RJ", "RIO GRANDE DO NORTE": "RN",
    "RIO GRANDE DO SUL": "RS", "RONDONIA": "RO", "RORAIMA": "RR",
    "SANTA CATARINA": "SC", "SAO PAULO": "SP", "SERGIPE": "SE",
    "TOCANTINS": "TO",
}


def _get_creds() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        # scripts/pipelines/anp/ is 3 levels below project root
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


def _get_max_date_supabase(sb) -> str:
    """Returns the latest data_fim already in Supabase anp_lpc, or '1900-01-01'."""
    try:
        res = (
            sb.table("anp_lpc")
            .select("data_fim")
            .order("data_fim", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if rows:
            return rows[0]["data_fim"]
    except Exception as e:
        print(f"  Aviso: nao conseguiu consultar max date: {e}")
    return "1900-01-01"


def _load_and_aggregate(
    parquet_path: Path,
    from_date: str | None,
    to_date: str | None,
) -> list[dict]:
    print(f"Lendo parquet: {parquet_path}")
    print("  (arquivo grande ~220MB, aguarde...)")

    # Read in chunks se possivel
    df = pd.read_parquet(parquet_path)
    print(f"  {len(df):,} linhas brutas")

    df["data_coleta"] = pd.to_datetime(df["data_coleta"], errors="coerce")
    df = df.dropna(subset=["data_coleta", "produto", "estado"])

    # Normalizar estado: pode ser sigla (AC) ou nome (ACRE)
    df["estado"] = df["estado"].astype(str).str.strip().str.upper()
    # Se tiver estados por nome, mapear para sigla
    mask_nome = ~df["estado"].str.len().eq(2)
    if mask_nome.any():
        df.loc[mask_nome, "estado"] = df.loc[mask_nome, "estado"].map(
            _ESTADO_PARA_UF
        )
    df = df.dropna(subset=["estado"])

    df["preco_venda"] = pd.to_numeric(df["preco_venda"], errors="coerce")
    df["produto"] = df["produto"].astype(str).str.strip()

    # Calcular data_fim de cada semana: max(data_coleta) dentro do mesmo grupo de semana
    # Usamos Monday-based week (iso week start = Monday)
    df["week_start"] = (
        df["data_coleta"] - pd.to_timedelta(df["data_coleta"].dt.weekday, unit="D")
    ).dt.date

    # data_fim = max data_coleta por week_start
    week_max = df.groupby("week_start")["data_coleta"].transform("max")
    df["data_fim"] = week_max.dt.date.astype(str)

    # Filtrar intervalo de datas
    if from_date:
        df = df[df["data_coleta"] >= pd.Timestamp(from_date)]
    if to_date:
        df = df[df["data_coleta"] <= pd.Timestamp(to_date)]

    if df.empty:
        print("  Nenhum dado no intervalo especificado.")
        return []

    print(f"  data_coleta range: {df['data_coleta'].min().date()} -> {df['data_coleta'].max().date()}")
    print(f"  Semanas distintas: {df['data_fim'].nunique()}")

    # Agregar por (data_fim, produto, estado)
    print("  Agregando por (data_fim, produto, estado)...")
    agg = (
        df.groupby(["data_fim", "produto", "estado"])
        .agg(
            preco_medio_venda=("preco_venda", "mean"),
            preco_medio_compra=("preco_compra", "mean") if "preco_compra" in df.columns else ("preco_venda", lambda x: None),
            n_postos=("preco_venda", "count"),
        )
        .reset_index()
    )

    # Deduplica pela PK (deve ser 1:1 apos groupby, mas garante)
    before = len(agg)
    agg = agg.drop_duplicates(subset=["data_fim", "produto", "estado"])
    if len(agg) != before:
        print(f"  Deduplicados: {before:,} -> {len(agg):,}")

    print(f"  {len(agg):,} registros agregados")

    records = []
    for _, row in agg.iterrows():
        rec = {
            "data_fim":           str(row["data_fim"]),
            "produto":            str(row["produto"]),
            "estado":             str(row["estado"]),
            "preco_medio_venda":  round(float(row["preco_medio_venda"]), 4) if pd.notna(row["preco_medio_venda"]) else None,
            "n_postos":           int(row["n_postos"]),
        }
        # preco_medio_compra so se tiver a coluna
        if "preco_compra" in df.columns:
            rec["preco_medio_compra"] = round(float(row["preco_medio_compra"]), 4) if pd.notna(row.get("preco_medio_compra")) else None
        else:
            rec["preco_medio_compra"] = None
        records.append(rec)

    return records


def _upsert(sb, records: list[dict]) -> int:
    total = 0
    n_batches = math.ceil(len(records) / _BATCH)
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table("anp_lpc").upsert(
            batch, on_conflict="data_fim,produto,estado"
        ).execute()
        total += len(batch)
        print(f"  [{i // _BATCH + 1}/{n_batches}] {total:,}/{len(records):,} upserted", end="\r")
    print()
    return total


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--parquet",    default=str(_PARQUET), help="Caminho do parquet consolidado")
    ap.add_argument("--from-date",  default=None, metavar="YYYY-MM-DD",
                    help="Data de inicio (data_coleta >= from_date). Default: auto (usa max Supabase - 1 semana)")
    ap.add_argument("--to-date",    default=None, metavar="YYYY-MM-DD",
                    help="Data de fim (data_coleta <= to_date). Default: sem limite")
    ap.add_argument("--full",       action="store_true",
                    help="Reprocessar tudo (ignorar max data_fim ja em Supabase)")
    args = ap.parse_args()

    parquet_path = Path(args.parquet)
    if not parquet_path.exists():
        print(f"Erro: parquet nao encontrado em {parquet_path}")
        sys.exit(1)

    url, key = _get_creds()
    sb = create_client(url, key)

    # Determinar from_date
    from_date = args.from_date
    if not from_date and not args.full:
        max_sb = _get_max_date_supabase(sb)
        print(f"Max data_fim em anp_lpc (Supabase): {max_sb}")
        if max_sb != "1900-01-01":
            # Backfill apenas o que falta (antes do max)
            # Como to_date default é None, isso pega tudo abaixo do max Supabase
            # Para nao duplicar o que ja existe, usamos to_date = max_sb
            args.to_date = args.to_date or max_sb
            print(f"  -> Backfilling ate {args.to_date} (excluindo o que ja existe)")
        else:
            print("  -> Supabase vazio, backfill completo")

    records = _load_and_aggregate(parquet_path, from_date, args.to_date)
    if not records:
        print("Nenhum registro para upsert.")
        sys.exit(0)

    print(f"\nUpsertando {len(records):,} registros em anp_lpc...")
    total = _upsert(sb, records)
    print(f"Concluido: {total:,} registros upserted em anp_lpc")


if __name__ == "__main__":
    main()
