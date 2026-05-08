#!/usr/bin/env python3
"""
ANP VOIP sync -- pulls BAR (Boletim Anual de Reservas) Excel and upserts anp_voip.

Source:
  https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-estatisticos/
  arquivos-reservas-nacionais-de-petroleo-e-gas-natural/tabela-dados-bar-{YYYY}.xlsx
Sheet: Export
Frequency: annually (BAR publishes ~April each year)

Idempotent: upserts on (ano_publicacao, campo).
"""
from __future__ import annotations

import io
import math
import os
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests
from supabase import create_client

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BAR_URL_TEMPLATE = (
    "https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-estatisticos/"
    "arquivos-reservas-nacionais-de-petroleo-e-gas-natural/"
    "tabela-dados-bar-{year}.xlsx"
)
SHEET = "Export"
TABLE = "anp_voip"
BATCH = 500
_HEADERS = {"User-Agent": "Mozilla/5.0"}

# Mapping from possible XLSX column names -> Supabase column names.
# BAR 2025 added an "Ano" column; BAR 2024 and older do not have it.
# We handle both by position and by name.
_COL_MAP = {
    # possible variants on the left, canonical name on the right
    "Campo/Área de desenvolvimento": "campo",
    "Campo/Area de desenvolvimento": "campo",
    "Campo / Área de desenvolvimento": "campo",
    "Campo / Area de desenvolvimento": "campo",
    "Bacia": "bacia",
    "Estado": "estado",
    "VOIP (bbl)": "voip_bbl",
    "VGIP (m³)": "vgip_m3",
    "VGIP (m3)": "vgip_m3",
    "Petróleo Acumulado (bbl)": "petroleo_acumulado_bbl",
    "Petroleo Acumulado (bbl)": "petroleo_acumulado_bbl",
    "Gás Natural Acumulado (m³)": "gas_acumulado_m3",
    "Gas Natural Acumulado (m3)": "gas_acumulado_m3",
    "Fração Recuperada de Petróleo": "fracao_recuperada",
    "Fracao Recuperada de Petroleo": "fracao_recuperada",
    "Fração Recuperada": "fracao_recuperada",
    "Situação": "situacao",
    "Situacao": "situacao",
}


def _get_creds() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        # Try local .env two levels up from this script
        env_path = Path(__file__).parent.parent.parent / ".env"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
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
        print("Error: SUPABASE_URL or SUPABASE_SERVICE_KEY not set", file=sys.stderr)
        sys.exit(1)
    return url, key


def _download(year: int) -> tuple[bytes, int]:
    """Download BAR XLSX for given year. Falls back to year-1 on 404."""
    url = BAR_URL_TEMPLATE.format(year=year)
    print(f"[voip_sync] downloading {url}")
    r = requests.get(url, headers=_HEADERS, timeout=120)
    if r.status_code == 404:
        year -= 1
        url = BAR_URL_TEMPLATE.format(year=year)
        print(f"[voip_sync] not found, trying previous year: {url}")
        r = requests.get(url, headers=_HEADERS, timeout=120)
    r.raise_for_status()
    print(f"[voip_sync] downloaded {len(r.content) / 1024:.0f} KB (year={year})")
    return r.content, year


def _parse(content: bytes, year: int) -> list[dict]:
    """
    Parse the 'Export' sheet.

    Column layout variations:
      BAR >= 2025  : Ano | Campo/... | Bacia | Estado | VOIP | VGIP | PetAcum | GasAcum | FracRec | Situacao
      BAR <= 2024  : Campo/...       | Bacia | Estado | VOIP | VGIP | PetAcum | GasAcum | FracRec | Situacao

    Strategy:
      1. Read with header=0 so pandas auto-uses row 0 as column names.
      2. Detect if "Ano"-like column exists; if not, inject year from the URL.
      3. Rename via _COL_MAP (fuzzy on accented variants).
      4. Convert NaN -> None.
    """
    df = pd.read_excel(io.BytesIO(content), sheet_name=SHEET, header=0, dtype=str)

    # Strip whitespace from column names
    df.columns = [str(c).strip() for c in df.columns]

    # Detect "Ano" column (BAR 2025+)
    ano_col = next(
        (c for c in df.columns if c.lower() in ("ano", "year")), None
    )

    # Rename known columns
    rename = {}
    for col in df.columns:
        if col in _COL_MAP:
            rename[col] = _COL_MAP[col]
    df = df.rename(columns=rename)

    # Required columns after rename
    required = {"campo", "bacia", "estado", "voip_bbl"}
    missing = required - set(df.columns)
    if missing:
        # Fallback: try mapping by column position if the file has unnamed or
        # unexpected headers. Positions for BAR without "Ano":
        #   0=campo, 1=bacia, 2=estado, 3=voip_bbl, 4=vgip_m3,
        #   5=petroleo_acumulado_bbl, 6=gas_acumulado_m3, 7=fracao_recuperada, 8=situacao
        # Positions for BAR with "Ano":
        #   0=ano, 1=campo, 2=bacia, 3=estado, 4=voip_bbl, 5=vgip_m3,
        #   6=petroleo_acumulado_bbl, 7=gas_acumulado_m3, 8=fracao_recuperada, 9=situacao
        print(f"[voip_sync] WARNING: could not map columns by name. "
              f"Found: {list(df.columns)}. Attempting positional fallback.")
        has_ano_pos = len(df.columns) >= 10
        if has_ano_pos:
            pos_map = {
                df.columns[0]: "ano_publicacao",
                df.columns[1]: "campo",
                df.columns[2]: "bacia",
                df.columns[3]: "estado",
                df.columns[4]: "voip_bbl",
                df.columns[5]: "vgip_m3",
                df.columns[6]: "petroleo_acumulado_bbl",
                df.columns[7]: "gas_acumulado_m3",
                df.columns[8]: "fracao_recuperada",
                df.columns[9]: "situacao",
            }
        else:
            pos_map = {
                df.columns[0]: "campo",
                df.columns[1]: "bacia",
                df.columns[2]: "estado",
                df.columns[3]: "voip_bbl",
                df.columns[4]: "vgip_m3",
                df.columns[5]: "petroleo_acumulado_bbl",
                df.columns[6]: "gas_acumulado_m3",
                df.columns[7]: "fracao_recuperada",
                df.columns[8]: "situacao",
            }
        df = df.rename(columns=pos_map)
        # Re-detect ano_col after positional rename
        ano_col = "ano_publicacao" if "ano_publicacao" in df.columns else None

    # Drop completely empty rows
    df = df.dropna(how="all")

    # Inject ano_publicacao
    if ano_col and ano_col != "ano_publicacao" and ano_col in df.columns:
        df = df.rename(columns={ano_col: "ano_publicacao"})
    if "ano_publicacao" not in df.columns:
        # BAR <= 2024: no year column -- use the URL year
        df["ano_publicacao"] = str(year)

    # Select only the columns we care about (ignore any extras)
    supabase_cols = [
        "ano_publicacao", "campo", "bacia", "estado",
        "voip_bbl", "vgip_m3", "petroleo_acumulado_bbl",
        "gas_acumulado_m3", "fracao_recuperada", "situacao",
    ]
    df = df[[c for c in supabase_cols if c in df.columns]]

    # Coerce numeric columns
    numeric_cols = [
        "ano_publicacao", "voip_bbl", "vgip_m3",
        "petroleo_acumulado_bbl", "gas_acumulado_m3", "fracao_recuperada",
    ]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Coerce ano_publicacao to int (safe after to_numeric)
    if "ano_publicacao" in df.columns:
        df["ano_publicacao"] = df["ano_publicacao"].where(
            df["ano_publicacao"].notna(), other=float(year)
        ).astype(int)

    # NaN -> None for JSON serialization
    df = df.where(pd.notnull(df), None)

    # Drop rows missing the PK fields
    df = df.dropna(subset=["campo"])
    df = df[df["campo"].astype(str).str.strip() != ""]

    return df.to_dict(orient="records")


def _dedup(records: list[dict]) -> list[dict]:
    """Keep last occurrence per (ano_publicacao, campo) before upsert."""
    seen: dict[tuple, dict] = {}
    for row in records:
        key = (row.get("ano_publicacao"), row.get("campo"))
        seen[key] = row
    return list(seen.values())


def _upsert(sb, records: list[dict]) -> int:
    total = 0
    n_batches = math.ceil(len(records) / BATCH)
    for i in range(0, len(records), BATCH):
        chunk = records[i : i + BATCH]
        sb.table(TABLE).upsert(
            chunk, on_conflict="ano_publicacao,campo"
        ).execute()
        total += len(chunk)
        print(f"  [{i // BATCH + 1}/{n_batches}] {total:,}/{len(records):,}")
    return total


def main() -> None:
    # Determine target year: env var BAR_YEAR > current UTC year
    raw_year = os.environ.get("BAR_YEAR", "").strip()
    year = int(raw_year) if raw_year else datetime.utcnow().year

    content, actual_year = _download(year)

    records = _parse(content, actual_year)
    print(f"[voip_sync] parsed {len(records):,} rows before dedup")

    records = _dedup(records)
    print(f"[voip_sync] {len(records):,} unique rows after dedup")

    if not records:
        print("[voip_sync] no data to upsert -- exiting", file=sys.stderr)
        sys.exit(1)

    sb_url, sb_key = _get_creds()
    sb = create_client(sb_url, sb_key)

    total = _upsert(sb, records)
    print(f"[voip_sync] done. {total:,} rows upserted into {TABLE}.")


if __name__ == "__main__":
    main()
