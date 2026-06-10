#!/usr/bin/env python3
"""
anp_sintese_taxes_sync.py
=========================
LEAN, FAIL-FAST scraper for the weekly tax lines of the ANP "Síntese Semanal
do Comportamento dos Preços dos Combustíveis" PDF.

It extracts ONLY four numbers per edition, from the "Composição do preço médio
de revenda" stacked-bar panel of each PDF:

    * Gasoline C : Tributos Federais (R$/L)  +  Tributo Estadual / ICMS (R$/L)
    * Diesel B S10: Tributos Federais (R$/L) +  Tributo Estadual / ICMS (R$/L)

and upserts them into ``public.anp_sintese_taxes`` on (data_fim, fuel_type).

Design goals (a prior heavy version hung + ingested 0 rows):
  * Fetch the index page ONCE, take only the MOST RECENT 1-3 Síntese PDF links.
    Never iterate the full archive, never crawl year sub-pages.
  * Every requests.get has timeout=(10, 30).
  * pdfplumber: open the PDF, search only the first ~7 pages for the two
    composition panels. If a PDF does not parse cleanly, SKIP it + log — never
    loop/retry indefinitely.
  * Sanity guard: federal in [0, 1.5], ICMS in [0.5, 2.5]; reject out-of-range.
  * Total runtime budget: a few PDFs, seconds each. Never hang.

Pegadinha #12 (CLAUDE.md): never advertise "br" in Accept-Encoding.

──────────────────────────────────────────────────────────────────────────────
How the panel is parsed (verified live on editions 19, 21, 22, 23 / 2026)
──────────────────────────────────────────────────────────────────────────────
The composition panel is a single vertical stacked bar. The R$ values live in a
narrow LEFT column (x0 < ~100). Read top-to-bottom they are, in fixed order:

    [0] total revenda  [1] Margens  [2] Tributo Estadual (ICMS)
    [3] Tributos Federais  [4] biofuel (Etanol/Biodiesel)  [5] Realização

So ICMS = value index 2 and Federal = value index 3 — an ORDINAL mapping, NOT a
nearest-label heuristic (proximity is ambiguous: for diesel the federal bar of
0,00 sits two slots above its legend label, with 0,74 in between). The ordinal
rule is cross-checked two ways before we trust it:
  * the legend labels (Margens / Tributo Estadual / Tributos Federais …) must
    appear in that order down the page; and
  * the five component values must sum to the total revenda (± a small epsilon).

data_fim = the survey week's end (the second date in "Semana de DD/MM/YYYY a
DD/MM/YYYY" — a Saturday) as stated by the PDF itself; we trust the PDF.

Usage:
    python scripts/pipelines/anp/sintese/anp_sintese_taxes_sync.py            # latest edition
    python scripts/pipelines/anp/sintese/anp_sintese_taxes_sync.py --last 3   # last 3 editions
    python scripts/pipelines/anp/sintese/anp_sintese_taxes_sync.py --dry-run

Credentials: SUPABASE_URL + SUPABASE_SERVICE_KEY (env or .env walked up the tree)
"""

import argparse
import io
import os
import re
import sys
import unicodedata
from pathlib import Path

import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_INDEX_URL = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/"
    "precos/sintese-semanal-do-comportamento-dos-precos-dos-combustiveis"
)

# IMPORTANT: never advertise "br" (CLAUDE.md Pegadinha #12). requests handles
# gzip/deflate transparently; advertising br without a guaranteed decoder is the
# classic silent-garbage failure mode.
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate",
}

# Hard per-request timeout (connect, read). Keeps any single fetch from hanging.
_TIMEOUT = (10, 30)

_TABLE = "anp_sintese_taxes"
_FONTE = "ANP — Síntese Semanal do Comportamento dos Preços dos Combustíveis"

# Sanity ranges (reject out-of-range → skip that fuel).
_FEDERAL_RANGE = (0.0, 1.5)
_ICMS_RANGE = (0.5, 2.5)

# Composition stacked-bar ordinal slots (left-column R$ values, top→bottom):
#   0 total · 1 Margens · 2 Tributo Estadual (ICMS) · 3 Tributos Federais ·
#   4 biofuel · 5 Realização
_IDX_ICMS = 2
_IDX_FEDERAL = 3
_MIN_COMPONENTS = 6  # total + 5 components

# Composition-panel detector: which fuel does this page describe?
_FUEL_BY_PANEL = [
    ("Gasoline C", ("gasolina comum",)),
    ("Diesel B", ("diesel b s10",)),
]

# Search only the first N pages of each PDF for the two composition panels.
_MAX_PAGES = 7


def _strip_accents_lower(s: str) -> str:
    return (
        unicodedata.normalize("NFKD", s)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------

def _get_creds():
    """Return (url, key) from env or a .env walked up the tree (worktree-safe)."""
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if url and key:
        return url, key
    for parent in Path(__file__).resolve().parents:
        env = parent / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
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
    return url, key


# ---------------------------------------------------------------------------
# Index → latest PDF links
# ---------------------------------------------------------------------------

def _edition_sort_key(url: str) -> tuple:
    """Best-effort recency key from a Síntese PDF URL.

    Filenames vary (sintese-precos-23.pdf, sinteseprecos20.pdf, .../2025/.../
    sintese-precos-52.pdf). The index already lists newest-first, so we mostly
    rely on document order, but this gives a stable tiebreak: (year, edition).
    """
    yr = 0
    ym = re.search(r"/(20\d{2})/", url)
    if ym:
        yr = int(ym.group(1))
    edm = re.search(r"sintese-?precos-?n?0*?(\d{1,2})\.pdf$", url, re.IGNORECASE)
    ed = int(edm.group(1)) if edm else 0
    return (yr, ed)


def _latest_pdf_links(n: int) -> list[str]:
    """Fetch the index ONCE; return the most recent `n` Síntese PDF URLs.

    The index lists links newest-first; we keep that document order (it is the
    authoritative recency signal) and just de-duplicate. We do NOT crawl any
    year sub-page — only links already present on this one page.
    """
    print(f"Fetching index (timeout={_TIMEOUT}) ...", end=" ", flush=True)
    r = requests.get(_INDEX_URL, headers=_HEADERS, timeout=_TIMEOUT)
    r.raise_for_status()
    enc = r.headers.get("Content-Encoding", "")
    print(f"{len(r.text) // 1024} KB (enc={enc or 'none'})")

    hrefs = re.findall(r'href="([^"]+)"', r.text)
    seen, ordered = set(), []
    for h in hrefs:
        hl = h.lower()
        if "sintese" in hl and "precos" in hl and hl.endswith(".pdf"):
            full = h if h.startswith("http") else ("https://www.gov.br" + h)
            if full not in seen:
                seen.add(full)
                ordered.append(full)

    if not ordered:
        raise SystemExit(
            "[anp-sintese] ERROR: 0 Síntese PDF links found on the index page — "
            "source layout likely changed (hard error, not a silent skip)."
        )

    latest = ordered[:n]
    print(f"Index lists {len(ordered)} Síntese PDFs; taking the latest {len(latest)}:")
    for u in latest:
        print(f"  · {u}")
    return latest


def _edicao_label(url: str) -> str:
    """Human-readable edition label, e.g. '23/2026', for the sintese_edicao col."""
    yr = re.search(r"/(20\d{2})/", url)
    ed = re.search(r"sintese-?precos-?n?0*?(\d{1,2})\.pdf$", url, re.IGNORECASE)
    if yr and ed:
        return f"{int(ed.group(1))}/{yr.group(1)}"
    return url.rsplit("/", 1)[-1]


# ---------------------------------------------------------------------------
# PDF parsing
# ---------------------------------------------------------------------------

_VAL_RE = re.compile(r"R\$\s*([0-9]+,[0-9]{2})")
_WEEK_RE = re.compile(r"(\d{2}/\d{2}/\d{4})\s*a\s*(\d{2}/\d{2}/\d{4})")
_BRL_DATE_RE = re.compile(r"^(\d{2})/(\d{2})/(\d{4})$")


def _brl_to_float(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


def _iso_date(brl: str) -> str | None:
    m = _BRL_DATE_RE.match(brl)
    if not m:
        return None
    d, mo, y = m.groups()
    return f"{y}-{mo}-{d}"


def _left_column_values(page) -> list[tuple[float, str]]:
    """Reconstruct the left-column R$ values (x0<100) ordered top→bottom.

    The PDF encodes the panel digits as individual chars (e.g. 'R $ 0 , 0 0'),
    so we rebuild each row from raw chars, then regex the R$ value out.
    """
    rows: dict[float, list] = {}
    for c in page.chars:
        # Composition panel is at the top-left of the page; keep a generous box.
        if c["x0"] < 100 and 95 < c["top"] < 185:
            rows.setdefault(round(c["top"] / 2.0), []).append(c)
    out: list[tuple[float, str]] = []
    for key in sorted(rows):
        cs = sorted(rows[key], key=lambda c: c["x0"])
        text = "".join(c["text"] for c in cs)
        m = _VAL_RE.search(text)
        if m:
            out.append((cs[0]["top"], m.group(1)))
    return out


def _legend_order_ok(page) -> bool:
    """Confirm the legend labels appear in the expected top→bottom order.

    Expected order: Margens · Tributo Estadual · Tributos Federais. We require
    the (accent-insensitive) label tops to be strictly increasing.
    """
    wanted = ("margens", "tributo estadual", "tributos federais")
    found: dict[str, float] = {}
    text = page.extract_text() or ""
    # Cheap text-position scan via words.
    for w in page.extract_words():
        wl = _strip_accents_lower(w["text"])
        for label in wanted:
            head = label.split()[0]  # 'margens' / 'tributo' / 'tributos'
            if wl == head and label not in found:
                # Anchor on the FIRST word of the multi-word label.
                found[label] = w["top"]
    tops = [found.get(lbl) for lbl in wanted]
    if any(t is None for t in tops):
        # Label words not all present — fall back to text-substring presence.
        low = _strip_accents_lower(text)
        return all(lbl in low for lbl in wanted)
    return tops[0] < tops[1] < tops[2]


def _parse_panel(page, fuel_type: str, week_end_iso: str, edicao: str, src_url: str):
    """Parse one composition panel page into a record, or return None (skip)."""
    vals = _left_column_values(page)
    if len(vals) < _MIN_COMPONENTS:
        print(f"    [skip] {fuel_type}: found {len(vals)} left-column values "
              f"(need {_MIN_COMPONENTS}) — panel layout unexpected.")
        return None

    nums = [v for _, v in vals]
    icms = _brl_to_float(nums[_IDX_ICMS])
    federal = _brl_to_float(nums[_IDX_FEDERAL])

    # Cross-check 1: legend order.
    if not _legend_order_ok(page):
        print(f"    [skip] {fuel_type}: legend order check failed — refusing to "
              f"trust the ordinal mapping.")
        return None

    # Cross-check 2: the five components sum to the total revenda (± epsilon).
    total = _brl_to_float(nums[0])
    comp_sum = sum(_brl_to_float(n) for n in nums[1:6])
    if abs(comp_sum - total) > 0.03:
        print(f"    [skip] {fuel_type}: component sum {comp_sum:.2f} != total "
              f"{total:.2f} — ordinal mapping unreliable on this PDF.")
        return None

    # Sanity guard: reject out-of-range values.
    if not (_FEDERAL_RANGE[0] <= federal <= _FEDERAL_RANGE[1]):
        print(f"    [skip] {fuel_type}: federal {federal} out of range {_FEDERAL_RANGE}.")
        return None
    if not (_ICMS_RANGE[0] <= icms <= _ICMS_RANGE[1]):
        print(f"    [skip] {fuel_type}: ICMS {icms} out of range {_ICMS_RANGE}.")
        return None

    return {
        "data_fim": week_end_iso,
        "fuel_type": fuel_type,
        "federal_rs_litro": round(federal, 4),
        "icms_rs_litro": round(icms, 4),
        "fonte": _FONTE,
        "sintese_edicao": edicao,
    }


def _parse_pdf(content: bytes, src_url: str) -> list[dict]:
    """Open the PDF and extract the (≤2) tax records. Skip-on-error, never hang."""
    import pdfplumber

    records: list[dict] = []
    edicao = _edicao_label(src_url)
    try:
        pdf = pdfplumber.open(io.BytesIO(content))
    except Exception as e:  # corrupt / unreadable PDF → skip, do not retry
        print(f"  [skip] {edicao}: pdfplumber could not open the PDF ({e!r}).")
        return records

    with pdf:
        seen_fuels: set[str] = set()
        for pidx, page in enumerate(pdf.pages[:_MAX_PAGES]):
            try:
                text = page.extract_text() or ""
            except Exception as e:
                print(f"  [skip-page {pidx}] {edicao}: extract_text failed ({e!r}).")
                continue
            low = _strip_accents_lower(text)
            if "composi" not in low or "tributo" not in low:
                continue

            # Which fuel panel is this?
            fuel_type = None
            for ft, needles in _FUEL_BY_PANEL:
                if any(_strip_accents_lower(nd) in low for nd in needles):
                    fuel_type = ft
                    break
            if fuel_type is None or fuel_type in seen_fuels:
                continue

            wm = _WEEK_RE.search(text)
            if not wm:
                print(f"  [skip] {edicao} p{pidx} ({fuel_type}): no week range found.")
                continue
            week_end_iso = _iso_date(wm.group(2))
            if not week_end_iso:
                print(f"  [skip] {edicao} p{pidx} ({fuel_type}): bad week-end date "
                      f"{wm.group(2)!r}.")
                continue

            rec = _parse_panel(page, fuel_type, week_end_iso, edicao, src_url)
            if rec:
                seen_fuels.add(fuel_type)
                records.append(rec)
                print(f"    [ok] {fuel_type:<10} data_fim={rec['data_fim']} "
                      f"federal={rec['federal_rs_litro']} icms={rec['icms_rs_litro']} "
                      f"(ed {edicao})")

    if not records:
        print(f"  [warn] {edicao}: no usable tax records parsed from this PDF.")
    return records


def _fetch_pdf(url: str) -> bytes | None:
    """Single GET with a hard timeout. Return bytes or None (skip on failure)."""
    name = url.rsplit("/", 1)[-1]
    print(f"  Downloading {name} (timeout={_TIMEOUT}) ...", end=" ", flush=True)
    try:
        r = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT)
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"error: {e} — skipping this edition.")
        return None
    enc = r.headers.get("Content-Encoding", "")
    print(f"{len(r.content) // 1024} KB (enc={enc or 'none'})")
    # Guard against a garbage/HTML body where a PDF was expected.
    if not r.content[:5].startswith(b"%PDF"):
        print(f"  [skip] {name}: body is not a PDF (starts {r.content[:8]!r}).")
        return None
    return r.content


# ---------------------------------------------------------------------------
# Upsert
# ---------------------------------------------------------------------------

def _dedupe(records: list[dict]) -> list[dict]:
    """De-dupe by PK (data_fim, fuel_type) before upsert (last wins)."""
    by_pk: dict[tuple, dict] = {}
    for r in records:
        by_pk[(r["data_fim"], r["fuel_type"])] = r
    out = list(by_pk.values())
    out.sort(key=lambda r: (r["data_fim"], r["fuel_type"]))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--last", type=int, default=1,
                    help="how many of the most recent editions to ingest (default 1)")
    ap.add_argument("--dry-run", action="store_true",
                    help="parse + report, do not upsert")
    args = ap.parse_args()

    n = max(1, min(args.last, 3))  # hard cap at 3 — stay lean
    links = _latest_pdf_links(n)

    all_records: list[dict] = []
    for url in links:
        content = _fetch_pdf(url)
        if content is None:
            continue
        all_records.extend(_parse_pdf(content, url))

    records = _dedupe(all_records)

    print(f"\nParsed {len(records)} tax record(s) from {len(links)} edition(s):")
    for r in records:
        print(f"  {r['fuel_type']:<10} {r['data_fim']}  federal={r['federal_rs_litro']:<6} "
              f"icms={r['icms_rs_litro']:<6} ed={r['sintese_edicao']}")

    if not records:
        # Honest, non-hanging failure: report unreliable parse and stop.
        raise SystemExit(
            "[anp-sintese] PDF parse unreliable — 0 tax records extracted from the "
            "latest edition(s). Not hanging; falling back to monitor/alert."
        )

    if args.dry_run:
        print("\n[dry-run] not upserting.")
        return

    url, key = _get_creds()
    if not url or not key:
        raise SystemExit("[anp-sintese] ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY "
                         "not set (and no --dry-run).")

    from supabase import create_client

    sb = create_client(url, key)
    sb.table(_TABLE).upsert(records, on_conflict="data_fim,fuel_type").execute()
    print(f"\nDone: upserted {len(records)} row(s) into {_TABLE}.")


if __name__ == "__main__":
    main()
