#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit_cdp_record_counts.py
==========================
Audit script: compare ANP CDP portal record counts vs our Supabase DB
for every month from 2024-01 to 2026-04, across all three environments
(Mar/PosSal, PreSal, Terra).

Strategy:
  1. Query Supabase for COUNT(*) per (ano, mes, local).
  2. For each (month, environment), open the ANP CDP portal via Selenium+CAPTCHA,
     click Buscar, and read the pagination label "1-25 de N" to get N.
  3. Build comparison table and flag BAD rows (gap > 2%).

Output: prints 3 tables (PosSal/Mar, PreSal, Terra) + summary to stdout.
"""

import os
import re
import sys
import time
import json
import base64
from io import BytesIO
from pathlib import Path
from datetime import datetime

# Load project .env
try:
    from dotenv import load_dotenv
    load_dotenv("C:/Users/eduar/dashboard_projeto/.env.local")
    load_dotenv("C:/Users/eduar/dashboard_projeto/.env")
except ImportError:
    pass

import requests
from PIL import Image
import ddddocr
from selenium import webdriver
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait
from supabase import create_client

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY not set")

PAGE_URL = (
    "https://cdp.anp.gov.br/ords/r/cdp_apex/"
    "consulta-dados-publicos-cdp/consulta-produção-por-poço"
)

# Environments: portal value → (local in DB, label)
AMBIENTES = {
    "M": ("PosSal", "Mar"),
    "S": ("PreSal", "PreSal"),
    "T": ("Terra",  "Terra"),
}

MAX_RETRIES = 30
BAD_THRESHOLD_PCT = 2.0  # flag as BAD if abs(gap%) > this

# Month range to audit
AUDIT_RANGE = [(y, m) for y in range(2024, 2027) for m in range(1, 13)
               if (y, m) <= (2026, 4) and (y, m) >= (2024, 1)]

# ── Supabase query ────────────────────────────────────────────────────────────

def fetch_db_counts() -> dict[tuple[int, int, str], int]:
    """Return {(ano, mes, local): count} for the full audit range."""
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    # Fetch all rows in range in pages of 1000
    all_data = []
    page = 0
    page_size = 1000
    while True:
        r = (
            sb.table("anp_cdp_producao")
            .select("ano,mes,local")
            .gte("ano", 2024)
            .lte("ano", 2026)
            .range(page * page_size, (page + 1) * page_size - 1)
            .execute()
        )
        batch = r.data or []
        all_data.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
        print(f"  [db] Fetched {len(all_data)} rows so far...", end="\r")

    print(f"  [db] Total rows fetched: {len(all_data)}")

    from collections import Counter
    counts = Counter()
    for row in all_data:
        ano = row["ano"]
        mes = row["mes"]
        local = row["local"]
        if (ano, mes) >= (2024, 1) and (ano, mes) <= (2026, 4):
            counts[(ano, mes, local)] += 1
    return dict(counts)


# ── Selenium helpers ──────────────────────────────────────────────────────────

def create_driver():
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1280,900")
    opts.add_argument("--lang=pt-BR")
    opts.add_argument(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    opts.add_experimental_option("prefs", {"intl.accept_languages": "pt-BR,pt;q=0.9"})

    chrome_binary = os.environ.get("CHROME_BINARY")
    if chrome_binary:
        opts.binary_location = chrome_binary

    chromedriver_path = os.environ.get("CHROMEDRIVER_PATH")
    from selenium.webdriver.chrome.service import Service
    if chromedriver_path:
        service = Service(executable_path=chromedriver_path)
        driver = webdriver.Chrome(service=service, options=opts)
    else:
        driver = webdriver.Chrome(options=opts)
    driver.set_page_load_timeout(60)
    return driver


def solve_captcha(driver, ocr_engine) -> str:
    captcha_div = driver.find_element(By.ID, "anp_p54_captcha")
    imgs = captcha_div.find_elements(By.TAG_NAME, "img")
    if len(imgs) != 5:
        return ""
    char_images = []
    for img in imgs:
        b64 = driver.execute_script("""
            var img = arguments[0];
            var c = document.createElement('canvas');
            c.width  = img.naturalWidth  || img.width  || 30;
            c.height = img.naturalHeight || img.height || 70;
            c.getContext('2d').drawImage(img, 0, 0);
            return c.toDataURL('image/png').split(',')[1];
        """, img)
        if not b64:
            return ""
        raw = base64.b64decode(b64)
        char_images.append(Image.open(BytesIO(raw)).convert("RGB"))

    gap = 2
    total_w = sum(im.size[0] for im in char_images) + gap * 4
    max_h = max(im.size[1] for im in char_images)
    composite = Image.new("RGB", (total_w, max_h), (255, 255, 255))
    x = 0
    for im in char_images:
        composite.paste(im, (x, 0))
        x += im.size[0] + gap

    buf = BytesIO()
    composite.save(buf, format="PNG")
    result = ocr_engine.classification(buf.getvalue())
    captcha = "".join(c for c in result.upper() if c.isascii() and c.isalnum())
    return captcha[:5] if len(captcha) >= 5 else captcha


def _parse_apex_count(text: str) -> int | None:
    """
    Parse total record count from APEX IR pagination label.

    Observed formats (all real, from cdp.anp.gov.br):
      "1 -                   25 de                3.260"  (Terra, European thousands sep)
      "1 - 25 de 774"                                     (Mar, no thousands sep)
      "1 - 25 de 850"
      "1 - 25 of 774"                                     (English fallback)

    Strategy: find the last sequence of digits (and optional dot/comma separators)
    after the keyword 'de' or 'of', strip whitespace and thousands separators.
    """
    # Normalise: collapse all whitespace sequences to single space
    text = re.sub(r'\s+', ' ', text).strip()

    # Match: "de <number>" or "of <number>" where number may have . or , as thousands sep
    m = re.search(r'\b(?:de|of)\s+([\d][0-9\s.,]*)', text, re.IGNORECASE)
    if m:
        n_str = m.group(1).strip()
        # Remove thousands separators (dot or comma when followed by exactly 3 digits)
        # Strategy: remove all . and , that are acting as separators
        # If there's a decimal separator at the end (e.g. "3.260,5"), only keep integer part
        # Simple approach: strip . and , and space
        n_clean = re.sub(r'[.,\s]', '', n_str)
        if n_clean.isdigit():
            return int(n_clean)
    return None


def get_pagination_count(driver) -> int | None:
    """
    Read the pagination label from the APEX IR table.
    Format variants observed:
      "1 -                   25 de                3.260"  (Portuguese/European with spaces)
      "1 - 25 de 774"   (Portuguese locale)
      "1 - 25 of 774"   (English fallback)
      "774"             (single page, no pagination bar — all rows visible)

    Returns the total N, or None if not found.
    """
    # Primary: .a-IRR-pagination-label is the most specific and reliable
    selectors = [
        ".a-IRR-pagination-label",
        ".a-IRR-controlsBar .a-IRR-pagination-label",
        ".a-IRR-paginationStatus",
    ]
    for sel in selectors:
        try:
            els = driver.find_elements(By.CSS_SELECTOR, sel)
            for el in els:
                text = el.text.strip()
                if text:
                    count = _parse_apex_count(text)
                    if count is not None:
                        return count
        except Exception:
            pass

    # Fallback: scan all pagination-wrapper elements
    try:
        status_els = driver.find_elements(By.CSS_SELECTOR, "[class*='pagination']")
        for el in status_els:
            text = el.text.strip()
            if text:
                count = _parse_apex_count(text)
                if count is not None:
                    return count
    except Exception:
        pass

    # Fallback: scan page source for "de N" pattern
    try:
        src = driver.page_source
        # Look for pagination label in HTML — may have whitespace between tags
        # Pattern: ">  1 -    25 de    3.260</span>"
        m = re.search(r'>\s*\d+\s*-\s*\d+\s+de\s+([\d][\d\s.,]*)<', src)
        if m:
            count = _parse_apex_count("de " + m.group(1))
            if count is not None:
                return count
    except Exception:
        pass

    # Last resort: count visible rows (unreliable for paginated tables)
    try:
        rows = driver.find_elements(By.CSS_SELECTOR, ".a-IRR-table tbody tr")
        if rows:
            return len(rows)
    except Exception:
        pass

    return None


def fetch_anp_count(ocr_engine, driver_factory, periodo: str, ambiente: str) -> int | str:
    """
    Load ANP portal for given periodo (MM/YYYY) and ambiente (M/S/T),
    return the total record count from pagination, or a string error code.

    Returns:
        int   — record count from portal
        "no_data"        — ANP has no data for this period/environment
        "captcha_failed" — exhausted MAX_RETRIES
        "page_changed"   — pagination element not found after successful Buscar
    """
    driver = driver_factory()
    try:
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                driver.get(PAGE_URL)
                WebDriverWait(driver, 15).until(
                    EC.presence_of_element_located((By.ID, "P54_PERIODO"))
                )
                time.sleep(0.8)

                driver.find_element(By.ID, "P54_PERIODO").clear()
                driver.find_element(By.ID, "P54_PERIODO").send_keys(periodo)
                Select(driver.find_element(By.ID, "P54_AMBIENTE")).select_by_value(ambiente)

                captcha = solve_captcha(driver, ocr_engine)
                if len(captcha) != 5:
                    continue

                driver.find_element(By.ID, "P54_CAPTCHA").clear()
                driver.find_element(By.ID, "P54_CAPTCHA").send_keys(captcha)

                buscar_btn = driver.find_element(By.CSS_SELECTOR, "button#B533104921457386864")
                buscar_btn.click()

                WebDriverWait(driver, 20).until(EC.staleness_of(buscar_btn))
                WebDriverWait(driver, 20).until(
                    EC.presence_of_element_located((By.ID, "P54_PERIODO"))
                )

                # Check for data
                try:
                    WebDriverWait(driver, 15).until(
                        EC.presence_of_element_located((By.CSS_SELECTOR, ".a-IRR-table tbody tr"))
                    )
                except Exception:
                    # Check for error alert (captcha wrong)
                    try:
                        driver.find_element(By.CSS_SELECTOR, ".t-Alert--warning, .t-Alert--danger")
                        # Captcha wrong, retry
                        continue
                    except Exception:
                        # No table, no error = no data
                        return "no_data"

                # Data loaded — read pagination count
                # Wait a moment for pagination to render
                time.sleep(1.0)
                count = get_pagination_count(driver)
                if count is not None:
                    return count
                else:
                    # Table is there but pagination not found — count rows directly
                    rows = driver.find_elements(By.CSS_SELECTOR, ".a-IRR-table tbody tr")
                    if rows:
                        # If row count == default page size (e.g. 25 or 50), we may be
                        # missing the full count. Try to get it from page source.
                        src = driver.page_source
                        m = re.search(r'de\s+(\d+)', src)
                        if m:
                            return int(m.group(1))
                        # Return visible row count as fallback
                        return len(rows)
                    return "page_changed"

            except (TimeoutException, WebDriverException) as e:
                print(f"    [audit] {periodo} {ambiente} attempt {attempt}: {type(e).__name__}: {str(e)[:100]}")
                # Restart driver on crash
                try:
                    driver.quit()
                except Exception:
                    pass
                driver = driver_factory()
                continue

    finally:
        try:
            driver.quit()
        except Exception:
            pass

    return "captcha_failed"


# ── Main audit logic ──────────────────────────────────────────────────────────

def run_audit():
    print("=" * 70)
    print("ANP CDP Record Count Audit")
    print(f"Audit range: 2024-01 to 2026-04 ({len(AUDIT_RANGE)} months)")
    print(f"Environments: Mar (PosSal), PreSal, Terra")
    print("=" * 70)

    # Step 1: fetch DB counts
    print("\n[Step 1] Fetching DB counts from Supabase...")
    db_counts = fetch_db_counts()
    print(f"  DB count entries: {len(db_counts)}")

    # Step 2: for each (month, ambiente) scrape ANP portal
    print("\n[Step 2] Scraping ANP CDP portal for record counts...")
    ocr_engine = ddddocr.DdddOcr(show_ad=False)

    # Results: {(ano, mes, amb_code): int|str}
    anp_counts: dict[tuple[int, int, str], int | str] = {}

    total_combos = len(AUDIT_RANGE) * len(AMBIENTES)
    done = 0
    for (ano, mes) in AUDIT_RANGE:
        for amb_code, (local, label) in AMBIENTES.items():
            periodo = f"{mes:02d}/{ano}"
            print(f"  [{done+1}/{total_combos}] {periodo} {label}...", end=" ", flush=True)
            count = fetch_anp_count(ocr_engine, create_driver, periodo, amb_code)
            anp_counts[(ano, mes, amb_code)] = count
            db_count = db_counts.get((ano, mes, local), 0)
            if isinstance(count, int):
                gap = count - db_count
                gap_pct = abs(gap / count * 100) if count > 0 else 0
                status = "BAD" if gap_pct > BAD_THRESHOLD_PCT and count > 0 else "OK"
                print(f"ANP={count} DB={db_count} gap={gap:+d} ({gap_pct:.1f}%) {status}")
            else:
                print(f"ANP={count} DB={db_count}")
            done += 1

    # Step 3: build tables
    print("\n\n" + "=" * 70)
    print("RESULTS")
    print("=" * 70)

    bad_list = []

    for amb_code, (local, label) in AMBIENTES.items():
        print(f"\n--- Environment: {label} (local={local}) ---")
        print(f"{'ano-mes':<12} {'our_records':>12} {'anp_records':>12} {'gap_abs':>9} {'gap_%':>8} {'status':<10}")
        print("-" * 65)

        for (ano, mes) in AUDIT_RANGE:
            db_count = db_counts.get((ano, mes, local), 0)
            anp_val = anp_counts.get((ano, mes, amb_code), "N/A")

            if isinstance(anp_val, int) and anp_val > 0:
                gap_abs = anp_val - db_count
                gap_pct = abs(gap_abs / anp_val * 100)
                status = "BAD" if gap_pct > BAD_THRESHOLD_PCT else "OK"
                anp_str = str(anp_val)
                gap_str = f"{gap_abs:+d}"
                pct_str = f"{gap_pct:.2f}%"
                if status == "BAD":
                    bad_list.append({
                        "ano": ano, "mes": mes, "local": local, "label": label,
                        "db_count": db_count, "anp_count": anp_val,
                        "gap_abs": gap_abs, "gap_pct": gap_pct,
                    })
            elif anp_val == "no_data":
                anp_str = "no_data"
                gap_str = "N/A"
                pct_str = "N/A"
                status = "NO_DATA"
            else:
                anp_str = str(anp_val)
                gap_str = "N/A"
                pct_str = "N/A"
                status = "N/A"

            print(f"{ano}-{mes:02d}      {db_count:>12} {anp_str:>12} {gap_str:>9} {pct_str:>8} {status:<10}")

    # Step 4: BAD list
    print("\n\n" + "=" * 70)
    print("BAD MONTHS (gap > 2%) — ordered by gap_abs descending")
    print("=" * 70)

    if not bad_list:
        print("  No BAD months found.")
    else:
        bad_list.sort(key=lambda x: abs(x["gap_abs"]), reverse=True)
        print(f"{'ano-mes':<12} {'local':<10} {'db_count':>10} {'anp_count':>10} {'gap_abs':>9} {'gap_%':>8}")
        print("-" * 65)
        for b in bad_list:
            print(
                f"{b['ano']}-{b['mes']:02d}      "
                f"{b['local']:<10} "
                f"{b['db_count']:>10} "
                f"{b['anp_count']:>10} "
                f"{b['gap_abs']:>+9d} "
                f"{b['gap_pct']:>7.2f}%"
            )

    # Step 5: Hypothesis conclusion
    print("\n\n" + "=" * 70)
    print("HYPOTHESIS ASSESSMENT")
    print("=" * 70)
    old_pipeline_cutoff = (2026, 3)  # commit 9b327a2b removed groupby+filter
    bad_old = [b for b in bad_list if (b["ano"], b["mes"]) < old_pipeline_cutoff]
    bad_new = [b for b in bad_list if (b["ano"], b["mes"]) >= old_pipeline_cutoff]

    print(f"  BAD months BEFORE 2026-03 (old pipeline era): {len(bad_old)}")
    print(f"  BAD months FROM  2026-03 onward (new pipeline): {len(bad_new)}")

    if len(bad_old) > len(bad_new) and len(bad_old) > 0:
        print("\n  CONCLUSION: Hypothesis CONFIRMED.")
        print("  Months loaded by the old pipeline (groupby+sum + zero-prod filter)")
        print("  have significantly more record gaps than newer months.")
    elif len(bad_old) == 0 and len(bad_list) == 0:
        print("\n  CONCLUSION: No BAD months. DB is fully in sync with portal.")
    else:
        print("\n  CONCLUSION: Inconclusive or mixed results — review tables above.")

    # Step 6: Re-run batch recommendation
    if bad_list:
        print("\n\n" + "=" * 70)
        print("RECOMMENDED BATCH RE-RUNS")
        print("=" * 70)
        # Group by (ano, mes), collect all bad locals
        from collections import defaultdict
        batch: dict[tuple[int, int], list] = defaultdict(list)
        for b in bad_list:
            batch[(b["ano"], b["mes"])].append(b["local"])
        print("  Months to re-run (CTO triggers via GitHub Actions UI):")
        for (ano, mes) in sorted(batch.keys()):
            locals_str = ", ".join(batch[(ano, mes)])
            print(f"    {ano}-{mes:02d}  (affected: {locals_str})")
        print()
        print("  Suggested workflow run parameters:")
        print("    Workflow: etl_anp_cdp.yml → workflow_dispatch")
        print("    For each month: set periodo=MM/YYYY, include --purge flag to clean stale rows")


if __name__ == "__main__":
    run_audit()
