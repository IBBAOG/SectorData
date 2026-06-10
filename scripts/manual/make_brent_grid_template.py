"""
Generate the Stock Guide Brent scenario-grid Excel TEMPLATE.

The analyst fills, per company, a dense 1-D mesh of (Brent level -> target price)
points along a single Brent axis. The frontend (/stock-guide) interpolates this
mesh live against the current Brent level. The filled grid is then uploaded with
`scripts/manual/stock_guide_brent_grid_upload.py`.

This script only produces the EMPTY skeleton the analyst types into:

    - WIDE format, single sheet.
    - 1st column header `brent`, pre-filled with Brent levels (default 40 -> 150
      step 5 = 23 rows; override with --min/--max/--step).
    - one column per ticker, header = ticker, cells LEFT BLANK (the analyst types
      the target price R$/share for each (brent, ticker) cell).

Tickers are discovered from `stock_guide_companies` (visible tickers, ordered by
display_order) via the public hide-aware RPC `get_stock_guide_comps` using the
ANON key (read-only, RLS-respecting). Override the ticker set with --tickers.

The output is the EXACT file the uploader reads by default:
    C:\\Users\\eduar\\dashboard_projeto\\data\\stock_guide_brent_grid.xlsx
(override with --out). That path is gitignored — never committed.

────────────────────────────────────────────────────────────────────────────
Usage:
    # Default: discover tickers from Supabase, Brent 40->150 step 5
    python scripts/manual/make_brent_grid_template.py

    # Regenerate over an existing file (DESTRUCTIVE — wipes analyst input):
    python scripts/manual/make_brent_grid_template.py --force

    # Explicit ticker set + custom Brent range, custom output:
    python scripts/manual/make_brent_grid_template.py \
        --tickers PETR4,PRIO3,RECV3 --min 50 --max 120 --step 5 \
        --out C:\\path\\to\\grid.xlsx --force

Credentials for ticker discovery (env vars, fall back to .env / .env.local):
    NEXT_PUBLIC_SUPABASE_URL  (or SUPABASE_URL)
    NEXT_PUBLIC_SUPABASE_ANON_KEY  (or SUPABASE_ANON_KEY)
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font


# ── Defaults ────────────────────────────────────────────────────────────────────

_DEFAULT_OUT = r"C:\Users\eduar\dashboard_projeto\data\stock_guide_brent_grid.xlsx"
_DEFAULT_MIN = 40.0
_DEFAULT_MAX = 150.0
_DEFAULT_STEP = 5.0
_X_COLUMN = "brent"


# ── Env / credentials ──────────────────────────────────────────────────────────

def _load_env_files() -> dict[str, str]:
    """Merge .env then .env.local (latter wins) from the current working dir."""
    result: dict[str, str] = {}
    for fname in (".env", ".env.local"):
        p = Path(fname)
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            result[key.strip()] = val.strip()
    return result


def _get_anon_credentials() -> tuple[str, str]:
    env = _load_env_files()
    url = (
        os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        or os.environ.get("SUPABASE_URL")
        or env.get("NEXT_PUBLIC_SUPABASE_URL")
        or env.get("SUPABASE_URL")
        or ""
    )
    key = (
        os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        or os.environ.get("SUPABASE_ANON_KEY")
        or env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        or env.get("SUPABASE_ANON_KEY")
        or ""
    )
    return url, key


# ── Ticker discovery ────────────────────────────────────────────────────────────

def _discover_tickers() -> list[str]:
    """Visible tickers from stock_guide_companies, ordered by display_order.

    Uses the public hide-aware RPC `get_stock_guide_comps` via the ANON key
    (read-only, RLS-respecting). Anon callers receive only visible tickers,
    which is the correct set for an analyst-facing template.
    """
    url, key = _get_anon_credentials()
    if not url or not key:
        print(
            "ERROR: Could not find anon Supabase credentials "
            "(NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). "
            "Set env vars / .env.local, or pass --tickers explicitly."
        )
        sys.exit(1)

    try:
        from supabase import create_client
    except ImportError:
        print("ERROR: supabase-py not installed (pip install supabase).")
        sys.exit(1)

    sb = create_client(url, key)
    try:
        resp = sb.rpc("get_stock_guide_comps", {}).execute()
    except Exception as e:
        print(f"ERROR: get_stock_guide_comps RPC failed: {e}")
        sys.exit(1)

    rows = resp.data or []
    if not rows:
        print(
            "ERROR: get_stock_guide_comps returned 0 rows. The anon caller may "
            "see no visible companies. Pass --tickers explicitly."
        )
        sys.exit(1)

    def _order_key(r: dict):
        d = r.get("display_order")
        return (d is None, d if d is not None else 0, str(r.get("ticker") or ""))

    rows_sorted = sorted(rows, key=_order_key)
    tickers = [str(r["ticker"]).strip() for r in rows_sorted if r.get("ticker")]
    # De-dupe while preserving order (defensive).
    seen: set[str] = set()
    out: list[str] = []
    for t in tickers:
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


# ── Brent levels ────────────────────────────────────────────────────────────────

def _build_brent_levels(lo: float, hi: float, step: float) -> list[float]:
    if step <= 0:
        print(f"ERROR: --step must be > 0 (got {step}).")
        sys.exit(1)
    if hi < lo:
        print(f"ERROR: --max ({hi}) must be >= --min ({lo}).")
        sys.exit(1)
    levels: list[float] = []
    v = lo
    # Tiny epsilon so the upper bound is included despite float drift.
    eps = step * 1e-9
    while v <= hi + eps:
        # Normalize -0.0 and trailing float noise.
        levels.append(round(v, 6))
        v += step
    return levels


def _as_number(x: float) -> int | float:
    """Render whole numbers as int so Excel shows 40 not 40.0."""
    return int(x) if float(x).is_integer() else float(x)


# ── CLI ───────────────────────────────────────────────────────────────────────

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=(
            "Generate the EMPTY Stock Guide Brent scenario-grid Excel template "
            "(WIDE: brent column + one blank column per ticker). The analyst "
            "fills target prices; upload with stock_guide_brent_grid_upload.py."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--out", default=_DEFAULT_OUT, metavar="PATH",
                   help=f"Output .xlsx path (default: {_DEFAULT_OUT}).")
    p.add_argument("--min", type=float, default=_DEFAULT_MIN, dest="min_brent",
                   metavar="USD", help=f"Min Brent level (default: {_DEFAULT_MIN}).")
    p.add_argument("--max", type=float, default=_DEFAULT_MAX, dest="max_brent",
                   metavar="USD", help=f"Max Brent level (default: {_DEFAULT_MAX}).")
    p.add_argument("--step", type=float, default=_DEFAULT_STEP, metavar="USD",
                   help=f"Brent step (default: {_DEFAULT_STEP}).")
    p.add_argument("--tickers", type=str, default=None, metavar="T1,T2,...",
                   help="Comma-separated ticker columns. Default: discover from "
                        "stock_guide_companies (visible, display_order).")
    p.add_argument("--force", action="store_true",
                   help="Overwrite the output file if it already exists "
                        "(DESTRUCTIVE — wipes any analyst input).")
    return p.parse_args()


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    args = _parse_args()

    out_path = Path(args.out)
    if out_path.exists() and not args.force:
        print(
            f"ERROR: Output already exists: {out_path}\n"
            "Refusing to overwrite (it may contain analyst input). "
            "Pass --force to regenerate from scratch."
        )
        sys.exit(1)

    # Resolve tickers
    if args.tickers:
        tickers = [t.strip() for t in args.tickers.split(",") if t.strip()]
        if not tickers:
            print("ERROR: --tickers was empty after parsing.")
            sys.exit(1)
        print(f"Tickers (from --tickers, {len(tickers)}): {tickers}")
    else:
        tickers = _discover_tickers()
        print(f"Tickers (from stock_guide_companies, {len(tickers)}): {tickers}")

    # Brent levels
    levels = _build_brent_levels(args.min_brent, args.max_brent, args.step)
    print(
        f"Brent range: {_as_number(args.min_brent)} -> {_as_number(args.max_brent)} "
        f"step {_as_number(args.step)}  ({len(levels)} rows)"
    )

    # Build workbook
    wb = Workbook()
    ws = wb.active
    ws.title = "brent_grid"

    headers = [_X_COLUMN] + tickers
    ws.append(headers)
    bold = Font(bold=True)
    for col_idx in range(1, len(headers) + 1):
        ws.cell(row=1, column=col_idx).font = bold

    for lvl in levels:
        # brent value in col 1; ticker cells left empty for the analyst.
        ws.append([_as_number(lvl)] + [None] * len(tickers))

    # Cosmetic: widen brent column; freeze header row.
    ws.column_dimensions["A"].width = 10
    ws.freeze_panes = "A2"

    out_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out_path)

    print(f"\nWrote template: {out_path}")
    print(f"  Sheet: {ws.title!r}")
    print(f"  Columns: {headers}")
    print(f"  Data rows: {len(levels)} (ticker cells empty — analyst fills target prices R$/share)")


if __name__ == "__main__":
    main()
