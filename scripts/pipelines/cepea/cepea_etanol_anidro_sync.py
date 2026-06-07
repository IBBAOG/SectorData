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
        week           text,             -- 'WW/IYYY' UNPADDED, e.g. '22/2026'
        preco_rs_litro numeric,          -- R$/L (à vista, SP)
        fonte          text DEFAULT 'CEPEA/ESALQ'
    )

CEPEA publishes the indicator's reference date as the week's Friday (occasionally
a Thursday/Wednesday on holiday weeks). We normalise each date to the Saturday of
its ISO week (`data_semana`) so the PK is stable regardless of the published
weekday, and derive `week` from that Saturday's ISO calendar.

================================================================================
HOW WE BYPASS CLOUDFLARE (the hard part)
================================================================================
Every CEPEA `*.aspx` / `*.php` page (indicator pages, the series pages, the
"Consultas ao Banco de Dados" tool and its JS/Excel handlers) sits behind a
**Cloudflare Turnstile managed challenge**. Plain `requests`, `curl_cffi`
(TLS-impersonation) and `cloudscraper` all get HTTP 403 "Just a moment…", and a
plain headless Selenium also fails. The ONLY CEPEA path that is whitelisted by
the WAF is the embed widget `widget*.js.php` — but that returns just the single
LATEST row, so it is useless for history.

The working method (PRIMARY):
  1. Launch **undetected-chromedriver** (headed) and load a CEPEA page. The
     Turnstile *managed* challenge auto-clears within ~10 s for a real,
     non-automation-flagged Chrome, issuing a valid `cf_clearance` cookie.
  2. Resolve the CEPEA "Consultas ao Banco de Dados" internal `tabela_id` for the
     anhydrous-SP weekly indicator via the AJAX helper:
        POST /br/indicador/listar_especificacao.aspx  body: produto=<etanol-group csv>
        -> JSON list; we pick the row whose name matches "Anidro ... São Paulo"
           and whose `periodicidade` advertises weekly (contains '2').
           (As of 2026-06 this is tabela_id = 131.)
  3. Generate the full-history Excel through the same endpoint the site's
     "Gerar Excel" button hits (re-using the cf_clearance cookie via curl_cffi):
        GET /br/consultas-ao-banco-de-dados-do-site.aspx
            ?tabela_id=<id>&periodicidade=2&data_inicial=dd/mm/yyyy&data_final=dd/mm/yyyy
        -> JSON {"tipo":1,"arquivo":"<.xls url>"}
  4. Download the `.xls` (a real BIFF/OLE2 workbook — parse with python-calamine;
     xlrd chokes on this CEPEA dialect) and upsert every weekly row.

This reaches back to **29/11/2002** (~1.2k weekly rows).

FALLBACK (forward-fill only): if the CEPEA path fails (Chrome/driver missing,
Turnstile not clearing in CI, endpoint change), we scrape the last ~10 weeks from
noticiasagricolas.com.br (which republishes the CEPEA indicator, ungated). This
keeps the series moving forward but cannot backfill deep history.

Zero rows from BOTH paths is a hard error (exit 1) — a silent empty is the real
bug we guard against.

Usage:
    python scripts/pipelines/cepea/cepea_etanol_anidro_sync.py
    python scripts/pipelines/cepea/cepea_etanol_anidro_sync.py --since 01/01/2002
    python scripts/pipelines/cepea/cepea_etanol_anidro_sync.py --fallback-only

Credentials: SUPABASE_URL + SUPABASE_SERVICE_KEY (env or repo-root .env).

Deps: undetected-chromedriver, selenium, curl_cffi, python-calamine, supabase,
      beautifulsoup4 (fallback). A Chrome/Chromium binary must be installed for
      the primary path.
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
CONSULTAS_URL = "https://www.cepea.org.br/br/consultas-ao-banco-de-dados-do-site.aspx"
LISTAR_ESPEC_URL = "https://www.cepea.org.br/br/indicador/listar_especificacao.aspx"
INDICADOR_WARMUP_URL = "https://www.cepea.esalq.usp.br/br/indicador/etanol.aspx"
# 'produto' value of the Etanol radio on the consultas form (group of indicator ids).
ETANOL_PRODUTO_GROUP = "15,16,51,52,53,54,55,56,57,58"
PERIODICIDADE_WEEKLY = "2"  # 1=Diário 2=Semanal 3=Mensal 4=Anual
DEFAULT_SINCE = "01/01/2002"  # CEPEA anidro series starts late 2002
SOURCE = "CEPEA/ESALQ"
TABLE = "cepea_etanol_anidro"
BATCH = 500

NA_FALLBACK_URL = (
    "https://www.noticiasagricolas.com.br/cotacoes/sucroenergetico/"
    "indicador-semanal-etanol-anidro-cepea-esalq"
)


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
# Helpers
# ──────────────────────────────────────────────────────────────────────────────
def _parse_brl(raw: str) -> float | None:
    """'2,5650' or '1.234,56' -> float. Returns None if not numeric."""
    raw = (raw or "").strip()
    if not raw:
        return None
    raw = raw.replace(".", "").replace(",", ".")
    try:
        return round(float(raw), 4)
    except ValueError:
        return None


def _to_record(date_ddmmyyyy: str, preco_rs_litro: float) -> dict | None:
    """Map a CEPEA reference date (Friday/Thu/Wed) + R$/L value to a table row.

    data_semana = Saturday of the date's ISO week; week = 'WW/IYYY' (unpadded).
    """
    try:
        d = dt.datetime.strptime(date_ddmmyyyy.strip(), "%d/%m/%Y").date()
    except ValueError:
        return None
    saturday = d + dt.timedelta(days=(5 - d.weekday()))  # Mon=0 .. Sat=5
    iso = saturday.isocalendar()
    return {
        "data_semana": saturday.isoformat(),
        "week": f"{iso[1]}/{iso[0]}",  # ISO week / ISO year, UNPADDED
        "preco_rs_litro": preco_rs_litro,
        "fonte": SOURCE,
    }


# ──────────────────────────────────────────────────────────────────────────────
# PRIMARY: CEPEA "Consultas ao Banco de Dados" full-history Excel
# ──────────────────────────────────────────────────────────────────────────────
def _chrome_major() -> int | None:
    """Best-effort detect installed Chrome major version.

    On Windows, `chrome.exe --version` writes nothing to stdout, so we read the
    binary's file version (PowerShell). On POSIX we fall back to `--version`.
    """
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
    """Wait for the Cloudflare managed challenge to auto-clear (title stops being
    'Um momento…' / 'Just a moment')."""
    deadline = time.time() + max_seconds
    while time.time() < deadline:
        time.sleep(3)
        title = (driver.title or "").lower()
        if "momento" not in title and "moment" not in title:
            return True
    return False


def _acquire_clearance() -> tuple[dict, str]:
    """Launch undetected-chromedriver, clear Turnstile, return (cookies, user_agent)."""
    import undetected_chromedriver as uc

    opts = uc.ChromeOptions()
    opts.add_argument("--window-size=1100,900")
    opts.add_argument("--lang=pt-BR")
    # In CI use the new headless; locally headed clears more reliably.
    if os.environ.get("CEPEA_HEADLESS", "").lower() in ("1", "true", "yes"):
        opts.add_argument("--headless=new")
        opts.add_argument("--no-sandbox")
        opts.add_argument("--disable-dev-shm-usage")

    major = _chrome_major()
    driver = uc.Chrome(options=opts, version_main=major)
    try:
        driver.get(INDICADOR_WARMUP_URL)
        if not _clear_turnstile(driver):
            # one retry on the consultas page directly
            driver.get(CONSULTAS_URL)
            _clear_turnstile(driver)
        # touch .org.br so clearance covers the consultas host too
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
    # fallback: any weekly anidro SP
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

    from python_calamine import CalamineWorkbook

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
        val = _parse_brl(str(row[1]))
        if val is None:
            continue
        rec = _to_record(date_cell, val)
        if rec:
            out[rec["data_semana"]] = rec  # dedupe by PK (Saturday)
    return list(out.values())


def fetch_primary(since: str) -> list[dict]:
    from curl_cffi import requests as creq

    print("[primary] acquiring Cloudflare clearance via undetected-chromedriver…")
    cookies, ua = _acquire_clearance()
    print(f"[primary] clearance OK (cookies: {', '.join(cookies)})")

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
    print(f"[primary] anidro-SP weekly tabela_id = {tabela_id}")
    content = _generate_and_download_excel(session, headers, tabela_id, since)
    print(f"[primary] downloaded Excel: {len(content)} bytes")
    records = _parse_cepea_xls(content)
    print(f"[primary] parsed {len(records)} weekly rows")
    return records


# ──────────────────────────────────────────────────────────────────────────────
# FALLBACK: noticiasagricolas (recent weeks only) — forward-fill
# ──────────────────────────────────────────────────────────────────────────────
def fetch_fallback() -> list[dict]:
    from curl_cffi import requests as creq

    print("[fallback] scraping noticiasagricolas (recent weeks)…")
    r = creq.get(NA_FALLBACK_URL, impersonate="chrome", timeout=30)
    r.raise_for_status()
    out: dict[str, dict] = {}
    for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", r.text, re.S):
        cells = [
            re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c)).strip()
            for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, re.S)
        ]
        cells = [c for c in cells if c]
        if len(cells) < 2:
            continue
        # first cell is a week range like "25 - 29/05/2026"; take the end date
        m = re.search(r"(\d{2}/\d{2}/\d{4})", cells[0])
        if not m:
            continue
        val = _parse_brl(cells[1])
        if val is None:
            continue
        rec = _to_record(m.group(1), val)
        if rec:
            out[rec["data_semana"]] = rec
    print(f"[fallback] parsed {len(out)} weekly rows")
    return list(out.values())


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
def main() -> None:
    ap = argparse.ArgumentParser(description="Sync CEPEA weekly anhydrous-ethanol (SP) -> Supabase")
    ap.add_argument("--since", default=DEFAULT_SINCE, help="start date dd/mm/yyyy (primary path)")
    ap.add_argument("--fallback-only", action="store_true", help="skip CEPEA, scrape NA only")
    args = ap.parse_args()

    records: list[dict] = []
    primary_err: Exception | None = None

    if not args.fallback_only:
        try:
            records = fetch_primary(args.since)
        except Exception as e:  # noqa: BLE001
            primary_err = e
            print(f"[primary] FAILED: {type(e).__name__}: {e}", file=sys.stderr)

    if not records:
        try:
            records = fetch_fallback()
            if primary_err and records:
                print("[warn] using forward-fill fallback ONLY (no deep history this run)",
                      file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"[fallback] FAILED: {type(e).__name__}: {e}", file=sys.stderr)

    if not records:
        sys.exit("FATAL: zero rows from CEPEA and from the fallback — aborting (no data).")

    upsert(records)


if __name__ == "__main__":
    main()
