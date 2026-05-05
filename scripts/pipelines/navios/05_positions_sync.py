"""
Vessel position sync — scrape VesselFinder's free port-call API for every
monitored vessel and write a row to `vessel_positions` placing the marker
at the centroid of either the *destination* port (if en route to a monitored
port) or the *current* port (if berthed / anchored there).

Exact lat/lon isn't available via the free VF API; the vessel's live
position lives behind an authenticated WebSocket. But the port-call API
gives us everything we actually need for import-arrival tracking:

  /api/pub/vi2/{mmsi}     → last port {name, locode, ATA/ATD ts} +
                            next destination {locode, ETA}
  /api/pub/pcext/v4/{mmsi} → chronological port-call history

So we place the vessel marker at its destination (if heading to one of
our 5 monitored ports) or at the port it's currently berthed in.
The nav_status string encodes the human-readable state for the tooltip.

Also opens a `port_arrivals` row the moment a vessel appears as ATA at
one of our polygons, and closes it when VF reports the ATD.

Runs every 6 h via `.github/workflows/vessel_position_sync.yml`, right
after `vessel_lookup.yml` finishes resolving new IMOs/MMSIs.
"""

from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timezone
from typing import Any

import requests
from dotenv import load_dotenv
from supabase import create_client


load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
if not (SUPABASE_URL and SUPABASE_KEY):
    print("[erro] faltam env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY", file=sys.stderr)
    sys.exit(1)

REQUEST_DELAY_S = float(os.environ.get("VF_POS_DELAY", "1.5"))
REQUEST_TIMEOUT_S = 15

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/127.0.0.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.vesselfinder.com/",
}

# UN/LOCODE (normalised, spaces/berth stripped) → port_polygons.slug.
# VF returns codes in multiple shapes: "BRITQ001" (berth), "BR IQI" (spaced),
# "BRITQ>BRPNG" (next-next), "BRTUB>BRSSZ" (route segments), or even plain
# text names like "PARANAGUABRAZIL". We normalise hard: uppercase, strip
# everything non-alphanumeric, then match by prefix.
LOCODE_TO_SLUG = {
    "BRSSZ": "santos",
    "BRSTS": "santos",
    "BRITQ": "itaqui",
    "BRIQI": "itaqui",          # São Luís / Itaqui alternate
    "BRSLZ": "itaqui",          # São Luís do Maranhão alternate
    "BRPNG": "paranagua",
    "BRSSB": "sao_sebastiao",
    "BRSSO": "sao_sebastiao",   # VF uses BRSSO most often for SP São Sebastião
    "BRSUA": "suape",
}

# Free-text name → slug (fallback when VF gives a name rather than a LOCODE)
NAME_TO_SLUG = {
    "SANTOS": "santos",
    "ITAQUI": "itaqui",
    "SAOLUIS": "itaqui",
    "PARANAGUA": "paranagua",
    "PARANAGUABRAZIL": "paranagua",
    "SAOSEBASTIAO": "sao_sebastiao",
    "SUAPE": "suape",
}


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _ts_to_iso(unix_ts: Any) -> str | None:
    if not unix_ts:
        return None
    try:
        return datetime.fromtimestamp(int(unix_ts), tz=timezone.utc).isoformat()
    except Exception:
        return None


import re


def _normalise(s: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def _match_slug(raw: str | None, is_name: bool = False) -> str | None:
    """
    VF returns port identifiers in wildly different shapes. Normalise, then:
    1. If `raw` contains '>', try each segment (route like BRTUB>BRSSZ).
    2. For each segment, test LOCODE prefix (first 5 chars) OR free-text name.
    Returns the first monitored slug we can pin down, else None.
    """
    if not raw:
        return None
    segments = [seg for seg in re.split(r"[>,;/]", raw) if seg]
    for seg in segments:
        norm = _normalise(seg)
        if not norm:
            continue
        # 5-char LOCODE prefix
        if norm[:5] in LOCODE_TO_SLUG:
            return LOCODE_TO_SLUG[norm[:5]]
        # 4-char (e.g. "BRIQI" stripped to "BRIQ") — only as last resort
        if norm[:4] + "Q" in LOCODE_TO_SLUG:
            return LOCODE_TO_SLUG[norm[:4] + "Q"]
        # name lookup (covers "PARANAGUABRAZIL", "SANTOS", "SUAPE Anch.")
        for name_key, slug in NAME_TO_SLUG.items():
            if name_key in norm:
                return slug
    return None


def _polygon_centroid(geo: dict) -> tuple[float, float]:
    ring = geo["coordinates"][0]
    lons = [c[0] for c in ring]
    lats = [c[1] for c in ring]
    return sum(lats) / len(lats), sum(lons) / len(lons)


def fetch_vi2(mmsi: str) -> dict | None:
    try:
        r = requests.get(
            f"https://www.vesselfinder.com/api/pub/vi2/{mmsi}",
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT_S,
        )
        if r.status_code != 200:
            return None
        txt = r.text.strip()
        if not txt or txt.startswith("<"):
            return None
        return r.json()
    except Exception as e:
        print(f"[pos] vi2 {mmsi}: {e}", file=sys.stderr)
        return None


def classify(vi2: dict) -> tuple[str | None, str | None, str | None, dict]:
    """
    Returns (slug_to_place_at, nav_status, state, extras).

    state:
      - "in_port"   vessel is currently berthed/anchored at a monitored port
      - "en_route"  vessel has departed its last port, heading to a monitored one
      - None        neither last nor next port is in our 5 monitored set
    """
    rpd_name = vi2.get("rpdna") or ""
    rpd_tt = (vi2.get("rpdtt") or "").upper()
    rpd_ts = vi2.get("rpdatd")
    rpd_slug = _match_slug(vi2.get("rpdid")) or _match_slug(rpd_name, is_name=True)

    npe_slug = _match_slug(vi2.get("npde"))
    npe_ts = vi2.get("npe")

    # Currently in a monitored port: last call is ATA
    if rpd_tt == "ATA" and rpd_slug:
        return (
            rpd_slug,
            f"At {rpd_name or rpd_slug} since {_fmt_ts(rpd_ts)}",
            "in_port",
            {"port_name": rpd_name, "since_ts": _ts_to_iso(rpd_ts)},
        )

    # En route to a monitored port
    if npe_slug:
        note = f"En route to {npe_slug} (ETA {_fmt_ts(npe_ts)})"
        if rpd_tt == "ATD" and rpd_ts:
            note += f" — departed {rpd_name or '—'} {_fmt_ts(rpd_ts)}"
        return (
            npe_slug,
            note,
            "en_route",
            {"destination_eta": _ts_to_iso(npe_ts), "last_port": rpd_name},
        )

    return (None, None, None, {})


def _fmt_ts(unix_ts: Any) -> str:
    if not unix_ts:
        return "—"
    try:
        return datetime.fromtimestamp(int(unix_ts), tz=timezone.utc).strftime("%b %d %H:%M UTC")
    except Exception:
        return "—"


def _load_port_centroids(sb) -> dict[str, tuple[float, float]]:
    resp = sb.table("port_polygons").select("slug, polygon").execute()
    centroids: dict[str, tuple[float, float]] = {}
    for row in resp.data or []:
        try:
            centroids[row["slug"]] = _polygon_centroid(row["polygon"])
        except Exception:
            continue
    return centroids


PORTO_TO_SLUG = {
    "Porto de Santos": "santos",
    "Porto de Itaqui": "itaqui",
    "Porto de Paranaguá": "paranagua",
    "Porto de São Sebastião": "sao_sebastiao",
    "Porto de Suape": "suape",
}


def _load_monitored(sb) -> list[dict]:
    """Unique (mmsi, imo, navio, table_slug) of non-finished monitored vessels."""
    resp = (
        sb.table("navios_diesel")
        .select("mmsi, imo, navio, porto, status")
        .not_.is_("mmsi", None)
        .neq("status", "Despachado")
        .neq("status", "ERRO_COLETA")
        .order("collected_at", desc=True)
        .execute()
    )
    seen: set[str] = set()
    out = []
    for row in resp.data or []:
        mmsi = (row.get("mmsi") or "").strip()
        if not mmsi or not mmsi.isdigit() or mmsi in seen:
            continue
        seen.add(mmsi)
        out.append({
            "mmsi": mmsi,
            "imo": row.get("imo"),
            "navio": row.get("navio") or "",
            "table_slug": PORTO_TO_SLUG.get(row.get("porto") or ""),
            "table_status": row.get("status"),
        })
    return out


def main() -> None:
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    centroids = _load_port_centroids(sb)
    if not centroids:
        print("[pos] erro: port_polygons vazio — aplique as migrations antes", file=sys.stderr)
        sys.exit(1)
    print(f"[pos] centróides carregados: {list(centroids.keys())}")

    monitored = _load_monitored(sb)
    print(f"[pos] {len(monitored)} MMSI(s) monitorado(s)")

    now_iso = _now_iso()
    position_rows: list[dict] = []
    arrivals_open: list[dict] = []
    stats = {"in_port": 0, "en_route": 0, "skipped": 0, "no_data": 0}

    stats["fallback_table"] = 0
    for i, v in enumerate(monitored, 1):
        mmsi = v["mmsi"]
        imo = v["imo"]
        nav = v["navio"]
        table_slug = v["table_slug"]
        table_status = v["table_status"]

        vi2 = fetch_vi2(mmsi)
        slug: str | None = None
        nav_status: str | None = None
        state: str | None = None
        extras: dict = {}

        if vi2:
            slug, nav_status, state, extras = classify(vi2)

        # Fallback: if VF can't pin the vessel to a monitored port but the
        # Expected Vessels table says it's at one of our 5 ports, place it
        # there with a "per line-up" note so the user still sees the marker.
        if not slug and table_slug:
            slug = table_slug
            state = "table_fallback"
            last = (vi2 or {}).get("rpdna") or "—"
            dest = (vi2 or {}).get("npde") or "—"
            nav_status = (
                f"Per line-up: {table_status} at {slug}"
                + (f" — AIS last port {last}" if last and last != "—" else "")
                + (f", next dest {dest}" if dest and dest != "—" else "")
            )
            extras = {}

        if not slug or not state:
            stats["no_data" if not vi2 else "skipped"] += 1
            print(f"[pos] {i}/{len(monitored)} {nav} → skip (no VF + no table port)")
            time.sleep(REQUEST_DELAY_S)
            continue

        stats[state] = stats.get(state, 0) + 1
        lat, lon = centroids[slug]
        position_rows.append({
            "mmsi": mmsi,
            "imo": imo,
            "ts": now_iso,
            "lat": lat,
            "lon": lon,
            "nav_status": nav_status,
            "inside_port": slug if state == "in_port" else None,
        })

        if state == "in_port":
            arrivals_open.append({
                "mmsi": mmsi,
                "imo": imo,
                "vessel_name": nav,
                "port_slug": slug,
                "entered_at": extras.get("since_ts") or now_iso,
            })

        print(f"[pos] {i}/{len(monitored)} {nav} → {state}: {nav_status}")
        time.sleep(REQUEST_DELAY_S)

    # Insert fresh positions (one row per vessel per run)
    if position_rows:
        for i in range(0, len(position_rows), 500):
            sb.table("vessel_positions").insert(position_rows[i:i + 500]).execute()
        print(f"[pos] {len(position_rows)} position(s) inserted")

    # Open port_arrivals for any "in_port" that isn't already tracked
    opened = 0
    for a in arrivals_open:
        if not a.get("imo"):
            continue  # unique index on (imo, port_slug) where exited_at IS NULL
        existing = (
            sb.table("port_arrivals")
            .select("id")
            .eq("imo", a["imo"])
            .eq("port_slug", a["port_slug"])
            .is_("exited_at", None)
            .limit(1)
            .execute()
        )
        if existing.data:
            continue
        sb.table("port_arrivals").insert(a).execute()
        opened += 1

    # Close port_arrivals for vessels that left (VF reports ATD for the port)
    closed = 0
    open_rows = (
        sb.table("port_arrivals")
        .select("id, imo, mmsi, port_slug")
        .is_("exited_at", None)
        .execute()
    ).data or []

    for row in open_rows:
        still_here = any(
            a["mmsi"] == row["mmsi"] and a["port_slug"] == row["port_slug"]
            for a in arrivals_open
        )
        if still_here:
            continue
        # Vessel is no longer reporting ATA at this port → close arrival
        sb.table("port_arrivals").update({"exited_at": now_iso}).eq("id", row["id"]).execute()
        closed += 1

    print(
        f"[pos] stats: in_port={stats.get('in_port', 0)} "
        f"en_route={stats.get('en_route', 0)} "
        f"table_fallback={stats.get('table_fallback', 0)} "
        f"skipped={stats.get('skipped', 0)} "
        f"no_data={stats.get('no_data', 0)} | "
        f"arrivals opened={opened} closed={closed}"
    )


if __name__ == "__main__":
    main()
