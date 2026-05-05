#!/usr/bin/env python3
"""
anp_lpc_sync.py
===============
Baixa os XLSXs de revendas do LPC (ANP Levantamento de Preços de Combustíveis
— Últimas Semanas Pesquisadas) e upserta preços médios agregados por
(data_fim_semana, produto, estado) em anp_lpc.

Estratégia incremental:
  - Consulta a data mais recente já em Supabase.
  - Baixa apenas semanas ainda não processadas.

Uso:
    python scripts/anp_lpc_sync.py

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
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
    "/precos/levantamento-de-precos-de-combustiveis-ultimas-semanas-pesquisadas"
)
_HEADERS = {"User-Agent": "Mozilla/5.0"}
_BATCH   = 500

_PAT_REVENDAS = re.compile(
    r"revendas_lpc_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.xlsx",
    re.IGNORECASE,
)

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

_COLS_XLSX = {
    "CNPJ":               "cnpj",
    "MUNICÍPIO":          "municipio",
    "ESTADO":             "estado_nome",
    "BANDEIRA":           "bandeira",
    "PRODUTO":            "produto",
    "UNIDADE DE MEDIDA":  "unidade",
    "PREÇO DE REVENDA":   "preco_venda",
    "DATA DA COLETA":     "data_coleta",
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


def _find_semanas() -> dict[str, str]:
    """Returns {data_fim: url} for all revendas files on the page."""
    r = requests.get(_PAGE_URL, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    out: dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        m = _PAT_REVENDAS.search(a["href"])
        if m:
            data_fim = m.group(2)
            href = a["href"]
            out[data_fim] = href if href.startswith("http") else "https://www.gov.br" + href
    return dict(sorted(out.items()))


def _get_max_date(sb) -> str:
    """Returns the latest data_fim already in Supabase, or '1900-01-01' if empty."""
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
    except Exception:
        pass
    return "1900-01-01"


def _parse_xlsx(content: bytes, data_fim: str) -> pd.DataFrame:
    df = pd.read_excel(io.BytesIO(content), skiprows=9, dtype=str)
    df = df.rename(columns=_COLS_XLSX)
    cols = [c for c in _COLS_XLSX.values() if c in df.columns]
    df = df[cols].copy()

    df["estado"] = (
        df["estado_nome"].str.strip().str.upper().map(_ESTADO_PARA_UF)
        if "estado_nome" in df.columns
        else None
    )
    df = df.drop(columns=["estado_nome"], errors="ignore")

    df["data_coleta"] = pd.to_datetime(df["data_coleta"], errors="coerce")
    df["preco_venda"] = pd.to_numeric(
        df["preco_venda"].astype(str).str.replace(",", ".", regex=False),
        errors="coerce",
    ).astype("float32")

    for col in ("produto", "bandeira", "unidade"):
        if col in df.columns:
            df[col] = df[col].str.strip()

    df = df.dropna(subset=["data_coleta", "produto", "estado"])
    df["data_fim"] = data_fim
    return df


def _aggregate(df: pd.DataFrame) -> list[dict]:
    agg = (
        df.groupby(["data_fim", "produto", "estado"])
        .agg(
            preco_medio_venda=("preco_venda", "mean"),
            n_postos=("preco_venda", "count"),
        )
        .reset_index()
    )

    records = []
    for _, row in agg.iterrows():
        records.append({
            "data_fim":           str(row["data_fim"]),
            "produto":            str(row["produto"]),
            "estado":             str(row["estado"]),
            "preco_medio_venda":  round(float(row["preco_medio_venda"]), 4) if pd.notna(row["preco_medio_venda"]) else None,
            "preco_medio_compra": None,
            "n_postos":           int(row["n_postos"]),
        })
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
        print(f"  [{i // _BATCH + 1}/{n_batches}] {total:,}/{len(records):,}")
    return total


def main():
    su_url, key = _get_creds()
    sb = create_client(su_url, key)

    max_date = _get_max_date(sb)
    print(f"Ultimo data_fim em anp_lpc: {max_date}")

    print("Consultando pagina LPC ANP...")
    semanas = _find_semanas()
    print(f"  {len(semanas)} semanas encontradas: {min(semanas)} → {max(semanas)}")

    novas = {d: u for d, u in semanas.items() if d > max_date}
    if not novas:
        print("Sem semanas novas. Nada a fazer.")
        sys.exit(0)
    print(f"  {len(novas)} semana(s) nova(s): {sorted(novas)}")

    all_records: list[dict] = []
    for data_fim in sorted(novas):
        url = novas[data_fim]
        nome = url.split("/")[-1].split("?")[0]
        print(f"[{data_fim}] Baixando {nome}...", end=" ", flush=True)
        try:
            r = requests.get(url, headers=_HEADERS, stream=True, timeout=180)
            r.raise_for_status()
            content = r.content
            print(f"{len(content) / 1024:.0f} KB")
        except Exception as e:
            print(f"ERRO: {e}")
            continue

        df = _parse_xlsx(content, data_fim)
        records = _aggregate(df)
        all_records.extend(records)
        print(f"         -> {len(df):,} revendas / {len(records):,} agregados")

    if not all_records:
        print("Nenhum registro gerado.")
        sys.exit(0)

    print(f"\nTotal: {len(all_records):,} registros")
    total = _upsert(sb, all_records)
    print(f"Concluido: {total:,} registros em anp_lpc")


if __name__ == "__main__":
    main()
