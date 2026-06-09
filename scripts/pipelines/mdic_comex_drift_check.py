#!/usr/bin/env python3
"""
mdic_comex_drift_check.py
=========================
Drift detector for retroactive ComexStat / SISCOMEX revisions in ``mdic_comex``.

ComexStat revises already-published months as more customs declarations are
processed. The daily 3-month + weekly 12-month sweeps in ``etl_mdic_comex.yml``
absorb recent revisions, but the annual "fechamento" (a final revision to the
prior year's late months, landing around Q1) can fall just outside the 12-month
window. This monthly check closes that gap for ANY horizon and surfaces the
revision as a loud-but-green signal.

Algorithm
---------
1. Fetch LIGHTWEIGHT live monthly aggregates for both flows over a trailing
   window (``--meses``, default 24). The call uses ``details: ["ncm"]`` (NO
   country detail) so each response is tiny — only monthly FOB + KG per month.
2. Read the stored aggregates from ``mdic_comex`` over the same window.
3. Compare per (flow, ano, mes). Flag DRIFT when the relative delta on FOB OR KG
   exceeds ``_TOL_PCT`` (default 0.5%), ignoring tiny months below ``_FLOOR_*``.
4. Self-heal each drifted month with a targeted full re-pull
   (``mdic_comex_sync.sync_months``), capped at ``_HEAL_CAP`` per run.
5. Signal: print a summary, emit GitHub Actions ``::warning::`` annotations and a
   ``$GITHUB_STEP_SUMMARY`` table listing each revised month + % delta. Exit
   non-zero ONLY if a heal was ATTEMPTED but FAILED (green = no drift or drift
   cleanly healed; red = needs a human).

CRITICAL API pegadinha (verified empirically 2026-06-09)
--------------------------------------------------------
The ComexStat ``period {from, to}`` does NOT describe a contiguous span. The
*month* component is applied as a recurring window across the *year* range, so a
naive trailing window like ``from=2024-06, to=2025-05`` returns ZERO rows (the
month range 06..05 is empty). To get a contiguous trailing window reliably we
request FULL CALENDAR YEARS (``from=<startYear>-01`` to ``to=<endYear>-12``) in a
single call per flow and filter client-side to the trailing N months. Verified:
``from=2024-01, to=2025-12`` returns all 24 months; ``from=2024-06, to=2025-05``
returns 0.

Uso:
    python scripts/pipelines/mdic_comex_drift_check.py                 # trailing 24 months
    python scripts/pipelines/mdic_comex_drift_check.py --meses 36      # wider window
    python scripts/pipelines/mdic_comex_drift_check.py --tolerancia 1.0
    python scripts/pipelines/mdic_comex_drift_check.py --dry-run       # detect only, no heal

Credenciais: SUPABASE_URL + SUPABASE_SERVICE_KEY (env ou .env na raiz do projeto).
"""
import argparse
import os
import sys
import time
from datetime import date
from pathlib import Path

import requests
from supabase import create_client

# Reuse the sync script's rate-limit/retry/headers machinery and the shared
# per-month pull+upsert path for self-healing. Both files live in the same dir.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mdic_comex_sync as sync  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── Tunables ────────────────────────────────────────────────────────────────
# A month is flagged DRIFT when the relative delta on FOB OR KG exceeds this.
_TOL_PCT = 0.5          # percent
# Absolute floors to ignore rounding noise on tiny months: a month is only
# eligible for drift if the stored total exceeds the floor (one per metric).
_FLOOR_FOB = 100_000.0  # USD
_FLOOR_KG  = 100_000.0  # kg
# Safety backstop, mirrors the cross-local heal-cap pattern (CLAUDE.md #17).
_HEAL_CAP = 12


# ── Credentials (walks worktree root AND main repo root) ──────────────────────

def _get_creds() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if url and key:
        return url, key
    # scripts/pipelines/ is 2 levels below the (work)tree root. Also probe a few
    # ancestors so a local run from inside a git worktree can still find the
    # main checkout's .env (the worktree's own .env.local only carries the anon
    # NEXT_PUBLIC_* keys, not the service key).
    here = Path(__file__).resolve()
    candidates = []
    for base in [here.parent.parent.parent, here.parent.parent.parent.parent,
                 Path.cwd()]:
        for name in (".env", ".env.local"):
            candidates.append(base / name)
    # Also walk straight up the tree from this file as a last resort.
    for anc in here.parents:
        candidates.append(anc / ".env")
    seen: set[Path] = set()
    for env_file in candidates:
        if env_file in seen or not env_file.exists():
            seen.add(env_file)
            continue
        seen.add(env_file)
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip()
            if k == "SUPABASE_URL" and not url:
                url = v
            if k == "SUPABASE_SERVICE_KEY" and not key:
                key = v
        if url and key:
            break
    if not url or not key:
        print("Error: SUPABASE_URL or SUPABASE_SERVICE_KEY not set")
        sys.exit(1)
    return url, key


# ── Trailing window helpers ───────────────────────────────────────────────────

def _trailing_months(n: int) -> list[tuple[int, int]]:
    """Return the last ``n`` (ano, mes) tuples ending at the current month."""
    cur = date.today().replace(day=1)
    out: list[tuple[int, int]] = []
    for _ in range(n):
        out.append((cur.year, cur.month))
        cur = (cur.replace(day=1) - __import__("datetime").timedelta(days=1)).replace(day=1)
    return sorted(out)


# ── Live aggregates (cheap, no country detail) ────────────────────────────────

def _post_agg_retry(flow: str, year_from: int, year_to: int) -> tuple[list[dict], bool]:
    """POST a lightweight monthly-aggregate query (no country detail).

    Requests FULL CALENDAR YEARS to dodge the period pegadinha (see module
    docstring) and reuses the sync script's headers/endpoint/backoff/Retry-After
    handling. Returns ``(rows, http_ok)``.
    """
    payload = {
        "flow":        flow,
        "monthDetail": True,
        "period":      {"from": f"{year_from}-01", "to": f"{year_to}-12"},
        "filters":     [{"filter": "ncm", "values": sync._NCMS}],
        "details":     ["ncm"],   # NO "country" → tiny response (≤ 12 mo × 3 NCM)
        "metrics":     ["metricFOB", "metricKG"],
    }
    http_ok = False
    for attempt in range(sync._RETRIES):
        try:
            r = requests.post(sync._API, headers=sync._HEADERS, json=payload, timeout=60)
            if r.status_code == 200:
                http_ok = True
                rows = r.json().get("data", {}).get("list", []) or []
                return rows, True
            print(f"    [warn] attempt {attempt + 1}: HTTP {r.status_code} "
                  f"({r.text[:120].strip()})")
            retry_after = r.headers.get("Retry-After")
            wait = sync._BACKOFF[attempt]
            if retry_after and retry_after.isdigit():
                wait = max(wait, int(retry_after))
        except Exception as e:  # noqa: BLE001
            print(f"    [warn] attempt {attempt + 1} failed: {e}")
            wait = sync._BACKOFF[attempt]
        if attempt < sync._RETRIES - 1:
            time.sleep(wait)
    return [], http_ok


def _live_aggregates(year_from: int, year_to: int) -> dict[tuple[str, int, int], dict]:
    """Return ``{(flow, ano, mes): {"fob": float, "kg": float}}`` from the API.

    One call per flow (full calendar-year span), summed across the 3 NCMs.
    """
    agg: dict[tuple[str, int, int], dict] = {}
    flows = ("import", "export")
    for idx, flow in enumerate(flows):
        print(f"  API {flow} {year_from}-01 → {year_to}-12 (monthly aggregate)...",
              end=" ", flush=True)
        rows, http_ok = _post_agg_retry(flow, year_from, year_to)
        if not http_ok:
            print("[HTTP FAILED]")
            raise RuntimeError(
                f"live aggregate fetch for {flow} failed (every HTTP attempt non-200)")
        n = 0
        for r in rows:
            try:
                ano = int(str(r.get("year", "")).strip())
                mes = int(str(r.get("monthNumber", "")).strip())
            except (ValueError, TypeError):
                continue
            fob = _to_float(r.get("metricFOB"))
            kg  = _to_float(r.get("metricKG"))
            cell = agg.setdefault((flow, ano, mes), {"fob": 0.0, "kg": 0.0})
            cell["fob"] += fob
            cell["kg"]  += kg
            n += 1
        print(f"{n:,} ncm-month rows")
        if idx < len(flows) - 1:
            time.sleep(sync._INTER_REQUEST_SLEEP)
    return agg


def _to_float(v) -> float:
    try:
        f = float(v)
        return 0.0 if f != f else f  # NaN guard
    except (TypeError, ValueError):
        return 0.0


# ── Stored aggregates ─────────────────────────────────────────────────────────

def _stored_aggregates(sb, year_from: int) -> dict[tuple[str, int, int], dict]:
    """Return ``{(flow, ano, mes): {"fob": float, "kg": float}}`` from the DB.

    Paginated SELECT (PostgREST caps page size); summed in Python by month.
    """
    agg: dict[tuple[str, int, int], dict] = {}
    page = 0
    page_size = 1000
    while True:
        resp = (
            sb.table("mdic_comex")
            .select("ano,mes,flow,valor_fob_usd,volume_kg")
            .gte("ano", year_from)
            .range(page * page_size, page * page_size + page_size - 1)
            .execute()
        )
        rows = resp.data or []
        for r in rows:
            try:
                ano = int(r["ano"]); mes = int(r["mes"])
            except (TypeError, ValueError, KeyError):
                continue
            flow = str(r.get("flow") or "")
            if flow not in ("import", "export"):
                continue
            cell = agg.setdefault((flow, ano, mes), {"fob": 0.0, "kg": 0.0})
            cell["fob"] += _to_float(r.get("valor_fob_usd"))
            cell["kg"]  += _to_float(r.get("volume_kg"))
        if len(rows) < page_size:
            break
        page += 1
    return agg


# ── Drift comparison ──────────────────────────────────────────────────────────

def _rel_delta(live: float, stored: float) -> float:
    """Relative delta of stored vs live, as a fraction (e.g. 0.046 = +4.6%)."""
    if stored == 0:
        return 0.0 if live == 0 else 1.0
    return (live - stored) / abs(stored)


def _detect_drift(live: dict, stored: dict, window: list[tuple[int, int]],
                  tol_frac: float) -> list[dict]:
    """Compare live vs stored over the trailing window. Returns drift records."""
    drifts: list[dict] = []
    window_set = set(window)
    for flow in ("import", "export"):
        for (ano, mes) in sorted(window_set):
            key = (flow, ano, mes)
            l = live.get(key, {"fob": 0.0, "kg": 0.0})
            s = stored.get(key, {"fob": 0.0, "kg": 0.0})
            # Skip tiny months (rounding noise) — both metrics must be below floor
            # AND live must also be small, otherwise a newly-appeared month
            # (stored=0, live large) is real drift we must surface.
            stored_small = s["fob"] < _FLOOR_FOB and s["kg"] < _FLOOR_KG
            live_small   = l["fob"] < _FLOOR_FOB and l["kg"] < _FLOOR_KG
            if stored_small and live_small:
                continue
            d_fob = _rel_delta(l["fob"], s["fob"])
            d_kg  = _rel_delta(l["kg"], s["kg"])
            if abs(d_fob) > tol_frac or abs(d_kg) > tol_frac:
                drifts.append({
                    "flow": flow, "ano": ano, "mes": mes,
                    "stored_fob": s["fob"], "live_fob": l["fob"], "d_fob": d_fob,
                    "stored_kg": s["kg"], "live_kg": l["kg"], "d_kg": d_kg,
                })
    return drifts


# ── GitHub Actions signalling ─────────────────────────────────────────────────

def _gha_warning(msg: str) -> None:
    # Annotation in the run log; safe no-op when not running under Actions.
    print(f"::warning::{msg}")


def _gha_summary(lines: list[str]) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    except OSError as e:  # noqa: BLE001
        print(f"  [warn] could not write GITHUB_STEP_SUMMARY: {e}")


def _fmt_pct(frac: float) -> str:
    return f"{frac * 100:+.2f}%"


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--meses", type=int, default=24,
                    help="Trailing months to check (default: 24)")
    ap.add_argument("--tolerancia", type=float, default=_TOL_PCT,
                    help=f"Relative drift tolerance in percent (default: {_TOL_PCT})")
    ap.add_argument("--heal-cap", type=int, default=_HEAL_CAP,
                    help=f"Max months to self-heal per run (default: {_HEAL_CAP})")
    ap.add_argument("--dry-run", action="store_true",
                    help="Detect and report only; do not self-heal")
    args = ap.parse_args()

    tol_frac = args.tolerancia / 100.0
    window = _trailing_months(args.meses)
    year_from = window[0][0]
    year_to = window[-1][0]
    print(f"Drift check: trailing {args.meses} months "
          f"({window[0][0]}-{window[0][1]:02d} → {window[-1][0]}-{window[-1][1]:02d}), "
          f"tolerance {args.tolerancia}% (calendar years {year_from}-{year_to})")

    url, key = _get_creds()
    sb = create_client(url, key)

    print("\nFetching live monthly aggregates (cheap, no country detail)...")
    live = _live_aggregates(year_from, year_to)
    print("Reading stored aggregates from mdic_comex...")
    stored = _stored_aggregates(sb, year_from)

    drifts = _detect_drift(live, stored, window, tol_frac)

    if not drifts:
        print(f"\nNo drift detected across {args.meses} months "
              f"(tolerance {args.tolerancia}%). Stored data matches live ComexStat.")
        _gha_summary([
            "## MDIC Comex drift check",
            "",
            f"No drift across the trailing {args.meses} months "
            f"(tolerance {args.tolerancia}%). Stored = live.",
        ])
        return

    print(f"\nDRIFT DETECTED in {len(drifts)} (flow, month) cell(s):")
    summary_lines = [
        "## MDIC Comex drift check",
        "",
        f"Detected **{len(drifts)}** drifted (flow, month) cell(s) "
        f"(tolerance {args.tolerancia}%).",
        "",
        "| Flow | Month | FOB Δ | KG Δ | Action |",
        "|------|-------|-------|------|--------|",
    ]
    # Determine the unique months to heal (a month drifting on either flow needs
    # both flows re-pulled by sync_months; collect month strings).
    months_to_heal: list[str] = []
    seen_months: set[str] = set()
    for d in drifts:
        mstr = f"{d['ano']}-{d['mes']:02d}"
        flow = d["flow"]
        msg = (f"ComexStat revised {flow} {mstr} "
               f"FOB by {_fmt_pct(d['d_fob'])}, KG by {_fmt_pct(d['d_kg'])} "
               f"(stored FOB {d['stored_fob']:,.0f} → live {d['live_fob']:,.0f})")
        print(f"  {msg}")
        _gha_warning(msg)
        if mstr not in seen_months:
            seen_months.add(mstr)
            months_to_heal.append(mstr)

    # Cap the heal set (safety backstop).
    cap = max(0, args.heal_cap)
    capped = False
    if len(months_to_heal) > cap:
        capped = True
        print(f"\n[WARNING] {len(months_to_heal)} months drifted but heal cap is "
              f"{cap}; healing the {cap} most recent and leaving the rest for the "
              f"next run.")
        _gha_warning(f"Heal cap hit: {len(months_to_heal)} months drifted, "
                     f"capping to {cap}. Remaining months will heal next run.")
        # Heal the most recent months first (they matter most to the dashboard).
        months_to_heal = sorted(months_to_heal, reverse=True)[:cap]

    heal_ok = True
    healed: set[str] = set()
    failed_legs: list[str] = []
    if args.dry_run:
        print("\n[dry-run] Skipping self-heal.")
    elif months_to_heal:
        print(f"\nSelf-healing {len(months_to_heal)} month(s): "
              f"{', '.join(sorted(months_to_heal))}")
        total, errors = sync.sync_months(sb, sorted(months_to_heal))
        print(f"  Re-pulled + upserted {total:,} rows")
        if errors:
            heal_ok = False
            failed_legs = errors
            print(f"  [ERROR] {len(errors)} leg(s) failed to fetch: "
                  f"{', '.join(errors)}")
        healed = {m for m in months_to_heal} if not errors else set()

    # Build the summary table now that we know what was healed.
    healed_set = {m for m in months_to_heal} if (not args.dry_run and heal_ok) else set()
    for d in drifts:
        mstr = f"{d['ano']}-{d['mes']:02d}"
        if args.dry_run:
            action = "detected (dry-run)"
        elif mstr in healed_set:
            action = "re-pulled"
        elif capped and mstr not in months_to_heal:
            action = "deferred (cap)"
        else:
            action = "heal FAILED"
        summary_lines.append(
            f"| {d['flow']} | {mstr} | {_fmt_pct(d['d_fob'])} | "
            f"{_fmt_pct(d['d_kg'])} | {action} |")
    _gha_summary(summary_lines)

    # Exit policy: red ONLY if a heal was attempted and FAILED. A clean heal (or
    # dry-run, or cap-deferred) is a loud-but-GREEN signal.
    if not args.dry_run and not heal_ok:
        print(f"\n[FATAL] Self-heal failed for: {', '.join(failed_legs)}. "
              f"Exiting non-zero so a human can investigate.")
        sys.exit(1)

    print("\nDone. Drift surfaced as a warning/summary"
          + ("" if args.dry_run else " and self-healed") + " — green run.")


if __name__ == "__main__":
    main()
