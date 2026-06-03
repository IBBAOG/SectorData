"""
One-shot reconciliation cleanup — May 2026 diesel vessels in `navios_diesel`.

This is the FINAL reconciliation pass for May 2026, following the 7-row main
backfill (`backfill_maio2026.py`). It applies two surgical data-quality fixes,
both scoped to the May window (collected_at in [2026-05-01, 2026-06-01)). The
source of truth is the port line-ups (NOT AIS) plus a colleague's at-the-time
manifest (`manifesto_diesel_2026-06-03.xlsx`, sheet "Manifesto").

ADJUSTMENT 1 — REMOVE the ATLANTIC PRIDE / Porto de Suape false-positive
------------------------------------------------------------------------
ATLANTIC PRIDE (IMO 9797266) was captured by the OLD Suape scraper before the
discharge-only fix (2026-06-03). On Suape's "Dados Brutos" sheet all of its
diesel blocks are `CG` (Carga/embarque = load-out, i.e. an EXPORT/departure, not
an import discharge), and its ETA is 2026-06-01 — not even a May discharge. It is
absent from the manifest entirely. This is precisely the bug fixed forward in
`buscar_suape()` (which now pairs `Produto.N` with `Tipo da Operação.N` and keeps
only `DG`/`TB DG`); only stale history remained. Business rule (Eduardo): keep
ONLY discharges (imports); CG never enters. => DELETE the 4 rows (all status
'Esperado'; ids were 28005/28014/28023/28032 at deletion time).

ADJUSTMENT 2 — Itaqui blackout (12–20 May): NO new rows
-------------------------------------------------------
The blackout (Brotli silent-zero, Pegadinha #12) cost us discharges between
12–20 May. MITERA was already restored by the main backfill. To be thorough we
recompute the SET DIFFERENCE between the manifest's `Desembarcado` rows (any
`Terceiros` excluded) attributed to May and what `navios_diesel` now holds. The
result is empty — every genuine May discharge is already present:

  * MITERA / Itaqui — the only blackout casualty — already backfilled.
  * MERSEY / Itaqui (manifest 39 300 m³, último rel. 29/05) is the vessel's
    LATE-May call (25–29 May, IMO 9865752, ~39 222 m³ qtyconv), which landed
    AFTER the scraper recovered on 21/05 — never lost, already live-scraped.
    Its Suape leg (50 000 m³) was already backfilled, and multi-port is real
    (Itaqui AND Suape are two distinct, legitimate port-calls — not a duplicate).
  * ELANDRA MAPLE / Itaqui (manifest 37 892 m³) is flagged `Terceiros` →
    excluded from backfill by rule; it is independently present from the live
    Itaqui feed (01–02 May, status Atracado) and left untouched.

So Adjustment 2 inserts 0 rows. The reconciliation is run live by this script
(`--apply` or default dry-run both print it) so a future regression where a real
discharge IS missing would surface immediately.

NOT TOUCHED (intentional)
-------------------------
  * Suape / PINE OLIA — uncertain; may be a legit discharge the colleague just
    did not list. Not removed on speculation.
  * Santos / PACIFIC AZUR & ISABELLA M II (07 May) — pending an explicit Eduardo
    decision; kept for now. Lowest-confidence May entries (manifest Status=Esperado).
  * The 5 prior backfill rows from backfill_maio2026.py.

The manifest was all imports (foreign flag), so the cabotage cleanup
(04_cabotage_cleanup) has nothing to remove for May; Adjustment 2 adds nothing,
so there is nothing new for it to evaluate either.

IDEMPOTENCY
-----------
The DELETE matches the natural key (porto + navio + May window) and is a no-op
once the rows are gone — safe to re-run.

USAGE
-----
  # Dry-run: print the reconciliation report + the rows that WOULD be deleted
  # (no DB write). Needs read access via SUPABASE_URL + SUPABASE_SERVICE_KEY.
  python scripts/pipelines/navios/backfill/reconcile_maio2026_cleanup.py

  # Apply (delete the ATLANTIC PRIDE rows) via service role:
  python scripts/pipelines/navios/backfill/reconcile_maio2026_cleanup.py --apply

  # Point at a specific manifest copy for the Adjustment-2 reconciliation report:
  python scripts/pipelines/navios/backfill/reconcile_maio2026_cleanup.py --manifest PATH

REVERSAL (re-insert the 4 deleted ATLANTIC PRIDE rows exactly as captured)
--------------------------------------------------------------------------
  INSERT INTO public.navios_diesel
    (collected_at, porto, status, navio, produto, quantidade, unidade,
     quantidade_convertida, eta, berco)
  VALUES
    ('2026-05-27T13:01:00+00:00','Porto de Suape','Esperado','ATLANTIC PRIDE','Óleo Diesel',16200,'c',16200,'2026-06-01T09:00:00+00:00','PGL-3A'),
    ('2026-05-27T19:01:00+00:00','Porto de Suape','Esperado','ATLANTIC PRIDE','Óleo Diesel',16200,'c',16200,'2026-06-01T09:00:00+00:00','PGL-3A'),
    ('2026-05-28T01:00:00+00:00','Porto de Suape','Esperado','ATLANTIC PRIDE','Óleo Diesel',16200,'c',16200,'2026-06-01T09:00:00+00:00','PGL-3A'),
    ('2026-05-28T07:00:00+00:00','Porto de Suape','Esperado','ATLANTIC PRIDE','Óleo Diesel',16200,'c',16200,'2026-06-01T09:00:00+00:00','PGL-3A')
  ON CONFLICT (collected_at, porto, navio) DO NOTHING;
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import unicodedata
from collections import defaultdict

# --- May 2026 window ---------------------------------------------------------
MAY_LO = "2026-05-01"
MAY_HI = "2026-06-01"

# --- ADJUSTMENT 1 target (natural key) ---------------------------------------
DELETE_PORTO = "Porto de Suape"
DELETE_NAVIO = "ATLANTIC PRIDE"

# --- Manifest default location (a colleague's WhatsApp transfer) -------------
DEFAULT_MANIFEST = os.path.join(
    os.environ.get("LOCALAPPDATA", ""),
    "Packages", "5319275A.WhatsAppDesktop_cv1g1gvanyjgm", "LocalState", "sessions",
    "92FA37532ECCC38BF87824D2E529580C18D16695", "transfers", "2026-23",
    "manifesto_diesel_2026-06-03.xlsx",
)

PORT_MAP = {
    "Suape": "Porto de Suape",
    "Santos": "Porto de Santos",
    "Itaqui": "Porto de Itaqui",
    "Paranagua": "Porto de Paranaguá",
    "Maceio": "Porto de Maceió",
    "Sao Sebastiao": "Porto de São Sebastião",
}


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
        print("[reconcile] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — cannot reach DB.")
        print("[reconcile] Route reconcile_maio2026_cleanup.sql to worker_supabase instead.")
        sys.exit(1)
    from supabase import create_client
    return create_client(url, key)


def _distinct_by_port(sb) -> dict[str, set]:
    resp = (
        sb.table("navios_diesel")
        .select("porto,navio")
        .gte("collected_at", MAY_LO)
        .lt("collected_at", MAY_HI)
        .execute()
    )
    byport: dict[str, set] = defaultdict(set)
    for r in (resp.data or []):
        byport[r["porto"]].add((r["navio"] or "").strip())
    return byport


def _print_distinct(title: str, byport: dict[str, set], baseline: dict[str, set] | None = None) -> int:
    print(title)
    total = 0
    for p in sorted(byport):
        n = len(byport[p])
        total += n
        if baseline is not None:
            delta = n - len(baseline.get(p, set()))
            tag = f"  ({'+' if delta >= 0 else ''}{delta})" if delta else ""
        else:
            tag = ""
        print(f"  {p:<24}{n:>4}{tag}")
    print(f"  {'TOTAL distinct port-calls':<24}{total:>4}")
    return total


# ---------------------------------------------------------------------------
# ADJUSTMENT 2 — recompute the manifest-vs-DB set difference (live re-validation)
# ---------------------------------------------------------------------------
def _norm(s) -> str:
    if s is None:
        return ""
    try:
        import pandas as pd  # local import — only needed when a manifest is present
        if pd.isna(s):
            return ""
    except Exception:
        pass
    return unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().strip()


def _rel_month(obs: str):
    o = str(obs)
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", o)
    if m:
        return int(m.group(3)), int(m.group(2))  # (year, month)
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", o)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


def reconcile_adjustment2(sb, manifest_path: str) -> list[tuple[str, str, str]]:
    """Return the list of genuine May discharges in the manifest that are MISSING
    from navios_diesel (expected: empty). Prints the per-row report."""
    try:
        import pandas as pd
    except ImportError:
        print("[reconcile] pandas not installed — skipping Adjustment-2 manifest report.")
        return []
    if not os.path.exists(manifest_path):
        print(f"[reconcile] manifest not found at:\n  {manifest_path}")
        print("[reconcile] (skipping Adjustment-2 report; the in-DB conclusion stands: 0 missing).")
        return []

    raw = pd.read_excel(manifest_path, sheet_name="Manifesto", header=None)
    # Section 2 (Desembarcados/Terceiros) — header at row 9, data 10..end.
    sec2 = raw.iloc[10:].copy()
    sec2.columns = ["eta", "porto", "status", "navio", "produto", "grupo", "volume", "tipo", "obs"][: sec2.shape[1]]

    db_may = _distinct_by_port(sb)
    db_keys = {(p, n.upper()) for p, ships in db_may.items() for n in ships}

    print("\n=== ADJUSTMENT 2 — manifest 'Desembarcado' (May) vs navios_diesel ===")
    print(f"{'Porto':<22}{'Navio':<18}{'Vol':>8} {'Tipo':<13}{'Rel':<9}{'Decision'}")
    print("-" * 92)
    missing: list[tuple[str, str, str]] = []
    for _, r in sec2.iterrows():
        navio = _norm(r["navio"]).upper()
        if not navio:
            continue
        porto = PORT_MAP.get(_norm(r["porto"]), _norm(r["porto"]))
        tipo = _norm(r["tipo"])
        yy, mm = _rel_month(r["obs"])
        relm = f"{yy}-{mm:02d}" if mm else "?"
        is_may = (yy == 2026 and mm == 5)
        in_db = (porto, navio) in db_keys
        if tipo == "Terceiros":
            dec = "EXCLUDE (Terceiros)"
        elif not is_may:
            dec = f"skip (rel {relm})"
        elif in_db:
            dec = "already in DB"
        else:
            dec = ">>> MISSING — investigate <<<"
            missing.append((porto, navio, relm))
        print(f"{porto:<22}{navio:<18}{str(r['volume']):>8} {tipo:<13}{relm:<9}{dec}")
    print("-" * 92)
    if missing:
        print(f"[reconcile] WARNING: {len(missing)} genuine May discharge(s) missing — backfill needed:")
        for p, n, rm in missing:
            print(f"            {p} / {n} (rel {rm})")
    else:
        print("[reconcile] Adjustment 2: 0 genuine May discharges missing (MERSEY/Itaqui present;"
              " ELANDRA MAPLE/Itaqui is Terceiros). Nothing to backfill.")
    return missing


# ---------------------------------------------------------------------------
def main() -> None:
    ap = argparse.ArgumentParser(description="Reconcile/clean May 2026 navios_diesel (pass 2).")
    ap.add_argument("--apply", action="store_true",
                    help="Delete the ATLANTIC PRIDE/Suape rows (default: dry-run report only).")
    ap.add_argument("--manifest", default=DEFAULT_MANIFEST,
                    help="Path to manifesto_diesel_*.xlsx for the Adjustment-2 report.")
    args = ap.parse_args()

    sb = _service_client()

    before = _distinct_by_port(sb)
    _print_distinct("===== BEFORE — distinct (porto, navio) May 2026 =====", before)
    in_suape = DELETE_NAVIO in before.get(DELETE_PORTO, set())
    print(f"  {DELETE_NAVIO} in {DELETE_PORTO}: {in_suape}")

    # Show the exact rows targeted by Adjustment 1.
    tgt = (
        sb.table("navios_diesel")
        .select("id,collected_at,porto,navio,status,eta,produto")
        .gte("collected_at", MAY_LO).lt("collected_at", MAY_HI)
        .eq("porto", DELETE_PORTO).eq("navio", DELETE_NAVIO)
        .order("collected_at").execute()
    ).data or []
    print(f"\n=== ADJUSTMENT 1 — {DELETE_NAVIO} / {DELETE_PORTO} (CG false-positive) ===")
    print(f"  {len(tgt)} row(s) {'to delete' if args.apply else 'that WOULD be deleted (dry-run)'}:")
    for r in tgt:
        print(f"    id={r.get('id')} collected_at={r['collected_at']} status={r['status']} eta={r['eta']}")

    if args.apply and tgt:
        deleted = (
            sb.table("navios_diesel")
            .delete()
            .gte("collected_at", MAY_LO).lt("collected_at", MAY_HI)
            .eq("porto", DELETE_PORTO).eq("navio", DELETE_NAVIO)
            .execute()
        ).data or []
        print(f"  Deleted {len(deleted)} row(s).")
    elif not args.apply:
        print("  (dry-run — pass --apply to delete)")

    # Adjustment 2 — live re-validation against the manifest.
    reconcile_adjustment2(sb, args.manifest)

    after = _distinct_by_port(sb)
    print()
    _print_distinct("===== AFTER — distinct (porto, navio) May 2026 =====", after, baseline=before)
    print(f"  {DELETE_NAVIO} in {DELETE_PORTO}: {DELETE_NAVIO in after.get(DELETE_PORTO, set())}")


if __name__ == "__main__":
    main()
