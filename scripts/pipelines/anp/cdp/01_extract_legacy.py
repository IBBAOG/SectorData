#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================
# DATA SOURCE: ANP Dados Estatísticos — annual "Produção por Poço" dumps
#   URL pattern: https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-estatisticos/de/ppg/pp/producao-pocos-{YEAR}.zip
#
# This is the LEGACY SOURCE for years < 2023 only.
# For 2023 onwards, use 01_extract.py (Selenium + APEX CDP portal).
#
# DO NOT use this pipeline to load post-2022 data. The APEX portal (01_extract.py)
# is the authoritative source for 2023+. Mixing sources for the same period
# contaminates anp_cdp_producao with duplicate rows under different PK conventions.
#
# If you genuinely need to load a pre-2023 year not currently covered, you must:
#   1. Update docs/app/anp-cdp.md "Data source" section
#   2. Get CTO sign-off explicitly
#   3. Run with --purge via 02_upload.py to replace any stale rows for that year
# ============================================================
"""
Extract ANP annual well-production dumps (pre-2023) from gov.br Dados Estatísticos.

Usage:
  python scripts/pipelines/anp/cdp/01_extract_legacy.py --year 2017 --output output/anp

The script downloads the ZIP for the given year, extracts the three XLSX files
(producao_mar, producao_presal, producao_terra), converts each to the CSV format
that 02_upload.py expects (one CSV per ambient per month), and writes them to the
output directory.

Output file naming matches 01_extract.py convention:
  producao_poco_MM-YYYY_M.csv   (Mar = all offshore, including PreSal rows)
  producao_poco_MM-YYYY_S.csv   (Pre-Sal subset)
  producao_poco_MM-YYYY_T.csv   (Terra = onshore)

02_upload.py is then called as-is with --from-csv-dir and --purge.

Important: the ANP annual dump DOES contain both Mar (M) and Pre-Sal (S) files,
so the M/S overlap situation is the same as the APEX portal. The existing
_deduplicate_m_vs_s() logic in 02_upload.py handles this correctly — no changes
to the upload pipeline are needed.
"""

import argparse
import csv
import io
import os
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

# Supported year range for this legacy pipeline
_YEAR_MIN = 2005
_YEAR_MAX = 2022

# URL pattern confirmed working 2026-05-14
_ZIP_URL_TEMPLATE = (
    "https://www.gov.br/anp/pt-br/centrais-de-conteudo/"
    "dados-estatisticos/de/ppg/pp/producao-pocos-{year}.zip"
)

# Expected XLSX filenames inside the ZIP (under {year}/ subdirectory)
# Keyed by ambient code used in output CSV filename.
_XLSX_FILES = {
    "M": "{year}_producao_mar.xlsx",
    "S": "{year}_producao_presal.xlsx",
    "T": "{year}_producao_terra.xlsx",
}

# Row in the XLSX where the actual column headers are (0-indexed).
# Rows 0-3 are SIGEP preamble; row 4 = first header line; row 5 = sub-header.
# Data starts at row 6 (0-indexed).
_HEADER_ROW_IDX = 4   # row 5 in 1-indexed (Excel-like)
_SUBHEADER_ROW_IDX = 5
_DATA_START_IDX = 6

# Column positions in the XLSX (0-indexed after reading the SIGEP sheet).
# Validated against 2017 dumps 2026-05-14.
_COL = {
    "estado":          0,
    "bacia":           1,
    "poco_anp":        2,   # Nome Poço ANP — SIGEP hyphenated format (7-BJ-9H-RJS)
    "poco_op":         3,   # Nome Poço Operador — compact/internal code (ignored)
    "campo":           4,
    "operador":        5,
    "num_contrato":    6,
    "periodo":         7,   # YYYY/MM in dump; converted to MM/YYYY for CSV
    "oleo":            8,   # Óleo (bbl/dia)
    "condensado":      9,   # Condensado (bbl/dia)
    "petroleo":        10,  # Petróleo (bbl/dia)
    "gas_assoc":       11,  # Gás Natural Associado (Mm³/dia)
    "gas_n_assoc":     12,  # Gás Natural Não Associado (Mm³/dia)
    "gas_total":       13,  # Gás Natural Total (Mm³/dia)
    "gas_royalties":   14,  # Volume Gás Royalties (Mm³/dia)
    "agua":            15,  # Água (bbl/dia)
    "instalacao":      16,  # Instalação Destino
    "tipo_instalacao": 17,  # Tipo Instalação
    "tempo_prod":      18,  # Tempo de Produção (hs por mês)
}

# CSV column headers — must match what _parse_csv() in 02_upload.py recognises.
# The parser uses fuzzy matching (substring checks), so these names were chosen
# to satisfy all the detection conditions in _parse_csv() for each field.
_CSV_HEADERS = [
    "Estado",
    "Bacia",
    "Nome Poço ANP",            # detected by: "poco" in cl and "anp" in cl
    "Nome Poço Operador",       # ignored by parser (kept for completeness)
    "Campo",
    "Operador",
    "Número do Contrato",
    "Período",                  # detected by: "perodo"/"período"/"periodo" in cl
    "Óleo (bbl/dia)",           # detected by: "leo (bbl" in cl
    "Condensado (bbl/dia)",     # detected by: "condensado" in cl
    "Petróleo (bbl/dia)",       # detected by: "petroleo"/"petróleo" in cl + "bbl" in cl
    "Gás Natural Associado (Mm³/dia)",      # detected by: "assoc" in cl and "mm"
    "Gás Natural Não Associado (Mm³/dia)", # detected by: "n_assoc"/"n-assoc" in cl
    "Gás Natural Total (Mm³/dia)",          # detected by: "total" in cl and "mm"
    "Volume Gás Royalties (Mm³/dia)",       # detected by: "royalt" in cl
    "Água (bbl/dia)",           # detected by: "gua (bbl" in cl
    "Instalação Destino",       # detected by: "destino" in cl
    "Tipo Instalação",          # detected by: "tipo" in cl and "instal" in cl
    "Tempo de Produção (hs por mês)",  # detected by: "tempo" in cl and "prod" in cl
]


def _download_zip(year: int, dest_path: str) -> None:
    """Download the annual ZIP from gov.br to dest_path."""
    url = _ZIP_URL_TEMPLATE.format(year=year)
    print(f"  Downloading: {url}")
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    with open(dest_path, "wb") as f:
        f.write(data)
    size_mb = os.path.getsize(dest_path) / 1_000_000
    print(f"  Downloaded: {size_mb:.1f} MB -> {dest_path}")


def _read_xlsx(zf: zipfile.ZipFile, xlsx_name: str) -> list[tuple]:
    """
    Read the XLSX from the open ZipFile and return data rows as a list of tuples.
    Skips the SIGEP preamble (first 6 rows) and returns rows starting at index 6.
    Returns empty list if file not found in ZIP.
    """
    try:
        import openpyxl
    except ImportError:
        raise SystemExit(
            "ERROR: openpyxl is required. Install it:\n"
            "  pip install openpyxl"
        )

    if xlsx_name not in zf.namelist():
        print(f"  WARN: {xlsx_name} not found in ZIP (skipping)")
        return []

    with zf.open(xlsx_name) as f:
        raw = f.read()

    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    ws = wb["SIGEP"]

    rows = []
    for idx, row in enumerate(ws.iter_rows(values_only=True)):
        if idx < _DATA_START_IDX:
            continue
        # Skip totally empty rows (happen at end of file sometimes)
        if all(v is None for v in row):
            continue
        rows.append(row)

    wb.close()
    return rows


def _fmt_periodo(raw) -> str:
    """
    Convert XLSX period format 'YYYY/MM' to CSV format 'MM/YYYY'.
    Handles both string and date-like values.
    """
    s = str(raw).strip() if raw is not None else ""
    if "/" in s:
        parts = s.split("/")
        if len(parts) == 2:
            left, right = parts[0].strip(), parts[1].strip()
            if len(left) == 4 and left.isdigit():
                # YYYY/MM ->MM/YYYY
                return f"{right.zfill(2)}/{left}"
            # Already MM/YYYY or other format — return as-is
            return s
    return s


def _fmt_num(val) -> str:
    """Format a numeric value for CSV output (dot decimal, empty string for None)."""
    if val is None:
        return ""
    try:
        f = float(val)
        # Use repr-level precision to preserve source values exactly
        return f"{f}"
    except (ValueError, TypeError):
        return str(val).strip()


def _fmt_text(val) -> str:
    """Format a text value for CSV output."""
    if val is None:
        return ""
    return str(val).strip()


def _rows_to_csv_bytes(xlsx_rows: list[tuple]) -> bytes:
    """
    Convert XLSX data rows to CSV bytes in the format that 02_upload.py's
    _parse_csv() expects:
      - UTF-8 encoding with BOM (utf-8-sig) — matches the first parser attempt
      - Comma separator, dot decimal
      - Header row = _CSV_HEADERS
    """
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(_CSV_HEADERS)

    for row in xlsx_rows:
        # Pad row to at least 19 columns if shorter
        row = tuple(row) + (None,) * max(0, 19 - len(row))

        csv_row = [
            _fmt_text(row[_COL["estado"]]),
            _fmt_text(row[_COL["bacia"]]),
            _fmt_text(row[_COL["poco_anp"]]),
            _fmt_text(row[_COL["poco_op"]]),
            _fmt_text(row[_COL["campo"]]),
            _fmt_text(row[_COL["operador"]]),
            _fmt_text(row[_COL["num_contrato"]]),
            _fmt_periodo(row[_COL["periodo"]]),
            _fmt_num(row[_COL["oleo"]]),
            _fmt_num(row[_COL["condensado"]]),
            _fmt_num(row[_COL["petroleo"]]),
            _fmt_num(row[_COL["gas_assoc"]]),
            _fmt_num(row[_COL["gas_n_assoc"]]),
            _fmt_num(row[_COL["gas_total"]]),
            _fmt_num(row[_COL["gas_royalties"]]),
            _fmt_num(row[_COL["agua"]]),
            _fmt_text(row[_COL["instalacao"]]),
            _fmt_text(row[_COL["tipo_instalacao"]]),
            _fmt_text(row[_COL["tempo_prod"]]),
        ]
        writer.writerow(csv_row)

    return buf.getvalue().encode("utf-8-sig")


def _split_by_month(
    rows: list[tuple],
    amb: str,
    year: int,
) -> dict[str, list[tuple]]:
    """
    Split XLSX rows into {month_str: [rows]} groups.
    month_str is in 'MM/YYYY' format (as it will appear in the CSV).
    Only includes rows matching the requested year.
    """
    buckets: dict[str, list[tuple]] = {}
    for row in rows:
        raw = row[_COL["periodo"]] if len(row) > _COL["periodo"] else None
        periodo = _fmt_periodo(raw)
        if not periodo:
            continue
        # Validate month is in the target year
        parts = periodo.split("/")
        if len(parts) != 2:
            continue
        mm, yyyy = parts[0], parts[1]
        if yyyy != str(year):
            continue
        if periodo not in buckets:
            buckets[periodo] = []
        buckets[periodo].append(row)
    return buckets


def _extract_year(year: int, output_dir: str, zip_path: str) -> int:
    """
    Extract all monthly CSVs for the given year from the ZIP.
    Returns the number of CSV files written.
    """
    os.makedirs(output_dir, exist_ok=True)
    written = 0

    with zipfile.ZipFile(zip_path) as zf:
        zip_contents = zf.namelist()
        print(f"  ZIP contents: {[n for n in zip_contents if not n.endswith('/')]}")

        for amb, xlsx_tpl in _XLSX_FILES.items():
            xlsx_name = f"{year}/{xlsx_tpl.format(year=year)}"
            print(f"\n  Processing {xlsx_name} (ambient={amb})…")

            rows = _read_xlsx(zf, xlsx_name)
            if not rows:
                print(f"  ->No rows found, skipping")
                continue

            print(f"  ->{len(rows)} total data rows")

            buckets = _split_by_month(rows, amb, year)
            months = sorted(buckets.keys())
            print(f"  ->Months found: {months}")

            for periodo, month_rows in buckets.items():
                mm, yyyy = periodo.split("/")
                csv_filename = f"producao_poco_{mm}-{yyyy}_{amb}.csv"
                dest = os.path.join(output_dir, csv_filename)

                csv_bytes = _rows_to_csv_bytes(month_rows)
                with open(dest, "wb") as f:
                    f.write(csv_bytes)

                n_data_rows = len(month_rows)
                size_kb = len(csv_bytes) / 1024
                print(f"  ->Wrote {dest} ({n_data_rows} rows, {size_kb:.1f} KB)")
                written += 1

    return written


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--year",
        type=int,
        required=True,
        help=f"Year to extract ({_YEAR_MIN}–{_YEAR_MAX}). Use 01_extract.py for 2023+.",
    )
    parser.add_argument(
        "--output",
        default="output/anp",
        help="Output directory for the CSVs (default: output/anp)",
    )
    parser.add_argument(
        "--keep-zip",
        action="store_true",
        help="Keep the downloaded ZIP file after extraction (default: delete)",
    )
    args = parser.parse_args()

    if args.year > _YEAR_MAX:
        parser.error(
            f"Year {args.year} > {_YEAR_MAX}: use 01_extract.py (Selenium + APEX CDP) "
            f"for 2023 and later. This pipeline is for pre-2023 annual dumps only."
        )
    if args.year < _YEAR_MIN:
        parser.error(f"Year {args.year} < {_YEAR_MIN}: no data available before {_YEAR_MIN}.")

    print(f"ANP CDP Legacy Extractor — year {args.year}")
    print(f"Output dir: {args.output}")
    print()

    # Download ZIP to temp file
    zip_dest = os.path.join(args.output, f"_anp_{args.year}.zip")
    os.makedirs(args.output, exist_ok=True)

    if os.path.exists(zip_dest):
        size_mb = os.path.getsize(zip_dest) / 1_000_000
        print(f"  ZIP already exists ({size_mb:.1f} MB), reusing: {zip_dest}")
    else:
        _download_zip(args.year, zip_dest)

    print()
    print(f"Extracting monthly CSVs…")
    n_written = _extract_year(args.year, args.output, zip_dest)

    if not args.keep_zip:
        try:
            os.remove(zip_dest)
            print(f"\n  ZIP deleted: {zip_dest}")
        except OSError as e:
            print(f"\n  WARN: could not delete ZIP: {e}")

    print()
    if n_written == 0:
        print("ERROR: No CSV files written. Check ZIP contents and XLSX structure.")
        sys.exit(1)

    print(f"Done: {n_written} CSV files written to {args.output}")
    print()
    print("Next step -- upload to Supabase with purge (replace stale rows):")
    print(
        f"  python scripts/pipelines/anp/cdp/02_upload.py "
        f"--from-csv-dir {args.output}/ --purge --no-incremental"
    )
    print()
    print("NOTE: The annual dump uses the same SIGEP hyphenated poco format as the")
    print("      APEX portal (validated 2026-05-14 on 2017 data: 0% compact format).")
    print("      The format guard in 02_upload.py passes without --allow-non-apex-format.")


if __name__ == "__main__":
    main()
