#!/usr/bin/env python3
"""
consolidar.py — SINDICOM Combustíveis
Lê o XLSX mais recente em DADOS/sindicom/ e gera:
    DADOS/sindicom/sindicom_consolidado.parquet

Schema:
    ano, mes, tipo, empresa, segmento, tipo_produto, nome_produto,
    tipo_produto_web, regiao, uf, volume

Uso:
    python alertas/scripts/sindicom/consolidar.py
"""
import sys
from pathlib import Path

import pandas as pd

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_DADOS_DIR = Path(__file__).parents[3] / "DADOS" / "sindicom"
_DEST      = _DADOS_DIR / "sindicom_consolidado.parquet"

_MES_MAP = {
    "JANEIRO": 1, "FEVEREIRO": 2, "MARÇO": 3, "ABRIL": 4,
    "MAIO": 5, "JUNHO": 6, "JULHO": 7, "AGOSTO": 8,
    "SETEMBRO": 9, "OUTUBRO": 10, "NOVEMBRO": 11, "DEZEMBRO": 12,
}


def _achar_xlsx() -> Path:
    candidatos = sorted(_DADOS_DIR.glob("tabela_SINDICOM_*.xlsx"), reverse=True)
    if not candidatos:
        raise FileNotFoundError(f"Nenhum XLSX encontrado em {_DADOS_DIR}")
    return candidatos[0]


def main():
    _DADOS_DIR.mkdir(parents=True, exist_ok=True)
    xlsx = _achar_xlsx()
    print(f"Lendo {xlsx.name}...")

    df = pd.read_excel(xlsx, sheet_name="dados_combs", dtype=str)
    print(f"  {len(df):,} linhas brutas")

    # Strip
    for c in df.columns:
        df[c] = df[c].astype(str).str.strip()
        df.loc[df[c].isin(["nan", "None", ""]), c] = None

    df.columns = [c.lower() for c in df.columns]

    # MES → número
    df["mes_num"] = df["mes"].str.upper().map(_MES_MAP)
    sem_mes = df["mes_num"].isna().sum()
    if sem_mes:
        print(f"  [aviso] {sem_mes} linhas com mês não reconhecido: {df[df['mes_num'].isna()]['mes'].unique()}")
    df = df.dropna(subset=["mes_num"])
    df["mes"] = df["mes_num"].astype("Int8")
    df["ano"] = pd.to_numeric(df["ano"], errors="coerce").astype("Int16")
    df = df.drop(columns=["mes_num"])

    df["volume"] = pd.to_numeric(df["volume"], errors="coerce").astype("float64")
    df = df.dropna(subset=["ano", "mes", "volume"])

    col_order = ["ano", "mes", "tipo", "empresa", "segmento",
                 "tipo_produto", "nome_produto", "tipo_produto_web",
                 "regiao", "uf", "volume"]
    df = df[[c for c in col_order if c in df.columns]]
    df = df.sort_values(["ano", "mes", "empresa", "nome_produto", "uf"])

    df.to_parquet(_DEST, index=False, compression="snappy")

    sz = _DEST.stat().st_size / 1024
    print(f"\nSalvo: {_DEST.name} ({sz:.1f} KB)")
    print(f"  {len(df):,} linhas")
    print(f"  Período: {int(df['ano'].min())}-{int(df['mes'].min()):02d} → "
          f"{int(df['ano'].max())}-{int(df[df['ano']==df['ano'].max()]['mes'].max()):02d}")
    print(f"  Empresas:  {sorted(df['empresa'].dropna().unique())}")
    print(f"  Produtos:  {sorted(df['nome_produto'].dropna().unique())}")
    print(f"  Segmentos: {sorted(df['segmento'].dropna().unique())}")


if __name__ == "__main__":
    main()
