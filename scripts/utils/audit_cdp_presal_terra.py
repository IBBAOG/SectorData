#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Spot-check PreSal and Terra environments on ANP CDP portal vs DB."""
import os, re, time, base64, sys
from io import BytesIO
from PIL import Image
import ddddocr
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

try:
    from dotenv import load_dotenv
    load_dotenv("C:/Users/eduar/dashboard_projeto/.env.local")
    load_dotenv("C:/Users/eduar/dashboard_projeto/.env")
except ImportError:
    pass

PAGE_URL = "https://cdp.anp.gov.br/ords/r/cdp_apex/consulta-dados-publicos-cdp/consulta-produção-por-poço"

opts = Options()
opts.add_argument("--headless=new")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--disable-gpu")
opts.add_argument("--window-size=1280,900")
opts.add_argument("--lang=pt-BR")
opts.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36")
opts.add_argument("--disable-blink-features=AutomationControlled")
opts.add_experimental_option("excludeSwitches", ["enable-automation"])
opts.add_experimental_option("useAutomationExtension", False)
opts.add_experimental_option("prefs", {"intl.accept_languages": "pt-BR,pt;q=0.9"})

ocr = ddddocr.DdddOcr(show_ad=False)


def make_driver():
    d = webdriver.Chrome(options=opts)
    d.set_page_load_timeout(60)
    return d


def solve_cap(d):
    try:
        div = d.find_element(By.ID, "anp_p54_captcha")
        imgs = div.find_elements(By.TAG_NAME, "img")
        if len(imgs) != 5:
            return ""
        chars = []
        for img in imgs:
            b64 = d.execute_script(
                "var i=arguments[0];var c=document.createElement('canvas');"
                "c.width=i.naturalWidth||30;c.height=i.naturalHeight||70;"
                "c.getContext('2d').drawImage(i,0,0);"
                "return c.toDataURL('image/png').split(',')[1];", img)
            if not b64:
                return ""
            chars.append(Image.open(BytesIO(base64.b64decode(b64))).convert("RGB"))
        gap = 2
        w = sum(im.size[0] for im in chars) + gap * 4
        h = max(im.size[1] for im in chars)
        comp = Image.new("RGB", (w, h), (255, 255, 255))
        x = 0
        for im in chars:
            comp.paste(im, (x, 0))
            x += im.size[0] + gap
        buf = BytesIO()
        comp.save(buf, format="PNG")
        r = ocr.classification(buf.getvalue())
        c2 = "".join(c for c in r.upper() if c.isascii() and c.isalnum())
        return c2[:5] if len(c2) >= 5 else c2
    except Exception:
        return ""


def parse_count(text):
    text = re.sub(r"\s+", " ", text).strip()
    m = re.search(r"\b(?:de|of)\s+([\d][0-9\s.,]*)", text, re.IGNORECASE)
    if m:
        n = re.sub(r"[.,\s]", "", m.group(1).strip())
        if n.isdigit():
            return int(n)
    return None


def get_count(d):
    try:
        for el in d.find_elements(By.CSS_SELECTOR, ".a-IRR-pagination-label"):
            t = el.text.strip()
            if t:
                c = parse_count(t)
                if c:
                    return c
    except Exception:
        pass
    try:
        src = d.page_source
        m = re.search(r">\s*\d+\s*-\s*\d+\s+de\s+([\d][\d\s.,]*)<", src)
        if m:
            c = parse_count("de " + m.group(1))
            if c:
                return c
    except Exception:
        pass
    return None


def fetch(periodo, amb):
    print(f"  {periodo} {amb}...", end=" ", flush=True)
    driver = make_driver()
    try:
        for attempt in range(1, 31):
            try:
                driver.get(PAGE_URL)
                WebDriverWait(driver, 20).until(
                    EC.presence_of_element_located((By.ID, "P54_PERIODO"))
                )
                time.sleep(0.8)
                driver.find_element(By.ID, "P54_PERIODO").clear()
                driver.find_element(By.ID, "P54_PERIODO").send_keys(periodo)
                Select(driver.find_element(By.ID, "P54_AMBIENTE")).select_by_value(amb)
                captcha = solve_cap(driver)
                if len(captcha) != 5:
                    continue
                driver.find_element(By.ID, "P54_CAPTCHA").clear()
                driver.find_element(By.ID, "P54_CAPTCHA").send_keys(captcha)
                b = driver.find_element(By.CSS_SELECTOR, "button#B533104921457386864")
                b.click()
                WebDriverWait(driver, 20).until(EC.staleness_of(b))
                WebDriverWait(driver, 20).until(
                    EC.presence_of_element_located((By.ID, "P54_PERIODO"))
                )
            except Exception:
                try:
                    driver.quit()
                except Exception:
                    pass
                driver = make_driver()
                continue
            try:
                WebDriverWait(driver, 15).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, ".a-IRR-table tbody tr"))
                )
            except Exception:
                try:
                    driver.find_element(By.CSS_SELECTOR, ".t-Alert--warning, .t-Alert--danger")
                    continue
                except Exception:
                    print("no_data")
                    return "no_data"
            time.sleep(1.5)
            c = get_count(driver)
            print(c, flush=True)
            return c
    finally:
        try:
            driver.quit()
        except Exception:
            pass
    print("captcha_failed")
    return "captcha_failed"


def compare_table(label, results, db_dict):
    print(f"\n=== {label} comparison ===")
    print(f"{'periodo':<10} {'DB':>10} {'ANP':>8} {'gap':>8} {'gap_%':>7} {'status':<6}")
    print("-" * 50)
    for p in sorted(results.keys()):
        anp = results[p]
        db = db_dict.get(p, "?")
        if isinstance(anp, int) and db != "?":
            gap = db - anp
            pct = gap / anp * 100
            status = "BAD" if abs(pct) > 2 else "OK"
            print(f"{p:<10} {db:>10} {anp:>8} {gap:>+8} {pct:>+6.1f}% {status}")
        else:
            print(f"{p:<10} {str(db):>10} {str(anp):>8}")


DB_PRESAL = {
    "01/2024": 353, "02/2024": 355, "03/2024": 366, "04/2024": 356,
    "05/2024": 353, "06/2024": 372, "07/2024": 366, "08/2024": 369,
    "09/2024": 375, "10/2024": 372, "11/2024": 380, "12/2024": 393,
    "01/2025": 388, "02/2025": 396, "03/2025": 379, "04/2025": 398,
    "05/2025": 391, "06/2025": 393, "07/2025": 411, "08/2025": 466,
    "09/2025": 452, "10/2025": 477, "11/2025": 475, "12/2025": 476,
    "01/2026": 472, "02/2026": 494, "03/2026": 509, "04/2026": 492,
}

DB_TERRA = {
    "01/2024": 6245, "02/2024": 6117, "03/2024": 6138, "04/2024": 6166,
    "05/2024": 6193, "06/2024": 6178, "07/2024": 6046, "08/2024": 6082,
    "09/2024": 6074, "10/2024": 6088, "11/2024": 6073, "12/2024": 6120,
    "01/2025": 6116, "02/2025": 6104, "03/2025": 6091, "04/2025": 6121,
    "05/2025": 6162, "06/2025": 6175, "07/2025": 6191, "08/2025": 6225,
    "09/2025": 6168, "10/2025": 6025, "11/2025": 5697, "12/2025": 5654,
    "01/2026": 5680, "02/2026": 5649, "03/2026": 5760, "04/2026": 3260,
}

PRESAL_TARGETS = [
    "01/2024", "06/2024", "12/2024",
    "03/2025", "06/2025", "09/2025", "12/2025",
    "01/2026", "02/2026", "03/2026", "04/2026",
]
TERRA_TARGETS = [
    "01/2024", "06/2024", "12/2024",
    "06/2025", "12/2025",
    "01/2026", "02/2026", "03/2026", "04/2026",
]

if __name__ == "__main__":
    print("=== PreSal spot-check ===")
    presal_results = {}
    for p in PRESAL_TARGETS:
        presal_results[p] = fetch(p, "S")

    print("\n=== Terra spot-check ===")
    terra_results = {}
    for p in TERRA_TARGETS:
        terra_results[p] = fetch(p, "T")

    compare_table("PreSal", presal_results, DB_PRESAL)
    compare_table("Terra", terra_results, DB_TERRA)
