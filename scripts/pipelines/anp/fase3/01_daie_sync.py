#!/usr/bin/env python3
"""
anp_daie_sync.py
================
Baixa os CSVs de Importações/Exportações da ANP (Dados Abertos IE)
e upserta em anp_daie. Filtra apenas combustíveis. Idempotente.

Uso:
    python scripts/anp_daie_sync.py

Credenciais: SUPABASE_URL + SUPABASE_SERVICE_KEY (env ou .env)
"""
import io
import math
import os
import re
import sys
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup
from supabase import create_client

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_PAGE_URL = (
    "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos"
    "/importacoes-e-exportacoes"
)
_HEADERS = {"User-Agent": "Mozilla/5.0"}
_BATCH   = 500

_PATS = {
    "petroleo":  re.compile(r"importacoes-exportacoes-petroleo[^/]*\.csv",  re.IGNORECASE),
    "derivados": re.compile(r"importacoes-exportacoes-derivados[^/]*\.csv", re.IGNORECASE),
}

_MES_MAP = {
    "JAN": 1, "FEV": 2, "MAR": 3, "ABR": 4,  "MAI": 5, "JUN": 6,
    "JUL": 7, "AGO": 8, "SET": 9, "OUT": 10, "NOV": 11, "DEZ": 12,
}

_PRODUTOS_COMBUSTIVEIS = {
    "PETRÓLEO",
    "COMBUSTÍVEIS PARA AERONAVES",
    "COMBUSTÍVEIS PARA NAVIOS",
    "COQUE",
    "GASOLINA A",
    "GASOLINA DE AVIAÇÃO",
    "GLP",
    "NAFTA",
    "QUEROSENE DE AVIAÇÃO",
    "QUEROSENE ILUMINANTE",
    "ÓLEO COMBUSTÍVEL",
    "ÓLEO DIESEL",
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


def _find_csv_urls() -> dict[str, str]:
    r = requests.get(_PAGE_URL, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    encontrados: dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        for key, pat in _PATS.items():
            if key not in encontrados and pat.search(href):
                encontrados[key] = (
                    href if href.startswith("http") else "https://www.gov.br" + href
                )
    return encontrados


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


def _parse_csv(content: bytes) -> pd.DataFrame:
    df = pd.read_csv(
        io.BytesIO(content), sep=";", encoding="utf-8-sig", dtype=str
    )
    df = df.rename(columns={
        "ANO":                   "ano",
        "MÊS":                   "mes",
        "PRODUTO":               "produto",
        "OPERAÇÃO COMERCIAL":    "operacao",
        "IMPORTADO / EXPORTADO": "volume_m3",
        "DISPÊNDIO / RECEITA":   "valor_usd",
    })
    df["ano"]      = pd.to_numeric(df["ano"], errors="coerce").astype("Int16")
    df["mes"]      = df["mes"].str.strip().str.upper().map(_MES_MAP).astype("Int8")
    df["produto"]  = df["produto"].str.strip()
    df["operacao"] = df["operacao"].str.strip()
    df["volume_m3"] = df["volume_m3"].apply(_parse_numero)
    df["valor_usd"] = df["valor_usd"].apply(_parse_numero)
    df = df.dropna(subset=["ano", "mes", "produto", "operacao"])
    return df[["ano", "mes", "produto", "operacao", "volume_m3", "valor_usd"]]


def _upsert(sb, records: list[dict]) -> int:
    total = 0
    n_batches = math.ceil(len(records) / _BATCH)
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table("anp_daie").upsert(
            batch, on_conflict="ano,mes,produto,operacao"
        ).execute()
        total += len(batch)
        print(f"  [{i // _BATCH + 1}/{n_batches}] {total:,}/{len(records):,}")
    return total


def main():
    print("Buscando CSVs de Dados Abertos IE na ANP...")
    urls = _find_csv_urls()
    if not urls:
        print("Erro: nenhum CSV encontrado")
        sys.exit(1)
    print(f"  Encontrados: {list(urls)}")

    partes: list[pd.DataFrame] = []
    for key, url in urls.items():
        nome = url.split("/")[-1].split("?")[0]
        print(f"Baixando {nome}...", end=" ", flush=True)
        r = requests.get(url, headers=_HEADERS, stream=True, timeout=180)
        r.raise_for_status()
        content = r.content
        print(f"{len(content) / 1024:.0f} KB")
        df = _parse_csv(content)
        partes.append(df)
        print(f"  -> {len(df):,} linhas")

    consolidado = pd.concat(partes, ignore_index=True)
    antes = len(consolidado)
    consolidado = consolidado[consolidado["produto"].isin(_PRODUTOS_COMBUSTIVEIS)]
    print(f"\nFiltro combustiveis: {antes:,} -> {len(consolidado):,} linhas")

    # Dedup — keep last entry per key
    seen: dict[tuple, dict] = {}
    for _, row in consolidado.iterrows():
        k = (int(row["ano"]), int(row["mes"]), row["produto"], row["operacao"])
        seen[k] = {
            "ano":       k[0],
            "mes":       k[1],
            "produto":   k[2],
            "operacao":  k[3],
            "volume_m3": float(row["volume_m3"]) if pd.notna(row["volume_m3"]) else None,
            "valor_usd": float(row["valor_usd"]) if pd.notna(row["valor_usd"]) else None,
        }
    records = list(seen.values())
    print(f"Total: {len(records):,} registros")

    url, key = _get_creds()
    sb = create_client(url, key)
    total = _upsert(sb, records)
    print(f"Concluido: {total:,} registros em anp_daie")


if __name__ == "__main__":
    main()
