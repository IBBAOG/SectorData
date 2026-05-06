#!/usr/bin/env python3
"""
consolidar.py
=============
Unifica todos os arquivos semestrais LPC (ca-YYYY-NN.csv / .zip) em um
único Parquet: DADOS/anp_lpc_ultimas/lpc_consolidado.parquet

Uso:
    python alertas/scripts/anp_lpc_ultimas/consolidar.py
"""
import io
import sys
import zipfile
from pathlib import Path

import pandas as pd

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_HISTORICO_DIR = Path(__file__).parents[3] / "DADOS" / "anp_lpc_ultimas" / "historico"
_DEST          = Path(__file__).parents[3] / "DADOS" / "anp_lpc_ultimas" / "lpc_consolidado.parquet"

_COLS_RENAME = {
    "﻿Regiao - Sigla": "regiao",
    "Regiao - Sigla":       "regiao",
    "Estado - Sigla":       "estado",
    "Municipio":            "municipio",
    "Revenda":              "revenda",
    "CNPJ da Revenda":      "cnpj",
    "Nome da Rua":          "logradouro",
    "Numero Rua":           "numero",
    "Complemento":          "complemento",
    "Bairro":               "bairro",
    "Cep":                  "cep",
    "Produto":              "produto",
    "Data da Coleta":       "data_coleta",
    "Valor de Venda":       "preco_venda",
    "Valor de Compra":      "preco_compra",
    "Unidade de Medida":    "unidade",
    "Bandeira":             "bandeira",
}

_COLS_KEEP = [
    "regiao", "estado", "municipio", "revenda", "cnpj",
    "produto", "data_coleta", "preco_venda", "preco_compra", "unidade", "bandeira",
]


def _detectar_encoding(primeiros_bytes: bytes) -> str:
    return "utf-8-sig" if primeiros_bytes[:3] == b"\xef\xbb\xbf" else "latin-1"


def _ler_arquivo(path: Path) -> pd.DataFrame:
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as zf:
            nome = next((n for n in zf.namelist() if n.lower().endswith(".csv")), None)
            if not nome:
                return pd.DataFrame()
            with zf.open(nome) as f:
                raw = f.read()
        enc = _detectar_encoding(raw)
        df = pd.read_csv(io.BytesIO(raw), sep=";", encoding=enc,
                         dtype=str, low_memory=False)
    else:
        with open(path, "rb") as fh:
            enc = _detectar_encoding(fh.read(4))
        df = pd.read_csv(path, sep=";", encoding=enc,
                         dtype=str, low_memory=False)

    df = df.rename(columns=_COLS_RENAME)
    # keep only known columns that exist
    cols = [c for c in _COLS_KEEP if c in df.columns]
    return df[cols]


def _limpar(df: pd.DataFrame) -> pd.DataFrame:
    # Parse date
    df["data_coleta"] = pd.to_datetime(
        df["data_coleta"].str.strip(), format="%d/%m/%Y", errors="coerce"
    )
    # Parse prices (Brazilian decimal comma)
    for col in ("preco_venda", "preco_compra"):
        if col in df.columns:
            df[col] = (
                df[col].str.strip()
                       .str.replace(".", "", regex=False)
                       .str.replace(",", ".", regex=False)
            )
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("float32")

    # Strip strings
    for col in ("regiao", "estado", "municipio", "produto", "bandeira", "unidade"):
        if col in df.columns:
            df[col] = df[col].str.strip()

    # Drop rows with no date or no product
    df = df.dropna(subset=["data_coleta", "produto"])
    return df


def main():
    arquivos = sorted(
        list(_HISTORICO_DIR.glob("ca-*.csv")) +
        list(_HISTORICO_DIR.glob("ca-*.zip"))
    )
    print(f"Arquivos encontrados: {len(arquivos)}")
    print(f"Destino: {_DEST}\n")

    partes = []
    total_linhas = 0

    for i, arq in enumerate(arquivos, 1):
        print(f"  [{i:02d}/{len(arquivos)}] {arq.name}...", end=" ", flush=True)
        try:
            df = _ler_arquivo(arq)
            df = _limpar(df)
            partes.append(df)
            total_linhas += len(df)
            print(f"{len(df):,} linhas")
        except Exception as e:
            print(f"ERRO: {e}")

    print(f"\nConcatenando {total_linhas:,} linhas...")
    consolidado = pd.concat(partes, ignore_index=True)

    # Sort by date then state then product
    consolidado = consolidado.sort_values(["data_coleta", "estado", "produto"])

    print(f"Salvando Parquet em {_DEST}...")
    consolidado.to_parquet(_DEST, index=False, compression="snappy")

    size_mb = _DEST.stat().st_size / 1024 / 1024
    print(f"\nConcluido!")
    print(f"  Linhas:  {len(consolidado):,}")
    print(f"  Periodo: {consolidado['data_coleta'].min().date()} → {consolidado['data_coleta'].max().date()}")
    print(f"  Tamanho: {size_mb:.1f} MB")
    print(f"  Colunas: {list(consolidado.columns)}")


if __name__ == "__main__":
    main()
