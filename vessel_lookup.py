"""
Vessel IMO/MMSI resolver — for every row in navios_diesel that still lacks an
IMO, search public maritime databases (VesselFinder first, MarineTraffic as
fallback) to resolve IMO + MMSI, then write the result back into
`navios_diesel` and `vessel_registry`.

Runs after `navios_esperados.yml` via `vessel_lookup.yml`, so by the time the
AIS sync runs we already know which MMSIs to filter by.

Invoke locally:  `python vessel_lookup.py`
"""

from __future__ import annotations

import os
import re
import sys
import time
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from supabase import create_client


load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
if not (SUPABASE_URL and SUPABASE_KEY):
    print("[erro] faltam env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY", file=sys.stderr)
    sys.exit(1)

REQUEST_DELAY_S = float(os.environ.get("VESSEL_LOOKUP_DELAY", "2.0"))
REQUEST_TIMEOUT_S = 15

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/127.0.0.0 Safari/537.36"
)
HEADERS = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}


# ─── Helpers ────────────────────────────────────────────────────────────────
def _norm(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", (name or "").upper())


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _is_plausible_imo(s: str | None) -> bool:
    return bool(s) and s.isdigit() and len(s) == 7


def _is_plausible_mmsi(s: str | None) -> bool:
    return bool(s) and s.isdigit() and len(s) == 9


# ─── Sources ────────────────────────────────────────────────────────────────
def lookup_vesselfinder(name: str) -> tuple[str | None, str | None]:
    """
    Returns (imo, mmsi) from vesselfinder.com free search.
    Honours exact-name match only to avoid wrong assignments.
    """
    target = _norm(name)
    try:
        r = requests.get(
            "https://www.vesselfinder.com/vessels",
            params={"name": name},
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT_S,
        )
        if r.status_code != 200:
            return None, None
        soup = BeautifulSoup(r.text, "html.parser")
        # Search results are rendered as rows in a table with class "results"
        # Each row links to /vessels/details/<IMO>/<MMSI>
        rows = soup.select("table.results tr")
        best: tuple[str | None, str | None] = (None, None)
        best_score = -1
        for row in rows:
            link = row.find("a", href=True)
            if not link:
                continue
            href = link["href"]
            # /vessels/details/IMO/MMSI
            m = re.search(r"/details/(\d{7})/(\d{9})", href or "")
            if not m:
                continue
            imo, mmsi = m.group(1), m.group(2)
            # name cell
            name_txt = link.get_text(strip=True)
            if _norm(name_txt) == target:
                return imo, mmsi
            # otherwise keep the best fuzzy candidate (exact prefix match only)
            if _norm(name_txt).startswith(target) and len(target) >= 4:
                score = len(target)
                if score > best_score:
                    best_score = score
                    best = (imo, mmsi)
        return best
    except Exception as e:
        print(f"[lookup/vf] {name}: {e}", file=sys.stderr)
        return None, None


def lookup_marinetraffic(name: str) -> tuple[str | None, str | None]:
    """
    Best-effort scrape of marinetraffic.com's public search JSON endpoint.
    They aggressively rate-limit; used only as fallback.
    """
    target = _norm(name)
    try:
        r = requests.get(
            "https://www.marinetraffic.com/en/vesselDetails/asyncJson",
            params={"term": name},
            headers={**HEADERS, "X-Requested-With": "XMLHttpRequest"},
            timeout=REQUEST_TIMEOUT_S,
        )
        if r.status_code != 200:
            return None, None
        data = r.json() if r.headers.get("content-type", "").startswith("application/json") else None
        if not isinstance(data, list):
            return None, None
        for item in data:
            nm = item.get("name") or item.get("title") or ""
            if _norm(nm) != target:
                continue
            imo = str(item.get("imo") or "").strip()
            mmsi = str(item.get("mmsi") or "").strip()
            return (imo if _is_plausible_imo(imo) else None, mmsi if _is_plausible_mmsi(mmsi) else None)
    except Exception as e:
        print(f"[lookup/mt] {name}: {e}", file=sys.stderr)
    return None, None


def resolve(name: str) -> tuple[str | None, str | None, str | None]:
    """Returns (imo, mmsi, source) or (None, None, None)."""
    imo, mmsi = lookup_vesselfinder(name)
    if imo or mmsi:
        return imo, mmsi, "vesselfinder"
    time.sleep(REQUEST_DELAY_S)
    imo, mmsi = lookup_marinetraffic(name)
    if imo or mmsi:
        return imo, mmsi, "marinetraffic"
    return None, None, None


# ─── Persistence ────────────────────────────────────────────────────────────
def _pending_vessels(sb) -> list[dict]:
    """Unique vessel names in current line-up that still lack IMO."""
    resp = (
        sb.table("navios_diesel")
        .select("navio")
        .is_("imo", None)
        .neq("status", "Despachado")
        .neq("status", "ERRO_COLETA")
        .execute()
    )
    seen: set[str] = set()
    out = []
    for row in resp.data or []:
        nm = (row.get("navio") or "").strip()
        if not nm or nm in seen:
            continue
        seen.add(nm)
        out.append({"navio": nm})
    return out


def _write_back(sb, name: str, imo: str | None, mmsi: str | None) -> None:
    payload: dict = {}
    if imo:
        payload["imo"] = imo
    if mmsi:
        payload["mmsi"] = mmsi
    if not payload:
        return

    # 1) update all navios_diesel rows with this exact name that still have no imo
    sb.table("navios_diesel").update(payload).eq("navio", name).is_("imo", None).execute()

    # 2) upsert vessel_registry so future name_norm lookups hit it too
    if imo:
        sb.table("vessel_registry").upsert(
            {
                "imo": imo,
                "mmsi": mmsi,
                "name": name,
                "last_seen_at": _now_iso(),
            },
            on_conflict="imo",
        ).execute()


# ─── Main ───────────────────────────────────────────────────────────────────
def main() -> None:
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    pending = _pending_vessels(sb)
    if not pending:
        print("[lookup] nenhum navio pendente — tudo resolvido")
        return

    print(f"[lookup] {len(pending)} navio(s) pendente(s) de resolução de IMO")

    resolved = 0
    for i, v in enumerate(pending, 1):
        name = v["navio"]
        imo, mmsi, source = resolve(name)
        if imo or mmsi:
            _write_back(sb, name, imo, mmsi)
            resolved += 1
            print(f"[lookup] {i}/{len(pending)} {name} → IMO {imo or '—'}, MMSI {mmsi or '—'} ({source})")
        else:
            print(f"[lookup] {i}/{len(pending)} {name} → sem match em nenhuma fonte")
        time.sleep(REQUEST_DELAY_S)

    print(f"[lookup] {resolved}/{len(pending)} resolvidos nesta run")


if __name__ == "__main__":
    main()
