"""
Upload a Stock Guide multi-metric, multi-axis scenario-grid (1..3 axes) to Supabase.

The analyst builds, in their own model, a dense Cartesian mesh of
(driver levels -> metric value) points PER COMPANY across 1, 2 or 3 driver axes
(e.g. Avg Brent 2026 / 2027 / 2028+), for one OR MORE output metrics
(target_price, fcfe, dividends, net_income, ...). Every Excel row in a sheet is
one model run = one mesh point for that sheet's metric. The frontend
(/stock-guide) interpolates each metric's mesh MULTILINEARLY (2^d corners) live
against the current driver levels.

The mesh is stored in `stock_guide_scenario_grid`, keyed to the "shell"
sensitivity row the analyst created in the Admin Panel (a row in
`stock_guide_sensitivities` whose `definition.grid` carries the axis + output
metadata: `{axes: [{driver_key, label, unit}](1..3), outputs: [<metric keys>]}`).
The legacy single-output shape (`{axes, output: "target_price"}`) is still
accepted and maps to a single `target_price` metric.

This is a REPLACE-TOTAL snapshot loader, NOT a time-series: every run wipes ALL
rows of the target `sensitivity_id` (every metric) and re-inserts the full
workbook content. It is idempotent (running twice yields the same state). The
"never delete a partial month" rule does NOT apply here — replace-total is the
correct semantics.

Writes go through the service role (bypasses RLS, no policy needed).

────────────────────────────────────────────────────────────────────────────
TEMPLATE PROVENANCE (v2): the workbook is now DOWNLOADED FROM THE ADMIN PANEL
("Download template" button on the scenario-grid shell, generated in-browser).
This Python script is the UPLOAD path. `scripts/manual/make_brent_grid_template.py`
is DEPRECATED (single-metric / offline fallback only).

────────────────────────────────────────────────────────────────────────────
Workbook structure (v2 — multi-sheet, one sheet per output metric):

    - ONE SHEET PER OUTPUT METRIC. The sheet NAME is the metric key
      (e.g. `target_price`, `fcfe`, `dividends`, `net_income`) -> stored verbatim
      as `metric`. A sheet whose name matches no configured output is skipped
      with a WARNING; a configured output with no matching sheet is reported with
      a WARNING ("metric X not in workbook — will be absent").

    - Per sheet: LONG format, one row per scenario (one Cartesian combination).
      The FIRST `d` columns are the coordinates, read POSITIONALLY in the order
      of `definition.grid.axes` (NOT by header name — v2 axes may key by an opaque
      driver_id with no clean key). The header of a coordinate column is the
      human label of the axis; a mismatch only produces a sanity WARNING, never
      an error. d<3 -> y/z stored as 0.

    - Every remaining non-empty, non-"Unnamed" column = a ticker; cell = that
      metric's value for that ticker at those coordinates.

    Example sheet `target_price` (2 axes — Brent 2026 × Brent 2027):
        Brent avg 2026 | Brent avg 2027 | PETR4 | PRIO3
        40             | 40             | 22.10 | 28.40
        40             | 50             | 24.05 | 30.10
        50             | 40             | 25.30 | 31.20
        50             | 50             | 27.80 | 33.90
        ...

    Each sheet must be a COMPLETE Cartesian mesh: one row for every combination
    of distinct levels across the axes, every ticker column fully filled (no
    holes). The validations below enforce this hard, per sheet.

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

# Legacy default metric when the shell carries the old single-`output` shape.
_DEFAULT_METRIC = "target_price"

# Known dynamic-driver catalog keys (kept in sync with src/hooks/useMarketDrivers.ts).
# Used only to WARN when a leftover (ticker) header looks like a driver key — a
# strong hint a coordinate column was mis-placed or the wrong file was paired.
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
            "Upload a Stock Guide multi-metric multi-axis scenario-grid (1..3 "
            "axes, one sheet per output metric, LONG format) to "
            "stock_guide_scenario_grid. REPLACE-TOTAL snapshot for one "
            "sensitivity table (all metrics at once); idempotent."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Target selection (exactly one of):\n"
            "  --sensitivity-id N        id of the stock_guide_sensitivities row (preferred).\n"
            "  --table-title \"...\"      title of that row; looked up in\n"
            "                            stock_guide_sensitivities. Errors if 0 or >1 match.\n\n"
            "Workbook (v2, downloaded from the Admin Panel): ONE SHEET PER METRIC,\n"
            "sheet name = metric key (target_price, fcfe, ...). Per sheet, the first\n"
            "d columns are coordinates read POSITIONALLY in definition.grid.axes\n"
            "order; every other non-empty column is a ticker whose cell is the\n"
            "metric value.\n"
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


# ── Sensitivity shell resolution (id + grid axes + output metrics) ──────────────

def _fetch_shell(supabase, args: argparse.Namespace) -> tuple[int, list[dict], list[str]]:
    """Resolve the target sensitivity_id and return (id, grid_axes, outputs).

    grid_axes is the parsed list from definition.grid.axes; outputs is the list
    of configured output-metric keys (legacy single `output` -> [that]; absent ->
    ['target_price']). Raises a clear error if the shell carries no valid grid.
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

    axes, outputs = _parse_grid(row.get("definition"))
    return sid, axes, outputs


def _parse_grid(definition) -> tuple[list[dict], list[str]]:
    """Extract & validate definition.grid: axes (1..3) and output metric keys.

    Returns (axes, outputs). outputs is derived from:
      - grid.outputs (list of strings)  -> used verbatim (v2);
      - grid.output (single string)     -> [that]  (legacy single-output);
      - neither                         -> ['target_price'].
    """
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

    # --- axes ---
    raw_axes = grid.get("axes")
    axes: list[dict] = []
    if isinstance(raw_axes, list) and raw_axes:
        for ax in raw_axes:
            if not isinstance(ax, dict):
                continue
            # v2 axes may key by driver_id (opaque) when no clean driver_key exists.
            key = str(ax.get("driver_key") or ax.get("driver_id") or "").strip()
            axes.append({
                "driver_key": key,
                "label": str(ax.get("label") or "").strip(),
                "unit": str(ax.get("unit") or "").strip(),
            })
        if not axes:
            print(
                "ERROR: shell definition.grid.axes is present but contains no "
                "valid axis. Re-save the shell in the Admin Panel."
            )
            sys.exit(1)
        if len(axes) > 3:
            print(
                f"ERROR: shell defines {len(axes)} axes — the mesh supports at "
                "most 3 (x/y/z). Re-save the shell with 1..3 axes."
            )
            sys.exit(1)
    elif "x_driver_key" in grid:
        # Legacy 1-D shape ({x_driver_key,...}) — the migration converts these,
        # but a stale/unsaved shell may still carry it.
        print(
            "ERROR: shell carries the legacy 1-D grid shape ({x_driver_key,...}) "
            "instead of {axes:[...]}. Re-save the shell in the Admin Panel."
        )
        sys.exit(1)
    else:
        print(
            "ERROR: shell definition.grid has no `axes` list. Re-save the shell "
            "in the Admin Panel."
        )
        sys.exit(1)

    # --- outputs ---
    outputs: list[str] = []
    raw_outputs = grid.get("outputs")
    if isinstance(raw_outputs, list) and raw_outputs:
        for o in raw_outputs:
            k = str(o).strip()
            if k and k not in outputs:
                outputs.append(k)
    if not outputs:
        legacy = grid.get("output")
        if isinstance(legacy, str) and legacy.strip():
            outputs = [legacy.strip()]
        else:
            outputs = [_DEFAULT_METRIC]

    print(f"  Axes ({len(axes)}): {[a['driver_key'] or a['label'] for a in axes]}")
    print(f"  Output metrics ({len(outputs)}): {outputs}")
    return axes, outputs


# ── Coordinate columns (positional) + ticker split per sheet ────────────────────

def _split_columns(df: pd.DataFrame, axes: list[dict]) -> tuple[list, list]:
    """First `d` columns are coordinates (POSITIONAL, in axis order). The rest
    are tickers. Returns (coord_columns, ticker_columns). A coordinate header
    that does not match its axis label/driver_key is only a sanity WARNING."""
    cols = list(df.columns)
    dim = len(axes)
    if len(cols) < dim:
        print(
            f"ERROR: sheet has {len(cols)} column(s) but the shell defines {dim} "
            f"axis/axes — the first {dim} columns must be the coordinates."
        )
        sys.exit(1)

    coord_cols = cols[:dim]
    rest = cols[dim:]

    # Sanity WARN: coordinate header should resemble the axis label/driver_key.
    for ax, c in zip(axes, coord_cols):
        hdr = str(c).strip().lower()
        expected = {ax["driver_key"].lower(), ax["label"].lower()} - {""}
        if expected and hdr not in expected:
            print(
                f"  WARNING: coordinate column header {str(c)!r} does not match "
                f"axis (driver_key={ax['driver_key']!r}, label={ax['label']!r}) "
                "— read positionally anyway."
            )

    ticker_cols = [
        c for c in rest
        if str(c).strip() and not str(c).startswith("Unnamed")
    ]

    # WARN if a ticker header is a known driver-catalog key — likely a coordinate
    # column landed in the ticker region (positional mis-alignment / wrong file).
    for c in ticker_cols:
        if str(c).strip().lower() in _DRIVER_CATALOG_KEYS:
            print(
                f"  WARNING: header {str(c)!r} is a known driver key but sits in "
                "the ticker region — being treated as a ticker. Coordinate column "
                "mis-placed / wrong file?"
            )

    if not ticker_cols:
        print(
            "ERROR: after the coordinate columns there are no ticker columns. "
            "Add at least one ticker column with metric values."
        )
        sys.exit(1)

    print(f"    Coordinate columns: {[str(c) for c in coord_cols]}")
    print(f"    Ticker columns ({len(ticker_cols)}): {[str(c) for c in ticker_cols]}")
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


# ── Melt + hard validations (LONG, per sheet) ───────────────────────────────────

def _melt_and_validate(
    df: pd.DataFrame, axes: list[dict], coord_cols: list, ticker_cols: list,
    sensitivity_id: int, metric: str,
) -> list[dict]:
    """Turn one sheet's LONG mesh into {sensitivity_id, ticker, metric, x_value,
    y_value, z_value, primary_value} records, enforcing the hard validations in
    plan order.

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
        print(f"    Dropped {n_dropped} fully-empty row(s) silently.")
    if not keep_idx:
        print(f"  WARNING: sheet {metric!r}: every row was empty — skipped.")
        return []

    def _excel_row(i: int) -> int:
        return i + 2  # +1 for 0-based -> 1-based, +1 for the header row

    axis_names = [a["driver_key"] or a["label"] or f"axis{n}" for n, a in enumerate(axes)]

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
            f"ERROR: sheet {metric!r}: {len(bad_coord_rows)} row(s) have a "
            f"non-numeric / blank coordinate cell — every coordinate must be "
            f"numeric. Excel rows: {shown}{more}"
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
            examples.append(f"    {dict(zip(axis_names, t))} @ Excel rows {rows}")
        print(
            f"ERROR: sheet {metric!r}: {len(dups)} duplicate coordinate tuple(s) "
            "— each scenario must appear exactly once.\n" + "\n".join(examples)
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
            examples.append(f"    {dict(zip(axis_names, t))}")
        dims_txt = " × ".join(f"{len(lv)}" for lv in per_axis_levels)
        print(
            f"ERROR: sheet {metric!r}: the mesh is not a complete Cartesian "
            f"product. Distinct levels per axis: {dims_txt} = {expected} "
            f"combinations expected, but {actual} rows present "
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
                f"ERROR: sheet {metric!r}, ticker {ticker!r} has "
                f"{len(bad_cell_rows)} non-numeric cell(s). Excel rows: {shown}{more}"
            )
            sys.exit(1)

        if n_blank == M:
            print(f"    WARNING: ticker {ticker!r}: column 100% empty — skipped.")
            continue
        if n_blank > 0:
            print(
                f"ERROR: sheet {metric!r}, ticker {ticker!r}: {n_blank} of {M} "
                "combos empty — the mesh must be complete per ticker."
            )
            sys.exit(1)

        for n in range(M):
            coords = coord_tuples[n]
            records.append({
                "sensitivity_id": sensitivity_id,
                "ticker": ticker,
                "metric": metric,
                "x_value": coords[0],
                "y_value": coords[1] if dim >= 2 else 0,
                "z_value": coords[2] if dim >= 3 else 0,
                "primary_value": cells[n],
            })
        per_ticker_count[ticker] = M

    dims_txt = " × ".join(f"{len(lv)}" for lv in per_axis_levels)
    print(f"    Mesh: {dims_txt} = {expected} scenarios × {len(per_ticker_count)} tickers")
    return records


# ── Workbook iteration: one sheet per metric ────────────────────────────────────

def _build_records(
    excel_path: str, axes: list[dict], outputs: list[str], sensitivity_id: int,
) -> list[dict]:
    """Iterate workbook sheets, matching each to a configured output metric, and
    accumulate validated records across all matched sheets."""
    try:
        xls = pd.ExcelFile(excel_path, engine="openpyxl")
    except Exception as e:
        print(f"ERROR: Could not open workbook: {e}")
        sys.exit(1)

    sheet_names = list(xls.sheet_names)
    print(f"\nWorkbook sheets ({len(sheet_names)}): {sheet_names}")

    # Case-insensitive map of configured output -> canonical metric key.
    output_lc = {o.lower(): o for o in outputs}

    records: list[dict] = []
    matched_metrics: set[str] = set()

    try:
        for sheet in sheet_names:
            metric = output_lc.get(str(sheet).strip().lower())
            if metric is None:
                print(
                    f"  WARNING: sheet {str(sheet)!r} matches no configured output "
                    f"metric {outputs} — skipped."
                )
                continue
            print(f"\n  Sheet {str(sheet)!r} -> metric {metric!r}:")
            df = xls.parse(sheet_name=sheet)
            print(f"    Rows: {len(df)}; columns: {list(df.columns)}")
            coord_cols, ticker_cols = _split_columns(df, axes)
            sheet_records = _melt_and_validate(
                df, axes, coord_cols, ticker_cols, sensitivity_id, metric
            )
            if sheet_records:
                matched_metrics.add(metric)
                records.extend(sheet_records)
    finally:
        # Release the workbook file handle (Windows keeps it locked otherwise).
        try:
            xls.close()
        except Exception:
            pass

    # Configured outputs with no matching sheet -> WARN (will be absent).
    for o in outputs:
        if o not in matched_metrics:
            print(
                f"  WARNING: metric {o!r} is configured on the shell but has no "
                "(non-empty) sheet in the workbook — it will be ABSENT from the "
                "upload."
            )

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

    # Resolve credentials (service role). In --dry-run, allow proceeding without
    # them: we still parse + validate; only the unknown-ticker check is skipped.
    supabase = None
    sensitivity_id: int
    axes: list[dict]
    outputs: list[str]
    if args.dry_run:
        url = os.environ.get("SUPABASE_URL") or _load_env_file().get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_SERVICE_KEY") or _load_env_file().get("SUPABASE_SERVICE_KEY", "")
        if url and key:
            supabase = create_client(url, key)
            sensitivity_id, axes, outputs = _fetch_shell(supabase, args)
        else:
            print(
                "ERROR: --dry-run still needs SUPABASE_URL + SUPABASE_SERVICE_KEY "
                "(read-only is enough) to fetch the shell's grid axes/outputs from "
                "the DB. It only skips the delete/upsert, not the shell lookup."
            )
            sys.exit(1)
    else:
        url, key = _get_credentials()
        supabase = create_client(url, key)
        sensitivity_id, axes, outputs = _fetch_shell(supabase, args)

    records = _build_records(excel_path, axes, outputs, sensitivity_id)
    total = len(records)
    metrics_loaded = sorted({r["metric"] for r in records})
    print(f"\nTotal mesh points to upload: {total} across metrics {metrics_loaded}")

    # --- total=0 = ERROR (silent-empty is a bug, pegadinha #12) ---
    if total == 0:
        print(
            "ERROR: 0 mesh points produced (no sheet matched a configured output, "
            "or every matched sheet was empty). Refusing to wipe the snapshot with "
            "nothing. Check the sheet names match the shell's output metrics."
        )
        sys.exit(1)

    _warn_unknown_tickers(supabase, records)

    if args.dry_run:
        print("\nDRY-RUN: validations passed. No delete, no upsert performed.")
        _print_payload_guidance(total)
        return

    # REPLACE-TOTAL: delete the whole snapshot for this sensitivity_id (ALL
    # metrics), then insert everything that came in the workbook.
    print(f"\nDeleting ALL existing rows for sensitivity_id={sensitivity_id} (all metrics)...")
    supabase.table("stock_guide_scenario_grid").delete().eq(
        "sensitivity_id", sensitivity_id
    ).execute()

    inserted = 0
    for i in range(0, total, _BATCH):
        batch = records[i : i + _BATCH]
        result = (
            supabase.table("stock_guide_scenario_grid")
            # upsert (not insert) so a re-run mid-failure stays idempotent even
            # if the delete already ran; PK is 6-col (incl. metric).
            .upsert(
                batch,
                on_conflict="sensitivity_id,ticker,metric,x_value,y_value,z_value",
            )
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
        f"for sensitivity_id={sensitivity_id} "
        f"({n_tickers} tickers, {len(axes)} axes, metrics {metrics_loaded})."
    )
    _print_payload_guidance(total)


def _print_payload_guidance(total: int) -> None:
    if total > _WARN_ROWS:
        print(
            f"\nWARNING: {total:,} mesh points is large (> {_WARN_ROWS:,}). "
            "Keep ≤15 levels/axis for 3-D meshes (≤40×40 for 2-D), and remember "
            "each output metric multiplies the payload the browser downloads."
        )


if __name__ == "__main__":
    main()
