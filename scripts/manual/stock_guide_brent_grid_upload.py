"""
Upload a Stock Guide Brent scenario-grid (1-D interpolation mesh) to Supabase.

The analyst builds, in their own model, a dense 1-D mesh of (Brent level ->
target price) points PER COMPANY along a single driver axis (Brent). The
frontend (/stock-guide) interpolates this mesh live against the current Brent
level. The mesh is stored in `stock_guide_scenario_grid`, keyed to the "shell"
sensitivity row the analyst created in the Admin Panel (a row in
`stock_guide_sensitivities` marked by `definition.grid`).

This is a REPLACE-TOTAL snapshot loader, NOT a time-series: every run wipes all
rows of the target `sensitivity_id` and re-inserts the full Excel content. It is
idempotent (running twice yields the same state). The "never delete a partial
month" rule does NOT apply here — replace-total is the correct semantics.

Writes go through the service role (bypasses RLS, no policy needed).

────────────────────────────────────────────────────────────────────────────
Usage:
    # By sensitivity id (preferred — unambiguous):
    python scripts/manual/stock_guide_brent_grid_upload.py --sensitivity-id 7

    # By table title (looked up in stock_guide_sensitivities; must be unique):
    python scripts/manual/stock_guide_brent_grid_upload.py \
        --table-title "Brent scenarios (avg 2026)"

    # Custom Excel path:
    python scripts/manual/stock_guide_brent_grid_upload.py \
        --sensitivity-id 7 --excel path/to/grid.xlsx

Excel path priority (when --excel is omitted):
    1. Env var  STOCK_GUIDE_BRENT_GRID_XLSX
    2. Default  C:\\Users\\eduar\\dashboard_projeto\\data\\stock_guide_brent_grid.xlsx

Excel structure (WIDE format, single sheet — the first sheet is read):
    - 1st column header: `brent`  (Brent levels in US$/bbl; may be thousands of rows)
    - every other column: header = ticker (PETR4, PRIO3, ...), cell = target price (R$/share)

    Example:
        brent | PETR4 | PRIO3 | RECV3
        60    | 28.10 | 32.40 | 18.90
        65    | 30.05 | 35.10 | 20.15
        ...

    Wide -> long melt: each (brent, ticker) cell with a non-null numeric value
    becomes one row {sensitivity_id, ticker, x_value=brent, primary_value=cell}.
    Empty cells are skipped.

Credentials (env vars, fall back to .env file):
    SUPABASE_URL
    SUPABASE_SERVICE_KEY
"""

from __future__ import annotations

import argparse
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

_DEFAULT_EXCEL = r"C:\Users\eduar\dashboard_projeto\data\stock_guide_brent_grid.xlsx"
_X_COLUMN = "brent"


def _resolve_excel_path(cli_excel: str | None) -> str:
    if cli_excel:
        return cli_excel
    return os.environ.get("STOCK_GUIDE_BRENT_GRID_XLSX", _DEFAULT_EXCEL)


# ── CLI ───────────────────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Upload a Stock Guide Brent scenario-grid (1-D mesh) to "
            "stock_guide_scenario_grid. REPLACE-TOTAL snapshot for one "
            "sensitivity table; idempotent."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Target selection (exactly one of):\n"
            "  --sensitivity-id N        id of the stock_guide_sensitivities row (preferred).\n"
            "  --table-title \"...\"      title of that row; looked up in\n"
            "                            stock_guide_sensitivities. Errors if 0 or >1 match.\n\n"
            "Excel (WIDE): first column header 'brent' (US$/bbl), every other column\n"
            "header is a ticker, cells are target prices (R$/share). The first sheet\n"
            "is read.\n"
        ),
    )
    target = p.add_mutually_exclusive_group(required=True)
    target.add_argument(
        "--sensitivity-id",
        type=int,
        metavar="N",
        help="id of the stock_guide_sensitivities row to load (preferred).",
    )
    target.add_argument(
        "--table-title",
        type=str,
        metavar="TITLE",
        help="title of the stock_guide_sensitivities row (must be unique).",
    )
    p.add_argument(
        "--excel",
        type=str,
        default=None,
        metavar="PATH",
        help=(
            "Excel path. Defaults to $STOCK_GUIDE_BRENT_GRID_XLSX or "
            f"{_DEFAULT_EXCEL}"
        ),
    )
    return p.parse_args()


# ── Sensitivity-id resolution ───────────────────────────────────────────────────

def _resolve_sensitivity_id(supabase, args: argparse.Namespace) -> int:
    """Return the target sensitivity_id, resolving --table-title if needed."""
    if args.sensitivity_id is not None:
        # Confirm the row actually exists so we fail fast with a clear message
        # rather than producing a snapshot keyed to a non-existent shell.
        resp = (
            supabase.table("stock_guide_sensitivities")
            .select("id, title")
            .eq("id", args.sensitivity_id)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            print(
                f"ERROR: No stock_guide_sensitivities row with id={args.sensitivity_id}. "
                "Create the grid shell in the Admin Panel first."
            )
            sys.exit(1)
        print(f"Target: sensitivity_id={args.sensitivity_id} "
              f"(title={rows[0].get('title')!r})")
        return int(args.sensitivity_id)

    # Lookup by title
    title = args.table_title
    resp = (
        supabase.table("stock_guide_sensitivities")
        .select("id, title")
        .eq("title", title)
        .execute()
    )
    rows = resp.data or []
    if len(rows) == 0:
        print(
            f"ERROR: No stock_guide_sensitivities row with title={title!r}. "
            "Create the grid shell in the Admin Panel first, or pass --sensitivity-id."
        )
        sys.exit(1)
    if len(rows) > 1:
        ids = ", ".join(str(r["id"]) for r in rows)
        print(
            f"ERROR: Title {title!r} matches {len(rows)} rows (ids: {ids}). "
            "Pass --sensitivity-id to disambiguate."
        )
        sys.exit(1)
    sid = int(rows[0]["id"])
    print(f"Target: sensitivity_id={sid} (resolved from title {title!r})")
    return sid


# ── Excel -> long records ────────────────────────────────────────────────────────

def _coerce_brent(val) -> float | None:
    """Parse a Brent level into float; None if not numeric."""
    if val is None or pd.isna(val):
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _melt_grid(df: pd.DataFrame, sensitivity_id: int) -> list[dict]:
    """
    Melt a WIDE grid (brent + ticker columns) into long
    {sensitivity_id, ticker, x_value, primary_value} records.

    - Validates the `brent` column is numeric; non-numeric rows are warned+dropped.
    - Sorts ascending by brent; warns on duplicate brent levels.
    - Drops NaN cells (with a per-ticker skip count).
    - Drops non-numeric ticker cells (warned).
    """
    cols = list(df.columns)
    # Identify the X column case-insensitively but preserve the original header.
    x_col = None
    for c in cols:
        if str(c).strip().lower() == _X_COLUMN:
            x_col = c
            break
    if x_col is None:
        print(
            f"ERROR: Excel has no '{_X_COLUMN}' column (found headers: {cols}). "
            "The first/leftmost data column must be the Brent level."
        )
        sys.exit(1)

    ticker_cols = [c for c in cols if c != x_col]
    ticker_cols = [c for c in ticker_cols if str(c).strip() and not str(c).startswith("Unnamed")]
    if not ticker_cols:
        print("ERROR: Excel has a 'brent' column but no ticker columns.")
        sys.exit(1)

    print(f"  Brent column: {x_col!r}")
    print(f"  Ticker columns ({len(ticker_cols)}): {[str(c) for c in ticker_cols]}")

    # Coerce + validate Brent levels
    brent_raw = df[x_col].tolist()
    brent_vals: list[float | None] = [_coerce_brent(v) for v in brent_raw]
    n_bad_brent = 0
    valid_idx: list[int] = []
    for i, b in enumerate(brent_vals):
        if b is None:
            # Only warn on rows that had *some* content but weren't numeric.
            raw = brent_raw[i]
            if raw is not None and not (isinstance(raw, float) and pd.isna(raw)):
                n_bad_brent += 1
        else:
            valid_idx.append(i)
    if n_bad_brent:
        print(f"  WARNING: {n_bad_brent} row(s) had a non-numeric 'brent' value - dropped.")

    # Duplicate brent levels (defense-in-depth; the PK would collide on insert)
    seen: dict[float, int] = {}
    for i in valid_idx:
        b = brent_vals[i]
        seen[b] = seen.get(b, 0) + 1
    dups = sorted(b for b, c in seen.items() if c > 1)
    if dups:
        print(
            f"  WARNING: {len(dups)} duplicate brent level(s) in Excel "
            f"(e.g. {dups[:5]}). Later rows overwrite earlier within a ticker on upsert."
        )

    records: list[dict] = []
    per_ticker_count: dict[str, int] = {}
    per_ticker_skipped: dict[str, int] = {}

    for tcol in ticker_cols:
        ticker = str(tcol).strip()
        kept = 0
        skipped = 0
        for i in valid_idx:
            cell = df[tcol].iloc[i]
            if cell is None or pd.isna(cell):
                skipped += 1
                continue
            try:
                pv = float(cell)
            except (TypeError, ValueError):
                print(
                    f"  WARNING: ticker {ticker!r} @ brent={brent_vals[i]}: "
                    f"non-numeric value {cell!r} - skipped."
                )
                skipped += 1
                continue
            records.append(
                {
                    "sensitivity_id": sensitivity_id,
                    "ticker": ticker,
                    "x_value": brent_vals[i],
                    "primary_value": pv,
                }
            )
            kept += 1
        per_ticker_count[ticker] = kept
        if skipped:
            per_ticker_skipped[ticker] = skipped

    print("\n  Rows per ticker:")
    for t in sorted(per_ticker_count):
        skip_note = f" (skipped {per_ticker_skipped[t]})" if t in per_ticker_skipped else ""
        print(f"    {t:<10} {per_ticker_count[t]}{skip_note}")

    return records


# ── Ticker existence warning ─────────────────────────────────────────────────────

def _warn_unknown_tickers(supabase, records: list[dict]) -> None:
    tickers = sorted({r["ticker"] for r in records})
    if not tickers:
        return
    try:
        resp = (
            supabase.table("stock_guide_companies")
            .select("ticker")
            .in_("ticker", tickers)
            .execute()
        )
        known = {row["ticker"] for row in (resp.data or [])}
    except Exception as e:
        print(f"  WARNING: could not verify tickers against stock_guide_companies: {e}")
        return
    unknown = [t for t in tickers if t not in known]
    if unknown:
        print(
            f"  WARNING: {len(unknown)} ticker(s) not in stock_guide_companies "
            f"(uploaded anyway): {unknown}"
        )


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    args = _parse_args()
    excel_path = _resolve_excel_path(args.excel)
    print(f"Excel file: {excel_path}")

    if not Path(excel_path).exists():
        print(f"ERROR: File not found: {excel_path}")
        sys.exit(1)

    # Read the first sheet (sheet_name=0).
    try:
        df = pd.read_excel(excel_path, sheet_name=0, engine="openpyxl")
    except Exception as e:
        print(f"ERROR: Could not read Excel: {e}")
        sys.exit(1)

    print(f"  Excel rows: {len(df)}; columns: {list(df.columns)}")

    url, key = _get_credentials()
    supabase = create_client(url, key)

    sensitivity_id = _resolve_sensitivity_id(supabase, args)

    records = _melt_grid(df, sensitivity_id)
    total = len(records)
    print(f"\nTotal mesh points to upload: {total}")

    # Silent-empty is a bug (CLAUDE.md pegadinha #12).
    if total == 0:
        print(
            "ERROR: 0 mesh points produced - refusing to wipe the snapshot with "
            "nothing. Check the Excel (brent column + ticker columns + numeric "
            "cells)."
        )
        sys.exit(1)

    _warn_unknown_tickers(supabase, records)

    # REPLACE-TOTAL: delete the whole snapshot for this sensitivity_id, then insert.
    print(f"\nDeleting existing rows for sensitivity_id={sensitivity_id}...")
    supabase.table("stock_guide_scenario_grid").delete().eq(
        "sensitivity_id", sensitivity_id
    ).execute()

    BATCH = 500
    inserted = 0
    for i in range(0, total, BATCH):
        batch = records[i : i + BATCH]
        result = (
            supabase.table("stock_guide_scenario_grid")
            # upsert (not insert) so a re-run mid-failure stays idempotent even
            # if the delete already ran; PK is (sensitivity_id, ticker, x_value).
            .upsert(batch, on_conflict="sensitivity_id,ticker,x_value")
            .execute()
        )
        if hasattr(result, "error") and result.error:
            print(f"ERROR: Batch {i}-{i + len(batch)} failed: {result.error}")
            sys.exit(1)
        inserted += len(batch)
        print(f"  Upserted {inserted}/{total}")

    n_tickers = len({r["ticker"] for r in records})
    print(
        f"\nDone! {inserted} mesh points upserted into stock_guide_scenario_grid "
        f"for sensitivity_id={sensitivity_id} ({n_tickers} tickers)."
    )


if __name__ == "__main__":
    main()
