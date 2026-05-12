#!/usr/bin/env python3
"""
subsidy_diesel_sync.py
======================
Downloads ANP daily diesel subsidy reference price PDFs and upserts
regional prices into anp_subsidy_diesel_reference.

Idempotent — ON CONFLICT (data_referencia, regiao) DO UPDATE.

Source (auto-discovered — current year):
  https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia
  /subvencao-a-comercializacao-de-oleo-diesel-rodoviario-<YEAR>

Each PDF contains a regional table with 5 macro-regions:
  NORTE, NORDESTE, CENTRO-OESTE, SUDESTE, SUL

Usage:
    python scripts/pipelines/anp/subsidy_diesel_sync.py
    python scripts/pipelines/anp/subsidy_diesel_sync.py --backfill
    python scripts/pipelines/anp/subsidy_diesel_sync.py --dry-run
    python scripts/pipelines/anp/subsidy_diesel_sync.py --enable-ocr-fallback

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

# pdfplumber is required for PDF table extraction.
# pdf2image + pytesseract are OPTIONAL — only used when --enable-ocr-fallback is set.
# Do NOT add pdf2image / pytesseract to requirements.txt (they need system Tesseract binary).
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
_PARENT_PAGE = _ANP_BASE
_YEAR_PAGE_PATTERN = re.compile(
    r"subvencao-a-comercializacao-de-oleo-diesel-rodoviario-(\d{4})", re.I
)
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; IBBA-ETL/1.0; +https://itaubba.com)"
    )
}
_BATCH = 500
_TABLE = "anp_subsidy_diesel_reference"

# Price sanity bounds (BRL/liter). Values outside this range are dropped.
_PRICE_MIN = 2.0
_PRICE_MAX = 10.0

# Canonical region set and normalization map
_REGION_CANONICAL = {"NORTE", "NORDESTE", "CENTRO-OESTE", "SUDESTE", "SUL"}

# Variants that ANP uses in different PDF editions
_REGION_ALIASES: dict[str, str] = {
    "NORTE": "NORTE",
    "NORDESTE": "NORDESTE",
    "CENTRO-OESTE": "CENTRO-OESTE",
    "CENTRO OESTE": "CENTRO-OESTE",
    "C.OESTE": "CENTRO-OESTE",
    "CENTROESTE": "CENTRO-OESTE",
    "SUDESTE": "SUDESTE",
    "SUL": "SUL",
}


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
# Discovery — parent page → year page → PDF links
# ---------------------------------------------------------------------------

def _discover_year_page_url() -> str | None:
    """
    GET the ANP parent pricing page and follow the link matching the
    diesel subsidy pattern. Returns the full URL of the current-year page.
    Auto-discovers the year — does NOT hardcode 2026.
    """
    current_year = date.today().year
    print(f"[subsidy-diesel] Discovering year page for {current_year}...")
    try:
        r = requests.get(_PARENT_PAGE, headers=_HEADERS, timeout=30)
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
        # Prefer current year; accept prior year as fallback
        if year > best_year:
            best_year = year
            best_url = href if href.startswith("http") else "https://www.gov.br" + href

    if best_url:
        print(f"[subsidy-diesel] Found year page ({best_year}): {best_url}")
    else:
        # Fallback: construct URL directly
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


def _discover_pdf_links(year_page_url: str, *, backfill: bool) -> list[tuple[str, str | None]]:
    """
    GET the year page and collect anchors pointing to PDFs.
    Returns list of (pdf_url, anchor_context_text | None).

    When backfill=False, only returns PDFs whose filename or anchor context
    suggests a date within the last 14 days.
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

        # Gather surrounding text for date context (sibling text, parent, title attr)
        ctx_parts = [a.get_text(strip=True)]
        parent = a.parent
        if parent:
            ctx_parts.append(parent.get_text(separator=" ", strip=True))
        # Look for a sibling span/div with a date class
        for sibling in a.find_next_siblings():
            ctx_parts.append(sibling.get_text(strip=True))
            break
        context_text = " | ".join(p for p in ctx_parts if p) or None

        if not backfill:
            # Try to detect date from filename or context; skip if older than cutoff
            detected = _detect_date_from_filename(href.split("/")[-1])
            if detected is None and context_text:
                detected = _detect_date_from_text(context_text[:200])
            if detected is not None:
                try:
                    d = date.fromisoformat(detected)
                    if d < cutoff:
                        continue
                except ValueError:
                    pass
            # If no date detected, include it (better safe than miss)

        results.append((full_url, context_text))

    print(f"[subsidy-diesel] Found {len(results)} PDF(s) to process")
    return results


# ---------------------------------------------------------------------------
# Date detection
# ---------------------------------------------------------------------------

# Patterns for dates in filenames
_FNAME_DATE_PATTERNS = [
    # YYYY-MM-DD
    re.compile(r"(\d{4})-(\d{2})-(\d{2})"),
    # DDMMYYYY
    re.compile(r"(\d{2})(\d{2})(\d{4})"),
    # DD-MM-YYYY or DD_MM_YYYY
    re.compile(r"(\d{2})[-_](\d{2})[-_](\d{4})"),
]

_TEXT_DATE_PATTERN = re.compile(r"(\d{2})/(\d{2})/(\d{4})")


def _detect_date_from_filename(fname: str) -> str | None:
    """Try to extract an ISO date string from a PDF filename."""
    m = _FNAME_DATE_PATTERNS[0].search(fname)
    if m:
        y, mo, d = m.groups()
        return f"{y}-{mo}-{d}"
    m = _FNAME_DATE_PATTERNS[1].search(fname)
    if m:
        d, mo, y = m.groups()
        try:
            datetime(int(y), int(mo), int(d))
            return f"{y}-{mo}-{d}"
        except ValueError:
            pass
    m = _FNAME_DATE_PATTERNS[2].search(fname)
    if m:
        d, mo, y = m.groups()
        try:
            datetime(int(y), int(mo), int(d))
            return f"{y}-{mo}-{d}"
        except ValueError:
            pass
    return None


def _detect_date_from_text(text: str) -> str | None:
    """Try to extract dd/mm/yyyy from a text snippet."""
    m = _TEXT_DATE_PATTERN.search(text)
    if m:
        d, mo, y = m.groups()
        try:
            datetime(int(y), int(mo), int(d))
            return f"{y}-{mo}-{d}"
        except ValueError:
            pass
    return None


def _detect_date(pdf_url: str, context_text: str | None, pdf_bytes: bytes) -> str | None:
    """
    Full date detection cascade:
    1. Filename
    2. Anchor context HTML text
    3. First 200 chars of PDF text content (page 0)
    """
    fname = pdf_url.split("/")[-1]

    # 1. Filename
    d = _detect_date_from_filename(fname)
    if d:
        return d

    # 2. Context text from HTML
    if context_text:
        d = _detect_date_from_text(context_text[:200])
        if d:
            return d

    # 3. PDF first-page text
    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            if pdf.pages:
                first_text = pdf.pages[0].extract_text() or ""
                d = _detect_date_from_text(first_text[:200])
                if d:
                    return d
    except Exception:
        pass

    return None


# ---------------------------------------------------------------------------
# Idempotency probe
# ---------------------------------------------------------------------------

def _get_existing_dates(sb) -> set[str]:
    """
    Returns the set of data_referencia values that already have 5 rows
    (i.e. all 5 regions are present) — these dates are skipped.
    """
    try:
        result = sb.rpc(
            "query",
            {},
        )
    except Exception:
        pass

    # Use a direct table query with grouping via PostgREST aggregate approach:
    # We select all data_referencia rows and count client-side to avoid
    # needing a custom RPC. For large archives this is acceptable
    # (max ~365 dates × 5 rows = 1825 rows).
    try:
        resp = (
            sb.table(_TABLE)
            .select("data_referencia")
            .execute()
        )
        counts: dict[str, int] = {}
        for row in resp.data:
            dr = row["data_referencia"]
            counts[dr] = counts.get(dr, 0) + 1
        complete = {dr for dr, cnt in counts.items() if cnt >= 5}
        print(f"[subsidy-diesel] Idempotency: {len(complete)} date(s) already complete (5 regions)")
        return complete
    except Exception as e:
        print(f"[subsidy-diesel] WARNING: Could not probe existing dates: {e}")
        return set()


# ---------------------------------------------------------------------------
# PDF download
# ---------------------------------------------------------------------------

def _download_pdf(url: str) -> bytes:
    r = requests.get(url, headers=_HEADERS, stream=True, timeout=120)
    r.raise_for_status()
    return r.content


# ---------------------------------------------------------------------------
# Region normalization
# ---------------------------------------------------------------------------

def _strip_accents(s: str) -> str:
    nfkd = unicodedata.normalize("NFD", s)
    return "".join(c for c in nfkd if unicodedata.category(c) != "Mn")


def _normalize_region(raw: str) -> str | None:
    """
    Normalize a region string to one of the 5 canonical values.
    Handles accented variants, spacing variants, and abbreviations.
    """
    cleaned = _strip_accents(raw.strip().upper())
    # Replace non-ASCII (from PDF encoding corruption) with space
    cleaned = re.sub(r"[^\x00-\x7F]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    # Remove hyphens for matching (CENTRO-OESTE vs CENTRO OESTE)
    normed = cleaned.replace("-", " ")
    # Direct alias lookup
    if cleaned in _REGION_ALIASES:
        return _REGION_ALIASES[cleaned]
    if normed in _REGION_ALIASES:
        return _REGION_ALIASES[normed]
    # Partial prefix match
    for alias, canonical in _REGION_ALIASES.items():
        if cleaned.startswith(alias) or alias.startswith(cleaned):
            return canonical
    return None


# ---------------------------------------------------------------------------
# Price parsing
# ---------------------------------------------------------------------------

def _parse_price(raw) -> float | None:
    """Convert Brazilian decimal string or numeric to float."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or s.lower() in ("nan", "none", "-", ""):
        return None
    # Brazilian decimal: '5,21' → 5.21; also handle '5.210' (thousands sep)
    # If both . and , present: assume . is thousands sep, , is decimal
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# PDF table extraction
# ---------------------------------------------------------------------------

def _extract_table_from_pdf(
    pdf_bytes: bytes,
    fname: str,
    *,
    enable_ocr: bool = False,
) -> list[list[str]] | None:
    """
    Primary: pdfplumber table extraction from page 0 (fallback to page 1).
    Optional fallback: pdf2image + pytesseract (only if --enable-ocr-fallback).

    Returns a raw list of rows (each row is a list of cell strings), or None.
    """
    try:
        with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
            for page_idx in (0, 1):
                if page_idx >= len(pdf.pages):
                    continue
                page = pdf.pages[page_idx]
                table = page.extract_table()
                if table:
                    return table
                # If no structured table found, try extract_text and parse manually
                text = page.extract_text()
                if text:
                    rows = _parse_text_table(text)
                    if rows:
                        return rows
    except Exception as e:
        print(f"[subsidy-diesel] WARNING: pdfplumber failed for {fname}: {e}")

    if not enable_ocr:
        print(
            f"[subsidy-diesel] WARNING: No table extracted from {fname}. "
            "Re-run with --enable-ocr-fallback to attempt OCR."
        )
        return None

    # OCR fallback (opt-in only — requires: pip install pdf2image pytesseract
    # + system Tesseract binary)
    try:
        from pdf2image import convert_from_bytes  # type: ignore
        import pytesseract  # type: ignore

        images = convert_from_bytes(pdf_bytes, dpi=300, first_page=1, last_page=2)
        for img in images:
            text = pytesseract.image_to_string(img, lang="por")
            rows = _parse_text_table(text)
            if rows:
                print(f"[subsidy-diesel] OCR fallback succeeded for {fname}")
                return rows
    except ImportError:
        print(
            "[subsidy-diesel] WARNING: OCR fallback requested but pdf2image/pytesseract "
            "not installed. Install them separately (not in requirements.txt)."
        )
    except Exception as e:
        print(f"[subsidy-diesel] WARNING: OCR fallback failed for {fname}: {e}")

    return None


def _parse_text_table(text: str) -> list[list[str]] | None:
    """
    Parse a text-based representation of the subsidy table.
    Looks for lines that contain a region keyword followed by a price-like number.
    """
    rows: list[list[str]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        # Look for lines with a region keyword
        upper = stripped.upper()
        region_match = None
        for alias in _REGION_ALIASES:
            if alias in upper:
                region_match = alias
                break
        if region_match is None:
            continue
        # Extract price: a decimal number in the same line
        price_match = re.search(r"(\d+[.,]\d+)", stripped)
        if price_match:
            rows.append([region_match, price_match.group(1)])

    return rows if rows else None


# ---------------------------------------------------------------------------
# Table parser — extract (region, price) pairs from raw table rows
# ---------------------------------------------------------------------------

def _parse_rows(raw_table: list[list[str | None]], fname: str) -> list[tuple[str, float]]:
    """
    Given raw rows from pdfplumber, extract (canonical_region, price_brl_liter) pairs.

    ANP table structure (typical):
      Row 0 (header): ["Região", "Preço de Referência (R$/L)"] or similar
      Row 1..5: [region_name, price_string]

    We skip header rows and rows where we cannot parse both a region and a price.
    """
    results: list[tuple[str, float]] = []

    for row in raw_table:
        if not row:
            continue
        # Flatten None cells to empty strings
        cells = [str(c).strip() if c is not None else "" for c in row]
        if not any(cells):
            continue

        # Find the cell that looks like a region
        region: str | None = None
        price: float | None = None

        for cell in cells:
            if region is None:
                r = _normalize_region(cell)
                if r:
                    region = r
            if price is None:
                p = _parse_price(cell)
                if p is not None:
                    price = p

        if region is None or price is None:
            continue

        # Validate price range
        if not (_PRICE_MIN <= price <= _PRICE_MAX):
            print(
                f"[subsidy-diesel] WARNING: price {price} for region {region} "
                f"in {fname} is outside [{_PRICE_MIN}, {_PRICE_MAX}] — dropped"
            )
            continue

        results.append((region, price))

    # Deduplicate — keep first occurrence per region
    seen_regions: set[str] = set()
    deduped: list[tuple[str, float]] = []
    for region, price in results:
        if region not in seen_regions:
            seen_regions.add(region)
            deduped.append((region, price))

    # Validate count
    if len(deduped) != 5:
        found = [r for r, _ in deduped]
        missing = _REGION_CANONICAL - set(found)
        if missing:
            print(
                f"[subsidy-diesel] WARNING: {fname} yielded {len(deduped)}/5 regions. "
                f"Missing: {missing}"
            )

    return deduped


# ---------------------------------------------------------------------------
# Upsert
# ---------------------------------------------------------------------------

def _upsert(sb, records: list[dict]) -> int:
    total = 0
    n_batches = math.ceil(len(records) / _BATCH) if records else 0
    for i in range(0, len(records), _BATCH):
        batch = records[i: i + _BATCH]
        sb.table(_TABLE).upsert(
            batch,
            on_conflict="data_referencia,regiao",
        ).execute()
        total += len(batch)
        print(f"[subsidy-diesel] Upserted batch {i // _BATCH + 1}/{n_batches} — {total}/{len(records)}")
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
        help="Walk full year archive (default: last 14 days only)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be upserted without writing to Supabase",
    )
    parser.add_argument(
        "--enable-ocr-fallback",
        action="store_true",
        help=(
            "Enable OCR fallback via pdf2image + pytesseract "
            "(opt-in; requires manual install of those packages + Tesseract binary)"
        ),
    )
    args = parser.parse_args()

    # Step 1 — Discover year page
    year_page_url = _discover_year_page_url()
    if not year_page_url:
        print("[subsidy-diesel] ERROR: Could not determine year page URL. Aborting.")
        sys.exit(1)

    # Step 2 — Discover PDF links
    pdf_links = _discover_pdf_links(year_page_url, backfill=args.backfill)
    if not pdf_links:
        print("[subsidy-diesel] No PDFs found. Check year page URL or ANP site structure.")
        sys.exit(0)

    # Step 3 — Initialize Supabase client and probe existing dates
    if args.dry_run:
        print("[subsidy-diesel] DRY RUN — no writes to Supabase")
        existing_dates: set[str] = set()
        sb = None
    else:
        url_sup, svc_key = _get_creds()
        sb = create_client(url_sup, svc_key)
        existing_dates = _get_existing_dates(sb)

    # Step 4 — Process each PDF
    all_records: list[dict] = []
    skipped = 0
    errors = 0

    for pdf_url, context_text in pdf_links:
        fname = pdf_url.split("/")[-1]
        print(f"\n[subsidy-diesel] Processing: {fname}")

        # Download PDF
        try:
            pdf_bytes = _download_pdf(pdf_url)
            print(f"[subsidy-diesel]   Downloaded: {len(pdf_bytes) / 1024:.1f} KB")
        except Exception as e:
            print(f"[subsidy-diesel] WARNING: Failed to download {pdf_url}: {e}")
            errors += 1
            continue

        # Detect date
        data_referencia = _detect_date(pdf_url, context_text, pdf_bytes)
        if data_referencia is None:
            print(
                f"[subsidy-diesel] WARNING: Could not detect date for {fname}. "
                "Skipping."
            )
            errors += 1
            continue
        print(f"[subsidy-diesel]   Date: {data_referencia}")

        # Idempotency check
        if data_referencia in existing_dates:
            print(
                f"[subsidy-diesel]   Skip: {data_referencia} already has 5 rows in DB"
            )
            skipped += 1
            continue

        # Extract table
        raw_table = _extract_table_from_pdf(
            pdf_bytes, fname, enable_ocr=args.enable_ocr_fallback
        )
        if raw_table is None:
            errors += 1
            continue

        # Parse rows
        region_prices = _parse_rows(raw_table, fname)
        if not region_prices:
            print(f"[subsidy-diesel] WARNING: No valid (region, price) pairs from {fname}")
            errors += 1
            continue

        for region, price in region_prices:
            all_records.append({
                "data_referencia": data_referencia,
                "regiao": region,
                "preco_referencia": price,
            })
            print(f"[subsidy-diesel]   {region}: R$ {price:.4f}/L")

    # Step 5 — Dedup (same key may appear across multiple PDFs if re-published)
    seen_keys: set[tuple] = set()
    deduped_records: list[dict] = []
    for rec in all_records:
        key = (rec["data_referencia"], rec["regiao"])
        if key not in seen_keys:
            seen_keys.add(key)
            deduped_records.append(rec)

    print(
        f"\n[subsidy-diesel] Summary: {len(deduped_records)} records to upsert "
        f"| {skipped} dates skipped (already complete) "
        f"| {errors} error(s)"
    )

    if args.dry_run:
        print("[subsidy-diesel] DRY RUN — records that would be upserted:")
        for rec in deduped_records:
            print(f"  {rec}")
        print("[subsidy-diesel] DRY RUN complete — no writes performed.")
        return

    # Step 6 — Upsert
    if deduped_records:
        total = _upsert(sb, deduped_records)
        print(f"[subsidy-diesel] Done: {total} records upserted to {_TABLE}")
    else:
        print("[subsidy-diesel] Nothing to upsert.")
        if errors > 0:
            sys.exit(1)


if __name__ == "__main__":
    main()
