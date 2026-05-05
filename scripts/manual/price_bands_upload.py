"""
Upload Price Bands data to Supabase.

Usage:
    python scripts/upload_price_bands.py [path/to/price_bands.xlsx]

Excel path priority:
    1. CLI argument (sys.argv[1])
    2. Env var  PRICE_BANDS_XLSX
    3. Default  C:\\Users\\eduar\\dashboard_projeto\\data\\price_bands.xlsx

Credentials (env vars, fall back to .env file):
    SUPABASE_URL
    SUPABASE_SERVICE_KEY

Excel structure:
    Sheet "Gasoline": Date | IBBA - Import Parity | IBBA - Export Parity | Petrobras Price
    Sheet "Diesel":   Date | BBA - Import Parity  | BBA - Import Parity w/ subsidy | BBA - Export Parity | Petrobras Price | Petrobras Price w/ subsidy
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
        print("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY (set env vars or .env)")
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

# Maps sheet name → (excel_col → db_col) for non-null columns
SHEET_COL_MAP: dict[str, dict[str, str]] = {
    "Gasoline": {
        "IBBA - Import Parity": "bba_import_parity",
        "IBBA - Export Parity": "bba_export_parity",
        "Petrobras Price":      "petrobras_price",
    },
    "Diesel": {
        "BBA - Import Parity":            "bba_import_parity",
        "BBA - Import Parity w/ subsidy": "bba_import_parity_w_subsidy",
        "BBA - Export Parity":            "bba_export_parity",
        "Petrobras Price":                "petrobras_price",
        "Petrobras Price w/ subsidy":     "petrobras_price_w_subsidy",
    },
}


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
    excel_path = _get_excel_path()
    print(f"📂 Excel file: {excel_path}")

    if not Path(excel_path).exists():
        print(f"❌ File not found: {excel_path}")
        sys.exit(1)

    all_records: list[dict] = []

    for sheet_name, product in SHEET_PRODUCT_MAP.items():
        col_map = SHEET_COL_MAP[sheet_name]
        try:
            df = pd.read_excel(excel_path, sheet_name=sheet_name)
        except Exception as e:
            print(f"❌ Could not read sheet '{sheet_name}': {e}")
            sys.exit(1)

        records = _process_sheet(df, product, col_map)
        print(f"  📊 Sheet '{sheet_name}' ({product}): {len(records)} rows")
        all_records.extend(records)

    print(f"\n📊 Total records to upsert: {len(all_records)}")

    if not all_records:
        print("⚠️  No records found — nothing to upload.")
        return

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
            print(f"❌ Batch {i}–{i + len(batch)} failed: {result.error}")
            sys.exit(1)
        inserted += len(batch)
        print(f"  ✅ Upserted {inserted}/{len(all_records)}")

    print(f"\n🎉 Done! {inserted} rows upserted into price_bands.")


if __name__ == "__main__":
    main()
