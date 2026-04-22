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


def _clean_search_name(name: str) -> str:
    """
    Strip parenthetical annotations like '(EX LATGALE)', '(ex. Pretty Scene)'
    etc. and common tanker prefixes so VesselFinder/MarineTraffic can match.
    """
    s = re.sub(r"\s*\([^)]*\)\s*", " ", name)
    # "MT " / "M/T " / "M/V " / "MV " prefixes used on port manifests
    s = re.sub(r"^\s*(MT|MV|M/T|M/V)\s+", "", s, flags=re.IGNORECASE)
    return s.strip()


# Ship-type hints for our line-up: everything is diesel/oil-product tankers.
# When a name is ambiguous, prefer candidates whose VesselFinder-reported
# type contains any of these tokens.
_TANKER_TYPE_TOKENS = ("TANKER", "OIL", "CHEMICAL", "PRODUCTS")


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _is_plausible_imo(s: str | None) -> bool:
    return bool(s) and s.isdigit() and len(s) == 7


def _is_plausible_mmsi(s: str | None) -> bool:
    return bool(s) and s.isdigit() and len(s) == 9


# ─── Sources ────────────────────────────────────────────────────────────────
def lookup_vesselfinder(name: str) -> tuple[str | None, str | None, str]:
    """
    Returns (imo, mmsi, debug) from vesselfinder.com free search.
    Honours exact normalised-name match, with tanker-type tie-break.

    Page structure (as of 2026-04):
      <a class="ship-link" href="/vessels/details/{IMO}">
        <img data-src=".../ship-photo/{IMO}-{MMSI}-..."/>
        <div class="slna">{NAME}</div>
        <div class="slty">{SHIP_TYPE}</div>
    """
    search_term = _clean_search_name(name)
    target = _norm(search_term)
    try:
        r = requests.get(
            "https://www.vesselfinder.com/vessels",
            params={"name": search_term},
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT_S,
        )
        if r.status_code != 200:
            return None, None, f"vf:http {r.status_code}"
        soup = BeautifulSoup(r.text, "html.parser")
        anchors = soup.select("a.ship-link[href^='/vessels/details/']")
        if not anchors:
            return None, None, "vf:0 results"

        # name, imo, mmsi, ship_type
        candidates: list[tuple[str, str, str | None, str]] = []
        for a in anchors:
            m_imo = re.search(r"/details/(\d{7})", a.get("href", ""))
            if not m_imo:
                continue
            imo = m_imo.group(1)

            mmsi: str | None = None
            img = a.find("img")
            if img:
                data_src = img.get("data-src") or img.get("src") or ""
                m_mmsi = re.search(r"/ship-photo/\d{7}-(\d{9})-", data_src)
                if m_mmsi:
                    mmsi = m_mmsi.group(1)

            slna = a.find("div", class_="slna")
            slty = a.find("div", class_="slty")
            nm = (slna.get_text(strip=True) if slna else a.get_text(" ", strip=True)) or ""
            ship_type = (slty.get_text(strip=True) if slty else "") or ""
            candidates.append((nm, imo, mmsi, ship_type))

        # Exact normalised match (cleaning candidate names too — VF sometimes
        # prefixes with "MT " etc.)
        exact = [c for c in candidates if _norm(_clean_search_name(c[0])) == target]
        if len(exact) == 1:
            nm, imo, mmsi, _ = exact[0]
            return imo, mmsi, f"vf:exact '{nm}'"
        if len(exact) > 1:
            # Tie-break: prefer tanker types (our line-up is 100% diesel tankers)
            tankers = [c for c in exact if any(t in c[3].upper() for t in _TANKER_TYPE_TOKENS)]
            if len(tankers) == 1:
                nm, imo, mmsi, ship_type = tankers[0]
                return imo, mmsi, f"vf:exact '{nm}' (tanker tie-break, {ship_type})"
            return None, None, f"vf:ambiguous ({len(exact)} exact, {len(tankers)} tankers)"
        cand_names = ", ".join(c[0] for c in candidates[:5])
        return None, None, f"vf:{len(candidates)} candidates [{cand_names}] — no exact match"
    except Exception as e:
        return None, None, f"vf:err {e}"


def lookup_marinetraffic(name: str) -> tuple[str | None, str | None, str]:
    """
    Scrape marinetraffic.com's public search page HTML.
    They aggressively rate-limit / bot-block; used as fallback only.
    """
    search_term = _clean_search_name(name)
    target = _norm(search_term)
    try:
        r = requests.get(
            "https://www.marinetraffic.com/en/ais/index/search/all/keyword:" + requests.utils.quote(search_term),
            headers={**HEADERS, "Referer": "https://www.marinetraffic.com/"},
            timeout=REQUEST_TIMEOUT_S,
            allow_redirects=True,
        )
        if r.status_code != 200:
            return None, None, f"mt:http {r.status_code}"
        # MT sometimes redirects straight to the ship page if there's one match
        m = re.search(r"/en/ais/details/ships/shipid:\d+/mmsi:(\d{9})/imo:(\d{7})/vessel:([^/\"']+)", r.url)
        if m:
            mmsi, imo, url_name = m.group(1), m.group(2), m.group(3)
            if _norm(url_name.replace("_", " ").replace("%20", " ")) == target:
                return imo, mmsi, "mt:redirect exact"
        # Otherwise parse HTML for search results
        soup = BeautifulSoup(r.text, "html.parser")
        candidates: list[tuple[str, str | None, str | None]] = []
        for a in soup.select("a[href*='/en/ais/details/ships/']"):
            href = a.get("href", "")
            m_mmsi = re.search(r"/mmsi:(\d{9})", href)
            m_imo = re.search(r"/imo:(\d{7})", href)
            mmsi = m_mmsi.group(1) if m_mmsi else None
            imo = m_imo.group(1) if m_imo else None
            nm = a.get_text(" ", strip=True)
            if not nm:
                continue
            candidates.append((nm, imo, mmsi))
        exact = [c for c in candidates if _norm(c[0]) == target]
        if len(exact) == 1:
            nm, imo, mmsi = exact[0]
            return imo, mmsi, f"mt:exact '{nm}'"
        if len(exact) > 1:
            return None, None, f"mt:ambiguous ({len(exact)})"
        return None, None, f"mt:{len(candidates)} candidates — no exact match"
    except Exception as e:
        return None, None, f"mt:err {e}"


def lookup_balticshipping(name: str) -> tuple[str | None, str | None, str]:
    """
    Free search at balticshipping.com. Third fallback.
    """
    search_term = _clean_search_name(name)
    target = _norm(search_term)
    try:
        r = requests.get(
            "https://www.balticshipping.com/vessels/search",
            params={"search": search_term},
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT_S,
        )
        if r.status_code != 200:
            return None, None, f"bs:http {r.status_code}"
        soup = BeautifulSoup(r.text, "html.parser")
        candidates: list[tuple[str, str | None, str | None]] = []
        for a in soup.select("a[href*='/vessel/imo/']"):
            href = a.get("href", "")
            m = re.search(r"/vessel/imo/(\d{7})", href)
            if not m:
                continue
            imo = m.group(1)
            nm = a.get_text(" ", strip=True)
            if not nm:
                continue
            candidates.append((nm, imo, None))
        exact = [c for c in candidates if _norm(c[0]) == target]
        if len(exact) == 1:
            nm, imo, mmsi = exact[0]
            return imo, mmsi, f"bs:exact '{nm}'"
        if len(exact) > 1:
            return None, None, f"bs:ambiguous ({len(exact)})"
        return None, None, f"bs:{len(candidates)} candidates — no exact match"
    except Exception as e:
        return None, None, f"bs:err {e}"


def resolve(name: str) -> tuple[str | None, str | None, str | None, list[str]]:
    """Returns (imo, mmsi, source, debug_notes) — debug always populated."""
    notes: list[str] = []
    for src_name, fn in [
        ("vesselfinder", lookup_vesselfinder),
        ("marinetraffic", lookup_marinetraffic),
        ("balticshipping", lookup_balticshipping),
    ]:
        imo, mmsi, note = fn(name)
        notes.append(note)
        if imo or mmsi:
            return imo, mmsi, src_name, notes
        time.sleep(REQUEST_DELAY_S)
    return None, None, None, notes


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
        imo, mmsi, source, notes = resolve(name)
        if imo or mmsi:
            _write_back(sb, name, imo, mmsi)
            resolved += 1
            print(f"[lookup] {i}/{len(pending)} {name} → IMO {imo or '—'}, MMSI {mmsi or '—'} ({source})")
        else:
            # Show every source's verdict so we can see WHY nothing matched
            print(f"[lookup] {i}/{len(pending)} {name} → no match | {' | '.join(notes)}")
        time.sleep(REQUEST_DELAY_S)

    print(f"[lookup] {resolved}/{len(pending)} resolvidos nesta run")


if __name__ == "__main__":
    main()
