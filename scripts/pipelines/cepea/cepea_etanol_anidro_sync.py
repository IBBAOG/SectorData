#!/usr/bin/env python3
"""
cepea_etanol_anidro_sync.py
===========================
Scrapes the CEPEA/ESALQ **weekly anhydrous-ethanol** indicator for São Paulo
("Indicador Semanal do Etanol Anidro CEPEA/ESALQ - São Paulo", à vista, sem
frete, sem PIS/Cofins) and upserts it into `cepea_etanol_anidro`.

Target table (PK = data_semana):
    cepea_etanol_anidro(
        data_semana    date PK,          -- the Saturday (ISO-week last day)
        week           text,             -- 'WW/IYYY' UNPADDED, e.g. '23/2026'
        preco_rs_litro numeric,          -- R$/L (à vista, SP)
        fonte          text DEFAULT 'CEPEA/ESALQ'
    )

CEPEA publishes the indicator's reference date as the week's Friday (occasionally
a Thursday/Wednesday on holiday weeks). We normalise each date to the Saturday of
its ISO week (`data_semana`) so the PK is stable regardless of the published
weekday, and derive `week` from that Saturday's ISO calendar.

================================================================================
DATA SOURCES (scheduled = pure-Python, no browser)
================================================================================
The weekly run is 100% browser-free. It walks a fallback chain of three ungated,
official-or-republished HTTP feeds, in this order:

  1. PRIMARY — CEPEA embed widget (browser-free, ungated, official 4-decimal):
         GET https://www.cepea.org.br/br/widgetproduto.js.php
             ?output=html&id_indicador[]=104
       `id_indicador[]=104` == "Etanol Anidro - SP" in R$/L (load-bearing).
       (103=Hidratado SP; 101=Anidro PE; 75=Anidro MT but R$/m³ — NEVER those.)
       The host MUST be www.cepea.org.br (the esalq host returns "Sem resultados")
       and the request MUST send a browser User-Agent — the default python UA gets
       a 403, any "Mozilla/5.0 …" string gets a 200. No cookie / Referer /
       cf_clearance / TLS-impersonation needed. The widget returns ONLY the single
       latest weekly row — that is fine: deep history is already backfilled, the
       upsert is idempotent on data_semana, and the weekly cron catches each Friday
       publication.

  2. FALLBACK — Notícias Agrícolas HTML (republishes the CEPEA indicator, ungated,
     ~10 recent weeks, 4-decimal). Patches a missed weekly run. Week label is a
     range like "01 - 05/06/2026"; we take the end date.

  3. LAST-RESORT — the same Notícias Agrícolas slug + ".json" (clean JSON, latest
     week only). Used to confirm when the two above fail.

  --backfill (NOT in CI) — the legacy undetected-chromedriver → cf_clearance →
     `consultas-ao-banco-de-dados` full-history Excel path. KEPT but reachable
     ONLY behind this flag, and the Chrome / Selenium / curl-cffi / calamine stack
     is **lazy-imported inside that path** so a normal (scheduled) run never
     touches Chrome. History is already backfilled to 2002 — this is for rare
     manual deep re-pulls only.

================================================================================
GUARDS (a silent empty / wrong-unit upsert is the real bug)
================================================================================
- zero rows across ALL sources -> hard exit(1).
- sane-range: any value outside [1.5, 5.0] R$/L is rejected as a parse failure
  (guards against accidentally parsing an R$/m³ indicator) and we fall through.
- decimal-precision sniff on the RAW string: a value with <=2 decimals is treated
  as rounded (UDOP-style) and we prefer the next source.
- week-mapping invariant: every record's data_semana is a Saturday and its `week`
  label matches its ISO calendar (asserted in `_to_record`).
- staleness: if the freshest data_semana we obtained is >14 days old, exit
  non-zero (loud — page-able by the freshness monitor) instead of silently
  re-upserting a stale week.
- per-source `parsed N rows` log; a per-source 0 is logged as an anomaly.
- cross-source agreement: if the widget and Notícias Agrícolas both yield an
  overlapping week in one run, their R$/L must agree to 4 dp before upsert.

Usage:
    python scripts/pipelines/cepea/cepea_etanol_anidro_sync.py          # weekly
    python scripts/pipelines/cepea/cepea_etanol_anidro_sync.py --backfill
    python scripts/pipelines/cepea/cepea_etanol_anidro_sync.py --backfill --since 01/01/2002

Credentials: SUPABASE_URL + SUPABASE_SERVICE_KEY (env or repo-root .env).

Deps (weekly path): requests, beautifulsoup4/lxml (optional), supabase.
Deps (--backfill ONLY): undetected-chromedriver, selenium, curl-cffi,
      python-calamine + a Chrome/Chromium binary — all lazy-imported.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ──────────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────────
SOURCE = "CEPEA/ESALQ"
TABLE = "cepea_etanol_anidro"
BATCH = 500

# Browser UA — REQUIRED by both CEPEA (403 on the default python UA) and Notícias
# Agrícolas. No other header / cookie is needed for the ungated feeds.
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# PRIMARY: CEPEA embed widget. id_indicador[]=104 == "Etanol Anidro - SP" (R$/L).
# Host must be www.cepea.org.br. Cosmetic params are harmless; we keep them minimal.
WIDGET_URL = (
    "https://www.cepea.org.br/br/widgetproduto.js.php"
    "?output=html&id_indicador[]=104"
)

# FALLBACKS: Notícias Agrícolas republished indicator (HTML page + .json view).
NA_FALLBACK_URL = (
    "https://www.noticiasagricolas.com.br/cotacoes/sucroenergetico/"
    "indicador-semanal-etanol-anidro-cepea-esalq"
)
NA_JSON_URL = NA_FALLBACK_URL + ".json"

# Sanity bounds for the SP anhydrous indicator in R$/L. A value outside this band
# almost certainly means we parsed the wrong indicator (e.g. an R$/m³ series).
MIN_RS_L = 1.5
MAX_RS_L = 5.0

# A run is stale (and should page) if the freshest week we obtained is older than
# this. CEPEA publishes weekly (Fridays); 14 days tolerates one holiday slip.
STALE_AFTER_DAYS = 14

# --- backfill-only constants (legacy Chrome + Excel path) ---------------------
CONSULTAS_URL = "https://www.cepea.org.br/br/consultas-ao-banco-de-dados-do-site.aspx"
LISTAR_ESPEC_URL = "https://www.cepea.org.br/br/indicador/listar_especificacao.aspx"
INDICADOR_WARMUP_URL = "https://www.cepea.esalq.usp.br/br/indicador/etanol.aspx"
ETANOL_PRODUTO_GROUP = "15,16,51,52,53,54,55,56,57,58"
PERIODICIDADE_WEEKLY = "2"  # 1=Diário 2=Semanal 3=Mensal 4=Anual
DEFAULT_SINCE = "01/01/2002"  # CEPEA anidro series starts late 2002


# ──────────────────────────────────────────────────────────────────────────────
# Credentials / Supabase
# ──────────────────────────────────────────────────────────────────────────────
def _get_creds() -> tuple[str, str]:
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "") or os.environ.get(
        "SUPABASE_SERVICE_ROLE_KEY", ""
    )
    if not url or not key:
        # search a few likely .env locations (repo root)
        here = Path(__file__).resolve()
        for parent in here.parents:
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
                    if k in ("SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY") and not key:
                        key = v
                if url and key:
                    break
    if not url or not key:
        sys.exit("Error: SUPABASE_URL / SUPABASE_SERVICE_KEY not set (env or .env)")
    return url, key


# ──────────────────────────────────────────────────────────────────────────────
# Helpers (validated against DB anchors — do NOT change parsing semantics)
# ──────────────────────────────────────────────────────────────────────────────
def _parse_brl(raw: str) -> float | None:
    """'2,5108' or '1.234,56' -> float. Returns None if not numeric."""
    raw = (raw or "").strip()
    if not raw:
        return None
    raw = raw.replace(".", "").replace(",", ".")
    try:
        return round(float(raw), 4)
    except ValueError:
        return None


def _decimal_places(raw: str) -> int:
    """Count decimal digits in a BRL-formatted raw string ('2,5108' -> 4)."""
    raw = (raw or "").strip()
    # In BRL formatting the comma is the decimal separator; the dot is thousands.
    if "," in raw:
        return len(raw.rsplit(",", 1)[1].strip())
    return 0


def _in_range(val: float | None) -> bool:
    """Sane-range guard: reject values that cannot be the SP anidro R$/L indicator."""
    return val is not None and MIN_RS_L <= val <= MAX_RS_L


def _to_record(date_ddmmyyyy: str, preco_rs_litro: float) -> dict | None:
    """Map a CEPEA reference date (Friday/Thu/Wed) + R$/L value to a table row.

    data_semana = Saturday of the date's ISO week; week = 'WW/IYYY' (unpadded).
    Asserts the week-mapping invariant (Saturday weekday + ISO label) before
    returning — a violation is a programming error, not bad source data.
    """
    try:
        d = dt.datetime.strptime(date_ddmmyyyy.strip(), "%d/%m/%Y").date()
    except ValueError:
        return None
    saturday = d + dt.timedelta(days=(5 - d.weekday()))  # Mon=0 .. Sat=5
    iso = saturday.isocalendar()
    week_label = f"{iso[1]}/{iso[0]}"  # ISO week / ISO year, UNPADDED
    # week-mapping invariant
    assert saturday.weekday() == 5, f"data_semana {saturday} is not a Saturday"
    assert week_label == f"{iso[1]}/{iso[0]}", "week label drifted from ISO calendar"
    return {
        "data_semana": saturday.isoformat(),
        "week": week_label,
        "preco_rs_litro": preco_rs_litro,
        "fonte": SOURCE,
    }


def _accept_value(raw_val: str, source: str) -> float | None:
    """Validate a RAW BRL string for a source: range + precision sniff.

    Returns the parsed float if acceptable, else None (caller falls through).
    """
    val = _parse_brl(raw_val)
    if not _in_range(val):
        print(f"[{source}] reject out-of-range value {raw_val!r} -> {val}")
        return None
    if _decimal_places(raw_val) <= 2:
        # Rounded (e.g. UDOP-style 2,51) — prefer a higher-precision source.
        print(f"[{source}] reject low-precision value {raw_val!r} (<=2 decimals)")
        return None
    return val


# ──────────────────────────────────────────────────────────────────────────────
# HTTP (weekly path uses plain `requests` — no browser, no `br` encoding)
# ──────────────────────────────────────────────────────────────────────────────
def _new_session():
    import requests

    s = requests.Session()
    s.headers.update({
        "User-Agent": BROWSER_UA,
        "Accept-Language": "pt-BR,pt;q=0.9",
        # NEVER advertise `br` here (Pegadinha #12): the feeds serve gzip, which
        # requests auto-decodes; `br` without a guaranteed brotli decode = silent
        # garbage. gzip/deflate only.
        "Accept-Encoding": "gzip, deflate",
    })
    return s


def _get_text(session, url: str, retries: int = 4, timeout: int = 30) -> str:
    """GET with a few retries (one cold-start empty widget response was observed)."""
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            r = session.get(url, timeout=timeout)
            r.raise_for_status()
            if r.text and r.text.strip():
                return r.text
            last_err = RuntimeError("empty response body")
        except Exception as e:  # noqa: BLE001
            last_err = e
        if attempt < retries:
            time.sleep(1.5 * attempt)
    raise RuntimeError(f"GET {url} failed after {retries} tries: {last_err}")


# ──────────────────────────────────────────────────────────────────────────────
# SOURCE 1 (PRIMARY): CEPEA embed widget — single latest weekly row
# ──────────────────────────────────────────────────────────────────────────────
_WIDGET_RE = re.compile(
    r"(\d{2}/\d{2}/\d{4}).*?R\$\s*<span[^>]*>([\d.,]+)</span>", re.S
)


def fetch_widget(session) -> list[dict]:
    print("[widget] GET CEPEA embed widget (id_indicador 104, Anidro-SP R$/L)…")
    html = _get_text(session, WIDGET_URL)
    out: dict[str, dict] = {}
    for date_str, raw_val in _WIDGET_RE.findall(html):
        val = _accept_value(raw_val, "widget")
        if val is None:
            continue
        rec = _to_record(date_str, val)
        if rec:
            out[rec["data_semana"]] = rec
    print(f"[widget] parsed {len(out)} weekly rows")
    return list(out.values())


# ──────────────────────────────────────────────────────────────────────────────
# SOURCE 2 (FALLBACK): Notícias Agrícolas HTML — ~10 recent weeks
# ──────────────────────────────────────────────────────────────────────────────
def fetch_na_html(session) -> list[dict]:
    print("[na-html] GET Notícias Agrícolas HTML (recent weeks)…")
    html = _get_text(session, NA_FALLBACK_URL)
    out: dict[str, dict] = {}
    for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        cells = [
            re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip()
            for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, re.S)
        ]
        cells = [c for c in cells if c]
        if len(cells) < 2:
            continue
        # first cell is a week range like "01 - 05/06/2026"; take the end date
        m = re.search(r"(\d{2}/\d{2}/\d{4})", cells[0])
        if not m:
            continue
        val = _accept_value(cells[1], "na-html")
        if val is None:
            continue
        rec = _to_record(m.group(1), val)
        if rec:
            out[rec["data_semana"]] = rec
    print(f"[na-html] parsed {len(out)} weekly rows")
    return list(out.values())


# ──────────────────────────────────────────────────────────────────────────────
# SOURCE 3 (LAST-RESORT): Notícias Agrícolas JSON — latest week only
# ──────────────────────────────────────────────────────────────────────────────
def fetch_na_json(session) -> list[dict]:
    print("[na-json] GET Notícias Agrícolas JSON (latest week)…")
    body = _get_text(session, NA_JSON_URL)
    data = json.loads(body)
    colunas = data.get("colunas") or {}
    # Identify the "Data" column id and the "R$/Litro" column id by label.
    data_col = next((cid for cid, lbl in colunas.items() if "data" in str(lbl).lower()), None)
    val_col = next(
        (cid for cid, lbl in colunas.items()
         if "litro" in str(lbl).lower() or "r$" in str(lbl).lower()),
        None,
    )
    out: dict[str, dict] = {}
    for row in (data.get("valores") or {}).values():
        if not isinstance(row, dict):
            continue
        date_cell = str(row.get(data_col, "")) if data_col else ""
        m = re.search(r"(\d{2}/\d{2}/\d{4})", date_cell)
        if not m:
            continue
        raw_val = str(row.get(val_col, "")) if val_col else ""
        val = _accept_value(raw_val, "na-json")
        if val is None:
            continue
        rec = _to_record(m.group(1), val)
        if rec:
            out[rec["data_semana"]] = rec
    print(f"[na-json] parsed {len(out)} weekly rows")
    return list(out.values())


# ──────────────────────────────────────────────────────────────────────────────
# BACKFILL ONLY: legacy CEPEA "Consultas ao Banco de Dados" full-history Excel
# (Chrome / Selenium / curl-cffi / calamine are LAZY-IMPORTED inside this path so
# a scheduled run never imports them.)
# ──────────────────────────────────────────────────────────────────────────────
def _chrome_major() -> int | None:
    """Best-effort detect installed Chrome major version (backfill only)."""
    import shutil
    import subprocess

    win_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for path in win_paths:
        if os.path.exists(path):
            try:
                out = subprocess.run(
                    ["powershell", "-NoProfile", "-Command",
                     f"(Get-Item '{path}').VersionInfo.ProductVersion"],
                    capture_output=True, text=True, timeout=20,
                ).stdout
                m = re.search(r"(\d+)\.\d+\.\d+", out)
                if m:
                    return int(m.group(1))
            except Exception:
                pass

    for path in (
        shutil.which("google-chrome"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        shutil.which("chrome"),
    ):
        if path and os.path.exists(path):
            try:
                out = subprocess.run(
                    [path, "--version"], capture_output=True, text=True, timeout=15
                ).stdout
                m = re.search(r"(\d+)\.\d+\.\d+", out)
                if m:
                    return int(m.group(1))
            except Exception:
                pass
    return None


def _clear_turnstile(driver, max_seconds: int = 75) -> bool:
    """Wait for the Cloudflare managed challenge to auto-clear (backfill only)."""
    deadline = time.time() + max_seconds
    while time.time() < deadline:
        time.sleep(3)
        title = (driver.title or "").lower()
        if "momento" not in title and "moment" not in title:
            return True
    return False


def _acquire_clearance() -> tuple[dict, str]:
    """Launch undetected-chromedriver, clear Turnstile, return (cookies, ua)."""
    import undetected_chromedriver as uc  # lazy — backfill only

    opts = uc.ChromeOptions()
    opts.add_argument("--window-size=1100,900")
    opts.add_argument("--lang=pt-BR")
    if os.environ.get("CEPEA_HEADLESS", "").lower() in ("1", "true", "yes"):
        opts.add_argument("--headless=new")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")

    major = _chrome_major()
    driver = uc.Chrome(options=opts, version_main=major)
    try:
        driver.get(INDICADOR_WARMUP_URL)
        if not _clear_turnstile(driver):
            driver.get(CONSULTAS_URL)
            _clear_turnstile(driver)
        driver.get(CONSULTAS_URL)
        _clear_turnstile(driver)
        cookies = {c["name"]: c["value"] for c in driver.get_cookies()}
        ua = driver.execute_script("return navigator.userAgent")
        if "cf_clearance" not in cookies:
            raise RuntimeError("Cloudflare clearance cookie not obtained")
        return cookies, ua
    finally:
        try:
            driver.quit()
        except Exception:
            pass


def _resolve_tabela_id(session, headers) -> int:
    """Resolve the CEPEA consultas `tabela_id` for the weekly anidro-SP indicator."""
    r = session.post(
        LISTAR_ESPEC_URL,
        data={"produto": ETANOL_PRODUTO_GROUP},
        impersonate="chrome",
        headers={**headers, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"},
        timeout=40,
    )
    r.raise_for_status()
    spec = json.loads(r.text)
    for item in spec:
        nome = (item.get("nome") or "").lower()
        per = str(item.get("periodicidade") or "")
        if "anidro" in nome and "são paulo" in nome and "semanal" in nome and "2" in per.split(","):
            return int(item["id"])
    for item in spec:
        nome = (item.get("nome") or "").lower()
        if "anidro" in nome and "paulo" in nome and "2" in str(item.get("periodicidade") or "").split(","):
            return int(item["id"])
    raise RuntimeError("Could not resolve anidro-SP weekly tabela_id from listar_especificacao")


def _generate_and_download_excel(session, headers, tabela_id: int, since: str) -> bytes:
    """Hit the consultas Excel-gen AJAX and download the resulting .xls bytes."""
    from urllib.parse import urlencode

    today = dt.date.today().strftime("%d/%m/%Y")
    params = {
        "tabela_id": str(tabela_id),
        "data_inicial": since,
        "periodicidade": PERIODICIDADE_WEEKLY,
        "data_final": today,
    }
    r = session.get(
        CONSULTAS_URL + "?" + urlencode(params),
        impersonate="chrome",
        headers={**headers, "X-Requested-With": "XMLHttpRequest",
                 "Accept": "application/json, text/javascript, */*; q=0.01"},
        timeout=120,
    )
    r.raise_for_status()
    payload = json.loads(r.text)
    if payload.get("tipo") != 1 or not payload.get("arquivo"):
        raise RuntimeError(f"Excel generation failed: {payload.get('mensagem', payload)}")
    arq = payload["arquivo"]
    if arq.startswith("/"):
        arq = "https://www.cepea.org.br" + arq
    elif not arq.startswith("http"):
        arq = "https://www.cepea.org.br/" + arq
    rx = session.get(arq, impersonate="chrome",
                     headers={"User-Agent": headers["User-Agent"], "Referer": CONSULTAS_URL},
                     timeout=120)
    rx.raise_for_status()
    if not rx.content[:4] == b"\xd0\xcf\x11\xe0":  # OLE2/BIFF magic
        raise RuntimeError("Downloaded file is not a CEPEA .xls workbook")
    return rx.content


def _parse_cepea_xls(content: bytes) -> list[dict]:
    """Parse the CEPEA BIFF workbook (Data | ANIDRO R$/LITRO | US$/LITRO)."""
    import tempfile

    from python_calamine import CalamineWorkbook  # lazy — backfill only

    with tempfile.NamedTemporaryFile(suffix=".xls", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        rows = CalamineWorkbook.from_path(tmp_path).get_sheet_by_index(0).to_python()
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    out: dict[str, dict] = {}
    for row in rows:
        if not row or len(row) < 2:
            continue
        date_cell = str(row[0]).strip()
        if not re.match(r"\d{2}/\d{2}/\d{4}$", date_cell):
            continue
        raw_val = str(row[1])
        val = _accept_value(raw_val, "backfill-xls")
        if val is None:
            continue
        rec = _to_record(date_cell, val)
        if rec:
            out[rec["data_semana"]] = rec  # dedupe by PK (Saturday)
    return list(out.values())


def fetch_backfill(since: str) -> list[dict]:
    """Legacy deep-history path (Chrome + Excel). LAZY: only entered by --backfill."""
    from curl_cffi import requests as creq  # lazy — backfill only

    print("[backfill] acquiring Cloudflare clearance via undetected-chromedriver…")
    cookies, ua = _acquire_clearance()
    print(f"[backfill] clearance OK (cookies: {', '.join(cookies)})")

    session = creq.Session()
    for k, v in cookies.items():
        session.cookies.set(k, v, domain=".cepea.org.br")
        session.cookies.set(k, v, domain=".cepea.esalq.usp.br")
    headers = {
        "User-Agent": ua,
        "Accept-Language": "pt-BR,pt;q=0.9",
        "Referer": CONSULTAS_URL,
    }

    tabela_id = _resolve_tabela_id(session, headers)
    print(f"[backfill] anidro-SP weekly tabela_id = {tabela_id}")
    content = _generate_and_download_excel(session, headers, tabela_id, since)
    print(f"[backfill] downloaded Excel: {len(content)} bytes")
    records = _parse_cepea_xls(content)
    print(f"[backfill] parsed {len(records)} weekly rows")
    return records


# ──────────────────────────────────────────────────────────────────────────────
# Cross-source agreement + staleness guards
# ──────────────────────────────────────────────────────────────────────────────
def _assert_agreement(primary: list[dict], other: list[dict]) -> None:
    """If two sources share a week, their R$/L must agree to 4 dp before upsert."""
    a = {r["data_semana"]: r["preco_rs_litro"] for r in primary}
    b = {r["data_semana"]: r["preco_rs_litro"] for r in other}
    for wk in a.keys() & b.keys():
        if round(a[wk], 4) != round(b[wk], 4):
            sys.exit(
                f"FATAL: cross-source disagreement for week {wk}: "
                f"{a[wk]} vs {b[wk]} — refusing to upsert."
            )
        print(f"[agreement] week {wk} matches across sources ({a[wk]})")


def _assert_fresh(records: list[dict]) -> None:
    """Loud failure if the freshest obtained week is older than STALE_AFTER_DAYS."""
    newest = max(dt.date.fromisoformat(r["data_semana"]) for r in records)
    age = (dt.date.today() - newest).days
    print(f"[staleness] newest week = {newest} (age {age} days)")
    if age > STALE_AFTER_DAYS:
        sys.exit(
            f"FATAL: freshest CEPEA week {newest} is {age} days old "
            f"(> {STALE_AFTER_DAYS}) — sources may be stale; not re-upserting."
        )


# ──────────────────────────────────────────────────────────────────────────────
# Upsert
# ──────────────────────────────────────────────────────────────────────────────
def upsert(records: list[dict]) -> None:
    from supabase import create_client

    url, key = _get_creds()
    sb = create_client(url, key)
    # dedupe by PK once more (defensive against ON CONFLICT double-update)
    dedup = {r["data_semana"]: r for r in records}
    payload = sorted(dedup.values(), key=lambda r: r["data_semana"])
    for i in range(0, len(payload), BATCH):
        chunk = payload[i:i + BATCH]
        sb.table(TABLE).upsert(chunk, on_conflict="data_semana").execute()
        print(f"[upsert] {i + len(chunk)}/{len(payload)}")

    res = sb.table(TABLE).select("data_semana", count="exact").execute()
    mn = (
        sb.table(TABLE).select("data_semana,week,preco_rs_litro")
        .order("data_semana").limit(1).execute().data
    )
    mx = (
        sb.table(TABLE).select("data_semana,week,preco_rs_litro")
        .order("data_semana", desc=True).limit(1).execute().data
    )
    print(f"[done] table rows={res.count} | oldest={mn} | newest={mx}")


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────
def _run_weekly() -> list[dict]:
    """widget (primary) -> NA HTML -> NA JSON, with cross-source agreement when both
    the widget and NA HTML succeed in the same run."""
    session = _new_session()

    widget_rows: list[dict] = []
    na_rows: list[dict] = []

    try:
        widget_rows = fetch_widget(session)
    except Exception as e:  # noqa: BLE001
        print(f"[widget] FAILED: {type(e).__name__}: {e}", file=sys.stderr)

    # Always attempt NA HTML too — it is cheap, patches missed weeks, and lets us
    # cross-check the widget's latest value.
    try:
        na_rows = fetch_na_html(session)
    except Exception as e:  # noqa: BLE001
        print(f"[na-html] FAILED: {type(e).__name__}: {e}", file=sys.stderr)

    if widget_rows and na_rows:
        _assert_agreement(widget_rows, na_rows)

    # Union widget + NA HTML (widget wins on shared weeks — official 4-dp source).
    if widget_rows or na_rows:
        merged: dict[str, dict] = {}
        for r in na_rows:
            merged[r["data_semana"]] = r
        for r in widget_rows:  # widget overrides NA on overlap
            merged[r["data_semana"]] = r
        return list(merged.values())

    # Last resort: NA JSON (latest week only).
    try:
        return fetch_na_json(session)
    except Exception as e:  # noqa: BLE001
        print(f"[na-json] FAILED: {type(e).__name__}: {e}", file=sys.stderr)
        return []


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Sync CEPEA weekly anhydrous-ethanol (SP) -> Supabase"
    )
    ap.add_argument(
        "--backfill", action="store_true",
        help="DEEP history via Chrome+Excel (NOT for CI; lazy-imports Selenium).",
    )
    ap.add_argument(
        "--since", default=DEFAULT_SINCE,
        help="start date dd/mm/yyyy (only used with --backfill)",
    )
    ap.add_argument(
        "--dry-run", action="store_true",
        help="fetch + run guards but DO NOT upsert (prints what would be written).",
    )
    args = ap.parse_args()

    if args.backfill:
        print("[main] --backfill: legacy Chrome + full-history Excel path")
        records = fetch_backfill(args.since)
    else:
        print("[main] weekly path: widget -> NA HTML -> NA JSON (browser-free)")
        records = _run_weekly()

    if not records:
        sys.exit("FATAL: zero rows from all CEPEA sources — aborting (no data).")

    # Guards that run for BOTH paths before any write.
    _assert_fresh(records)

    if args.dry_run:
        for r in sorted(records, key=lambda x: x["data_semana"])[-5:]:
            print(f"[dry-run] would upsert {r}")
        print(f"[dry-run] {len(records)} rows total — NOT writing.")
        return

    upsert(records)


if __name__ == "__main__":
    main()
