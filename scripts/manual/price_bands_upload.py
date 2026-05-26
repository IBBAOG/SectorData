"""
Upload Price Bands data to Supabase.

Usage:
    python scripts/manual/price_bands_upload.py [path/to/price_bands.xlsx]

Excel path priority:
    1. CLI argument (sys.argv[1])
    2. Env var  PRICE_BANDS_XLSX
    3. Default  C:\\Users\\eduar\\dashboard_projeto\\data\\price_bands.xlsx

Credentials (env vars, fall back to .env file):
    SUPABASE_URL
    SUPABASE_SERVICE_KEY

Excel structure:
    Sheet "Gasoline": Date | IBBA - Import Parity | IBBA - Export Parity | Petrobras Price
    Sheet "Diesel":   Date | BBA - Import Parity  | BBA - Export Parity  | Petrobras Price

Note: "BBA - Import Parity w/ subsidy" and "Petrobras Price w/ subsidy" are no longer
uploaded from Excel. They are auto-computed by SQL triggers (migration
20260527200000_subsidy_reform.sql) based on daily ANP reference prices and
period-fixed commercialization prices. If these columns still exist in your Excel
template, they are silently ignored.
"""

import os
import sys
from pathlib import Path

import pandas as pd
from supabase import create_client


# ── Credentials ───────────────────────────────────────────────────────────────

def _load_env_file() -> dict[str, str]:
    env_path = Path(".env")
    if not env_path.exists():
        return {}
    result: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        result[key.strip()] = val.strip()
    return result


def _get_credentials() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        env = _load_env_file()
        url = url or env.get("SUPABASE_URL", "")
        key = key or env.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY (set env vars or .env)")
        sys.exit(1)
    return url, key


# ── Excel path ────────────────────────────────────────────────────────────────

_DEFAULT_EXCEL = r"C:\Users\eduar\dashboard_projeto\data\price_bands.xlsx"


def _get_excel_path() -> str:
    if len(sys.argv) > 1:
        return sys.argv[1]
    return os.environ.get("PRICE_BANDS_XLSX", _DEFAULT_EXCEL)


# ── Sheet processing ──────────────────────────────────────────────────────────

# Maps sheet name → product label stored in DB
SHEET_PRODUCT_MAP = {
    "Gasoline": "Gasoline",
    "Diesel":   "Diesel",
}

# Columns uploaded to Supabase (same 4-column structure for both sheets).
# Subsidy-adjusted columns (bba_import_parity_w_subsidy, petrobras_price_w_subsidy)
# are intentionally excluded — auto-computed by SQL triggers on the server side.
SHEET_COL_MAP: dict[str, dict[str, str]] = {
    "Gasoline": {
        "IBBA - Import Parity": "bba_import_parity",
        "IBBA - Export Parity": "bba_export_parity",
        "Petrobras Price":      "petrobras_price",
    },
    "Diesel": {
        "BBA - Import Parity": "bba_import_parity",
        "BBA - Export Parity": "bba_export_parity",
        "Petrobras Price":     "petrobras_price",
    },
}

# Obsolete columns that may still exist in older Excel templates — ignored silently.
_OBSOLETE_DIESEL_COLS = {"BBA - Import Parity w/ subsidy", "Petrobras Price w/ subsidy"}


def _process_sheet(df: pd.DataFrame, product: str, col_map: dict[str, str]) -> list[dict]:
    records = []
    for _, row in df.iterrows():
        date_val = row.get("Date")
        if date_val is None or (hasattr(date_val, "__class__") and str(date_val) == "NaT"):
            continue
        if pd.isna(date_val):
            continue

        # Convert date to ISO string
        try:
            date_str = pd.Timestamp(date_val).strftime("%Y-%m-%d")
        except Exception:
            continue

        record: dict = {"product": product, "date": date_str}
        for excel_col, db_col in col_map.items():
            val = row.get(excel_col)
            record[db_col] = None if (val is None or pd.isna(val)) else float(val)

        records.append(record)

    return records


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print(
        "INFO: Subsidy-adjusted columns (bba_import_parity_w_subsidy, "
        "petrobras_price_w_subsidy) are now auto-computed by SQL triggers. "
        "Excluding from upload."
    )

    excel_path = _get_excel_path()
    print(f"Excel file: {excel_path}")

    if not Path(excel_path).exists():
        print(f"ERROR: File not found: {excel_path}")
        sys.exit(1)

    all_records: list[dict] = []

    for sheet_name, product in SHEET_PRODUCT_MAP.items():
        col_map = SHEET_COL_MAP[sheet_name]
        try:
            df = pd.read_excel(excel_path, sheet_name=sheet_name)
        except Exception as e:
            print(f"ERROR: Could not read sheet '{sheet_name}': {e}")
            sys.exit(1)

        # Warn if obsolete subsidy columns are still present in the Excel template
        if sheet_name == "Diesel":
            found_obsolete = _OBSOLETE_DIESEL_COLS.intersection(df.columns)
            if found_obsolete:
                print(
                    f"  WARNING: Sheet 'Diesel' still contains obsolete columns "
                    f"{sorted(found_obsolete)} — ignored. "
                    "You can remove them from your Excel template."
                )

        records = _process_sheet(df, product, col_map)
        print(f"  Sheet '{sheet_name}' ({product}): {len(records)} rows")
        all_records.extend(records)

    print(f"\nTotal records to upsert: {len(all_records)}")

    if not all_records:
        print("WARNING: No records found — nothing to upload.")
        return

    # Dry-run preview (first record keys confirm no _w_subsidy columns)
    sample_keys = list(all_records[0].keys()) if all_records else []
    print(f"Upsert keys per record: {sample_keys}")
    assert "bba_import_parity_w_subsidy" not in sample_keys, "BUG: w_subsidy key leaked into upsert payload"
    assert "petrobras_price_w_subsidy" not in sample_keys, "BUG: w_subsidy key leaked into upsert payload"

    url, key = _get_credentials()
    supabase = create_client(url, key)

    BATCH = 500
    inserted = 0
    for i in range(0, len(all_records), BATCH):
        batch = all_records[i : i + BATCH]
        result = (
            supabase.table("price_bands")
            .upsert(batch, on_conflict="product,date")
            .execute()
        )
        if hasattr(result, "error") and result.error:
            print(f"ERROR: Batch {i}–{i + len(batch)} failed: {result.error}")
            sys.exit(1)
        inserted += len(batch)
        print(f"  Upserted {inserted}/{len(all_records)}")

    print(f"\nDone! {inserted} rows upserted into price_bands.")


if __name__ == "__main__":
    main()
