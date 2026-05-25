#!/usr/bin/env python3
"""
anp_desembaracos_sync.py
========================
Downloads the ANP yearly Desembaraços XLSXs, aggregates by
(ano, mes, ncm_codigo, pais_origem, importador, cnpj, uf_cnpj) and upserts
into anp_desembaracos.

Strategy:
  - First run (empty DB): downloads ALL years available on the page.
  - Subsequent runs: only the current year (data is incremental/monthly).

Reform note (2026-05-25 — Imports & Exports): the importer columns
(`importador`, `cnpj`, `uf_cnpj`) are now preserved. Previously they were
discarded at the end of `_ler_arquivo`. The Supabase PK was extended to
include `cnpj`. Pre-2020 XLSXs that lack the CNPJ column collapse under the
`__legacy__` sentinel so the composite key resolves uniquely.

Usage:
    python scripts/pipelines/anp/fase3/02_desembaracos_sync.py

Credentials: SUPABASE_URL + SUPABASE_SERVICE_KEY (env or .env)
"""
import math
import os
import re
import sys
import tempfile
from datetime import date
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup
from supabase import create_client

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_PAGE_URL = (
    "https://www.gov.br/anp/pt-br/assuntos/importacoes-e-exportacoes"
    "/relatorio-de-desembaracos-de-importacoes-de-petroleo-gas-derivados-e-biocombustiveis"
)
_HEADERS  = {"User-Agent": "Mozilla/5.0"}
_BATCH    = 500
_FILE_PAT = re.compile(r"desembaraco-(\d{4})\.xlsx", re.IGNORECASE)
_ANO_ATUAL = date.today().year

_COLS_RENAME = {
    "Mês de desembaraço":              "mes",
    "Importador":                      "importador",
    "CNPJ":                            "cnpj",
    "UF DO CNPJ*":                     "uf_cnpj",
    "NCM":                             "ncm",
    "Descrição NCM":                   "descricao_ncm",
    "UA Despacho":                     "ua_despacho",
    "Pais de origem":                  "pais_origem",
    "Quantidade de produto em quilos": "quantidade_kg",
}

# Sentinel used when CNPJ is missing in older XLSXs (pre-2020).
# The Supabase PK is (ano, mes, ncm_codigo, pais_origem, cnpj); cnpj cannot be
# NULL inside a composite PK, so legacy rows collapse under this single sentinel.
_LEGACY_CNPJ = "__legacy__"

_NCMS_COMBUSTIVEIS = {
    22071010, 22072011,
    27090010,
    27101251, 27101911, 27101921, 27101922, 27101931, 27101932, 27101994,
    27111100, 27111300, 27111910, 27112100, 27112910,
    38260000,
}

# Nomes curtos para exibição no dashboard
_NCM_NOMES = {
    "22071010": "Etanol Anidro (≥99%)",
    "22072011": "Etanol Anidro Carburante",
    "27090010": "Petróleo Cru",
    "27101251": "Nafta para Aviação",
    "27101911": "QAV (Querosene Aviação)",
    "27101921": "Diesel (Gasóleo)",
    "27101922": "Fuel-oil",
    "27101931": "Gasolina A",
    "27101932": "Gasolina Aditivada",
    "27101994": "Hidrocarbonetos Parafínicos",
    "27111100": "GNL",
    "27111300": "Butanos (GLP)",
    "27111910": "GLP Propano/Butano",
    "27112100": "Gás Natural (gasoso)",
    "27112910": "Butanos gasoso",
    "38260000": "Biodiesel",
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


def _listar_anos_disponiveis() -> dict[int, str]:
    r = requests.get(_PAGE_URL, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    out: dict[int, str] = {}
    for a in soup.find_all("a", href=True):
        m = _FILE_PAT.search(a["href"])
        if m:
            ano = int(m.group(1))
            href = a["href"]
            out[ano] = href if href.startswith("http") else "https://www.gov.br" + href
    return dict(sorted(out.items()))


def _already_has_history(sb) -> bool:
    """True if anp_desembaracos has any REAL (non-legacy) rows for past years.

    Legacy rows (cnpj='__legacy__') from before the 2026-05-25 Imports & Exports
    reform don't count — they exist for historical totals but lack the
    importador/cnpj/uf_cnpj enrichment that the reform requires. Treating them as
    'history' would short-circuit the next run into current-year-only mode and
    permanently strand historical years with the sentinel value, silently
    undoing the backfill that's supposed to replace them.
    """
    try:
        res = (
            sb.table("anp_desembaracos")
            .select("ano", count="exact")
            .lt("ano", _ANO_ATUAL)
            .neq("cnpj", _LEGACY_CNPJ)
            .limit(1)
            .execute()
        )
        return (res.count or 0) > 0
    except Exception:
        return False


def _baixar(url: str) -> bytes:
    r = requests.get(url, headers=_HEADERS, stream=True, timeout=300)
    r.raise_for_status()
    return r.content


def _ler_arquivo(content: bytes, ano: int) -> pd.DataFrame:
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        with pd.ExcelFile(tmp_path) as xf:
            sheets = [s for s in xf.sheet_names if s.lower().startswith("desemb")]
            partes = []
            for sheet in sheets:
                df = pd.read_excel(xf, sheet_name=sheet, skiprows=2)
                df = df.rename(columns=_COLS_RENAME)
                df = df[pd.to_numeric(df.get("mes", pd.Series()), errors="coerce").notna()]
                partes.append(df)
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    if not partes:
        return pd.DataFrame()

    df = pd.concat(partes, ignore_index=True)
    df["ano"] = ano
    df["mes"] = pd.to_numeric(df["mes"], errors="coerce").astype("Int8")
    df["ncm"] = pd.to_numeric(df["ncm"], errors="coerce").astype("Int64")
    df["quantidade_kg"] = pd.to_numeric(df["quantidade_kg"], errors="coerce").astype("float64")
    df = df[df["ncm"].isin(_NCMS_COMBUSTIVEIS)]
    if "pais_origem" in df.columns:
        df["pais_origem"] = df["pais_origem"].astype(str).str.strip()
        df.loc[df["pais_origem"] == "nan", "pais_origem"] = None
    if "descricao_ncm" in df.columns:
        df["descricao_ncm"] = df["descricao_ncm"].astype(str).str.strip()
        df.loc[df["descricao_ncm"] == "nan", "descricao_ncm"] = None
    # Importer fields: preserved by the Imports & Exports reform (2026-05-25).
    # Older XLSXs (pre-2020) lack these columns — ensure they exist so downstream
    # aggregation does not KeyError; missing cnpj is later replaced by _LEGACY_CNPJ.
    for col in ("importador", "cnpj", "uf_cnpj"):
        if col not in df.columns:
            df[col] = None
        else:
            df[col] = df[col].astype(str).str.strip()
            df.loc[df[col].isin(["nan", "None", ""]), col] = None
    # Normalize CNPJ: strip non-digit characters so equal CNPJs grouped consistently
    # regardless of source formatting ("12.345.678/0001-90" vs "12345678000190").
    df["cnpj"] = df["cnpj"].astype("string").str.replace(r"\D", "", regex=True)
    df.loc[df["cnpj"].isin(["", "nan", "None"]) | df["cnpj"].isna(), "cnpj"] = None
    return df[[
        "ano", "mes", "ncm", "descricao_ncm", "pais_origem", "quantidade_kg",
        "importador", "cnpj", "uf_cnpj",
    ]]


def _aggregate(df: pd.DataFrame) -> list[dict]:
    df = df.dropna(subset=["ano", "mes", "ncm", "pais_origem"])
    df["ncm_codigo"] = df["ncm"].astype(int).astype(str)
    df["ncm_nome"]   = df["ncm_codigo"].map(_NCM_NOMES).fillna(df.get("descricao_ncm", ""))
    # Coalesce missing CNPJ to legacy sentinel so groupby keys are non-null and
    # the upsert PK (ano, mes, ncm_codigo, pais_origem, cnpj) resolves uniquely
    # for pre-2020 rows where the CNPJ column did not exist.
    df["cnpj"] = df["cnpj"].fillna(_LEGACY_CNPJ)
    df["importador"] = df["importador"].fillna("")
    df["uf_cnpj"] = df["uf_cnpj"].fillna("")
    group_keys = [
        "ano", "mes", "ncm_codigo", "ncm_nome", "pais_origem",
        "importador", "cnpj", "uf_cnpj",
    ]
    agg = (
        df.groupby(group_keys)["quantidade_kg"]
        .sum()
        .reset_index()
    )
    records = []
    for _, row in agg.iterrows():
        importador = str(row["importador"]) if row["importador"] else None
        uf_cnpj    = str(row["uf_cnpj"]) if row["uf_cnpj"] else None
        records.append({
            "ano":           int(row["ano"]),
            "mes":           int(row["mes"]),
            "ncm_codigo":    str(row["ncm_codigo"]),
            "ncm_nome":      str(row["ncm_nome"]) if row["ncm_nome"] else None,
            "pais_origem":   str(row["pais_origem"]),
            "quantidade_kg": float(row["quantidade_kg"]) if pd.notna(row["quantidade_kg"]) else None,
            "importador":    importador,
            "cnpj":          str(row["cnpj"]),
            "uf_cnpj":       uf_cnpj,
        })
    return records


def _upsert(sb, records: list[dict]) -> int:
    total = 0
    n_batches = math.ceil(len(records) / _BATCH)
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table("anp_desembaracos").upsert(
            batch, on_conflict="ano,mes,ncm_codigo,pais_origem,cnpj"
        ).execute()
        total += len(batch)
        print(f"  [{i // _BATCH + 1}/{n_batches}] {total:,}/{len(records):,}")
    return total


def main():
    su_url, key = _get_creds()
    sb = create_client(su_url, key)

    has_history = _already_has_history(sb)

    print(f"Consultando pagina ANP Desembaracos...")
    anos_disponiveis = _listar_anos_disponiveis()
    print(f"  {len(anos_disponiveis)} anos: {list(anos_disponiveis)}")

    if has_history:
        anos_para_baixar = {_ANO_ATUAL: anos_disponiveis[_ANO_ATUAL]} if _ANO_ATUAL in anos_disponiveis else {}
        print(f"  Historico ja presente — baixando apenas {_ANO_ATUAL}")
    else:
        anos_para_baixar = anos_disponiveis
        print(f"  Primeiro run — baixando todos os anos")

    all_records: list[dict] = []
    for ano, url in anos_para_baixar.items():
        print(f"[{ano}] Baixando...", end=" ", flush=True)
        try:
            content = _baixar(url)
            print(f"{len(content) / 1024:.0f} KB")
        except Exception as e:
            print(f"ERRO: {e}")
            continue
        df = _ler_arquivo(content, ano)
        if df.empty:
            print(f"       -> 0 linhas (vazio)")
            continue
        records = _aggregate(df)
        all_records.extend(records)
        print(f"       -> {len(df):,} linhas brutas / {len(records):,} agregados")

    if not all_records:
        print("Nada a upsert.")
        sys.exit(0)

    print(f"\nTotal: {len(all_records):,} registros")
    total = _upsert(sb, all_records)
    print(f"Concluido: {total:,} registros em anp_desembaracos")


if __name__ == "__main__":
    main()
