#!/usr/bin/env python3
"""
anp_lpc_sync.py
===============
Downloads the LPC resale XLSXs (ANP Levantamento de Preços de Combustíveis
— Últimas Semanas Pesquisadas) and upserts station-weighted average prices by
(week_end, product, state) into anp_lpc.

It ALSO ingests the ANP-published NATIONAL ("BRASIL") weekly resale price into
anp_lpc_brasil. That national figure comes from the sibling
"resumo_semanal_lpc_*.xlsx" file (BRASIL sheet) — the same date suffix as the
revendas file, with the path token swapped revendas -> resumo_semanal.

Incremental strategy:
  - Reads the most recent week already in Supabase.
  - Downloads only weeks not yet processed.

Usage:
    python scripts/pipelines/anp/lpc_sync.py            # weekly run (revendas + brasil)
    python scripts/pipelines/anp/lpc_sync.py --backfill-brasil   # backfill anp_lpc_brasil only

Credentials: SUPABASE_URL + SUPABASE_SERVICE_KEY (env or .env)

Pegadinha #12: never advertise `br` in Accept-Encoding — Python `requests` does
not decode Brotli by default and would silently return binary garbage.
"""
import argparse
import datetime as dt
import io
import math
import os
import re
import sys
import unicodedata
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
# Pegadinha #12: do NOT advertise `br` (Brotli) — requests can't decode it by
# default and would silently return binary garbage that read_excel can't parse.
_HEADERS = {"User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip, deflate"}
_BATCH   = 500

# Base path holding the per-year resumo_semanal files. The revendas URL on the
# listing page derives the resumo URL only by swapping the revendas token, but
# for the backfill we construct it directly from this base + year.
_ARQUIVOS_LPC_BASE = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
    "/precos/arquivos-lpc"
)

_PAT_REVENDAS = re.compile(
    r"revendas_lpc_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.xlsx",
    re.IGNORECASE,
)

# Products to keep from the national BRASIL sheet, mapped to the canonical
# product names used by recompute_dg_margins. 'OLEO DIESEL S10' -> 'DIESEL S10'.
# NOTE: 'OLEO DIESEL' (without S10) is S500 — deliberately NOT ingested.
_BRASIL_PRODUTOS = {
    "GASOLINA COMUM":  "GASOLINA COMUM",
    "OLEO DIESEL S10": "DIESEL S10",
}

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
    # Usa calamine como engine para evitar bug openpyxl 3.1.x com ExternalReference
    # em XLSXs da ANP que têm links externos malformados.
    df = pd.read_excel(io.BytesIO(content), skiprows=9, dtype=str, engine="calamine")
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


# ---------------------------------------------------------------------------
# National (BRASIL) resale price — resumo_semanal BRASIL sheet -> anp_lpc_brasil
# ---------------------------------------------------------------------------

def _norm(text: str) -> str:
    """Accent- and case-insensitive normalizer for fuzzy column matching."""
    s = unicodedata.normalize("NFKD", str(text))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.strip().upper()


def _find_col(df: pd.DataFrame, target: str) -> str | None:
    """Find a column matching `target` accent-/case-insensitively. The resumo
    headers carry real accents (PREÇO MÉDIO REVENDA, NÚMERO DE POSTOS …); we
    must not rely on console rendering of those bytes."""
    want = _norm(target)
    for c in df.columns:
        if _norm(c) == want:
            return c
    return None


def _resumo_urls(data_ini: str, data_fim: str) -> list[str]:
    """Candidate resumo_semanal URLs for a week. Handles year-boundary weeks by
    trying both the data_ini year and the data_fim year."""
    fname = f"resumo_semanal_lpc_{data_ini}_{data_fim}.xlsx"
    years = []
    for d in (data_ini, data_fim):
        y = d[:4]
        if y not in years:
            years.append(y)
    return [f"{_ARQUIVOS_LPC_BASE}/{y}/{fname}" for y in years]


def _resumo_url_from_revendas(revendas_url: str) -> str:
    """Derive the resumo_semanal URL from the revendas URL by swapping the
    filename token (same year directory, same date suffix)."""
    return revendas_url.replace("revendas_lpc_", "resumo_semanal_lpc_")


def _download(url: str) -> bytes | None:
    """Download a URL, returning bytes on a plausible XLSX hit, else None."""
    try:
        r = requests.get(url, headers=_HEADERS, stream=True, timeout=180)
        if r.status_code != 200:
            return None
        content = r.content
        if len(content) < 1000:
            return None
        return content
    except Exception:
        return None


def _parse_brasil(content: bytes, data_fim: str) -> list[dict]:
    """Read the BRASIL sheet and return upsert records for the kept products."""
    df = pd.read_excel(
        io.BytesIO(content), sheet_name="BRASIL", skiprows=9,
        dtype=str, engine="calamine",
    )

    col_prod   = _find_col(df, "PRODUTO")
    col_fim    = _find_col(df, "DATA FINAL")
    col_preco  = _find_col(df, "PREÇO MÉDIO REVENDA")
    col_postos = _find_col(df, "NÚMERO DE POSTOS PESQUISADOS")
    if not (col_prod and col_preco):
        print(f"         [WARN] BRASIL sheet missing PRODUTO/PREÇO columns "
              f"for {data_fim}; columns={list(df.columns)}")
        return []

    records: list[dict] = []
    for _, row in df.iterrows():
        prod_raw = _norm(row.get(col_prod, ""))
        if prod_raw not in _BRASIL_PRODUTOS:
            continue
        produto = _BRASIL_PRODUTOS[prod_raw]

        # week_end: prefer the sheet's DATA FINAL (datetime -> date); fall back
        # to the data_fim parsed from the filename.
        wk_end = data_fim
        if col_fim:
            parsed = pd.to_datetime(row.get(col_fim), errors="coerce")
            if pd.notna(parsed):
                wk_end = parsed.date().isoformat()

        # Price: resumo sheet uses '.' decimal, but coerce defensively
        # (str.replace ',' -> '.' is a safe no-op when there is no comma).
        preco = pd.to_numeric(
            str(row.get(col_preco, "")).replace(",", "."), errors="coerce",
        )
        if pd.isna(preco):
            continue

        n_postos = None
        if col_postos:
            n = pd.to_numeric(
                str(row.get(col_postos, "")).replace(".", "").replace(",", ""),
                errors="coerce",
            )
            n_postos = int(n) if pd.notna(n) else None

        records.append({
            "data_fim":      wk_end,
            "produto":       produto,
            "preco_revenda": round(float(preco), 4),
            "n_postos":      n_postos,
        })
    return records


def _fetch_brasil(data_ini: str, data_fim: str, revendas_url: str | None = None) -> list[dict]:
    """Download the resumo_semanal file for a week and extract the national
    (BRASIL) gasolina-comum + diesel-S10 records. Tries the URL derived from the
    revendas listing first, then the year-directory candidates. Returns [] (and
    warns) if the resumo file is missing — a missing resumo must NOT hard-fail
    the LPC run."""
    candidates: list[str] = []
    if revendas_url:
        candidates.append(_resumo_url_from_revendas(revendas_url))
    for u in _resumo_urls(data_ini, data_fim):
        if u not in candidates:
            candidates.append(u)

    for url in candidates:
        content = _download(url)
        if content is None:
            continue
        records = _parse_brasil(content, data_fim)
        if records:
            return records
        # File present but no kept rows: warn, keep trying other candidates.
        print(f"         [WARN] resumo present but 0 BRASIL rows kept: {url}")
    return []


def _upsert_brasil(sb, records: list[dict]) -> int:
    if not records:
        return 0
    total = 0
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table("anp_lpc_brasil").upsert(
            batch, on_conflict="data_fim,produto"
        ).execute()
        total += len(batch)
    return total


def _data_ini_from_fim(data_fim: str) -> str:
    """data_ini = data_fim − 6 days (ANP weekly survey window)."""
    d = dt.date.fromisoformat(data_fim)
    return (d - dt.timedelta(days=6)).isoformat()


def _backfill_brasil(sb) -> None:
    """Backfill anp_lpc_brasil for the computed era. For each distinct data_fim
    in anp_lpc with data_fim >= 2023-05-01, derive the week window, build the
    resumo_semanal URL and upsert the national gasolina+diesel-S10 rows."""
    print("Backfill anp_lpc_brasil — querying computed-era weeks (>= 2023-05-01)...")
    weeks: set[str] = set()
    step, off = 1000, 0
    while True:
        res = (
            sb.table("anp_lpc")
            .select("data_fim")
            .gte("data_fim", "2023-05-01")
            .order("data_fim")
            .range(off, off + step - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break
        for r in rows:
            weeks.add(r["data_fim"])
        if len(rows) < step:
            break
        off += step

    weeks_sorted = sorted(weeks)
    print(f"  {len(weeks_sorted)} distinct weeks: "
          f"{weeks_sorted[0]} → {weeks_sorted[-1]}")

    landed = 0
    missing: list[str] = []
    total_rows = 0
    for data_fim in weeks_sorted:
        data_ini = _data_ini_from_fim(data_fim)
        records = _fetch_brasil(data_ini, data_fim)
        if records:
            n = _upsert_brasil(sb, records)
            total_rows += n
            landed += 1
            prices = {r["produto"]: r["preco_revenda"] for r in records}
            print(f"  [OK] {data_ini}_{data_fim}: {n} rows {prices}")
        else:
            missing.append(data_fim)
            print(f"  [MISS] {data_ini}_{data_fim}: resumo missing / no rows")

    print(f"\nBackfill done: {landed}/{len(weeks_sorted)} weeks landed "
          f"({total_rows} rows upserted).")
    if missing:
        print(f"  {len(missing)} week(s) with no BRASIL value: {missing}")


def main():
    ap = argparse.ArgumentParser(description="ANP LPC sync (revendas + national BRASIL)")
    ap.add_argument(
        "--backfill-brasil", action="store_true",
        help="Backfill anp_lpc_brasil for the computed era and exit "
             "(does not touch anp_lpc).",
    )
    args = ap.parse_args()

    su_url, key = _get_creds()
    sb = create_client(su_url, key)

    if args.backfill_brasil:
        _backfill_brasil(sb)
        return

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
    brasil_records: list[dict] = []
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

        # Also fetch the national (BRASIL) resale price for this week. A missing
        # resumo file must NOT hard-fail the LPC run — warn and continue.
        data_ini = _data_ini_from_fim(data_fim)
        br = _fetch_brasil(data_ini, data_fim, revendas_url=url)
        if br:
            brasil_records.extend(br)
            prices = {r["produto"]: r["preco_revenda"] for r in br}
            print(f"         -> BRASIL {prices}")
        else:
            print(f"         [WARN] no BRASIL row for {data_fim} "
                  f"(resumo_semanal missing); continuing")

    if not all_records:
        print("Nenhum registro gerado.")
        sys.exit(0)

    print(f"\nTotal: {len(all_records):,} registros")
    total = _upsert(sb, all_records)
    print(f"Concluido: {total:,} registros em anp_lpc")

    if brasil_records:
        n = _upsert_brasil(sb, brasil_records)
        print(f"Concluido: {n:,} registros em anp_lpc_brasil")
    else:
        print("[WARN] no BRASIL records ingested this run")


if __name__ == "__main__":
    main()
