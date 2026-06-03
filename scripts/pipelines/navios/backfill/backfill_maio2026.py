"""
One-shot backfill — May 2026 diesel vessels missing from `navios_diesel`.

WHY
---
Two coverage gaps left May 2026 short of what actually transited the port
line-ups (the source of truth for navios_diesel — AIS is NOT used here):

  1. Porto de Itaqui BLACKOUT, 12–20 May 2026. The scraper silently returned
     0 ships for 9 days (Brotli decode failure — Pegadinha #12; the encoding
     was fixed 2026-05-21 in 5efe3077, and the watchdog was hardened to fail
     loud on broken fetches in this same task). Confirmed in-DB: Itaqui has
     data through 2026-05-11, none 12–20, resumes 2026-05-21. MITERA was lost
     entirely (0 rows anywhere in navios_diesel).

  2. Porto de Maceió was NEVER scraped (added as a source in this same task).
     Its diesel calls never reached navios_diesel.

A few Suape and Santos port-calls were also missing (distinct port-calls of
vessels we DID have at another port that month — e.g. MERSEY/SUPER G/ELANDRA
MAPLE called Itaqui AND Suape; PACIFIC AZUR called Itaqui AND Santos).

RECONCILIATION (set difference, NOT "add everything")
-----------------------------------------------------
The reference is a port-lineup manifest captured at the time by a colleague
(`manifesto_diesel_2026-06-03.xlsx`, sheet "Manifesto", 40 vessels in 2
sections). For each manifest vessel attributed to May 2026 we checked whether
`navios_diesel` already held that (porto, navio) for May. We had 24 of them;
these 7 were genuinely missing. Santos/Paranaguá actually carry MORE vessels
than the manifest, so this is a difference of sets — only the missing rows are
inserted.

No port retroactive endpoint covers the gap: Itaqui exposes only live state
(/desembarcados, /historico are 404) and Maceió is live-only, so the manifest
is the authoritative record of those captured line-ups. Paranaguá DOES expose
a retroactive line-up (relLineUpRetroativo), but reconciliation found 0 missing
Paranaguá vessels, so nothing is sourced from it here.

ATTRIBUTION / SEMANTICS
-----------------------
- `collected_at` = the manifest "último rel." timestamp (the real last-report
  time of that lineup capture — all mid-May). This lands the vessel in the
  correct month AND is deliberately NOT the May anchor snapshot
  (2026-05-31T19:00Z), so `get_nd_volume_mensal_historico` counts each row as
  DISCHARGED for the closed month of May (a vessel absent from the month's
  last snapshot but seen earlier = discharged & departed).
- `eta` = manifest ETA where present (noon BRT to avoid a TZ day-shift), else NULL.
- volume is already in m³ in the manifest → quantidade / quantidade_convertida
  both set to it, unidade 'm³'.
- `status` = 'Atracado' (arrived/berthed) — a concrete arrived state, never
  'ERRO_COLETA' or 'Despachado'.
- `imo`/`mmsi` left NULL — pipeline 03_imo_lookup fills them on the next run.
- `origem` NULL — all 7 are foreign-flag imports (none cabotage); verified
  against 04_cabotage_cleanup's blocklist + flag/origem rules, so none would
  be filtered. The same canonical filters that gate the live scraper
  (_diesel_puro, discharge/import only) hold: every row is diesel + import.

IDEMPOTENCY
-----------
Upsert ON CONFLICT (collected_at, porto, navio) DO NOTHING — re-running never
duplicates and never overwrites a real scrape that may later land on the same key.

USAGE
-----
  # Regenerate the SQL artifact (no DB write):
  python scripts/pipelines/navios/backfill/backfill_maio2026.py

  # Apply directly via service role (needs SUPABASE_URL + SUPABASE_SERVICE_KEY):
  python scripts/pipelines/navios/backfill/backfill_maio2026.py --apply

REVERSAL
--------
  DELETE FROM navios_diesel
  WHERE (collected_at, porto, navio) IN (
    ('2026-05-07T20:52:00-03:00', 'Porto de Santos', 'ISABELLA M II'),
    ('2026-05-07T20:52:00-03:00', 'Porto de Santos', 'PACIFIC AZUR'),
    ('2026-05-15T09:31:00-03:00', 'Porto de Suape',  'ELANDRA MAPLE'),
    ('2026-05-19T09:32:00-03:00', 'Porto de Itaqui', 'MITERA'),
    ('2026-05-19T09:32:00-03:00', 'Porto de Suape',  'SUPER G'),
    ('2026-05-21T09:34:00-03:00', 'Porto de Maceió', 'ELANDRA MAPLE'),
    ('2026-05-21T09:34:00-03:00', 'Porto de Suape',  'MERSEY')
  );
"""

from __future__ import annotations

import argparse
import os
import sys

# ---------------------------------------------------------------------------
# The backfill rows (the result of the set-difference reconciliation above).
# Each tuple: porto, navio, volume_m3, eta_date|None, collected_at (último rel.)
# ---------------------------------------------------------------------------
BACKFILL = [
    # Itaqui blackout (12–20 May) — fully lost vessel
    ("Porto de Itaqui", "MITERA",        60218, None,         "2026-05-19T09:32:00-03:00",
     "Itaqui blackout 12-20 May; absent from navios_diesel entirely; manifest record"),
    # Maceió — never scraped before this task
    ("Porto de Maceió", "ELANDRA MAPLE", 23400, None,         "2026-05-21T09:34:00-03:00",
     "Maceió not covered before 2026-06-03; manifest record"),
    # Santos — distinct port-calls missing from May (ISABELLA M II only in DB for Apr;
    # PACIFIC AZUR only in DB for Itaqui)
    ("Porto de Santos", "ISABELLA M II", 35503, "2026-05-07", "2026-05-07T20:52:00-03:00",
     "Santos call 07 May missing (DB had only an April Santos call); manifest record"),
    ("Porto de Santos", "PACIFIC AZUR",  47337, "2026-05-07", "2026-05-07T20:52:00-03:00",
     "Santos call 07 May missing (DB had only an Itaqui call); manifest record"),
    # Suape — distinct port-calls missing (each vessel was in DB at Itaqui, not Suape)
    ("Porto de Suape",  "ELANDRA MAPLE", 18840, "2026-05-11", "2026-05-15T09:31:00-03:00",
     "Suape call missing (DB had only an Itaqui call); manifest record"),
    ("Porto de Suape",  "SUPER G",       10150, "2026-05-16", "2026-05-19T09:32:00-03:00",
     "Suape call missing (DB had only an Itaqui call); manifest record"),
    ("Porto de Suape",  "MERSEY",        50000, "2026-05-20", "2026-05-21T09:34:00-03:00",
     "Suape call missing (DB had only an Itaqui call); manifest record"),
]

PRODUTO = "Óleo Diesel"
STATUS = "Atracado"


def _eta_iso(d: str | None) -> str | None:
    """ETA date (YYYY-MM-DD) → noon BRT ISO, to avoid a TZ day-shift; None → None."""
    return f"{d}T12:00:00-03:00" if d else None


def records() -> list[dict]:
    out = []
    for porto, navio, vol, eta, collected_at, _note in BACKFILL:
        out.append({
            "collected_at": collected_at,
            "porto": porto,
            "status": STATUS,
            "navio": navio,
            "produto": PRODUTO,
            "quantidade": float(vol),
            "unidade": "m³",
            "quantidade_convertida": float(vol),
            "eta": _eta_iso(eta),
            "inicio_descarga": None,
            "fim_descarga": None,
            "origem": None,
            "berco": None,
            "imo": None,
        })
    return out


def _sql_lit(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def build_sql() -> str:
    cols = [
        "collected_at", "porto", "status", "navio", "produto",
        "quantidade", "unidade", "quantidade_convertida",
        "eta", "inicio_descarga", "fim_descarga", "origem", "berco", "imo",
    ]
    lines = [
        "-- ============================================================================",
        "-- Backfill — May 2026 diesel vessels missing from navios_diesel.",
        "--",
        "-- Source of truth: port line-ups (NOT AIS). Two gaps left May short:",
        "--   1. Porto de Itaqui Brotli blackout 12-20 May 2026 (silent 0 rows for 9",
        "--      days; encoding fixed 2026-05-21 in 5efe3077; watchdog hardened in the",
        "--      same task as this backfill). MITERA was lost entirely.",
        "--   2. Porto de Maceió was never scraped before 2026-06-03.",
        "--   + a few distinct Suape/Santos port-calls of vessels we held at another",
        "--     port that month.",
        "--",
        "-- These 7 rows are the SET DIFFERENCE between a colleague's at-the-time port",
        "-- line-up manifest (manifesto_diesel_2026-06-03.xlsx) and what navios_diesel",
        "-- already held for May. Idempotent: ON CONFLICT DO NOTHING.",
        "--",
        "-- collected_at = manifest 'último rel.' (mid-May, NOT the 2026-05-31 anchor)",
        "-- so get_nd_volume_mensal_historico counts each as DISCHARGED for closed May.",
        "-- Per-row provenance in the comment after each VALUES tuple.",
        "-- ============================================================================",
        "",
        f"INSERT INTO public.navios_diesel ({', '.join(cols)}) VALUES",
    ]
    recs = records()
    notes = [b[5] for b in BACKFILL]
    # Trailing comma must come BEFORE the inline comment, otherwise the comma is
    # swallowed by the -- comment and the multi-row INSERT breaks.
    n = len(recs)
    tuple_lines = []
    for idx, (rec, note) in enumerate(zip(recs, notes)):
        vals = ", ".join(_sql_lit(rec[c]) for c in cols)
        sep = "," if idx < n - 1 else ""
        tuple_lines.append(f"  ({vals}){sep}  -- {note}")
    lines.append("\n".join(tuple_lines))
    lines.append("ON CONFLICT (collected_at, porto, navio) DO NOTHING;")
    lines.append("")
    lines.append("-- Reversal:")
    lines.append("--   DELETE FROM public.navios_diesel")
    lines.append("--   WHERE (collected_at, porto, navio) IN (")
    rev = ",\n".join(
        f"--     ({_sql_lit(r['collected_at'])}, {_sql_lit(r['porto'])}, {_sql_lit(r['navio'])})"
        for r in recs
    )
    lines.append(rev)
    lines.append("--   );")
    lines.append("")
    return "\n".join(lines)


def apply_via_service_role(recs: list[dict]) -> None:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        # Fall back to a sibling .env (the importer 02_diesel_import.mjs does the same)
        for candidate in (".env", os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".env")):
            try:
                import re
                txt = open(candidate, encoding="utf-8").read()
                url = url or (re.search(r"SUPABASE_URL=(\S+)", txt) or [None, None])[1]
                key = key or (re.search(r"SUPABASE_SERVICE_KEY=(\S+)", txt) or [None, None])[1]
            except OSError:
                continue
    if not (url and key):
        print("[backfill] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — cannot --apply.")
        print("[backfill] The SQL artifact is written; route it to worker_supabase.")
        sys.exit(1)

    from supabase import create_client
    sb = create_client(url, key)
    resp = (
        sb.table("navios_diesel")
        .upsert(recs, on_conflict="collected_at,porto,navio", ignore_duplicates=True)
        .execute()
    )
    n = len(resp.data or [])
    print(f"[backfill] upsert ON CONFLICT DO NOTHING — {n} row(s) inserted "
          f"(of {len(recs)}; duplicates skipped).")


def main() -> None:
    ap = argparse.ArgumentParser(description="Backfill May 2026 missing diesel vessels.")
    ap.add_argument("--apply", action="store_true",
                    help="Apply directly via service role (default: only write SQL).")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    sql_path = os.path.join(here, "backfill_maio2026.sql")
    sql = build_sql()
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write(sql)
    print(f"[backfill] wrote SQL artifact: {sql_path} ({len(records())} rows)")

    if args.apply:
        apply_via_service_role(records())
    else:
        print("[backfill] dry run (no DB write). Pass --apply to upsert via service role.")


if __name__ == "__main__":
    main()
