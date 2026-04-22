"""
AIS position sync — listens to AISStream.io over WebSocket for a short window,
updates the vessel registry, inserts new positions, and detects when monitored
vessels cross into port polygons.

Runs every 6 h via `.github/workflows/ais_sync.yml` and can also be invoked
locally:  `python ais_sync.py`
"""

import asyncio
import json
import os
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from shapely.geometry import Point, shape
from supabase import create_client

try:
    import websockets
except ImportError:
    print("[erro] dependência faltando: pip install websockets", file=sys.stderr)
    sys.exit(1)


# ─── Config ──────────────────────────────────────────────────────────────────
load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
AISSTREAM_KEY = os.environ.get("AISSTREAM_API_KEY")

if not (SUPABASE_URL and SUPABASE_KEY and AISSTREAM_KEY):
    print("[erro] faltam env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, AISSTREAM_API_KEY", file=sys.stderr)
    sys.exit(1)

# Janela de escuta no WebSocket por execução (segundos).
# Com `FiltersShipMMSI` ativo o stream vem pré-filtrado, então 60s é suficiente.
# Sem filtro (primeira run antes do vessel_lookup), precisamos de janela maior.
LISTEN_SECONDS_FILTERED = int(os.environ.get("AIS_LISTEN_SECONDS_FILTERED", "60"))
LISTEN_SECONDS_FALLBACK = int(os.environ.get("AIS_LISTEN_SECONDS_FALLBACK", "150"))

# Bounding boxes cobrindo a costa brasileira onde os 5 portos monitorados estão.
# AISStream.io espera pares [[lat_min, lon_min], [lat_max, lon_max]].
BOUNDING_BOXES = [
    # Costa Norte/Nordeste (Itaqui ~-2.5, Suape ~-8.4)
    [[-10.0, -45.0], [0.0, -34.0]],
    # Costa Sudeste/Sul (São Sebastião ~-23.8, Santos ~-23.95, Paranaguá ~-25.5)
    [[-26.5, -49.0], [-22.5, -44.0]],
]

AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"

# Considera um arrival "fechado" se a última posição fora do polígono foi há
# mais de X horas.
ARRIVAL_EXIT_HOURS = 2


# ─── Helpers ─────────────────────────────────────────────────────────────────
def _norm_name(name: str) -> str:
    import re
    return re.sub(r"[^A-Za-z0-9]", "", (name or "").upper())


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _parse_ais_time(value: str | None) -> str:
    """
    AISStream sends `time_utc` in Go's default time.Time format, e.g.
    '2026-04-22 14:00:04.905714085 +0000 UTC', which Postgres rejects.
    Convert to ISO 8601 with microsecond precision and UTC offset.
    """
    if not value:
        return _now_iso()
    try:
        # strip trailing " UTC" and truncate ns → µs (Python caps at 6 digits)
        cleaned = value.replace(" UTC", "").strip()
        # split off timezone offset (last token)
        parts = cleaned.rsplit(" ", 1)
        dt_part = parts[0]
        tz_part = parts[1] if len(parts) > 1 else "+0000"
        # truncate sub-second to 6 digits
        if "." in dt_part:
            date_time, frac = dt_part.split(".", 1)
            frac = frac[:6].ljust(6, "0")
            dt_part = f"{date_time}.{frac}"
        iso_like = f"{dt_part}{tz_part[:3]}:{tz_part[3:]}"  # +0000 → +00:00
        return datetime.fromisoformat(iso_like).astimezone(timezone.utc).isoformat()
    except Exception:
        return _now_iso()


def _load_monitored_mmsis(sb) -> list[str]:
    """
    Returns the list of MMSIs from navios_diesel rows that are still active in
    the current line-up (not despachado / erro). Used to subscribe to
    AISStream with a server-side filter.
    """
    resp = (
        sb.table("navios_diesel")
        .select("mmsi")
        .not_.is_("mmsi", None)
        .neq("status", "Despachado")
        .neq("status", "ERRO_COLETA")
        .execute()
    )
    mmsis: set[str] = set()
    for row in resp.data or []:
        m = (row.get("mmsi") or "").strip()
        if m and m.isdigit():
            mmsis.add(m)
    return sorted(mmsis)


def _load_polygons(sb) -> list[dict]:
    resp = sb.table("port_polygons").select("slug, name, polygon").execute()
    polys = []
    for row in resp.data or []:
        polys.append({
            "slug": row["slug"],
            "name": row["name"],
            "shape": shape(row["polygon"]),
        })
    return polys


def _point_in_any(lat: float, lon: float, polys: list[dict]) -> str | None:
    pt = Point(lon, lat)
    for p in polys:
        if p["shape"].contains(pt):
            return p["slug"]
    return None


# ─── AIS listener ────────────────────────────────────────────────────────────
async def _listen(polys: list[dict], mmsi_filter: list[str]) -> tuple[dict, dict]:
    """
    Returns (positions_by_mmsi, statics_by_mmsi).

    positions_by_mmsi[mmsi] = {ts, lat, lon, sog, cog, nav_status, inside_port}
    statics_by_mmsi[mmsi]   = {imo, name, ship_type}

    If `mmsi_filter` is non-empty, AISStream delivers only those vessels and
    the listen window is short. Otherwise fall back to the full-bbox listen.
    """
    positions: dict[str, dict] = {}
    statics: dict[str, dict] = {}

    sub: dict = {
        "APIKey": AISSTREAM_KEY,
        "BoundingBoxes": BOUNDING_BOXES,
        "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
    }
    if mmsi_filter:
        sub["FiltersShipMMSI"] = mmsi_filter
        listen_seconds = LISTEN_SECONDS_FILTERED
        print(f"[ais] conectando em {AISSTREAM_URL} com filtro de {len(mmsi_filter)} MMSI(s), {listen_seconds}s")
    else:
        listen_seconds = LISTEN_SECONDS_FALLBACK
        print(f"[ais] conectando em {AISSTREAM_URL} sem filtro MMSI (bbox-only), {listen_seconds}s")

    async with websockets.connect(AISSTREAM_URL, ping_interval=30) as ws:
        await ws.send(json.dumps(sub))

        msg_count = 0
        deadline = asyncio.get_event_loop().time() + listen_seconds

        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                break
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
            except asyncio.TimeoutError:
                break

            msg_count += 1
            try:
                msg = json.loads(raw)
            except Exception:
                continue

            mtype = msg.get("MessageType")
            meta = msg.get("MetaData") or {}
            mmsi = str(meta.get("MMSI") or "").strip()
            if not mmsi:
                continue

            if mtype == "PositionReport":
                pr = (msg.get("Message") or {}).get("PositionReport") or {}
                lat = pr.get("Latitude")
                lon = pr.get("Longitude")
                if lat is None or lon is None:
                    continue
                ts = _parse_ais_time(meta.get("time_utc"))
                positions[mmsi] = {
                    "ts": ts,
                    "lat": float(lat),
                    "lon": float(lon),
                    "sog": pr.get("Sog"),
                    "cog": pr.get("Cog"),
                    "nav_status": pr.get("NavigationalStatus"),
                    "inside_port": _point_in_any(float(lat), float(lon), polys),
                    "name_from_meta": (meta.get("ShipName") or "").strip() or None,
                }

            elif mtype == "ShipStaticData":
                sd = (msg.get("Message") or {}).get("ShipStaticData") or {}
                imo = sd.get("ImoNumber")
                name = (sd.get("Name") or meta.get("ShipName") or "").strip()
                if not name:
                    continue
                statics[mmsi] = {
                    "imo": str(imo) if imo else None,
                    "name": name,
                    "ship_type": sd.get("Type"),
                }

        print(f"[ais] {msg_count} msgs recebidas | {len(positions)} posições únicas | {len(statics)} statics únicos")

    return positions, statics


# ─── Persistence ─────────────────────────────────────────────────────────────
def _persist_registry(sb, positions: dict, statics: dict) -> int:
    """Upsert vessel_registry from (IMO ↔ MMSI ↔ name) observations."""
    now = _now_iso()
    rows = []
    seen_imos = set()

    for mmsi, s in statics.items():
        if not s.get("imo"):
            continue
        if s["imo"] in seen_imos:
            continue
        seen_imos.add(s["imo"])
        rows.append({
            "imo": s["imo"],
            "mmsi": mmsi,
            "name": s["name"],
            "ship_type": str(s["ship_type"]) if s.get("ship_type") is not None else None,
            "last_seen_at": now,
        })

    if not rows:
        return 0

    # upsert in batches
    written = 0
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        sb.table("vessel_registry").upsert(chunk, on_conflict="imo").execute()
        written += len(chunk)
    return written


def _persist_positions(sb, positions: dict, statics: dict) -> int:
    """Insert one vessel_positions row per MMSI observed."""
    if not positions:
        return 0

    rows = []
    for mmsi, p in positions.items():
        imo = (statics.get(mmsi) or {}).get("imo")
        rows.append({
            "imo": imo,
            "mmsi": mmsi,
            "ts": p["ts"],
            "lat": p["lat"],
            "lon": p["lon"],
            "sog": p["sog"],
            "cog": p["cog"],
            "nav_status": str(p["nav_status"]) if p["nav_status"] is not None else None,
            "inside_port": p["inside_port"],
        })

    written = 0
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        sb.table("vessel_positions").insert(chunk).execute()
        written += len(chunk)
    return written


def _reconcile_navios_imo(sb, statics: dict) -> int:
    """For navios_diesel rows missing IMO, fill it by matching normalised name."""
    if not statics:
        return 0

    # Build name_norm → (imo, mmsi) map from observed statics
    by_name_norm: dict[str, tuple[str, str]] = {}
    for mmsi, s in statics.items():
        if not s.get("imo"):
            continue
        nn = _norm_name(s["name"])
        if nn and nn not in by_name_norm:
            by_name_norm[nn] = (s["imo"], mmsi)

    if not by_name_norm:
        return 0

    # Fetch navios with no IMO yet (limit to recent rows to keep this cheap)
    resp = (
        sb.table("navios_diesel")
        .select("id, navio")
        .is_("imo", "null")
        .order("collected_at", desc=True)
        .limit(2000)
        .execute()
    )
    rows = resp.data or []

    updates = 0
    for row in rows:
        match = by_name_norm.get(_norm_name(row["navio"]))
        if not match:
            continue
        imo, mmsi = match
        sb.table("navios_diesel").update({"imo": imo, "mmsi": mmsi}).eq("id", row["id"]).execute()
        updates += 1
    return updates


def _detect_arrivals(sb, positions: dict, statics: dict) -> tuple[int, int]:
    """
    Open new port_arrivals when a vessel's latest position is inside a polygon
    and no open arrival exists for (imo, port_slug). Close stale arrivals where
    the latest position is outside the polygon.
    """
    opened = 0
    closed = 0

    # Positions currently inside a port
    for mmsi, p in positions.items():
        if not p.get("inside_port"):
            continue
        imo = (statics.get(mmsi) or {}).get("imo")
        if not imo:
            # arrivals are keyed by IMO — skip if we have no IMO
            continue

        existing = (
            sb.table("port_arrivals")
            .select("id")
            .eq("imo", imo)
            .eq("port_slug", p["inside_port"])
            .is_("exited_at", "null")
            .limit(1)
            .execute()
        )
        if existing.data:
            continue

        vessel_name = (statics.get(mmsi) or {}).get("name") or p.get("name_from_meta")
        sb.table("port_arrivals").insert({
            "imo": imo,
            "mmsi": mmsi,
            "vessel_name": vessel_name,
            "port_slug": p["inside_port"],
            "entered_at": p["ts"],
        }).execute()
        opened += 1

    # Close arrivals whose latest observed position has left the polygon for long enough
    open_rows = (
        sb.table("port_arrivals")
        .select("id, imo, port_slug")
        .is_("exited_at", "null")
        .execute()
    ).data or []

    for a in open_rows:
        last_pos = (
            sb.table("vessel_positions")
            .select("ts, inside_port")
            .eq("imo", a["imo"])
            .order("ts", desc=True)
            .limit(1)
            .execute()
        ).data
        if not last_pos:
            continue
        last = last_pos[0]
        if last["inside_port"] == a["port_slug"]:
            continue
        # Outside the polygon — count hours since that observation
        ts = datetime.fromisoformat(last["ts"].replace("Z", "+00:00"))
        hours_since = (datetime.now(tz=timezone.utc) - ts).total_seconds() / 3600.0
        if hours_since >= ARRIVAL_EXIT_HOURS:
            sb.table("port_arrivals").update({"exited_at": last["ts"]}).eq("id", a["id"]).execute()
            closed += 1

    return opened, closed


# ─── Entry point ─────────────────────────────────────────────────────────────
async def _run():
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    polys = _load_polygons(sb)
    print(f"[ais] {len(polys)} polígono(s) carregado(s): {[p['slug'] for p in polys]}")

    monitored_mmsis = _load_monitored_mmsis(sb)
    print(f"[ais] {len(monitored_mmsis)} MMSI(s) monitorado(s) conhecido(s)")

    positions, statics = await _listen(polys, monitored_mmsis)

    n_reg = _persist_registry(sb, positions, statics)
    n_pos = _persist_positions(sb, positions, statics)
    n_rec = _reconcile_navios_imo(sb, statics)
    opened, closed = _detect_arrivals(sb, positions, statics)

    print(
        f"[ais] registry={n_reg} | positions={n_pos} | "
        f"navios_resolved={n_rec} | arrivals opened={opened} closed={closed}"
    )


if __name__ == "__main__":
    try:
        asyncio.run(_run())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
