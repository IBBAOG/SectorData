"""
Cabotage cleanup — hard-delete Brazilian coastal-shipping rows from
`navios_diesel` so they never appear in any RPC output (expected or
delivered tables) and don't clutter the AIS tracking pipeline.

Detection signals (OR'd):

  1. flag matches Brazilian variants (resolved by vessel_lookup)
  2. origem matches a Brazilian locode/name pattern (Suape scraping)
  3. vessel name is on the curated Brazilian-fleet blocklist

Signal 3 covers vessels that VesselFinder / MarineTraffic don't index
(many small coastal tankers aren't listed publicly). Extend the
BLOCKLIST set below as new cabotage vessels appear.

Also cleans related rows in vessel_positions and port_arrivals when
the MMSI/IMO is no longer referenced anywhere in navios_diesel.

Runs after `vessel_lookup.py` in the `vessel_lookup.yml` workflow.
Idempotent — re-running is safe.
"""

from __future__ import annotations

import os
import re
import sys
from typing import Any

from dotenv import load_dotenv
from supabase import create_client


load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
if not (SUPABASE_URL and SUPABASE_KEY):
    print("[erro] faltam env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY", file=sys.stderr)
    sys.exit(1)


# ─── Curated Brazilian-fleet blocklist (normalised names) ───────────────────
# Match is performed on UPPER(navio) with non-alphanumerics stripped, so
# "Sergio Buarque de Holanda" and "SERGIO-BUARQUE_DE_HOLANDA" both hit.
BLOCKLIST_NORM: set[str] = {
    # Transpetro Aframax / Suezmax
    "ATAULFOALVES", "CARLOSDRUMMOND", "CELSOFURTADO",
    "DRAGAOELERJ", "HENRIQUEDIAS", "JOAOCANDIDO",
    "MARCILIODIAS", "SERGIOBUARQUEDEHOLANDA", "TANCREDONEVES",
    "TOBIASBARRETO", "VITALDEOLIVEIRA", "ZUMBIDOSPALMARES",
    # Transpetro product tankers / smaller coastal
    "BARRADOITAPOCU", "BARRADORIACHO", "BARRADOUNA", "BARRADODANTE",
    "CARIOCA", "GERONIMO", "LAMBARI", "MARAJO", "NORDESTINA",
    # Norsul / Eisa / other Brazilian cabotage
    "BASTOSI", "BASTOSII", "BASTOSIII",
    "GUARANI", "GUARAPARI", "PARATY", "PARANAIBA",
    "IBIA", "ISOLDA", "CATUAI",
}


def _norm(s: str | None) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", (s or "")).upper()


def classify(row: dict[str, Any]) -> str | None:
    """Return the reason this row is cabotage, or None if it's an import."""
    flag = (row.get("flag") or "").upper()
    if flag in ("BRAZIL", "BRASIL", "BR"):
        return f"flag={flag}"

    origem = (row.get("origem") or "").upper()
    if origem.endswith("-BRA") or "BRASIL" in origem:
        return f"origem={row.get('origem')}"

    name_norm = _norm(row.get("navio"))
    if name_norm in BLOCKLIST_NORM:
        return f"blocklist={row.get('navio')}"

    return None


def _chunk(xs: list, n: int):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def main() -> None:
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Page through navios_diesel in case the table grows — supabase-py caps
    # a single select at 1000 rows, so we loop until the page is short.
    all_rows: list[dict] = []
    offset = 0
    PAGE = 1000
    while True:
        resp = (
            sb.table("navios_diesel")
            .select("id, navio, flag, origem, imo, mmsi")
            .range(offset, offset + PAGE - 1)
            .execute()
        )
        chunk = resp.data or []
        all_rows.extend(chunk)
        if len(chunk) < PAGE:
            break
        offset += PAGE

    print(f"[cabot] {len(all_rows)} linhas totais em navios_diesel")

    to_delete: list[int] = []
    cabot_mmsis: set[str] = set()
    cabot_imos: set[str] = set()
    by_reason: dict[str, int] = {}
    sample_names: dict[str, set[str]] = {}

    for row in all_rows:
        reason = classify(row)
        if not reason:
            continue
        to_delete.append(row["id"])
        if row.get("mmsi"):
            cabot_mmsis.add(row["mmsi"])
        if row.get("imo"):
            cabot_imos.add(row["imo"])
        key = reason.split("=", 1)[0]
        by_reason[key] = by_reason.get(key, 0) + 1
        sample_names.setdefault(key, set()).add(row.get("navio") or "")

    if not to_delete:
        print("[cabot] nenhuma linha de cabotagem encontrada — nada a fazer")
        return

    print(f"[cabot] identificadas {len(to_delete)} linha(s) de cabotagem:")
    for key, n in sorted(by_reason.items()):
        sample = sorted(sample_names.get(key, set()))[:5]
        print(f"[cabot]   {key}: {n} linha(s) — ex: {sample}")

    # DELETE from navios_diesel in batches
    deleted = 0
    for batch in _chunk(to_delete, 500):
        sb.table("navios_diesel").delete().in_("id", batch).execute()
        deleted += len(batch)
    print(f"[cabot] {deleted} linha(s) removidas de navios_diesel")

    # Cascade cleanup: drop vessel_positions rows for MMSIs/IMOs no longer
    # referenced by any (non-cabotage) navios_diesel row.
    if cabot_mmsis:
        still_refd = set()
        resp = (
            sb.table("navios_diesel")
            .select("mmsi")
            .in_("mmsi", list(cabot_mmsis))
            .execute()
        )
        for r in resp.data or []:
            if r.get("mmsi"):
                still_refd.add(r["mmsi"])
        orphan_mmsis = cabot_mmsis - still_refd
        if orphan_mmsis:
            for batch in _chunk(list(orphan_mmsis), 500):
                sb.table("vessel_positions").delete().in_("mmsi", batch).execute()
            print(f"[cabot] {len(orphan_mmsis)} MMSI(s) órfão(s) removido(s) de vessel_positions")

    if cabot_imos:
        still_refd = set()
        resp = (
            sb.table("navios_diesel")
            .select("imo")
            .in_("imo", list(cabot_imos))
            .execute()
        )
        for r in resp.data or []:
            if r.get("imo"):
                still_refd.add(r["imo"])
        orphan_imos = cabot_imos - still_refd
        if orphan_imos:
            for batch in _chunk(list(orphan_imos), 500):
                sb.table("port_arrivals").delete().in_("imo", batch).execute()
            print(f"[cabot] {len(orphan_imos)} IMO(s) órfão(s) removido(s) de port_arrivals")


if __name__ == "__main__":
    main()
