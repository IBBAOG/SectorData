"""
AIS Discovery — early-warning radar for diesel imports.

Subscribes to AISStream globally for *ShipStaticData* messages only
(broadcast every ~6 minutes by Class-A vessels) and filters for any
whose `Destination` field points at one of the 5 monitored Brazilian
ports. Enriches each hit with VesselFinder port-call data, scores the
likelihood it's a diesel import based on:

  1. ship_type ∈ tanker (AIS 80-89, VF "Oil/Chemical Products Tanker")
  2. size compatible with products (< 200m, < 60k DWT rules out crude)
  3. last port is a known refined-products export hub
  4. current draught > 70% of max (loaded vs ballast)
  5. destination LOCODE maps to a monitored port

Writes results to `import_candidates` (one row per IMO, upserted).
Candidate rows automatically transition to 'in_lineup' status via a
DB trigger when they appear in the port-scraped navios_diesel table.

Runs on GitHub Actions 3× daily. A single run listens 10 minutes to
capture the 6-minute ShipStaticData broadcast cycle for every tanker
active in the window.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
import traceback
from datetime import datetime, timezone
from typing import Any

import requests
from dotenv import load_dotenv
from supabase import create_client

try:
    import websockets
except ImportError:
    print("[erro] dependência faltando: pip install websockets", file=sys.stderr)
    sys.exit(1)


# ─── Config ─────────────────────────────────────────────────────────────────
load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
AISSTREAM_KEY = os.environ.get("AISSTREAM_API_KEY")

if not (SUPABASE_URL and SUPABASE_KEY and AISSTREAM_KEY):
    print("[erro] faltam env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, AISSTREAM_API_KEY", file=sys.stderr)
    sys.exit(1)

AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"
LISTEN_SECONDS = int(os.environ.get("AIS_DISCOVERY_SECONDS", "600"))  # 10 min
VF_DELAY_S = float(os.environ.get("VF_DELAY", "1.5"))
VF_TIMEOUT_S = 15

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
)
VF_HEADERS = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.vesselfinder.com/",
}

# ─── Destination matchers for monitored BR ports ────────────────────────────
LOCODE_TO_SLUG = {
    "BRSSZ": "santos",       "BRSTS": "santos",
    "BRITQ": "itaqui",       "BRIQI": "itaqui",  "BRSLZ": "itaqui",
    "BRPNG": "paranagua",
    "BRSSB": "sao_sebastiao", "BRSSO": "sao_sebastiao",
    "BRSUA": "suape",
}
NAME_TO_SLUG = {
    "SANTOS": "santos",
    "ITAQUI": "itaqui",
    "SAOLUIS": "itaqui",
    "PARANAGUA": "paranagua",
    "SAOSEBASTIAO": "sao_sebastiao",
    "SUAPE": "suape",
}
# Regex for fast pre-filter of the raw Destination field
BR_MATCH_RE = re.compile(
    r"(?i)\b(BR[A-Z]{3}|SANTOS|ITAQUI|SUAPE|PARANAGUA|S[AÃ]O\s*SEBASTI[AÃ]O|S[AÃ]O\s*LU[IÍ]S)"
)

# ─── Refined-product export hubs (by UN/LOCODE prefix) ──────────────────────
PRODUCT_HUB_LOCODES: set[str] = {
    # ARA (Rotterdam, Antwerp, Amsterdam, Vlissingen/Terneuzen)
    "NLRTM", "BEANR", "NLAMS", "NLTNZ", "NLVLI",
    # US Gulf — the largest refined-product export cluster
    "USHOU", "USCRP", "USLCH", "USMSY", "USPAT", "USBPT", "USTXB",
    "USLAK", "USNOL", "USPAS",
    # India — Sikka/Jamnagar (Reliance), JNPT
    "INSIK", "INJNV", "INJAM", "INMUN", "INIXY",
    # Middle East — Fujairah, Ras Tanura, Sitra, Mesaieed, Mina Al-Ahmadi
    "AEFJR", "SARTA", "SARUH", "SAYNB", "KWMIB", "QAMES", "BHSIT",
    # Asia — Singapore, Ulsan, Yeosu, Port Klang, Jurong
    "SGSIN", "SGJUR", "KRUSN", "KRYSU", "KRTUS", "MYPKG",
    # Africa — Algeria
    "DZALG", "DZSKI", "DZARZ", "DZBJA",
    # Europe — Spain, Portugal, Med
    "ESBCN", "ESTAR", "ESBIO", "ESVLC", "ESALG",
    "PTSIN", "PTLIS",
    "GIGIB", "GBIMM", "GBMIL",
    "FRLFO", "FRMRS", "ITAUG", "ITSIR",
}

# Product-tanker ship-type strings (from VF), lowercased substrings
TANKER_PRODUCT_PATTERNS = (
    "products tanker",
    "chemical/oil",
    "oil/chemical",
    "oil products",
    "chemical tanker",
)

# Non-oil tankers that must be excluded even though their type contains "tanker"
NON_OIL_TANKER_SUBSTRINGS = (
    "lpg", "lng", "gas", "asphalt", "bitumen", "water",
)


def is_oil_tanker(ship_type: str | None, ship_type_code: int | None) -> bool:
    """True if this vessel is a liquid-petroleum-capable tanker.

    The Radar tracks DIESEL imports, so general-cargo, container, bulk-carrier
    and gas/water carriers are pure noise. Rule:
      - VF `ship_type` contains "tanker" and none of the non-oil substrings
      - OR, if VF type is missing, AIS code 80-89 (the tanker bucket)
    """
    if ship_type:
        t = ship_type.lower()
        if "tanker" not in t:
            return False
        return not any(bad in t for bad in NON_OIL_TANKER_SUBSTRINGS)
    return _is_tanker_ship_type(ship_type_code)


# ─── Helpers ────────────────────────────────────────────────────────────────
def _norm(s: str | None) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", (s or "")).upper()


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _ts_to_iso(unix_ts: Any) -> str | None:
    if not unix_ts:
        return None
    try:
        return datetime.fromtimestamp(int(unix_ts), tz=timezone.utc).isoformat()
    except Exception:
        return None


def _match_br_slug(raw: str | None) -> tuple[str | None, str | None]:
    """Given an AIS destination string, return (port_slug, port_name)."""
    if not raw:
        return None, None
    for seg in re.split(r"[>,;/\\|]", raw):
        norm = _norm(seg)
        if not norm:
            continue
        if norm[:5] in LOCODE_TO_SLUG:
            slug = LOCODE_TO_SLUG[norm[:5]]
            return slug, slug.replace("_", " ").title()
        for name_key, slug in NAME_TO_SLUG.items():
            if name_key in norm:
                return slug, name_key.title()
    return None, None


def _is_tanker_ship_type(code: int | None) -> bool:
    return code is not None and 80 <= code <= 89


# ─── AISStream listener ─────────────────────────────────────────────────────
async def listen_for_br_candidates() -> tuple[dict[str, dict], dict]:
    """
    Returns (hits, stats) where:
      hits  — {mmsi: {imo, name, ship_type_code, dest_raw, eta, draught, ...}}
      stats — {msgs_total, br_matches, unique_imos, listen_seconds}
    for vessels whose Destination mentions a Brazilian port during the window.
    """
    hits: dict[str, dict] = {}
    msgs = 0
    br_matches = 0

    sub = {
        "APIKey": AISSTREAM_KEY,
        "BoundingBoxes": [[[-90.0, -180.0], [90.0, 180.0]]],
        "FilterMessageTypes": ["ShipStaticData"],
    }

    print(f"[disc] conectando AISStream global, listen {LISTEN_SECONDS}s (ShipStaticData only)")

    async with websockets.connect(AISSTREAM_URL, ping_interval=30) as ws:
        await ws.send(json.dumps(sub))
        deadline = asyncio.get_event_loop().time() + LISTEN_SECONDS

        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                break
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
            except asyncio.TimeoutError:
                break

            msgs += 1
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            if msg.get("MessageType") != "ShipStaticData":
                continue

            meta = msg.get("MetaData") or {}
            mmsi = str(meta.get("MMSI") or "").strip()
            if not mmsi:
                continue

            sd = (msg.get("Message") or {}).get("ShipStaticData") or {}
            dest = (sd.get("Destination") or "").strip()
            if not dest or not BR_MATCH_RE.search(dest):
                continue

            slug, port_name = _match_br_slug(dest)
            if not slug:
                continue

            br_matches += 1
            imo_raw = sd.get("ImoNumber")
            imo = str(imo_raw) if imo_raw and str(imo_raw).isdigit() and len(str(imo_raw)) == 7 else None
            name = (sd.get("Name") or meta.get("ShipName") or "").strip()
            ship_type_code = sd.get("Type")
            dim = sd.get("Dimension") or {}
            length_m = None
            if isinstance(dim, dict):
                a = dim.get("A") or 0
                b = dim.get("B") or 0
                if a or b:
                    length_m = (a or 0) + (b or 0)

            eta_dict = sd.get("Eta") or {}
            eta_iso = _eta_dict_to_iso(eta_dict)

            # AISStream includes lat/lon in MetaData for every message type
            try:
                last_lat = float(meta["latitude"]) if meta.get("latitude") is not None else None
                last_lon = float(meta["longitude"]) if meta.get("longitude") is not None else None
            except (TypeError, ValueError):
                last_lat = last_lon = None
            last_seen_ts = _parse_meta_time(meta.get("time_utc"))

            hits[mmsi] = {
                "mmsi": mmsi,
                "imo": imo,
                "navio": name,
                "ship_type_code": ship_type_code,
                "length_m": length_m,
                "destination_raw": dest,
                "destination_slug": slug,
                "destination_port_name": port_name,
                "eta": eta_iso,
                "current_draught_m": _parse_draught(sd.get("MaximumStaticDraught") or sd.get("Draught")),
                "last_seen_lat": last_lat,
                "last_seen_lon": last_lon,
                "last_seen_ts": last_seen_ts,
            }

        print(f"[disc] {msgs} ShipStaticData msgs | {br_matches} com destino BR | {len(hits)} IMOs únicos")

    stats = {
        "msgs_total": msgs,
        "br_matches": br_matches,
        "unique_imos": len(hits),
        "listen_seconds": LISTEN_SECONDS,
    }
    return hits, stats


def _eta_dict_to_iso(eta: dict) -> str | None:
    """AIS ETA is {Month, Day, Hour, Minute}; year is implied (current/next)."""
    if not eta:
        return None
    try:
        m = int(eta.get("Month") or 0)
        d = int(eta.get("Day") or 0)
        h = int(eta.get("Hour") or 0)
        mi = int(eta.get("Minute") or 0)
        if not (1 <= m <= 12 and 1 <= d <= 31):
            return None
        now = datetime.now(tz=timezone.utc)
        year = now.year
        # If ETA month is in the past, assume next year
        if m < now.month or (m == now.month and d < now.day - 2):
            year += 1
        return datetime(year, m, d, min(h, 23), min(mi, 59), tzinfo=timezone.utc).isoformat()
    except Exception:
        return None


def _parse_draught(raw: Any) -> float | None:
    try:
        v = float(raw)
        return v if 0 < v < 25 else None
    except (TypeError, ValueError):
        return None


def _parse_meta_time(value: str | None) -> str | None:
    """AISStream sends `time_utc` in Go format; reuse ais_sync's parser logic."""
    if not value:
        return None
    try:
        cleaned = value.replace(" UTC", "").strip()
        parts = cleaned.rsplit(" ", 1)
        dt_part = parts[0]
        tz_part = parts[1] if len(parts) > 1 else "+0000"
        if "." in dt_part:
            date_time, frac = dt_part.split(".", 1)
            frac = frac[:6].ljust(6, "0")
            dt_part = f"{date_time}.{frac}"
        iso_like = f"{dt_part}{tz_part[:3]}:{tz_part[3:]}"
        return datetime.fromisoformat(iso_like).astimezone(timezone.utc).isoformat()
    except Exception:
        return None


# ─── VesselFinder enrichment ────────────────────────────────────────────────
def fetch_vi2(mmsi: str) -> dict | None:
    try:
        r = requests.get(
            f"https://www.vesselfinder.com/api/pub/vi2/{mmsi}",
            headers=VF_HEADERS,
            timeout=VF_TIMEOUT_S,
        )
        if r.status_code != 200:
            return None
        txt = r.text.strip()
        if not txt or txt.startswith("<"):
            return None
        return r.json()
    except Exception:
        return None


def fetch_click(mmsi: str) -> dict | None:
    """Click endpoint — returns ship_type, flag, DWT, max draught, name."""
    try:
        r = requests.get(
            f"https://www.vesselfinder.com/api/pub/click/{mmsi}",
            headers=VF_HEADERS,
            timeout=VF_TIMEOUT_S,
        )
        if r.status_code != 200:
            return None
        txt = r.text.strip()
        if not txt or txt.startswith("<") or txt.startswith("Error"):
            return None
        return r.json()
    except Exception:
        return None


def score_candidate(c: dict) -> tuple[int, dict]:
    """
    Composite 0-100 confidence based on 5 signals. Each signal ~20 pts.
    Returns (score, signals dict).
    """
    signals: dict[str, bool] = {}

    # 1. Destination maps to monitored BR port (already filtered, always true here)
    signals["destination_br_port"] = bool(c.get("destination_slug"))

    # 2. Ship type is a tanker (AIS or VF)
    tanker = _is_tanker_ship_type(c.get("ship_type_code"))
    st_str = (c.get("ship_type") or "").lower()
    if not tanker and any(p in st_str for p in TANKER_PRODUCT_PATTERNS):
        tanker = True
    signals["tanker"] = tanker

    # 3. Size fits a product tanker (< 200 m or DWT < 80k — rules out VLCC/Suezmax)
    length = c.get("length_m") or 0
    dwt = c.get("dwt") or 0
    size_ok = (length and length < 230) or (dwt and dwt < 90000)
    signals["size_product_range"] = bool(size_ok)

    # 4. Origin is a known refined-product export hub
    origin_hub = bool(c.get("origin_is_product_hub"))
    signals["origin_product_hub"] = origin_hub

    # 5. Loaded (current draught > 70% max)
    cur = c.get("current_draught_m") or 0
    mx  = c.get("max_draught_m") or 0
    loaded = cur > 0 and mx > 0 and (cur / mx) > 0.70
    signals["loaded"] = loaded

    score = sum(20 for v in signals.values() if v)
    return score, signals


# ─── Persistence ────────────────────────────────────────────────────────────
def upsert_candidates(sb, enriched: list[dict]) -> int:
    if not enriched:
        return 0
    payload: list[dict] = []
    now = _now_iso()
    for c in enriched:
        if not c.get("imo"):
            continue  # IMO is the unique key
        payload.append({
            "imo": c["imo"],
            "mmsi": c.get("mmsi"),
            "navio": c.get("navio") or "",
            "flag": c.get("flag"),
            "ship_type_code": c.get("ship_type_code"),
            "ship_type": c.get("ship_type"),
            "length_m": c.get("length_m"),
            "dwt": c.get("dwt"),
            "destination_raw": c.get("destination_raw"),
            "destination_slug": c.get("destination_slug"),
            "destination_port_name": c.get("destination_port_name"),
            "eta": c.get("eta"),
            "origin_port_name": c.get("origin_port_name"),
            "origin_locode": c.get("origin_locode"),
            "origin_country": c.get("origin_country"),
            "origin_is_product_hub": c.get("origin_is_product_hub"),
            "departure_ts": c.get("departure_ts"),
            "current_draught_m": c.get("current_draught_m"),
            "max_draught_m": c.get("max_draught_m"),
            "is_loaded": c.get("is_loaded"),
            "confidence_score": c.get("confidence_score"),
            "signals": c.get("signals"),
            "last_seen_lat": c.get("last_seen_lat"),
            "last_seen_lon": c.get("last_seen_lon"),
            "last_seen_ts":  c.get("last_seen_ts"),
            "last_seen_at": now,
            "status": "active",
        })
    if not payload:
        return 0

    written = 0
    for i in range(0, len(payload), 500):
        sb.table("import_candidates").upsert(payload[i:i + 500], on_conflict="imo").execute()
        written += len(payload[i:i + 500])
    return written


def insert_position_history(sb, enriched: list[dict]) -> int:
    """
    Append one row to candidate_positions per vessel observation. Unique on
    (imo, ts) so re-runs can't duplicate the same captured moment.
    """
    rows: list[dict] = []
    for c in enriched:
        if not c.get("imo"):
            continue
        lat = c.get("last_seen_lat")
        lon = c.get("last_seen_lon")
        ts  = c.get("last_seen_ts")
        if lat is None or lon is None or not ts:
            continue
        rows.append({
            "imo": c["imo"],
            "mmsi": c.get("mmsi"),
            "ts": ts,
            "lat": lat,
            "lon": lon,
            "confidence_score": c.get("confidence_score"),
            "destination_slug": c.get("destination_slug"),
        })
    if not rows:
        return 0

    written = 0
    for i in range(0, len(rows), 500):
        sb.table("candidate_positions").upsert(
            rows[i:i + 500], on_conflict="imo,ts", ignore_duplicates=True,
        ).execute()
        written += len(rows[i:i + 500])
    return written


# ─── Main ───────────────────────────────────────────────────────────────────
async def _run():
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # 1. Listen for BR-destined ShipStaticData
    hits, stats = await listen_for_br_candidates()

    cabotage_skipped = 0
    non_tanker_skipped = 0

    if not hits:
        print("[disc] nenhum candidato novo neste ciclo")
        _log_run(sb, stats, cabotage_skipped, non_tanker_skipped, 0, 0)
        return

    # 2. Enrich each hit with VesselFinder click + vi2
    enriched: list[dict] = []
    for i, (mmsi, c) in enumerate(hits.items(), 1):
        click = fetch_click(mmsi) or {}
        vi2 = fetch_vi2(mmsi) or {}
        time.sleep(VF_DELAY_S)

        # Flag, vessel type, DWT, max draught from click endpoint
        c["flag"] = click.get("country") or c.get("flag")
        c["ship_type"] = click.get("type") or c.get("ship_type")
        c["dwt"] = click.get("dw") or c.get("dwt")
        # `drm` is max design draught from VF (metres)
        try:
            c["max_draught_m"] = float(click.get("drm")) if click.get("drm") else None
        except (TypeError, ValueError):
            c["max_draught_m"] = None
        # `draught` from click is tenths of metre (e.g. 80 = 8.0 m)
        try:
            d = click.get("draught")
            if d is not None and c.get("current_draught_m") is None:
                c["current_draught_m"] = float(d) / 10.0
        except (TypeError, ValueError):
            pass

        if c.get("current_draught_m") and c.get("max_draught_m"):
            c["is_loaded"] = (c["current_draught_m"] / c["max_draught_m"]) > 0.70

        # Origin from vi2 (last port before current leg)
        origin_name = vi2.get("rpdna")
        origin_locode = (vi2.get("rpdid") or "")[:5].upper() or None
        origin_country = vi2.get("rpdco")
        departure_ts = _ts_to_iso(vi2.get("rpdatd"))
        c["origin_port_name"] = origin_name
        c["origin_locode"] = origin_locode
        c["origin_country"] = origin_country
        c["departure_ts"] = departure_ts
        c["origin_is_product_hub"] = bool(origin_locode and origin_locode in PRODUCT_HUB_LOCODES)

        # Cabotagem guard — dashboard tracks IMPORTS only. If the last port is
        # Brazilian, this vessel is doing domestic coastal shipping (e.g.
        # BOW COMPASS Rio Grande → Paranaguá). Drop it here; never insert.
        is_br_origin = (
            (origin_locode and origin_locode.upper().startswith("BR"))
            or (origin_country and origin_country.strip().upper() in ("BRAZIL", "BRASIL", "BR"))
        )
        if is_br_origin:
            cabotage_skipped += 1
            print(
                f"[disc] {i}/{len(hits)} {c.get('navio') or mmsi:30s} "
                f"→ SKIP cabotagem (origin {origin_name or origin_locode or origin_country})"
            )
            continue

        # Non-oil-tanker guard — Radar tracks diesel imports only. Skip
        # container/bulk/cargo/gas/water vessels so they never reach the UI.
        if not is_oil_tanker(c.get("ship_type"), c.get("ship_type_code")):
            non_tanker_skipped += 1
            print(
                f"[disc] {i}/{len(hits)} {c.get('navio') or mmsi:30s} "
                f"→ SKIP non-oil-tanker (type: {c.get('ship_type') or c.get('ship_type_code') or '?'})"
            )
            continue

        # Score
        score, signals = score_candidate(c)
        c["confidence_score"] = score
        c["signals"] = signals

        enriched.append(c)
        print(
            f"[disc] {i}/{len(hits)} {c.get('navio') or mmsi:30s} "
            f"→ {c.get('destination_slug'):15s} "
            f"ETA {c.get('eta') or '—'} "
            f"conf {score:3d} "
            f"({'|'.join(k for k,v in signals.items() if v)})"
        )

    # 3. Upsert latest snapshot + append to historical trail
    written = upsert_candidates(sb, enriched)
    print(f"[disc] {written} candidato(s) gravado(s) em import_candidates")
    trail_written = insert_position_history(sb, enriched)
    print(f"[disc] {trail_written} linha(s) de trilha gravada(s) em candidate_positions")

    _log_run(sb, stats, cabotage_skipped, non_tanker_skipped, written, trail_written)


def _log_run(sb, stats: dict, cabotage_skipped: int, non_tanker_skipped: int,
             candidates_written: int, positions_written: int) -> None:
    """Persist this sweep's outcome so the dashboard can show 'last run' even
    when everything got filtered."""
    try:
        sb.table("discovery_runs").insert({
            "listen_seconds":     stats.get("listen_seconds"),
            "msgs_total":         stats.get("msgs_total"),
            "br_matches":         stats.get("br_matches"),
            "unique_imos":        stats.get("unique_imos"),
            "cabotage_skipped":   cabotage_skipped,
            "non_tanker_skipped": non_tanker_skipped,
            "candidates_written": candidates_written,
            "positions_written":  positions_written,
        }).execute()
        print("[disc] run registrada em discovery_runs")
    except Exception as e:
        print(f"[disc] falha ao registrar run em discovery_runs: {e}", file=sys.stderr)


if __name__ == "__main__":
    try:
        asyncio.run(_run())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
