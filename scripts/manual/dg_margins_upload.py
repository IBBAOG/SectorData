"""
Upload D&G Margins data to Supabase.

Usage:
    python upload_dg_margins.py [path/to/d_g_margins.xlsx]

Excel path priority:
    1. CLI argument (sys.argv[1])
    2. Env var  DG_MARGINS_XLSX
    3. Default  C:\\Users\\eduar\\dashboard_projeto\\data\\d_g_margins.xlsx

Credentials (env vars, fall back to .env file):
    SUPABASE_URL
    SUPABASE_SERVICE_KEY
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

_DEFAULT_EXCEL = r"C:\Users\eduar\dashboard_projeto\data\d_g_margins.xlsx"

def _get_excel_path() -> str:
    if len(sys.argv) > 1:
        return sys.argv[1]
    return os.environ.get("DG_MARGINS_XLSX", _DEFAULT_EXCEL)


# ── Sheet processing ──────────────────────────────────────────────────────────

# Maps sheet name → (fuel_type, biofuel_col, base_fuel_col)
SHEET_MAP = {
    "Diesel B":   ("Diesel B",   "Biodiesel",        "Diesel A"),
    "Gasoline C": ("Gasoline C", "Anhydrous Ethanol", "Gasoline A"),
}

# Common columns present in both sheets (Excel header → DB column)
COMMON_COL_MAP = {
    "Week":                          "week",
    "Distribution and Resale Margin": "distribution_and_resale_margin",
    "State Tax":                     "state_tax",
    "Federal Tax":                   "federal_tax",
    "Total":                         "total",
}


def _process_sheet(df: pd.DataFrame, fuel_type: str, biofuel_col: str, base_fuel_col: str) -> list[dict]:
    records = []
    for _, row in df.iterrows():
        week_val = str(row.get("Week", "")).strip()
        if not week_val or week_val.lower() == "nan":
            continue

        record: dict = {"fuel_type": fuel_type}

        # Common columns
        for excel_col, db_col in COMMON_COL_MAP.items():
            val = row.get(excel_col)
            if pd.isna(val):
                record[db_col] = None
            else:
                record[db_col] = float(val) if db_col != "week" else str(val).strip()

        # Fuel-specific columns
        biofuel_val = row.get(biofuel_col)
        record["biofuel_component"] = None if pd.isna(biofuel_val) else float(biofuel_val)

        base_val = row.get(base_fuel_col)
        record["base_fuel"] = None if pd.isna(base_val) else float(base_val)

        records.append(record)

    return records


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    excel_path = _get_excel_path()
    print(f"📂 Excel file: {excel_path}")

    if not Path(excel_path).exists():
        print(f"❌ File not found: {excel_path}")
        sys.exit(1)

    # Load all sheets
    all_records: list[dict] = []
    for sheet_name, (fuel_type, biofuel_col, base_fuel_col) in SHEET_MAP.items():
        try:
            df = pd.read_excel(excel_path, sheet_name=sheet_name)
        except Exception as e:
            print(f"❌ Could not read sheet '{sheet_name}': {e}")
            sys.exit(1)

        records = _process_sheet(df, fuel_type, biofuel_col, base_fuel_col)
        print(f"  📊 Sheet '{sheet_name}': {len(records)} rows")
        all_records.extend(records)

    print(f"\n📊 Total records to upsert: {len(all_records)}")

    if not all_records:
        print("⚠️  No records found — nothing to upload.")
        return

    # Connect to Supabase
    url, key = _get_credentials()
    supabase = create_client(url, key)

    # Upsert in batches
    BATCH = 500
    inserted = 0
    for i in range(0, len(all_records), BATCH):
        batch = all_records[i : i + BATCH]
        result = (
            supabase.table("d_g_margins")
            .upsert(batch, on_conflict="fuel_type,week")
            .execute()
        )
        if hasattr(result, "error") and result.error:
            print(f"❌ Batch {i}–{i + len(batch)} failed: {result.error}")
            sys.exit(1)
        inserted += len(batch)
        print(f"  ✅ Upserted {inserted}/{len(all_records)}")

    print(f"\n🎉 Done! {inserted} rows upserted into d_g_margins.")


if __name__ == "__main__":
    main()
