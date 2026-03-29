#!/usr/bin/env python3
"""
Extração automática de dados de produção por poço — ANP/CDP.

Usa Selenium (Chrome headless) para executar JavaScript do site APEX +
ddddocr (rede neural offline) para resolver CAPTCHAs automaticamente.

Após Buscar com CAPTCHA correto, usa Ações → Fazer Download → CSV
(download nativo do Interactive Report, sem segundo CAPTCHA).

Uso:
    python scripts/anp_auto.py --periodo 01/2025 --ambiente M --output output/anp
    python scripts/anp_auto.py --de 01/2023 --ate 12/2024 --ambiente todos --output output/anp
"""

import argparse
import glob
import os
import re
import shutil
import sys
import time
from io import BytesIO
from pathlib import Path

import ddddocr
from PIL import Image
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

PAGE_URL = "https://cdp.anp.gov.br/ords/r/cdp_apex/consulta-dados-publicos-cdp/consulta-produção-por-poço"

AMBIENTES = {"M": "Mar", "S": "Pre-Sal", "T": "Terra"}
MAX_RETRIES = 10


def create_driver(download_dir):
    """Create Chrome WebDriver in headless mode."""
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1280,900")
    opts.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

    prefs = {
        "download.default_directory": str(Path(download_dir).resolve()),
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
    }
    opts.add_experimental_option("prefs", prefs)

    driver = webdriver.Chrome(options=opts)
    driver.set_page_load_timeout(60)

    # Enable downloads in headless mode
    driver.execute_cdp_cmd("Page.setDownloadBehavior", {
        "behavior": "allow",
        "downloadPath": str(Path(download_dir).resolve()),
    })

    return driver


def solve_captcha(driver, ocr_engine):
    """Read the 5 CAPTCHA char images from the page and OCR them."""
    captcha_div = driver.find_element(By.ID, "anp_p54_captcha")
    imgs = captcha_div.find_elements(By.TAG_NAME, "img")

    if len(imgs) != 5:
        return ""

    # Get each image as PNG bytes via screenshot
    char_images = []
    for img in imgs:
        png_bytes = img.screenshot_as_png
        char_images.append(Image.open(BytesIO(png_bytes)))

    # Stitch into composite
    gap = 2
    total_w = sum(im.size[0] for im in char_images) + gap * 4
    max_h = max(im.size[1] for im in char_images)
    composite = Image.new("RGB", (total_w, max_h), (255, 255, 255))
    x = 0
    for im in char_images:
        composite.paste(im.convert("RGB"), (x, 0))
        x += im.size[0] + gap

    buf = BytesIO()
    composite.save(buf, format="PNG")
    result = ocr_engine.classification(buf.getvalue())
    captcha = "".join(c for c in result.upper() if c.isalnum())
    return captcha[:5] if len(captcha) >= 5 else captcha


def wait_for_download(download_dir, timeout=60):
    """Wait for a CSV file to appear in download_dir."""
    start = time.time()
    while time.time() - start < timeout:
        csv_files = glob.glob(os.path.join(download_dir, "*.csv"))
        # Exclude .crdownload (partial downloads)
        csv_files = [f for f in csv_files if not f.endswith(".crdownload")]
        if csv_files:
            # Return the newest file
            return max(csv_files, key=os.path.getmtime)
        time.sleep(1)
    return None


def extract_one(driver, ocr_engine, periodo, ambiente, output_dir, download_dir):
    """Extract data for one periodo/ambiente combination."""
    amb_nome = AMBIENTES.get(ambiente, ambiente)
    print(f"  → Período {periodo}, Ambiente {amb_nome} ({ambiente})")

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"    Tentativa {attempt}/{MAX_RETRIES}...")

            # Clear download dir
            for f in glob.glob(os.path.join(download_dir, "*.csv")):
                os.remove(f)

            # Navigate to page
            driver.get(PAGE_URL)
            WebDriverWait(driver, 15).until(
                EC.presence_of_element_located((By.ID, "P54_PERIODO"))
            )
            time.sleep(1)

            # Fill form
            periodo_input = driver.find_element(By.ID, "P54_PERIODO")
            periodo_input.clear()
            periodo_input.send_keys(periodo)

            ambiente_select = Select(driver.find_element(By.ID, "P54_AMBIENTE"))
            ambiente_select.select_by_value(ambiente)

            # Solve CAPTCHA
            captcha = solve_captcha(driver, ocr_engine)
            print(f"    CAPTCHA: {captcha}")

            if len(captcha) != 5:
                print(f"    ✗ CAPTCHA com {len(captcha)} chars")
                continue

            captcha_input = driver.find_element(By.ID, "P54_CAPTCHA")
            captcha_input.clear()
            captcha_input.send_keys(captcha)

            # Click Buscar
            buscar_btn = driver.find_element(By.CSS_SELECTOR, "button#B533104921457386864")
            buscar_btn.click()

            # Wait for page to load after submit
            WebDriverWait(driver, 20).until(
                EC.presence_of_element_located((By.ID, "P54_PERIODO"))
            )
            time.sleep(2)

            # Check if data loaded — look for IR table rows
            try:
                WebDriverWait(driver, 5).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, ".a-IRR-table tbody tr"))
                )
                print(f"    ✓ Dados carregados!")
            except Exception:
                # Check for error alert
                try:
                    alert = driver.find_element(By.CSS_SELECTOR, ".t-Alert--warning, .t-Alert--danger")
                    print(f"    ✗ CAPTCHA errado (erro na página)")
                except Exception:
                    print(f"    ✗ Sem dados (CAPTCHA provavelmente errado)")
                continue

            # Click Ações → Fazer Download
            acoes_btn = driver.find_element(By.CSS_SELECTOR, ".a-IRR-button--actions")
            acoes_btn.click()
            time.sleep(1)

            download_menu = WebDriverWait(driver, 5).until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, "[data-action='ir-download']"))
            )
            download_menu.click()
            time.sleep(1)

            # In dialog: CSV should be pre-selected, click Fazer Download
            download_btn = WebDriverWait(driver, 5).until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, ".ui-dialog-buttonset button.a-Button--hot"))
            )
            download_btn.click()

            # Wait for CSV file
            print(f"    Aguardando download...")
            csv_path = wait_for_download(download_dir, timeout=30)

            if not csv_path:
                print(f"    ✗ Download não completou")
                continue

            # Validate CSV has data
            with open(csv_path, "r", encoding="utf-8", errors="ignore") as f:
                lines = [l for l in f if l.strip()]

            if len(lines) <= 1:
                print(f"    ✗ CSV vazio")
                os.remove(csv_path)
                continue

            # Move to output
            fname = f"producao_poco_{periodo.replace('/', '-')}_{ambiente}.csv"
            dest = os.path.join(output_dir, fname)
            shutil.move(csv_path, dest)
            size_kb = os.path.getsize(dest) / 1024
            print(f"    ✓ Salvo: {dest} ({size_kb:.1f} KB, {len(lines)-1} linhas)")
            return True

        except Exception as e:
            print(f"    ✗ Erro: {e}")
            if attempt < MAX_RETRIES:
                time.sleep(2)

    print(f"    ✗ Falhou após {MAX_RETRIES} tentativas")
    return False


def parse_periodo(s):
    m = re.match(r"^(\d{2})/(\d{4})$", s)
    if not m:
        raise argparse.ArgumentTypeError(f"Formato inválido: {s}. Use MM/YYYY")
    month, year = int(m.group(1)), int(m.group(2))
    if month < 1 or month > 12:
        raise argparse.ArgumentTypeError(f"Mês inválido: {month}")
    if year < 2023:
        raise argparse.ArgumentTypeError("Dados disponíveis a partir de 01/2023")
    return s


def generate_periodos(de, ate):
    d_m, d_y = int(de[:2]), int(de[3:])
    a_m, a_y = int(ate[:2]), int(ate[3:])
    periodos = []
    y, m = d_y, d_m
    while (y, m) <= (a_y, a_m):
        periodos.append(f"{m:02d}/{y}")
        m += 1
        if m > 12:
            m = 1
            y += 1
    return periodos


def main():
    parser = argparse.ArgumentParser(description="Extrai dados de produção por poço da ANP/CDP")
    parser.add_argument("--periodo", type=parse_periodo, help="Período único MM/YYYY")
    parser.add_argument("--de", type=parse_periodo, help="Período inicial MM/YYYY (lote)")
    parser.add_argument("--ate", type=parse_periodo, help="Período final MM/YYYY (lote)")
    parser.add_argument("--ambiente", default="todos",
                        help="M (Mar), S (Pre-Sal), T (Terra), ou 'todos' (default: todos)")
    parser.add_argument("--output", default="output/anp", help="Diretório de saída")
    args = parser.parse_args()

    if args.periodo and (args.de or args.ate):
        parser.error("Use --periodo OU --de/--ate, não ambos")
    if not args.periodo and not args.de:
        parser.error("Informe --periodo ou --de/--ate")
    if args.de and not args.ate:
        args.ate = args.de
    if args.ate and not args.de:
        args.de = args.ate

    periodos = [args.periodo] if args.periodo else generate_periodos(args.de, args.ate)

    if args.ambiente.lower() == "todos":
        ambientes = list(AMBIENTES.keys())
    else:
        amb = args.ambiente.upper()
        if amb not in AMBIENTES:
            parser.error(f"Ambiente inválido: {amb}. Use M, S, T ou todos")
        ambientes = [amb]

    os.makedirs(args.output, exist_ok=True)
    download_dir = os.path.join(args.output, "_downloads")
    os.makedirs(download_dir, exist_ok=True)

    print("ANP/CDP — Produção por Poço")
    print(f"Períodos: {periodos[0]} a {periodos[-1]} ({len(periodos)} meses)")
    print(f"Ambientes: {', '.join(AMBIENTES[a] for a in ambientes)}")
    print(f"Saída: {args.output}")
    print()

    # Initialize
    ocr_engine = ddddocr.DdddOcr(show_ad=False)
    driver = create_driver(download_dir)

    try:
        total = len(periodos) * len(ambientes)
        ok = 0
        fail = 0

        for periodo in periodos:
            for ambiente in ambientes:
                if extract_one(driver, ocr_engine, periodo, ambiente, args.output, download_dir):
                    ok += 1
                else:
                    fail += 1

        print()
        print(f"Concluído: {ok}/{total} extrações com sucesso, {fail} falhas")

    finally:
        driver.quit()
        # Clean up download dir
        shutil.rmtree(download_dir, ignore_errors=True)

    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
