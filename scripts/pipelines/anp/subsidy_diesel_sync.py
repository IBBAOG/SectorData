#!/usr/bin/env python3
"""
subsidy_diesel_sync.py
======================
Downloads ANP diesel subsidy reference price PDFs and upserts
daily regional prices into anp_subsidy_diesel_reference.

Data model:
  Each PDF covers one "periodo de apuracao" (~2 weeks).
  The table has ONE ROW per (data_referencia, regiao, tipo_agente).
  tipo_agente is either 'importador' (page 0 of PDF) or 'produtor' (page 1).

Source page (auto-discovered):
  https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/
  subvencao-a-comercializacao-de-oleo-diesel-rodoviario-<YEAR>

PDF URL pattern (2026 onwards — two naming conventions coexist):
  Legacy (primeiro–quinto):  /arquivos/subvencao-2026/<ordinal>-periodo-subvencao.pdf
  New    (sexto+):           /arquivos/subvencao-2026/<ordinal>-periodo-diesel.pdf
  GLP variants (skip):       *-periodo-glp.pdf, pr-p*-glp.pdf

Each PDF table has columns:
  DIA (d) | Norte | Nordeste | Centro-Oeste | Sudeste | Sul | DIA (d-2)

The script pivots this wide table into (date, regiao, preco_referencia) rows
for each agent type present in the PDF.

Idempotent: ON CONFLICT (data_referencia, regiao, tipo_agente) DO UPDATE.

Usage:
    python scripts/pipelines/anp/subsidy_diesel_sync.py
    python scripts/pipelines/anp/subsidy_diesel_sync.py --backfill
    python scripts/pipelines/anp/subsidy_diesel_sync.py --dry-run
    python scripts/pipelines/anp/subsidy_diesel_sync.py --all-pdfs   # debug

Credentials: SUPABASE_URL + SUPABASE_SERVICE_KEY (env or .env)
"""

import argparse
import math
import os
import re
import sys
import unicodedata
from datetime import date, datetime, timedelta
from io import BytesIO
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from supabase import create_client

try:
    import pdfplumber
except ImportError:
    print("[subsidy-diesel] ERROR: pdfplumber not installed. Run: pip install pdfplumber")
    sys.exit(1)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ANP_BASE = "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; IBBA-ETL/1.0; +https://itaubba.com)"
}
_BATCH = 500
_TABLE = "anp_subsidy_diesel_reference"
_TABLE_COMM = "anp_subsidy_commercialization"

# Commercialization HTML page URL pattern (per year)
_COMM_URL_TEMPLATE = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/"
    "subvencao-a-comercializacao-de-oleo-diesel-rodoviario-{year}"
)

# HTTP headers for the commercialization HTML scrape.
# IMPORTANT: do NOT advertise "br" in Accept-Encoding — see CLAUDE.md Pegadinha #12.
# requests handles gzip/deflate transparently; advertising br without the brotli
# package installed yields HTTP 200 with binary garbage in resp.text → silent
# empty parse (BeautifulSoup finds 0 tables → 0 rows → silent outage).
_COMM_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
}

# Price sanity bounds (BRL/liter). Values outside this range are dropped.
_PRICE_MIN = 2.0
_PRICE_MAX = 12.0

# Regex: filenames that contain diesel period reference price tables.
#
# ANP uses two naming conventions (coexist on the 2026 page):
#   Legacy (primeiro–quinto):  <ordinal>-periodo-subvencao.pdf
#   New    (sexto+):           <ordinal>-periodo-diesel.pdf
#
# Explicitly excluded (GLP / cooking-gas variants — different subsidy programme):
#   <ordinal>-periodo-glp.pdf
#   pr-p<N>-glp.pdf
#
# The alternation (subvencao|diesel) keeps both diesel conventions while
# rejecting glp without requiring a separate blocklist.
_PERIODO_PDF_RE = re.compile(
    r"^[\w]+-periodo-(subvencao|diesel)\.pdf$",
    re.IGNORECASE,
)

# Year-page link pattern
_YEAR_PAGE_PATTERN = re.compile(
    r"subvencao-a-comercializacao-de-oleo-diesel-rodoviario-(\d{4})",
    re.IGNORECASE,
)

# Column names (normalized) that identify each region in the wide table
_REGION_COLUMNS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"]

# Canonical region set
_REGION_CANONICAL = {"NORTE", "NORDESTE", "CENTRO-OESTE", "SUDESTE", "SUL"}

# Map of possible column header variants → canonical name
_REGION_COL_ALIASES: dict[str, str] = {
    "NORTE": "NORTE",
    "NORDESTE": "NORDESTE",
    "CENTRO-OESTE": "CENTRO-OESTE",
    "CENTRO OESTE": "CENTRO-OESTE",
    "C.OESTE": "CENTRO-OESTE",
    "CENTROESTE": "CENTRO-OESTE",
    "SUDESTE": "SUDESTE",
    "SUL": "SUL",
}

# Agent type labels detected from PDF page text
_AGENT_TYPE_IMPORTADOR = "importador"
_AGENT_TYPE_PRODUTOR = "produtor"

# Text patterns in the header that distinguish agent type
_PRODUTOR_KEYWORDS = [
    "petr",  # "petróleo nacional próprio"
    "nacional pr",
    "produtor",
]


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------

def _get_creds() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        env_path = Path(__file__).parent.parent.parent.parent / ".env"
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
        print("[subsidy-diesel] ERROR: SUPABASE_URL or SUPABASE_SERVICE_KEY not set")
        sys.exit(1)
    return url, key


# ---------------------------------------------------------------------------
# Discovery — parent page → year page → period PDF links
# ---------------------------------------------------------------------------

def _discover_year_page_url() -> str | None:
    """GET the ANP parent pricing page and follow the link for the current year."""
    current_year = date.today().year
    print(f"[subsidy-diesel] Discovering year page for {current_year}...")
    try:
        r = requests.get(_ANP_BASE, headers=_HEADERS, timeout=30)
        r.raise_for_status()
    except Exception as e:
        print(f"[subsidy-diesel] WARNING: Failed to GET parent page: {e}")
        return None

    soup = BeautifulSoup(r.text, "lxml")
    best_url: str | None = None
    best_year: int = 0

    for a in soup.find_all("a", href=True):
        href = a["href"]
        m = _YEAR_PAGE_PATTERN.search(href)
        if not m:
            continue
        year = int(m.group(1))
        if year > best_year:
            best_year = year
            best_url = href if href.startswith("http") else "https://www.gov.br" + href

    if best_url:
        print(f"[subsidy-diesel] Found year page ({best_year}): {best_url}")
    else:
        fallback = (
            f"{_ANP_BASE}"
            f"/subvencao-a-comercializacao-de-oleo-diesel-rodoviario-{current_year}"
        )
        print(
            f"[subsidy-diesel] WARNING: Could not find year page via scrape. "
            f"Trying constructed URL: {fallback}"
        )
        best_url = fallback

    return best_url


def _discover_period_pdfs(
    year_page_url: str,
    *,
    backfill: bool,
    all_pdfs: bool,
) -> list[tuple[str, str | None]]:
    """
    GET the year page and collect period PDF anchors.

    Filter logic (unless --all-pdfs):
      - Only filenames matching _PERIODO_PDF_RE (e.g. "terceiro-periodo-subvencao.pdf")
      - Skip obviously irrelevant PDFs (roteiro, anexo, declaracao, glp, saldos, decisao)

    Returns list of (pdf_url, anchor_text | None).
    """
    print(f"[subsidy-diesel] Fetching year page: {year_page_url}")
    try:
        r = requests.get(year_page_url, headers=_HEADERS, timeout=30)
        r.raise_for_status()
    except Exception as e:
        print(f"[subsidy-diesel] ERROR: Failed to GET year page: {e}")
        return []

    soup = BeautifulSoup(r.text, "lxml")
    cutoff = date.today() - timedelta(days=14)

    results: list[tuple[str, str | None]] = []
    seen: set[str] = set()

    for a in soup.find_all("a", href=True):
        href: str = a["href"]
        if not href.lower().endswith(".pdf"):
            continue

        full_url = href if href.startswith("http") else "https://www.gov.br" + href
        if full_url in seen:
            continue
        seen.add(full_url)

        fname = href.split("/")[-1].lower()

        # Unless --all-pdfs, restrict to periodo PDFs only
        if not all_pdfs:
            if not _PERIODO_PDF_RE.match(fname):
                continue

        anchor_text = a.get_text(strip=True) or None

        # Recency filter for incremental mode
        if not backfill and not all_pdfs:
            detected_date = _extract_period_start_from_anchor(anchor_text or "")
            if detected_date is not None and detected_date < cutoff:
                print(
                    f"[subsidy-diesel] Skip (too old: {detected_date}): {fname}"
                )
                continue

        results.append((full_url, anchor_text))

    print(f"[subsidy-diesel] Found {len(results)} period PDF(s) to process")
    return results


# ---------------------------------------------------------------------------
# Date extraction from anchor text
# ---------------------------------------------------------------------------

# Anchor text patterns for period date ranges.
#
# ANP uses two formats in accordion headings:
#
#   Older (year after each date):
#     "... (1º a 15 de maio de 2026)"
#     "... (7 a 19 de abril de 2026)"
#   New (year only after end date — sexto onwards):
#     "... (16 de maio a 31 de maio de 2026)"
#     "... (de 16 de maio a 31 de maio de 2026)"
#
# _ANCHOR_RANGE_NEW_RE: "N de mês a N de mês de YYYY"  (sexto+, year at end only)
#   Group 1: start day; Group 2: start month; Group 3: year
# _ANCHOR_RANGE_OLD_RE: "N a N de mês de YYYY"  (older periods, no "de" before start month)
#   Group 1: start day; Group 2: shared month; Group 3: year
# _ANCHOR_DATE_RE: final fallback — "N de mês de YYYY" (year per date, or only one date present)
#
_ANCHOR_RANGE_NEW_RE = re.compile(
    r"(\d+)[ºo°]?\s+de\s+(\w+)\s+a\s+\d+[ºo°]?\s+de\s+\w+\s+de\s+(\d{4})",
    re.IGNORECASE,
)
_ANCHOR_RANGE_OLD_RE = re.compile(
    r"(\d+)[ºo°]?\s+a\s+\d+[ºo°]?\s+de\s+(\w+)\s+de\s+(\d{4})",
    re.IGNORECASE,
)
# Keep old name as alias so nothing else breaks if it were referenced
_ANCHOR_RANGE_RE = _ANCHOR_RANGE_NEW_RE
_ANCHOR_DATE_RE = re.compile(
    r"(\d+)[ºo°]?\s+(?:de\s+)?(\w+)\s+(?:de\s+)?(\d{4})",
    re.IGNORECASE,
)
_MONTH_PT: dict[str, int] = {
    "janeiro": 1, "fevereiro": 2, "março": 3, "marco": 3,
    "abril": 4, "maio": 5, "junho": 6,
    "julho": 7, "agosto": 8, "setembro": 9,
    "outubro": 10, "novembro": 11, "dezembro": 12,
}

# Also handle dd/mm/yyyy pattern
_DATE_SLASH_RE = re.compile(r"(\d{2})/(\d{2})/(\d{4})")


def _strip_accents(s: str) -> str:
    nfkd = unicodedata.normalize("NFD", s)
    return "".join(c for c in nfkd if unicodedata.category(c) != "Mn")


def _extract_period_start_from_anchor(text: str) -> date | None:
    """
    Extract the START date of the period from anchor text.

    Handles four formats (all observed in ANP accordion headings):
      1. dd/mm/yyyy literal        — "... 07/04/2026 a ..."
      2. New range (year at end):  "... (16 de maio a 31 de maio de 2026) ..."
         → _ANCHOR_RANGE_NEW_RE: start day + month before "a", year from end date
      3. Old range (shared month): "... (1º a 15 de maio de 2026) ..."
         → _ANCHOR_RANGE_OLD_RE: start day before "a", shared month + year at end
      4. Single date fallback:     "... (15 de maio de 2026) ..."
         → _ANCHOR_DATE_RE: first "N de mês de YYYY" found
    """
    normalized = _strip_accents(text.lower())

    # 1 — dd/mm/yyyy
    m = _DATE_SLASH_RE.search(normalized)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return date(y, mo, d)
        except ValueError:
            pass

    # 2a — New range "N de mês a N de mês de YYYY" (sexto+ naming; year at end only)
    #       Group 1: start day; Group 2: start month; Group 3: year
    m = _ANCHOR_RANGE_NEW_RE.search(normalized)
    if m:
        day_str, month_str, year_str = m.group(1), m.group(2), m.group(3)
        month_num = _MONTH_PT.get(month_str)
        if month_num is not None:
            try:
                return date(int(year_str), month_num, int(day_str))
            except ValueError:
                pass

    # 2b — Old range "N a N de mês de YYYY" (first through quinto; shared month, year at end)
    #       Group 1: start day; Group 2: shared month; Group 3: year
    m = _ANCHOR_RANGE_OLD_RE.search(normalized)
    if m:
        day_str, month_str, year_str = m.group(1), m.group(2), m.group(3)
        month_num = _MONTH_PT.get(month_str)
        if month_num is not None:
            try:
                return date(int(year_str), month_num, int(day_str))
            except ValueError:
                pass

    # 3 — Final fallback: first "N de mês de YYYY" found
    for m in _ANCHOR_DATE_RE.finditer(normalized):
        day_str, month_str, year_str = m.group(1), m.group(2), m.group(3)
        month_num = _MONTH_PT.get(month_str)
        if month_num is None:
            continue
        try:
            return date(int(year_str), month_num, int(day_str))
        except ValueError:
            continue

    return None


def _extract_period_dates_from_pdf_text(text: str) -> tuple[date | None, date | None]:
    """
    Extract period start and end dates from PDF first-page text.
    Looks for: "Período de apuração: 07/04/2026 a 19/04/2026"
    """
    # Pattern: two dd/mm/yyyy (or dd/mm/yy) dates separated by " a "
    period_re = re.compile(
        r"per[íi]odo\s+de\s+apura[cç][aã]o\s*[:\-]?\s*"
        r"(\d{1,2}/\d{2}/\d{2,4})\s+a\s+(\d{1,2}/\d{2}/\d{2,4})",
        re.IGNORECASE,
    )
    m = period_re.search(text)
    if not m:
        return None, None

    def _parse_date(s: str) -> date | None:
        parts = s.split("/")
        if len(parts) != 3:
            return None
        d, mo, y = int(parts[0]), int(parts[1]), int(parts[2])
        if y < 100:
            y += 2000
        try:
            return date(y, mo, d)
        except ValueError:
            return None

    return _parse_date(m.group(1)), _parse_date(m.group(2))


# ---------------------------------------------------------------------------
# Agent type detection from PDF page text
# ---------------------------------------------------------------------------

def _detect_agent_type(page_text: str) -> str:
    """
    Detect whether a PDF page belongs to 'importador' or 'produtor' agent type.
    Importers/mixed is the default; producers of domestic crude are page 2.
    """
    lower = _strip_accents(page_text.lower())
    # Check for explicit producer language EXCLUDING the "importadores e produtores" phrase
    # (page 0 says "importadores ... e produtores ... que refinem petróleo importado e nacional")
    # (page 1 says "Produtores que refinem petróleo nacional próprio")
    if "nacional pr" in lower or "proprio" in lower:
        return _AGENT_TYPE_PRODUTOR
    return _AGENT_TYPE_IMPORTADOR


# ---------------------------------------------------------------------------
# PDF table extraction + parsing
# ---------------------------------------------------------------------------

def _normalize_col_header(raw: str) -> str | None:
    """Normalize a column header string to a canonical region name, or None."""
    cleaned = _strip_accents(raw.strip().upper())
    cleaned = re.sub(r"[^\x00-\x7F]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    normed = cleaned.replace("-", " ")
    if cleaned in _REGION_COL_ALIASES:
        return _REGION_COL_ALIASES[cleaned]
    if normed in _REGION_COL_ALIASES:
        return _REGION_COL_ALIASES[normed]
    return None


def _parse_price(raw) -> float | None:
    """Convert Brazilian decimal string or numeric to float."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s.lower() in ("nan", "none", "-", ""):
        return None
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")
    try:
        v = float(s)
        return v if _PRICE_MIN <= v <= _PRICE_MAX else None
    except ValueError:
        return None


def _parse_date_dd_mm_yy(raw: str) -> date | None:
    """Parse a date string like '07/04/26' or '07/04/2026'."""
    raw = raw.strip()
    m = re.match(r"(\d{1,2})/(\d{2})/(\d{2,4})$", raw)
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if y < 100:
        y += 2000
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def _extract_rows_from_page(
    page,
    fname: str,
    agent_type: str,
) -> list[dict]:
    """
    Extract all (date, region, price, tipo_agente) rows from a single PDF page.

    The page table looks like:
      Row 0: ["PREÇO DE REFERENCIA NO DIA...", None, ...]
      Row 1: ["", "", ...]
      Row 2: ["DIA (d)", "Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul", "DIA (d-2)"]
      Row 3: ["07/04/26", "6,3484", "6,3285", "6,5737", "6,3573", "6,3759", "02/04/26"]
      ...
    """
    table = page.extract_table()
    if not table:
        return []

    # Find the header row: the row whose first cell is exactly "DIA (d)" (or similar)
    # and whose second cell is a region name.
    # We must NOT pick the title row ("PREÇO DE REFERENCIA NO DIA ... em R$/Litro").
    header_idx: int | None = None
    for i, row in enumerate(table):
        if not row or not row[0]:
            continue
        cell0 = str(row[0]).strip().upper()
        # Must match "DIA (D)" pattern exactly — not the long title row
        if re.match(r"^DIA\s*\(D\)$", cell0):
            header_idx = i
            break

    if header_idx is None:
        print(f"[subsidy-diesel] WARNING: No header row found in {fname} ({agent_type})")
        return []

    header_row = table[header_idx]

    # Map column index → canonical region name
    col_to_region: dict[int, str] = {}
    for col_idx, cell in enumerate(header_row):
        if cell is None:
            continue
        region = _normalize_col_header(str(cell))
        if region:
            col_to_region[col_idx] = region

    if not col_to_region:
        print(f"[subsidy-diesel] WARNING: No region columns found in {fname} ({agent_type})")
        return []

    # First column should be the date column (DIA(d))
    date_col_idx = 0  # column 0 is always DIA(d)

    records: list[dict] = []
    for row in table[header_idx + 1 :]:
        if not row or not row[date_col_idx]:
            continue
        raw_date = str(row[date_col_idx]).strip()
        parsed_date = _parse_date_dd_mm_yy(raw_date)
        if parsed_date is None:
            continue  # skip non-data rows

        for col_idx, region in col_to_region.items():
            if col_idx >= len(row):
                continue
            price = _parse_price(row[col_idx])
            if price is None:
                continue
            records.append({
                "data_referencia": parsed_date.isoformat(),
                "regiao": region,
                "preco_referencia": price,
                "tipo_agente": agent_type,
            })

    return records


def _process_pdf(pdf_bytes: bytes, fname: str) -> list[dict]:
    """
    Open a PDF and extract all daily rows from all pages.
    Returns a flat list of record dicts.
    """
    records: list[dict] = []

    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            for page_idx, page in enumerate(pdf.pages):
                page_text = page.extract_text() or ""
                agent_type = _detect_agent_type(page_text)

                page_records = _extract_rows_from_page(page, fname, agent_type)

                if page_records:
                    print(
                        f"[subsidy-diesel]   Page {page_idx} ({agent_type}): "
                        f"{len(page_records)} rows"
                    )
                    records.extend(page_records)
                else:
                    print(
                        f"[subsidy-diesel]   Page {page_idx} ({agent_type}): 0 rows"
                    )
    except Exception as e:
        print(f"[subsidy-diesel] WARNING: pdfplumber failed for {fname}: {e}")

    return records


# ---------------------------------------------------------------------------
# Commercialization HTML scraper (period-level price, NOT in PDFs)
# ---------------------------------------------------------------------------
#
# Source: https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/
#         subvencao-a-comercializacao-de-oleo-diesel-rodoviario-<YEAR>
#
# Each "período de apuração" on the page is a logical group of 2 or 3 HTML
# tables (R$/litro, 5 regions: Norte, Nordeste, Centro-Oeste, Sudeste, Sul):
#
#   Period 1 (1º-6 abril 2026 — unified subvenção, single 0.32 cap):
#     - Table A: importadores + produtores petr. importado+nacional terceiros
#                → map to tipo_agente='importador'
#     - Table B: produtores petróleo nacional próprio
#                → map to tipo_agente='produtor'
#
#   Periods 2+ (after 2026-04-07 split — 1.20 importer cap + 0.80 produtor cap):
#     - Table 1: importadores      → tipo_agente='importador'
#     - Table 2: produtores que refinam petr. importado + nacional de terceiros
#                → IGNORE (no corresponding cap in our model)
#     - Table 3: produtores que refinam petróleo nacional próprio
#                → tipo_agente='produtor'
#
# Each table has the shape:
#   ['(Em R$/litro)', 'Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul']
#   ['Preço de Referência(em DD/MM/YYYY)', f1, f2, f3, f4, f5]
#   ['Preço de Comercialização',           c1, c2, c3, c4, c5]
#
# We extract the LAST row (Preço de Comercialização) — that's the period price.
#
# The period date range is read from the closing paragraph immediately AFTER
# the table group:
#   "Esses preços estiveram/estarão vigentes para o período de apuração
#    de N a N de MES de YYYY, ..."
#
# We also handle these date-range variants seen in older periods:
#   "de 1º a 6 de abril de 2026"  (shared month)
#   "de 16 a 31 de maio de 2026"  (shared month)
#   "de N de MES a N de MES de YYYY" (cross-month, year at end only)


# Region column header in the comm tables
_COMM_REGIONS_ORDER = ["NORTE", "NORDESTE", "CENTRO-OESTE", "SUDESTE", "SUL"]

# Cap value matches for agent-type detection in the period header paragraphs.
# Period 1 (unified, R$ 0,32 single cap) uses explicit "Para importadores..." /
# "Para produtores que refinem petróleo nacional próprio" cues; later periods
# rely on table ORDER within the group.
_COMM_CUE_IMPORTADOR = re.compile(
    r"para\s+importadores\b",
    re.IGNORECASE,
)
_COMM_CUE_PRODUTOR_PROPRIO = re.compile(
    r"produtores?\s+que\s+refin(?:em|am)\s+petr[óo]leo\s+nacional\s+pr[óo]prio",
    re.IGNORECASE,
)
_COMM_CUE_PRODUTOR_MIX = re.compile(
    # "produtores que refinem petróleo importado e petróleo nacional adquirido de terceiros"
    r"petr[óo]leo\s+importado\s+e\s+petr[óo]leo\s+nacional\s+adquirido",
    re.IGNORECASE,
)

# Match the closing paragraph that anchors the period date range.
_COMM_PERIOD_RANGE_PT = re.compile(
    r"per[ií]odo\s+de\s+apura[cç][aã]o\s+de\s+(.+?)(?:,|\.|\s+nos\s+termos)",
    re.IGNORECASE | re.DOTALL,
)

# Range subpatterns (apply to the inner text captured above).
# (a) Shared month: "1º a 6 de abril de 2026"  or "16 a 31 de maio de 2026"
_COMM_RANGE_SHARED_MONTH = re.compile(
    r"(\d{1,2})[ºo°]?\s+a\s+(\d{1,2})[ºo°]?\s+de\s+([A-Za-zçÇ]+)\s+de\s+(\d{4})",
    re.IGNORECASE,
)
# (b) Cross-month: "N de MES_A a N de MES_B de YYYY"
_COMM_RANGE_CROSS_MONTH = re.compile(
    r"(\d{1,2})[ºo°]?\s+de\s+([A-Za-zçÇ]+)\s+a\s+(\d{1,2})[ºo°]?\s+de\s+([A-Za-zçÇ]+)\s+de\s+(\d{4})",
    re.IGNORECASE,
)


def _parse_period_range(text: str) -> tuple[date, date] | None:
    """
    Extract (data_inicio, data_fim) from a "período de apuração de ..." snippet.

    Returns None if text doesn't match a known format.
    """
    norm = _strip_accents(text.lower())

    # Try cross-month first (more specific — it has two "de MES" tokens)
    m = _COMM_RANGE_CROSS_MONTH.search(norm)
    if m:
        d1, mes1, d2, mes2, yr = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        mo1 = _MONTH_PT.get(mes1)
        mo2 = _MONTH_PT.get(mes2)
        if mo1 is not None and mo2 is not None:
            try:
                return (
                    date(int(yr), mo1, int(d1)),
                    date(int(yr), mo2, int(d2)),
                )
            except ValueError:
                return None

    # Shared-month variant
    m = _COMM_RANGE_SHARED_MONTH.search(norm)
    if m:
        d1, d2, mes, yr = m.group(1), m.group(2), m.group(3), m.group(4)
        mo = _MONTH_PT.get(mes)
        if mo is not None:
            try:
                return (
                    date(int(yr), mo, int(d1)),
                    date(int(yr), mo, int(d2)),
                )
            except ValueError:
                return None

    return None


def _is_comm_litro_table(table) -> bool:
    """
    True iff the table is a Diesel R$/litro table with 5 regional columns.

    Skips the GLP R$/kg tables (only have "Brasil" column).
    """
    rows = table.find_all("tr")
    if len(rows) < 3:
        return False
    header_cells = [
        c.get_text(strip=True) for c in rows[0].find_all(["td", "th"])
    ]
    if not header_cells:
        return False
    first = header_cells[0].lower()
    if "litro" not in first:
        return False  # filter R$/kg (GLP) tables
    # Need 5 region columns
    region_cells = [_strip_accents(c.upper()).replace(" ", "") for c in header_cells[1:]]
    required = {"NORTE", "NORDESTE", "CENTROOESTE", "SUDESTE", "SUL"}
    return required.issubset(set(c.replace("-", "") for c in region_cells))


def _extract_comm_row(table) -> dict | None:
    """
    Extract the "Preço de Comercialização" row from a comm table.

    Returns dict {regiao: float} keyed by canonical region name, or None.
    """
    rows = table.find_all("tr")
    if len(rows) < 3:
        return None

    # Header row defines column → region mapping
    header_cells = [c.get_text(strip=True) for c in rows[0].find_all(["td", "th"])]
    col_to_region: dict[int, str] = {}
    for idx, cell in enumerate(header_cells):
        if idx == 0:
            continue  # first col is "(Em R$/litro)"
        canon = _normalize_col_header(cell)
        if canon:
            col_to_region[idx] = canon

    if len(col_to_region) != 5:
        return None

    # Find the row whose label is "Preço de Comercialização" (last row by convention,
    # but we match by content to be safe)
    for r in rows:
        cells = [c.get_text(strip=True) for c in r.find_all(["td", "th"])]
        if not cells:
            continue
        label = _strip_accents(cells[0].lower())
        if "comercializacao" in label or "comercializaã" in label:
            result: dict[str, float] = {}
            for idx, region in col_to_region.items():
                if idx >= len(cells):
                    continue
                price = _parse_price(cells[idx])
                if price is None:
                    return None  # incomplete row
                result[region] = price
            return result if len(result) == 5 else None

    return None


def _classify_period_group(
    group_tables: list,
    cue_paragraphs: list[str],
) -> dict[int, str]:
    """
    Decide which tables in a group map to which tipo_agente.

    Inputs:
      group_tables: list of BS4 table elements in document order.
      cue_paragraphs: list of paragraph texts found ANYWHERE inside the group
                      (between tables) — used to detect explicit cues.

    Returns:
      dict mapping table_index → tipo_agente ('importador' | 'produtor').
      Tables not in the dict are intentionally ignored.

    Rules:
      - If we see explicit "Para importadores" / "Para produtores que refinem
        petróleo nacional próprio" cues IN ORDER, use them positionally.
      - Else (no cues — typical for periods 2+ where the page just lists the
        3 tables back-to-back), fall back to ORDER:
            len==3 → table 0=importador, table 2=produtor, table 1=ignored
            len==2 → table 0=importador, table 1=produtor (unified-cap period)
            len==1 → table 0=produtor (defensive; shouldn't happen for diesel)
    """
    n = len(group_tables)
    if n == 0:
        return {}

    # Cue-based mapping: each table is preceded (in the cue list) by a marker.
    # We pair tables to cues by ORDER. If we have exactly one importador cue and
    # one produtor cue, map them respectively.
    importador_cue_idx = None
    produtor_proprio_cue_idx = None
    for i, p in enumerate(cue_paragraphs):
        if _COMM_CUE_IMPORTADOR.search(p) and importador_cue_idx is None:
            importador_cue_idx = i
        if _COMM_CUE_PRODUTOR_PROPRIO.search(p) and produtor_proprio_cue_idx is None:
            produtor_proprio_cue_idx = i

    # When cues are present and we have ≤2 tables, the mapping is direct:
    if importador_cue_idx is not None and produtor_proprio_cue_idx is not None and n == 2:
        return {0: _AGENT_TYPE_IMPORTADOR, 1: _AGENT_TYPE_PRODUTOR}

    # Default positional rules:
    if n >= 3:
        return {0: _AGENT_TYPE_IMPORTADOR, n - 1: _AGENT_TYPE_PRODUTOR}
    if n == 2:
        return {0: _AGENT_TYPE_IMPORTADOR, 1: _AGENT_TYPE_PRODUTOR}
    if n == 1:
        return {0: _AGENT_TYPE_PRODUTOR}
    return {}


def _walk_periods(soup: BeautifulSoup) -> list[dict]:
    """
    Walk the HTML body in document order, grouping comm tables by period.

    A period boundary is the closing paragraph that contains
    "vigentes para o período de apuração de ...".

    Returns a list of period dicts:
      [{
        "tables": [BS4_table_element, ...],
        "cue_paragraphs": [str, ...],
        "data_inicio": date, "data_fim": date,
        "ordinal": int (1-based by document order, ascending — period 1 = first
                       on the page = newest? No: see below)
      }, ...]

    NOTE on ordinal: the ANP page lists periods in REVERSE chronological order
    (newest first). We assign ordinal AFTER seeing all periods, sorted by
    data_inicio ASC, so ordinal=1 is the chronologically-earliest period.
    """
    body = soup.find("body") or soup

    # Linearize all element children to a flat sequence, preserving order
    linear = []
    for el in body.descendants:
        if getattr(el, "name", None) in ("table", "p", "h2", "h3", "h4", "strong"):
            linear.append(el)

    pending_tables: list = []
    pending_paragraphs: list[str] = []
    periods_raw: list[dict] = []

    for el in linear:
        if el.name == "table":
            if _is_comm_litro_table(el):
                pending_tables.append(el)
            continue

        # Text element
        txt = el.get_text(" ", strip=True)
        if not txt:
            continue

        # Check if this paragraph closes a period
        closes = "vigentes para o per" in txt.lower() and "apura" in txt.lower()

        if pending_tables:
            pending_paragraphs.append(txt)

        if closes and pending_tables:
            # Extract the date range from this paragraph
            m = _COMM_PERIOD_RANGE_PT.search(txt)
            if m:
                rng = _parse_period_range(m.group(1))
                if rng is not None:
                    di, df = rng
                    periods_raw.append({
                        "tables": pending_tables,
                        "cue_paragraphs": pending_paragraphs,
                        "data_inicio": di,
                        "data_fim": df,
                    })
                else:
                    print(
                        "[subsidy-diesel][comm] WARN: closing paragraph found but "
                        f"could not parse date range from: {txt[:200]!r}"
                    )
            else:
                print(
                    "[subsidy-diesel][comm] WARN: closing paragraph w/o range: "
                    f"{txt[:200]!r}"
                )
            pending_tables = []
            pending_paragraphs = []

    if pending_tables:
        print(
            f"[subsidy-diesel][comm] WARN: {len(pending_tables)} comm tables left "
            "unmatched at end of document (no closing 'vigentes para o período' paragraph)"
        )

    # Assign ordinal by data_inicio ascending (chronological order: 1st historical = ordinal 1)
    periods_raw.sort(key=lambda p: p["data_inicio"])
    for i, p in enumerate(periods_raw, start=1):
        p["ordinal"] = i

    return periods_raw


def _scrape_commercialization(year: int, sb, *, dry_run: bool = False) -> int:
    """
    Scrape the ANP commercialization page for `year`, parse each "período de
    apuração", and upsert one row per (data_inicio, regiao, tipo_agente) into
    `anp_subsidy_commercialization`.

    Returns the number of rows upserted. Raises if year page returned ZERO
    period rows (silent-empty defence — Pegadinha #12).

    Behaviour for 404 (page not yet published for `year`): logs warning,
    returns 0 without raising. Caller may treat as soft skip.
    """
    url = _COMM_URL_TEMPLATE.format(year=year)
    print(f"\n[subsidy-diesel][comm] GET {url}")
    try:
        r = requests.get(url, headers=_COMM_HEADERS, timeout=30)
    except Exception as e:
        print(f"[subsidy-diesel][comm] ERROR: HTTP exception for year {year}: {e}")
        return 0

    if r.status_code == 404:
        print(f"[subsidy-diesel][comm] Year page {year} returns 404 — skipping.")
        return 0
    if r.status_code != 200:
        print(
            f"[subsidy-diesel][comm] ERROR: HTTP {r.status_code} for year {year} "
            f"(len={len(r.text)})"
        )
        return 0

    # Sanity: Content-Encoding should be gzip/deflate (we never advertise 'br').
    enc = (r.headers.get("Content-Encoding") or "").lower()
    if "br" in enc:
        # Should never happen given our headers, but log loudly if it does —
        # Pegadinha #12: silent brotli garbage is the real bug.
        print(
            f"[subsidy-diesel][comm] WARN: server returned Content-Encoding={enc!r} "
            "— we did not advertise 'br'. Verify response decoded correctly."
        )

    if len(r.text) < 2000:
        raise RuntimeError(
            f"[subsidy-diesel][comm] page for year {year} is suspiciously short "
            f"({len(r.text)} chars). Aborting to avoid silent-empty ingest."
        )

    soup = BeautifulSoup(r.text, "lxml")
    periods = _walk_periods(soup)
    print(f"[subsidy-diesel][comm] {year}: detected {len(periods)} period(s)")

    rows: list[dict] = []
    for p in periods:
        di: date = p["data_inicio"]
        df: date = p["data_fim"]
        n_tables = len(p["tables"])
        print(
            f"[subsidy-diesel][comm]   period ordinal={p['ordinal']} "
            f"{di.isoformat()}..{df.isoformat()}  tables={n_tables}"
        )

        agent_map = _classify_period_group(p["tables"], p["cue_paragraphs"])
        if not agent_map:
            print(
                f"[subsidy-diesel][comm]     WARN: no agent mapping for this period "
                "(skipping)"
            )
            continue

        period_rows = 0
        for tbl_idx, agent in agent_map.items():
            tbl = p["tables"][tbl_idx]
            region_prices = _extract_comm_row(tbl)
            if not region_prices:
                print(
                    f"[subsidy-diesel][comm]     WARN: table {tbl_idx} "
                    f"({agent}) has no parseable 'Preço de Comercialização' row"
                )
                continue
            for regiao, price in region_prices.items():
                if not (_PRICE_MIN <= price <= _PRICE_MAX):
                    print(
                        f"[subsidy-diesel][comm]     WARN: price out of bounds "
                        f"{price} for {regiao}/{agent} in period {di}..{df}"
                    )
                    continue
                rows.append({
                    "data_inicio": di.isoformat(),
                    "data_fim": df.isoformat(),
                    "regiao": regiao,
                    "tipo_agente": agent,
                    "preco_comercializacao": round(price, 4),
                    "ordinal": p["ordinal"],
                    "pdf_url": url,
                })
                period_rows += 1

        expected = 5 * len(agent_map)  # 5 regions × N agents
        if period_rows < expected:
            print(
                f"[subsidy-diesel][comm]     WARN: period {di}..{df} produced "
                f"{period_rows} rows (expected {expected})"
            )
        else:
            print(
                f"[subsidy-diesel][comm]     OK: {period_rows} rows "
                f"({len(agent_map)} agents × 5 regions)"
            )

    if not rows:
        raise RuntimeError(
            f"[subsidy-diesel][comm] year {year}: produced ZERO rows. "
            "Page structure likely changed — failing visibly per Pegadinha #12."
        )

    print(
        f"[subsidy-diesel][comm] {year}: {len(rows)} total rows ready "
        f"({len(periods)} periods)"
    )

    if dry_run or sb is None:
        print("[subsidy-diesel][comm] DRY RUN — sample rows that would be upserted:")
        for r_ in rows[:10]:
            print(f"  {r_}")
        if len(rows) > 10:
            print(f"  ... ({len(rows) - 10} more)")
        return 0

    # Upsert in batches with ON CONFLICT (data_inicio, regiao, tipo_agente) DO UPDATE
    total = 0
    n_batches = math.ceil(len(rows) / _BATCH)
    for i in range(0, len(rows), _BATCH):
        batch = rows[i : i + _BATCH]
        sb.table(_TABLE_COMM).upsert(
            batch,
            on_conflict="data_inicio,regiao,tipo_agente",
        ).execute()
        total += len(batch)
        print(
            f"[subsidy-diesel][comm] upsert batch {i // _BATCH + 1}/{n_batches} "
            f"— {total}/{len(rows)}"
        )

    print(
        f"[subsidy-diesel][comm] {year}: DONE — {total} rows upserted to {_TABLE_COMM}"
    )
    return total


# ---------------------------------------------------------------------------
# Idempotency probe
# ---------------------------------------------------------------------------

def _get_existing_keys(sb) -> set[tuple[str, str, str]]:
    """
    Returns the set of (data_referencia, regiao, tipo_agente) keys already present.
    Used to skip PDFs already fully ingested.
    """
    try:
        resp = (
            sb.table(_TABLE)
            .select("data_referencia,regiao,tipo_agente")
            .execute()
        )
        keys = {
            (row["data_referencia"], row["regiao"], row["tipo_agente"])
            for row in resp.data
        }
        print(f"[subsidy-diesel] Idempotency: {len(keys)} existing rows in DB")
        return keys
    except Exception as e:
        print(f"[subsidy-diesel] WARNING: Could not probe existing keys: {e}")
        return set()


# ---------------------------------------------------------------------------
# Upsert
# ---------------------------------------------------------------------------

def _upsert(sb, records: list[dict]) -> int:
    total = 0
    n_batches = math.ceil(len(records) / _BATCH) if records else 0
    for i in range(0, len(records), _BATCH):
        batch = records[i : i + _BATCH]
        sb.table(_TABLE).upsert(
            batch,
            on_conflict="data_referencia,regiao,tipo_agente",
        ).execute()
        total += len(batch)
        print(
            f"[subsidy-diesel] Upserted batch {i // _BATCH + 1}/{n_batches} "
            f"— {total}/{len(records)}"
        )
    return total


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="ANP diesel subsidy reference price PDF scraper"
    )
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="Process all period PDFs found on the page (default: last 14 days only). "
             "Also scrapes commercialization data for additional historical years.",
    )
    parser.add_argument(
        "--mode",
        choices=["incremental", "backfill"],
        default=None,
        help="Alias for backfill/default mode (workflow-friendly form). "
             "'backfill' is equivalent to --backfill.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be upserted without writing to Supabase",
    )
    parser.add_argument(
        "--all-pdfs",
        action="store_true",
        help="Debug: include ALL PDFs from the year page, not just periodo ones",
    )
    parser.add_argument(
        "--skip-commercialization",
        action="store_true",
        help="Skip the HTML commercialization scrape (only run the PDF reference flow)",
    )
    parser.add_argument(
        "--commercialization-only",
        action="store_true",
        help="Run ONLY the HTML commercialization scrape (skip the PDF reference flow)",
    )
    args = parser.parse_args()

    # Normalize --mode → --backfill
    if args.mode == "backfill":
        args.backfill = True

    if args.skip_commercialization and args.commercialization_only:
        print(
            "[subsidy-diesel] ERROR: --skip-commercialization and "
            "--commercialization-only are mutually exclusive."
        )
        sys.exit(2)

    # Initialize Supabase client EARLY — both flows share it.
    if args.dry_run:
        print("[subsidy-diesel] DRY RUN — no writes to Supabase")
        sb = None
    else:
        url_sup, svc_key = _get_creds()
        sb = create_client(url_sup, svc_key)

    # Step 0 — Scrape commercialization HTML (NEW)
    # Runs BEFORE the PDF flow so that anp_subsidy_commercialization is populated
    # before any computed-subsidy trigger on anp_subsidy_diesel_reference fires.
    if not args.skip_commercialization:
        current_year = date.today().year
        # Backfill: try previous year too. Incremental: current year only.
        years_to_scrape: list[int] = [current_year]
        if args.backfill:
            years_to_scrape = [current_year - 1, current_year]
        total_comm = 0
        for y in years_to_scrape:
            try:
                total_comm += _scrape_commercialization(y, sb, dry_run=args.dry_run)
            except RuntimeError as e:
                # Silent-empty guard fired — re-raise for visible failure
                print(f"[subsidy-diesel][comm] FATAL: {e}")
                # In incremental (current year only), this is a hard error.
                # In backfill, an empty 2025 page is a soft skip already handled
                # inside _scrape_commercialization via 404; a runtime error here
                # means something else broke. Still fail hard.
                raise
            except Exception as e:
                print(
                    f"[subsidy-diesel][comm] ERROR (year {y}): {e}  — "
                    "continuing with other years/flows"
                )
        print(f"[subsidy-diesel][comm] grand total upserted: {total_comm}")

    if args.commercialization_only:
        print("[subsidy-diesel] --commercialization-only set; exiting before PDF flow.")
        return

    # Step 1 — Discover year page
    year_page_url = _discover_year_page_url()
    if not year_page_url:
        print("[subsidy-diesel] ERROR: Could not determine year page URL. Aborting.")
        sys.exit(1)

    # Step 2 — Discover period PDF links
    pdf_links = _discover_period_pdfs(
        year_page_url,
        backfill=args.backfill,
        all_pdfs=args.all_pdfs,
    )
    if not pdf_links:
        print(
            "[subsidy-diesel] No period PDFs found. "
            "Check year page URL or ANP site structure."
        )
        sys.exit(0)

    # Step 3 — Probe existing reference rows for idempotency
    existing_keys: set[tuple] = set()
    if not args.dry_run and sb is not None:
        existing_keys = _get_existing_keys(sb)

    # Step 4 — Process each PDF
    all_records: list[dict] = []
    errors = 0

    for pdf_url, anchor_text in pdf_links:
        fname = pdf_url.split("/")[-1]
        print(f"\n[subsidy-diesel] Processing: {fname}")
        if anchor_text:
            print(f"[subsidy-diesel]   Anchor: {anchor_text[:120]}")

        # Download PDF
        try:
            r = requests.get(pdf_url, headers=_HEADERS, stream=True, timeout=120)
            r.raise_for_status()
            pdf_bytes = r.content
            print(f"[subsidy-diesel]   Downloaded: {len(pdf_bytes) / 1024:.1f} KB")
        except Exception as e:
            print(f"[subsidy-diesel] WARNING: Failed to download {pdf_url}: {e}")
            errors += 1
            continue

        # Extract rows
        records = _process_pdf(pdf_bytes, fname)
        if not records:
            print(f"[subsidy-diesel] WARNING: 0 rows extracted from {fname}")
            errors += 1
            continue

        # Filter out already-existing rows
        new_records = [
            rec
            for rec in records
            if (rec["data_referencia"], rec["regiao"], rec["tipo_agente"])
            not in existing_keys
        ]
        if len(new_records) < len(records):
            print(
                f"[subsidy-diesel]   {len(records) - len(new_records)} rows already in DB, "
                f"{len(new_records)} new"
            )

        all_records.extend(new_records)

    # Step 5 — Dedup across PDFs (same key from multiple PDFs)
    seen_keys: set[tuple] = set()
    deduped: list[dict] = []
    for rec in all_records:
        key = (rec["data_referencia"], rec["regiao"], rec["tipo_agente"])
        if key not in seen_keys:
            seen_keys.add(key)
            deduped.append(rec)

    print(
        f"\n[subsidy-diesel] Summary: {len(deduped)} records to upsert "
        f"| {errors} error(s)"
    )

    if args.dry_run:
        print("[subsidy-diesel] DRY RUN — sample records that would be upserted:")
        for rec in deduped[:20]:
            print(f"  {rec}")
        if len(deduped) > 20:
            print(f"  ... ({len(deduped) - 20} more)")
        print("[subsidy-diesel] DRY RUN complete — no writes performed.")
        return

    # Step 6 — Upsert
    if deduped:
        total = _upsert(sb, deduped)
        print(f"[subsidy-diesel] Done: {total} records upserted to {_TABLE}")
    else:
        print("[subsidy-diesel] Nothing to upsert.")
        if errors > 0:
            sys.exit(1)


if __name__ == "__main__":
    main()
