"""
Upload a Stock Guide multi-axis scenario-grid (1..3 axes) to Supabase.

The analyst builds, in their own model, a dense Cartesian mesh of
(driver levels -> target price) points PER COMPANY across 1, 2 or 3 driver axes
(e.g. Avg Brent 2026 / 2027 / 2028+). Every Excel row is one model run = one
mesh point. The frontend (/stock-guide) interpolates this mesh MULTILINEARLY
(2^d corners) live against the current driver levels.

The mesh is stored in `stock_guide_scenario_grid`, keyed to the "shell"
sensitivity row the analyst created in the Admin Panel (a row in
`stock_guide_sensitivities` whose `definition.grid` carries the axis metadata:
`{axes: [{driver_key, label, unit}](1..3), output}`).

This is a REPLACE-TOTAL snapshot loader, NOT a time-series: every run wipes all
rows of the target `sensitivity_id` and re-inserts the full Excel content. It is
idempotent (running twice yields the same state). The "never delete a partial
month" rule does NOT apply here — replace-total is the correct semantics.

Writes go through the service role (bypasses RLS, no policy needed).

────────────────────────────────────────────────────────────────────────────
Excel structure (LONG format — canonical, single sheet, the first sheet is read):

    - One row per scenario (one model run = one Cartesian combination).
    - Coordinate columns: header = the EXACT driver_key of each axis, taken from
      the shell's `definition.grid.axes` (e.g. `avg_brent_2026`, `avg_brent_2027`,
      `avg_brent_2028`). Match is case-insensitive + trimmed.
    - Every remaining non-empty, non-"Unnamed" column = a ticker; cell = target
      price (R$/share) for that ticker at those coordinates.

    Example (2 axes — avg_brent_2026 × avg_brent_2027):
        avg_brent_2026 | avg_brent_2027 | PETR4 | PRIO3
        40             | 40             | 22.10 | 28.40
        40             | 50             | 24.05 | 30.10
        50             | 40             | 25.30 | 31.20
        50             | 50             | 27.80 | 33.90
        ...

    The file must be a COMPLETE Cartesian mesh: one row for every combination of
    distinct levels across the axes, and every ticker column fully filled (no
    holes). The validations below enforce this hard.

────────────────────────────────────────────────────────────────────────────
Usage:
    # By sensitivity id (preferred — unambiguous):
    python scripts/manual/stock_guide_brent_grid_upload.py --sensitivity-id 7

    # By table title (looked up in stock_guide_sensitivities; must be unique):
    python scripts/manual/stock_guide_brent_grid_upload.py \
        --table-title "Brent scenario grid 3-D"

    # Custom Excel path:
    python scripts/manual/stock_guide_brent_grid_upload.py \
        --sensitivity-id 7 --excel path/to/grid.xlsx

    # Dry run (parse + validate + report; NO delete, NO upsert — production
    # is never touched):
    python scripts/manual/stock_guide_brent_grid_upload.py \
        --sensitivity-id 7 --dry-run

Excel path priority (when --excel is omitted):
    1. Env var  STOCK_GUIDE_BRENT_GRID_XLSX
    2. Default  C:\\Users\\eduar\\dashboard_projeto\\data\\stock_guide_brent_grid.xlsx

Credentials (env vars, fall back to .env file):
    SUPABASE_URL
    SUPABASE_SERVICE_KEY
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from itertools import product
from pathlib import Path

import pandas as pd
from supabase import create_client


# ── Constants ───────────────────────────────────────────────────────────────────

_DEFAULT_EXCEL = r"C:\Users\eduar\dashboard_projeto\data\stock_guide_brent_grid.xlsx"
_COORD_ROUND = 6        # decimals — neutralizes float drift between template & model
_BATCH = 500
_WARN_ROWS = 60_000     # payload guidance threshold (see end-of-run print)

# Known dynamic-driver catalog keys (kept in sync with src/hooks/useMarketDrivers.ts).
# Used only to WARN when a leftover header looks like a driver key that is NOT one
# of this shell's axes — a strong hint the wrong file/shell was paired.
_DRIVER_CATALOG_KEYS = {
    "avg_brent_2026", "avg_brent_2027", "avg_brent_2028",
    "avg_fx_2026", "avg_fx_2027", "avg_fx_2028",
}


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

def _resolve_excel_path(cli_excel: str | None) -> str:
    if cli_excel:
        return cli_excel
    return os.environ.get("STOCK_GUIDE_BRENT_GRID_XLSX", _DEFAULT_EXCEL)


# ── CLI ───────────────────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Upload a Stock Guide multi-axis scenario-grid (1..3 axes, LONG "
            "format) to stock_guide_scenario_grid. REPLACE-TOTAL snapshot for "
            "one sensitivity table; idempotent."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Target selection (exactly one of):\n"
            "  --sensitivity-id N        id of the stock_guide_sensitivities row (preferred).\n"
            "  --table-title \"...\"      title of that row; looked up in\n"
            "                            stock_guide_sensitivities. Errors if 0 or >1 match.\n\n"
            "Excel (LONG): one row per scenario. Coordinate columns are named\n"
            "EXACTLY by each axis driver_key from the shell's definition.grid.axes\n"
            "(e.g. avg_brent_2026); every other non-empty column is a ticker whose\n"
            "cell is the target price (R$/share). The first sheet is read.\n"
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
    p.add_argument(
        "--dry-run",
        action="store_true",
        help=(
            "Parse + validate + report only. NO delete, NO upsert — production "
            "is never touched. Validations still run; the unknown-ticker check "
            "queries stock_guide_companies read-only if credentials are present."
        ),
    )
    return p.parse_args()


# ── Sensitivity shell resolution (id + grid axes) ───────────────────────────────

def _fetch_shell(supabase, args: argparse.Namespace) -> tuple[int, list[dict]]:
    """Resolve the target sensitivity_id and return (id, grid_axes).

    grid_axes is the parsed list from definition.grid.axes; raises a clear error
    if the shell carries no valid grid block (legacy/unsaved shape).
    """
    if args.sensitivity_id is not None:
        resp = (
            supabase.table("stock_guide_sensitivities")
            .select("id, title, definition")
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
        row = rows[0]
        sid = int(args.sensitivity_id)
        print(f"Target: sensitivity_id={sid} (title={row.get('title')!r})")
    else:
        title = args.table_title
        resp = (
            supabase.table("stock_guide_sensitivities")
            .select("id, title, definition")
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
        row = rows[0]
        sid = int(row["id"])
        print(f"Target: sensitivity_id={sid} (resolved from title {title!r})")

    axes = _parse_grid_axes(row.get("definition"))
    return sid, axes


def _parse_grid_axes(definition) -> list[dict]:
    """Extract and validate definition.grid.axes (1..3) from the shell."""
    if not isinstance(definition, dict):
        print(
            "ERROR: shell has no JSON definition — this is not a scenario-grid "
            "shell. Re-save the shell in the Admin Panel."
        )
        sys.exit(1)
    grid = definition.get("grid")
    if not isinstance(grid, dict):
        print(
            "ERROR: shell definition has no `grid` block. This is not a "
            "scenario-grid table (or it uses the legacy 1-D shape). Re-save the "
            "shell in the Admin Panel."
        )
        sys.exit(1)
    axes = grid.get("axes")
    if isinstance(axes, list) and axes:
        parsed: list[dict] = []
        for ax in axes:
            if not isinstance(ax, dict):
                continue
            key = str(ax.get("driver_key") or "").strip()
            if not key:
                continue
            parsed.append({
                "driver_key": key,
                "label": str(ax.get("label") or "").strip(),
                "unit": str(ax.get("unit") or "").strip(),
            })
        if not parsed:
            print(
                "ERROR: shell definition.grid.axes is present but contains no "
                "valid axis (each axis needs a driver_key). Re-save the shell in "
                "the Admin Panel."
            )
            sys.exit(1)
        if len(parsed) > 3:
            print(
                f"ERROR: shell defines {len(parsed)} axes — the mesh supports at "
                "most 3 (x/y/z). Re-save the shell with 1..3 axes."
            )
            sys.exit(1)
        return parsed

    # Legacy 1-D shape ({x_driver_key,...}) — the migration converts these, but a
    # stale/unsaved shell may still carry it.
    if "x_driver_key" in grid:
        print(
            "ERROR: shell carries the legacy 1-D grid shape ({x_driver_key,...}) "
            "instead of {axes:[...]}. Re-save the shell in the Admin Panel."
        )
        sys.exit(1)

    print(
        "ERROR: shell definition.grid has no `axes` list. Re-save the shell in "
        "the Admin Panel."
    )
    sys.exit(1)


# ── Header matching: driver_keys -> coord columns; remainder = tickers ──────────

def _match_headers(df: pd.DataFrame, axes: list[dict]) -> tuple[list, list]:
    """Map each axis driver_key to exactly one Excel header (case-insensitive,
    trimmed). Returns (coord_columns_in_axis_order, ticker_columns)."""
    cols = list(df.columns)
    norm = {c: str(c).strip().lower() for c in cols}

    coord_cols: list = []
    matched_set: set = set()
    errors: list[str] = []
    for ax in axes:
        key = ax["driver_key"]
        key_norm = key.strip().lower()
        hits = [c for c in cols if norm[c] == key_norm and c not in matched_set]
        if len(hits) == 0:
            errors.append(f"  axis driver_key {key!r}: NO matching header")
        elif len(hits) > 1:
            errors.append(
                f"  axis driver_key {key!r}: {len(hits)} matching headers "
                f"{[str(h) for h in hits]} (expected exactly 1)"
            )
        else:
            coord_cols.append(hits[0])
            matched_set.add(hits[0])

    if errors:
        print(
            "ERROR: could not match coordinate columns to the shell's axes.\n"
            f"  Expected (driver_keys): {[a['driver_key'] for a in axes]}\n"
            f"  Found headers:          {[str(c) for c in cols]}\n"
            + "\n".join(errors)
        )
        sys.exit(1)

    # Remaining headers = tickers (drop blanks / pandas "Unnamed: N" placeholders).
    remaining = [c for c in cols if c not in matched_set]
    ticker_cols = [
        c for c in remaining
        if str(c).strip() and not str(c).startswith("Unnamed")
    ]

    # WARN if a leftover header is a known driver-catalog key not in this shell's
    # axes — strong hint the wrong file/shell was paired.
    axis_keys = {a["driver_key"].lower() for a in axes}
    for c in ticker_cols:
        cn = str(c).strip().lower()
        if cn in _DRIVER_CATALOG_KEYS and cn not in axis_keys:
            print(
                f"  WARNING: header {str(c)!r} is a known driver key but is NOT "
                "an axis of this shell — being treated as a ticker. Wrong file / "
                "wrong shell?"
            )

    if not ticker_cols:
        print(
            "ERROR: matched all coordinate columns but found no ticker columns. "
            "Add at least one ticker column with target prices."
        )
        sys.exit(1)

    print(f"  Axes ({len(axes)}): {[a['driver_key'] for a in axes]}")
    print(f"  Coordinate columns: {[str(c) for c in coord_cols]}")
    print(f"  Ticker columns ({len(ticker_cols)}): {[str(c) for c in ticker_cols]}")
    return coord_cols, ticker_cols


# ── Numeric coercion ────────────────────────────────────────────────────────────

def _is_blank(val) -> bool:
    if val is None:
        return True
    try:
        if pd.isna(val):
            return True
    except (TypeError, ValueError):
        pass
    if isinstance(val, str) and val.strip() == "":
        return True
    return False


def _coerce_num(val) -> float | None:
    """Parse a numeric cell into float; None if not numeric (blank handled upstream)."""
    if _is_blank(val):
        return None
    try:
        f = float(val)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


# ── Melt + hard validations (LONG) ──────────────────────────────────────────────

def _melt_and_validate(
    df: pd.DataFrame, axes: list[dict], coord_cols: list, ticker_cols: list,
    sensitivity_id: int,
) -> list[dict]:
    """Turn a LONG mesh into {sensitivity_id, ticker, x_value, y_value, z_value,
    primary_value} records, enforcing the hard validations in plan order.

    Excel row numbers reported to the analyst are 1-based and account for the
    header row (data row 0 -> Excel row 2).
    """
    dim = len(axes)

    # Drop fully-empty rows silently (coords AND every ticker blank).
    all_cols = list(coord_cols) + list(ticker_cols)
    keep_idx: list[int] = []
    for i in range(len(df)):
        if all(_is_blank(df[c].iloc[i]) for c in all_cols):
            continue
        keep_idx.append(i)
    n_dropped = len(df) - len(keep_idx)
    if n_dropped:
        print(f"  Dropped {n_dropped} fully-empty row(s) silently.")
    if not keep_idx:
        print("ERROR: every Excel row was empty — nothing to upload.")
        sys.exit(1)

    def _excel_row(i: int) -> int:
        return i + 2  # +1 for 0-based -> 1-based, +1 for the header row

    # --- Coordinates: every coord cell must be numeric (ERROR, not warn-skip) ---
    coord_tuples: list[tuple[float, ...]] = []
    bad_coord_rows: list[int] = []
    for i in keep_idx:
        coords: list[float] = []
        ok = True
        for c in coord_cols:
            v = _coerce_num(df[c].iloc[i])
            if v is None:
                ok = False
                break
            coords.append(round(v, _COORD_ROUND))
        if not ok:
            bad_coord_rows.append(_excel_row(i))
            coord_tuples.append(())  # placeholder, row will be rejected
        else:
            coord_tuples.append(tuple(coords))
    if bad_coord_rows:
        shown = ", ".join(str(r) for r in bad_coord_rows[:10])
        more = f" (+{len(bad_coord_rows) - 10} more)" if len(bad_coord_rows) > 10 else ""
        print(
            f"ERROR: {len(bad_coord_rows)} row(s) have a non-numeric / blank "
            f"coordinate cell — every coordinate must be numeric. "
            f"Excel rows: {shown}{more}"
        )
        sys.exit(1)

    # --- Duplicate coordinate tuples = ERROR (up to 5 examples) ---
    seen: dict[tuple, list[int]] = {}
    for n, i in enumerate(keep_idx):
        seen.setdefault(coord_tuples[n], []).append(_excel_row(i))
    dups = {t: rows for t, rows in seen.items() if len(rows) > 1}
    if dups:
        examples = []
        for t, rows in list(dups.items())[:5]:
            examples.append(f"    {dict(zip([a['driver_key'] for a in axes], t))} @ Excel rows {rows}")
        print(
            f"ERROR: {len(dups)} duplicate coordinate tuple(s) — each scenario "
            "must appear exactly once.\n" + "\n".join(examples)
        )
        sys.exit(1)

    # --- Cartesian completeness: len(rows) == Π(distinct levels per axis) ---
    per_axis_levels: list[list[float]] = []
    for d in range(dim):
        vals = sorted({coord_tuples[n][d] for n in range(len(keep_idx))})
        per_axis_levels.append(vals)
    expected = 1
    for lv in per_axis_levels:
        expected *= len(lv)
    actual = len(keep_idx)
    if actual != expected:
        present = set(coord_tuples)
        full = set(product(*per_axis_levels))
        missing = sorted(full - present)
        examples = []
        for t in missing[:5]:
            examples.append(f"    {dict(zip([a['driver_key'] for a in axes], t))}")
        dims_txt = " × ".join(f"{len(lv)}" for lv in per_axis_levels)
        print(
            f"ERROR: the mesh is not a complete Cartesian product. "
            f"Distinct levels per axis: {dims_txt} = {expected} combinations "
            f"expected, but {actual} rows present "
            f"({len(missing)} combination(s) missing).\n"
            "  Missing examples:\n" + "\n".join(examples)
        )
        sys.exit(1)

    # --- Per ticker: full column blank = WARN+skip; partial = ERROR; cell numeric ---
    records: list[dict] = []
    per_ticker_count: dict[str, int] = {}
    M = actual
    for tcol in ticker_cols:
        ticker = str(tcol).strip()
        cells: list[float | None] = []
        n_blank = 0
        bad_cell_rows: list[int] = []
        for n, i in enumerate(keep_idx):
            raw = df[tcol].iloc[i]
            if _is_blank(raw):
                cells.append(None)
                n_blank += 1
                continue
            v = _coerce_num(raw)
            if v is None:
                bad_cell_rows.append(_excel_row(i))
                cells.append(None)
            else:
                cells.append(v)

        if bad_cell_rows:
            shown = ", ".join(str(r) for r in bad_cell_rows[:10])
            more = f" (+{len(bad_cell_rows) - 10} more)" if len(bad_cell_rows) > 10 else ""
            print(
                f"ERROR: ticker {ticker!r} has {len(bad_cell_rows)} non-numeric "
                f"cell(s). Excel rows: {shown}{more}"
            )
            sys.exit(1)

        if n_blank == M:
            print(f"  WARNING: ticker {ticker!r}: column 100% empty — skipped.")
            continue
        if n_blank > 0:
            print(
                f"ERROR: ticker {ticker!r}: {n_blank} of {M} combos empty — the "
                "mesh must be complete per ticker."
            )
            sys.exit(1)

        for n in range(M):
            coords = coord_tuples[n]
            records.append({
                "sensitivity_id": sensitivity_id,
                "ticker": ticker,
                "x_value": coords[0],
                "y_value": coords[1] if dim >= 2 else 0,
                "z_value": coords[2] if dim >= 3 else 0,
                "primary_value": cells[n],
            })
        per_ticker_count[ticker] = M

    # --- total=0 = ERROR (silent-empty is a bug, pegadinha #12) ---
    if not records:
        print(
            "ERROR: 0 mesh points produced (every ticker column was empty). "
            "Refusing to wipe the snapshot with nothing."
        )
        sys.exit(1)

    print("\n  Mesh summary:")
    dims_txt = " × ".join(f"{len(lv)}" for lv in per_axis_levels)
    print(f"    Scenarios (Cartesian): {dims_txt} = {expected}")
    print(f"    Tickers loaded: {len(per_ticker_count)}")
    print("  Rows per ticker:")
    for t in sorted(per_ticker_count):
        print(f"    {t:<10} {per_ticker_count[t]}")

    return records


# ── Ticker existence warning ─────────────────────────────────────────────────────

def _warn_unknown_tickers(supabase, records: list[dict]) -> None:
    if supabase is None:
        return
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

    try:
        df = pd.read_excel(excel_path, sheet_name=0, engine="openpyxl")
    except Exception as e:
        print(f"ERROR: Could not read Excel: {e}")
        sys.exit(1)

    print(f"  Excel rows: {len(df)}; columns: {list(df.columns)}")

    # Resolve credentials (service role). In --dry-run, allow proceeding without
    # them: we still parse + validate; only the unknown-ticker check is skipped.
    supabase = None
    sensitivity_id: int
    axes: list[dict]
    if args.dry_run:
        url = os.environ.get("SUPABASE_URL") or _load_env_file().get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_SERVICE_KEY") or _load_env_file().get("SUPABASE_SERVICE_KEY", "")
        if url and key:
            supabase = create_client(url, key)
            sensitivity_id, axes = _fetch_shell(supabase, args)
        else:
            print(
                "ERROR: --dry-run still needs SUPABASE_URL + SUPABASE_SERVICE_KEY "
                "(read-only is enough) to fetch the shell's grid axes from the DB. "
                "It only skips the delete/upsert, not the shell lookup."
            )
            sys.exit(1)
    else:
        url, key = _get_credentials()
        supabase = create_client(url, key)
        sensitivity_id, axes = _fetch_shell(supabase, args)

    coord_cols, ticker_cols = _match_headers(df, axes)
    records = _melt_and_validate(df, axes, coord_cols, ticker_cols, sensitivity_id)
    total = len(records)
    print(f"\nTotal mesh points to upload: {total}")

    _warn_unknown_tickers(supabase, records)

    if args.dry_run:
        print("\nDRY-RUN: validations passed. No delete, no upsert performed.")
        _print_payload_guidance(total)
        return

    # REPLACE-TOTAL: delete the whole snapshot for this sensitivity_id, then insert.
    print(f"\nDeleting existing rows for sensitivity_id={sensitivity_id}...")
    supabase.table("stock_guide_scenario_grid").delete().eq(
        "sensitivity_id", sensitivity_id
    ).execute()

    inserted = 0
    for i in range(0, total, _BATCH):
        batch = records[i : i + _BATCH]
        result = (
            supabase.table("stock_guide_scenario_grid")
            # upsert (not insert) so a re-run mid-failure stays idempotent even
            # if the delete already ran; PK is 5-col.
            .upsert(batch, on_conflict="sensitivity_id,ticker,x_value,y_value,z_value")
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
        f"for sensitivity_id={sensitivity_id} ({n_tickers} tickers, {len(axes)} axes)."
    )
    _print_payload_guidance(total)


def _print_payload_guidance(total: int) -> None:
    if total > _WARN_ROWS:
        print(
            f"\nWARNING: {total:,} mesh points is large (> {_WARN_ROWS:,}). "
            "Keep ≤15 levels/axis for 3-D meshes (≤40×40 for 2-D) to bound the "
            "payload the browser downloads."
        )


if __name__ == "__main__":
    main()
