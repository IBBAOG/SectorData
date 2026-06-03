"""
One-shot reconciliation — May 2026 Santos low-confidence removal (pass 3).

This is the FINAL surgical pass for May 2026 `navios_diesel`, resolving the one
item the previous pass (`reconcile_maio2026_cleanup.py`) deliberately left open
"pending an explicit decision by Eduardo". That decision has now been made:
REMOVE the two lowest-confidence Santos entries that originated from a
colleague's at-the-time manifest (`manifesto_diesel_2026-06-03.xlsx`, sheet
"Manifesto").

WHAT IS REMOVED (exactly 2 rows, both imo IS NULL — manifest backfill rows)
---------------------------------------------------------------------------
  * PACIFIC AZUR  / Porto de Santos / 07 May — ~47 337 m³ (id was 28241).
  * ISABELLA M II / Porto de Santos / 07 May — ~35 503 m³ (id was 28240).

Both were inserted by `backfill_maio2026.py` with collected_at
'2026-05-07T20:52:00-03:00' (stored UTC: '2026-05-07T23:52:00+00:00'),
status 'Atracado' (as all backfill rows are), eta 2026-05-07.

WHY (Eduardo's call, 2026-06-03)
--------------------------------
On the colleague's manifest these two are the only Santos vessels flagged
Status="Esperado" (EXPECTED — discharge NOT confirmed); they are the
lowest-confidence rows on his sheet. Our own Santos scraper ran normally for the
whole month (19 distinct vessels live-scraped — already MORE than the colleague's
14 Santos entries) and never captured either vessel. With our first-party source
both healthy and broader than the manifest for Santos, we prioritise the accuracy
of our own feed over inflating the count with two unconfirmed "Esperado" rows.
This is the opposite trade-off from the Itaqui blackout (where our feed had a
real 9-day hole and the manifest was the only record) — here there is no gap to
fill, so the manifest's weakest rows are dropped.

SAFETY (why the natural key is strictly scoped)
-----------------------------------------------
PACIFIC AZUR ALSO has a legitimate, live-scraped June call at Porto de Itaqui
(IMO 9788540) and ISABELLA M II has legitimate April Santos calls (IMO 9836440).
The DELETE is therefore scoped to ALL of: porto='Porto de Santos' AND the vessel
name AND the May window AND imo IS NULL — so only the two manifest-backfill rows
match. The live Itaqui/April rows (which carry a real IMO) are never touched.
Verified in-DB before deletion: each target has exactly 1 May Santos row and it
is the imo-NULL one.

NOT TOUCHED (intentional)
-------------------------
  * The other backfill rows stay: MITERA/Itaqui, ELANDRA MAPLE/Maceió,
    ELANDRA MAPLE/Suape, SUPER G/Suape, MERSEY/Suape.
  * The ATLANTIC PRIDE/Suape CG false-positive was already removed in pass 2.
  * Every live-scraped Santos vessel stays.

EFFECT
------
Santos distinct (porto, navio) for May drops by exactly 2 (each removed vessel
had only this single May Santos row). Reported before/after by this script.

IDEMPOTENCY
-----------
The DELETE matches the natural key (porto + navio + May window + imo IS NULL) and
is a no-op once the rows are gone — safe to re-run. ON CONFLICT DO NOTHING on the
reversal makes re-insertion idempotent too.

USAGE
-----
  # Dry-run: print the exact rows that WOULD be deleted + before/after Santos
  # distinct (no DB write). Needs SUPABASE_URL + SUPABASE_SERVICE_KEY.
  python scripts/pipelines/navios/backfill/reconcile_maio2026_santos.py

  # Apply (delete the 2 Santos rows) via service role:
  python scripts/pipelines/navios/backfill/reconcile_maio2026_santos.py --apply

REVERSAL (re-insert the 2 deleted Santos rows exactly as captured)
------------------------------------------------------------------
  INSERT INTO public.navios_diesel
    (collected_at, porto, status, navio, produto, quantidade, unidade,
     quantidade_convertida, eta, inicio_descarga, fim_descarga, origem, berco, imo)
  VALUES
    ('2026-05-07T20:52:00-03:00','Porto de Santos','Atracado','PACIFIC AZUR','Óleo Diesel',47337,'m³',47337,'2026-05-07T12:00:00-03:00',NULL,NULL,NULL,NULL,NULL),
    ('2026-05-07T20:52:00-03:00','Porto de Santos','Atracado','ISABELLA M II','Óleo Diesel',35503,'m³',35503,'2026-05-07T12:00:00-03:00',NULL,NULL,NULL,NULL,NULL)
  ON CONFLICT (collected_at, porto, navio) DO NOTHING;
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from collections import defaultdict

# --- May 2026 window ---------------------------------------------------------
MAY_LO = "2026-05-01"
MAY_HI = "2026-06-01"

# --- Removal targets (natural key) -------------------------------------------
DELETE_PORTO = "Porto de Santos"
DELETE_NAVIOS = ("PACIFIC AZUR", "ISABELLA M II")

# Exact reversal payload, captured from the live rows before deletion
# (ids 28241 / 28240). collected_at written in the -03:00 form the backfill used;
# it resolves to the same instant as the stored UTC '2026-05-07T23:52:00+00:00'.
REVERSAL_ROWS = [
    {
        "collected_at": "2026-05-07T20:52:00-03:00",
        "porto": "Porto de Santos",
        "status": "Atracado",
        "navio": "PACIFIC AZUR",
        "produto": "Óleo Diesel",
        "quantidade": 47337.0,
        "unidade": "m³",
        "quantidade_convertida": 47337.0,
        "eta": "2026-05-07T12:00:00-03:00",
        "inicio_descarga": None,
        "fim_descarga": None,
        "origem": None,
        "berco": None,
        "imo": None,
    },
    {
        "collected_at": "2026-05-07T20:52:00-03:00",
        "porto": "Porto de Santos",
        "status": "Atracado",
        "navio": "ISABELLA M II",
        "produto": "Óleo Diesel",
        "quantidade": 35503.0,
        "unidade": "m³",
        "quantidade_convertida": 35503.0,
        "eta": "2026-05-07T12:00:00-03:00",
        "inicio_descarga": None,
        "fim_descarga": None,
        "origem": None,
        "berco": None,
        "imo": None,
    },
]


# ---------------------------------------------------------------------------
# Service-role client (same .env discovery as backfill_maio2026.py).
# ---------------------------------------------------------------------------
def _service_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not (url and key):
        for candidate in (
            ".env",
            os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", ".env"),
        ):
            try:
                txt = open(candidate, encoding="utf-8").read()
            except OSError:
                continue
            url = url or (re.search(r"SUPABASE_URL=(\S+)", txt) or [None, None])[1]
            key = key or (re.search(r"SUPABASE_SERVICE_KEY=(\S+)", txt) or [None, None])[1]
    if not (url and key):
        print("[santos] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — cannot reach DB.")
        print("[santos] Route reconcile_maio2026_santos.sql to worker_supabase instead.")
        sys.exit(1)
    from supabase import create_client
    return create_client(url, key)


def _santos_distinct(sb) -> set:
    resp = (
        sb.table("navios_diesel")
        .select("navio")
        .gte("collected_at", MAY_LO).lt("collected_at", MAY_HI)
        .eq("porto", DELETE_PORTO)
        .execute()
    )
    return {(r["navio"] or "").strip() for r in (resp.data or [])}


def _targeted_rows(sb, navio: str) -> list[dict]:
    """The strictly-scoped natural-key match for one vessel (porto + navio + May +
    imo IS NULL). Returns the full row(s) so the reversal stays exact."""
    return (
        sb.table("navios_diesel")
        .select("id,collected_at,porto,navio,status,produto,quantidade,unidade,"
                "quantidade_convertida,eta,imo,mmsi,berco,origem")
        .gte("collected_at", MAY_LO).lt("collected_at", MAY_HI)
        .eq("porto", DELETE_PORTO).eq("navio", navio).is_("imo", "null")
        .order("collected_at").execute()
    ).data or []


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Remove the 2 low-confidence May Santos manifest rows (pass 3).")
    ap.add_argument("--apply", action="store_true",
                    help="Delete the 2 Santos rows (default: dry-run report only).")
    args = ap.parse_args()

    sb = _service_client()

    before = _santos_distinct(sb)
    print(f"===== BEFORE — Santos distinct (porto, navio) May 2026: {len(before)} =====")

    # Show the exact rows targeted, strictly scoped (imo IS NULL only).
    targets: list[dict] = []
    for nav in DELETE_NAVIOS:
        rows = _targeted_rows(sb, nav)
        print(f"\n=== {nav} / {DELETE_PORTO} (manifest 'Esperado' low-confidence) ===")
        print(f"  {len(rows)} row(s) {'to delete' if args.apply else 'that WOULD be deleted (dry-run)'}:")
        for r in rows:
            print(f"    id={r.get('id')} collected_at={r['collected_at']} status={r['status']} "
                  f"qty={r['quantidade_convertida']} eta={r['eta']} imo={r['imo']}")
        targets.extend(rows)

    if len(targets) != 2:
        print(f"\n[santos] ABORT: expected exactly 2 targeted rows, found {len(targets)}.")
        print("[santos] Refusing to delete — the natural key must match precisely "
              "(porto='Porto de Santos' + navio + May + imo IS NULL).")
        sys.exit(2)

    if args.apply:
        n_deleted = 0
        for nav in DELETE_NAVIOS:
            deleted = (
                sb.table("navios_diesel")
                .delete()
                .gte("collected_at", MAY_LO).lt("collected_at", MAY_HI)
                .eq("porto", DELETE_PORTO).eq("navio", nav).is_("imo", "null")
                .execute()
            ).data or []
            n_deleted += len(deleted)
        print(f"\n  Deleted {n_deleted} row(s) (expected 2).")
    else:
        print("\n  (dry-run — pass --apply to delete)")

    after = _santos_distinct(sb)
    delta = len(after) - len(before)
    print(f"\n===== AFTER — Santos distinct (porto, navio) May 2026: {len(after)}"
          f"  ({'+' if delta >= 0 else ''}{delta}) =====")
    for nav in DELETE_NAVIOS:
        print(f"  {nav} still in Santos May: {nav in after}")


if __name__ == "__main__":
    main()
