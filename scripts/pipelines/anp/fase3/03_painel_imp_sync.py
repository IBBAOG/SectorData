#!/usr/bin/env python3
"""
anp_painel_imp_sync.py
======================
Baixa o liquidos.zip da ANP, extrai apenas as importações de
distribuidores e upserta em anp_painel_imp_dist.
Agrega por (ano, mes, distribuidor, uf, nome_produto). Idempotente.

Uso:
    python scripts/anp_painel_imp_sync.py

Credenciais: SUPABASE_URL + SUPABASE_SERVICE_KEY (env ou .env)
"""
import io
import math
import os
import sys
import zipfile
from pathlib import Path

import pandas as pd
import requests
from supabase import create_client

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_ZIP_URL = (
    "https://www.gov.br/anp/pt-br/centrais-de-conteudo"
    "/dados-abertos/arquivos/mdpg/liquidos.zip"
)
_HEADERS = {"User-Agent": "Mozilla/5.0"}
_BATCH   = 500

_IMPORT_COLS = {
    "Ano":                            "ano",
    "Mês":                            "mes",
    "Distribuidor":                   "distribuidor",
    "Região":                         "regiao",
    "UF":                             "uf",
    "Código do Produto":              "codigo_produto",
    "Nome do Produto":                "nome_produto",
    "Descrição do Produto":           "descricao_produto",
    "Região Origem":                  "regiao_origem",
    "UF Origem":                      "uf_origem",
    "Quantidade de produto (mil m³)": "volume_mil_m3",
}


def _get_creds():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        env = Path(__file__).parent.parent / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
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


def _parse_numero(s) -> float | None:
    if s is None:
        return None
    s = str(s).strip()
    if not s or s.lower() in ("nan", "none"):
        return None
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _parse_importacoes(content: bytes) -> pd.DataFrame:
    """Extract and parse Liquidos_Importacao_de_Distribuidores.csv from ZIP bytes."""
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        names = zf.namelist()
        target = next(
            (n for n in names if "importacao" in n.lower() and "distribui" in n.lower()),
            None,
        )
        if not target:
            raise FileNotFoundError(
                f"Liquidos_Importacao_de_Distribuidores.csv nao encontrado no ZIP. "
                f"Arquivos: {names}"
            )
        with zf.open(target) as f:
            df = pd.read_csv(f, sep=";", encoding="latin-1", dtype=str)

    df = df.rename(columns=_IMPORT_COLS)
    df = df[[c for c in _IMPORT_COLS.values() if c in df.columns]]

    df["ano"] = pd.to_numeric(df["ano"], errors="coerce").astype("Int16")
    df["mes"] = pd.to_numeric(df["mes"], errors="coerce").astype("Int8")
    df["volume_mil_m3"] = df["volume_mil_m3"].apply(_parse_numero)
    df["volume_m3"]     = df["volume_mil_m3"] * 1000.0
    df = df.drop(columns=["volume_mil_m3"])
    df = df.dropna(subset=["ano", "mes"])

    for col in df.select_dtypes(include="object").columns:
        df[col] = df[col].astype(str).str.strip()
        df.loc[df[col].isin(["nan", "None", ""]), col] = None

    return df


def _aggregate(df: pd.DataFrame) -> list[dict]:
    required = {"ano", "mes", "distribuidor", "uf", "nome_produto", "volume_m3"}
    missing  = required - set(df.columns)
    if missing:
        raise ValueError(f"Colunas faltando: {missing}")

    df = df.dropna(subset=["ano", "mes", "distribuidor", "nome_produto"])
    df["uf"] = df["uf"].fillna("N/D")

    agg = (
        df.groupby(["ano", "mes", "distribuidor", "uf", "nome_produto"])["volume_m3"]
        .sum()
        .reset_index()
    )

    records = []
    for _, row in agg.iterrows():
        records.append({
            "ano":          int(row["ano"]),
            "mes":          int(row["mes"]),
            "distribuidor": str(row["distribuidor"]),
            "uf":           str(row["uf"]),
            "nome_produto": str(row["nome_produto"]),
            "volume_m3":    float(row["volume_m3"]) if pd.notna(row["volume_m3"]) else None,
        })
    return records


def _upsert(sb, records: list[dict]) -> int:
    total = 0
    n_batches = math.ceil(len(records) / _BATCH)
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table("anp_painel_imp_dist").upsert(
            batch, on_conflict="ano,mes,distribuidor,uf,nome_produto"
        ).execute()
        total += len(batch)
        print(f"  [{i // _BATCH + 1}/{n_batches}] {total:,}/{len(records):,}")
    return total


def main():
    print(f"Baixando liquidos.zip da ANP...", end=" ", flush=True)
    r = requests.get(_ZIP_URL, headers=_HEADERS, stream=True, timeout=300)
    r.raise_for_status()
    content = r.content
    print(f"{len(content) / 1024 / 1024:.0f} MB")

    print("Extraindo importacoes_distribuidores...")
    df = _parse_importacoes(content)
    print(f"  {len(df):,} linhas brutas")

    records = _aggregate(df)
    print(f"  {len(records):,} registros agregados")

    url, key = _get_creds()
    sb = create_client(url, key)
    total = _upsert(sb, records)
    print(f"Concluido: {total:,} registros em anp_painel_imp_dist")


if __name__ == "__main__":
    main()
