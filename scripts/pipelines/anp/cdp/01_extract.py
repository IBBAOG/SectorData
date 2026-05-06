#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
"""
Extração automática de dados de produção por poço — ANP/CDP.

Modos de operação:
  --capture    : Selenium + ddddocr resolve CAPTCHA uma vez, salva session.json
  --replay     : Usa session.json para baixar múltiplos períodos (Selenium como fallback)
  --replay-only: Como --replay mas sem fallback Selenium (falha se sessão expirar)
  (padrão)     : Selenium + ddddocr por período, com fast path se session.json existir

Fluxo recomendado:
  # 1. Capturar sessão (resolve CAPTCHA uma vez):
  python scripts/anp_auto.py --capture --periodo 01/2025 --output output/anp

  # 2. Baixar múltiplos períodos com a sessão salva:
  python scripts/anp_auto.py --replay --de 01/2023 --ate 12/2024 --output output/anp
"""

import argparse
import glob
import json
import os
import re
import shutil
import sys
import time
import urllib.parse
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path

import base64

import ddddocr
import requests
from PIL import Image
from selenium import webdriver
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select, WebDriverWait

# Replay module (pure requests — importável também pelo monitor de alertas)
# Use path-based import so this script works whether invoked from repo root or directly.
import importlib.util as _ilu
_replay_path = Path(__file__).parent / "_replay.py"
_spec = _ilu.spec_from_file_location("_replay", _replay_path)
_replay_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_replay_mod)
_build_requests_session = _replay_mod._build_requests_session
replay_download = _replay_mod.replay_download

# ─── Diagnostic helpers ──────────────────────────────────────────────────────

def _wait_for(driver, condition, timeout, label):
    """WebDriverWait wrapper that logs the failing selector/condition on timeout."""
    try:
        return WebDriverWait(driver, timeout).until(condition)
    except TimeoutException:
        print(f"    [timeout] Esperando: {label} ({timeout}s esgotado)")
        raise


def _dump_page_state(driver, output_dir, label, attempt):
    """Save current page HTML + log URL/title/body excerpt for post-mortem debug."""
    ts = time.strftime("%Y%m%d_%H%M%S")
    try:
        debug_dir = Path(output_dir) / "_debug"
        debug_dir.mkdir(parents=True, exist_ok=True)
        html_path = debug_dir / f"debug_{ts}_{label}_{attempt}.html"
        html_path.write_text(driver.page_source, encoding="utf-8")
        print(f"    [diag-state] HTML salvo: {html_path.name}")
    except Exception as html_exc:
        print(f"    [diag-state] Falha ao salvar HTML: {html_exc}")
    try:
        print(f"    [diag-state] URL: {driver.current_url}")
        print(f"    [diag-state] Title: {driver.title}")
    except Exception as nav_exc:
        print(f"    [diag-state] Falha ao ler URL/title: {nav_exc}")
    try:
        body_text = driver.find_element(By.TAG_NAME, "body").text[:500]
        print(f"    [diag-state] Body (500 chars): {body_text!r}")
    except Exception:
        pass


PAGE_URL = (
    "https://cdp.anp.gov.br/ords/r/cdp_apex/"
    "consulta-dados-publicos-cdp/consulta-produção-por-poço"
)
ORDS_BASE = "https://cdp.anp.gov.br/ords"
SESSION_FILENAME = "session.json"

AMBIENTES = {"M": "Mar", "S": "Pre-Sal", "T": "Terra"}
MAX_RETRIES = 10

# JS injected before triggering download to capture the exact APEX download mechanism.
# Intercepts form.submit(), fetch(), XHR, and window.location navigation.
_CAPTURE_JS = """
window._anpCapture = [];

// --- form.submit ---
if (!window._anpFormHooked) {
    window._anpFormHooked = true;
    var _origSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function() {
        try {
            var d = {__type__: 'form', __action__: this.action,
                     __method__: (this.method || 'POST').toUpperCase()};
            new FormData(this).forEach(function(v, k) { d[k] = v; });
            window._anpCapture.push(d);
        } catch(e) {}
        _origSubmit.call(this);
    };
}

// --- fetch ---
if (!window._anpFetchHooked) {
    window._anpFetchHooked = true;
    var _origFetch = window.fetch;
    window.fetch = function(url, opts) {
        try {
            window._anpCapture.push({
                __type__: 'fetch',
                url: String(url),
                method: (opts && opts.method) || 'GET',
                body: (opts && typeof opts.body === 'string') ? opts.body : ''
            });
        } catch(e) {}
        return _origFetch.apply(this, arguments);
    };
}

// --- XMLHttpRequest ---
if (!window._anpXHRHooked) {
    window._anpXHRHooked = true;
    var _origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        this._anpUrl    = String(url);
        this._anpMethod = String(method);
        return _origOpen.apply(this, arguments);
    };
    var _origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
        try {
            if (this._anpUrl) {
                window._anpCapture.push({
                    __type__: 'xhr',
                    url:      this._anpUrl,
                    method:   this._anpMethod,
                    body:     typeof body === 'string' ? body : ''
                });
            }
        } catch(e) {}
        return _origSend.apply(this, arguments);
    };
}
"""


# ─── Driver ──────────────────────────────────────────────────────────────────

def create_driver(download_dir):
    """Create headless Chrome WebDriver with download support."""
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1280,900")
    opts.add_argument(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    # Anti-bot: suppress automation fingerprint that APEX/Oracle may detect
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)

    # Force the Chrome binary installed by browser-actions/setup-chrome (CI env).
    # Avoids version mismatch when the system already has an older Chrome in PATH.
    # When running locally without CHROME_BINARY, Selenium uses its default resolution.
    chrome_binary = os.environ.get("CHROME_BINARY")
    if chrome_binary:
        opts.binary_location = chrome_binary
        print(f"  [config] Chrome binary forçado: {chrome_binary}")

    prefs = {
        "download.default_directory": str(Path(download_dir).resolve()),
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
    }
    opts.add_experimental_option("prefs", prefs)

    driver = webdriver.Chrome(options=opts)
    driver.set_page_load_timeout(60)
    driver.execute_cdp_cmd("Page.setDownloadBehavior", {
        "behavior": "allow",
        "downloadPath": str(Path(download_dir).resolve()),
    })
    return driver


# ─── CAPTCHA ─────────────────────────────────────────────────────────────────

def solve_captcha(driver, ocr_engine):
    """
    Fetch the 5 CAPTCHA character images using the browser's canvas API (JS),
    stitch them, and OCR the result.
    Using canvas.toDataURL() runs entirely inside the browser context —
    no extra HTTP request needed, so auth cookies/headers are never an issue.
    """
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
    # Restrict to ASCII alphanumeric only — ddddocr may return CJK chars that pass isalnum()
    captcha = "".join(c for c in result.upper() if c.isascii() and c.isalnum())
    return captcha[:5] if len(captcha) >= 5 else captcha


# ─── Utilities ───────────────────────────────────────────────────────────────

def wait_for_download(download_dir, timeout=60):
    """Poll download_dir until a complete CSV file appears."""
    start = time.time()
    while time.time() - start < timeout:
        csv_files = glob.glob(os.path.join(download_dir, "*.csv"))
        csv_files = [f for f in csv_files if not f.endswith(".crdownload")]
        if csv_files:
            return max(csv_files, key=os.path.getmtime)
        time.sleep(1)
    return None


def validate_csv(path):
    """Return number of data rows (excluding header), or 0 if empty/invalid."""
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            lines = [l for l in f if l.strip()]
        return max(0, len(lines) - 1)
    except Exception:
        return 0


def save_debug_screenshot(driver, output_dir, label):
    """Save a screenshot to _debug/ for post-mortem CI diagnostics."""
    try:
        debug_dir = os.path.join(output_dir, "_debug")
        os.makedirs(debug_dir, exist_ok=True)
        ts = time.strftime("%Y%m%d_%H%M%S")
        path = os.path.join(debug_dir, f"debug_{ts}_{label}.png")
        driver.save_screenshot(path)
        print(f"    [debug] {path}")
    except Exception as e:
        print(f"    [debug] screenshot failed: {e}")


# ─── Selenium page interactions ──────────────────────────────────────────────

def do_buscar(driver, ocr_engine, periodo, ambiente):
    """
    Navigate to the ANP page, fill the form, solve CAPTCHA, click Buscar,
    and wait for the IR table to load.
    Returns True on success.
    """
    driver.get(PAGE_URL)
    WebDriverWait(driver, 15).until(
        EC.presence_of_element_located((By.ID, "P54_PERIODO"))
    )
    time.sleep(1)

    driver.find_element(By.ID, "P54_PERIODO").clear()
    driver.find_element(By.ID, "P54_PERIODO").send_keys(periodo)
    Select(driver.find_element(By.ID, "P54_AMBIENTE")).select_by_value(ambiente)

    captcha = solve_captcha(driver, ocr_engine)
    print(f"    CAPTCHA: {captcha}")
    if len(captcha) != 5:
        print(f"    ✗ CAPTCHA inválido ({len(captcha)} chars)")
        return False

    driver.find_element(By.ID, "P54_CAPTCHA").clear()
    driver.find_element(By.ID, "P54_CAPTCHA").send_keys(captcha)

    buscar_btn = driver.find_element(By.CSS_SELECTOR, "button#B533104921457386864")
    buscar_btn.click()

    # Wait for DOM to be torn down (page submit) then reloaded
    WebDriverWait(driver, 20).until(EC.staleness_of(buscar_btn))
    WebDriverWait(driver, 20).until(
        EC.presence_of_element_located((By.ID, "P54_PERIODO"))
    )

    try:
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, ".a-IRR-table tbody tr"))
        )
        print(f"    OK Dados carregados")
        return True
    except Exception:
        try:
            driver.find_element(By.CSS_SELECTOR, ".t-Alert--warning, .t-Alert--danger")
            print(f"    FAIL CAPTCHA errado (alerta na pagina)")
        except Exception:
            print(f"    FAIL Sem dados apos Buscar")
        return False


def do_acoes_download(driver, output_dir=None, attempt=1):
    """
    Click the "Exportar p/ csv" button that the ANP/APEX UI now exposes directly
    (the previous Ações menu + dialog confirm flow was removed by ANP).

    Strategy C (hybrid): wait for button presence in DOM, then fire apex.submit()
    via JS — same code path as a human click.  Falls back to a direct Selenium
    .click() if the JS submit raises an exception.

    output_dir / attempt are used for _dump_page_state on TimeoutException.
    Returns True on success.
    """
    _EXPORTAR_XPATH = "//button[.//span[text()='Exportar p/ csv']]"

    # Wait for the "Exportar p/ csv" button to be present in the DOM (ensures the
    # APEX page state is ready before we fire the submit).
    try:
        _wait_for(
            driver,
            EC.presence_of_element_located((By.XPATH, _EXPORTAR_XPATH)),
            timeout=20,
            label="botão 'Exportar p/ csv' presente no DOM",
        )
    except TimeoutException:
        if output_dir:
            _dump_page_state(driver, output_dir, "exportar_btn_absent", attempt)
        raise

    # Primary path: fire apex.submit() via JS — identical to the onclick handler.
    try:
        driver.execute_script("apex.submit({request:'Exportar',validate:true});")
        return True
    except Exception as js_exc:
        print(f"    [export] apex.submit() falhou ({js_exc}), tentando click direto...")

    # Fallback: direct Selenium click on the button element.
    try:
        btn = _wait_for(
            driver,
            EC.element_to_be_clickable((By.XPATH, _EXPORTAR_XPATH)),
            timeout=10,
            label="botão 'Exportar p/ csv' clicável (fallback)",
        )
        btn.click()
        return True
    except TimeoutException:
        if output_dir:
            _dump_page_state(driver, output_dir, "exportar_btn_not_clickable", attempt)
        raise


# ─── Session capture ─────────────────────────────────────────────────────────

def _is_renderer_crash(exc):
    """Return True if the exception looks like a Chrome renderer crash/timeout."""
    msg = str(exc).lower()
    return (
        "renderer" in msg
        or "session deleted" in msg
        or "disconnected" in msg
        or "target window already closed" in msg
        or not str(exc).strip()
    )


def _diag_webdriver_exc(exc):
    """Print a structured diagnostic for WebDriver exceptions."""
    exc_type = type(exc).__name__
    msg = getattr(exc, "msg", None) or str(exc)
    print(f"    [diag] {exc_type}: {msg[:300] if msg else '(sem mensagem)'}")
    low = (msg or "").lower()
    if "chrome" in low or "chromedriver" in low or "driver" in low:
        print(f"    [diag] Possivel incompatibilidade Chrome/Chromedriver — verifique versoes no runner")
    if "#0 0x" in (msg or "") or "stacktrace" in low:
        print(f"    [diag] Stack trace nativa detectada — tipico de crash de renderer ou mismatch de driver")
    if "version" in low and ("does not support" in low or "compatible" in low or "detected" in low):
        print(f"    [diag] Mismatch de versao confirmado — Selenium Manager deveria ter resolvido isso")


def capture_session(ocr_engine, periodo, ambiente, output_dir, download_dir):
    """
    Run a full Selenium flow for one period/ambiente, intercept the APEX download
    form parameters via JavaScript, and save everything to session.json.

    The captured session is later used by try_fast_download() to replay requests
    for multiple periods without solving CAPTCHA again.

    Returns the path to the downloaded CSV on success, None on failure.
    """
    print(f"  Capturando sessão para {periodo} / {AMBIENTES[ambiente]}...")

    driver = create_driver(download_dir)
    try:
      for attempt in range(1, MAX_RETRIES + 1):
        print(f"    Tentativa {attempt}/{MAX_RETRIES}...")

        try:
            for f in glob.glob(os.path.join(download_dir, "*.csv")):
                os.remove(f)

            if not do_buscar(driver, ocr_engine, periodo, ambiente):
                save_debug_screenshot(driver, output_dir, f"cap_buscar_{attempt}")
                continue

            # Inject JS interceptor BEFORE triggering download.
            # The XHR is captured at send() time — before any file is downloaded.
            driver.execute_script(_CAPTURE_JS)

            do_acoes_download(driver, output_dir=output_dir, attempt=attempt)

            # Give the JS event loop a moment to fire the XHR interceptor
            time.sleep(2)

        except Exception as e:
            print(f"    ✗ Erro [{type(e).__name__}]: {str(e)[:200]}")
            if isinstance(e, TimeoutException):
                # Dump page state so the next run log shows exactly which wait failed
                _dump_page_state(driver, output_dir, "cap_timeout", attempt)
            elif isinstance(e, WebDriverException):
                _diag_webdriver_exc(e)
            save_debug_screenshot(driver, output_dir, f"cap_err_{attempt}")
            if _is_renderer_crash(e):
                print(f"    [driver] Chrome travou, reiniciando...")
                try:
                    driver.quit()
                except Exception:
                    pass
                driver = create_driver(download_dir)
            elif attempt < MAX_RETRIES:
                time.sleep(2)
            continue

        # ── Collect intercepted requests ─────────────────────────────────────
        # The XHR capture happens at send() time, so it's available immediately
        # after the button click — we do NOT need to wait for Chrome's file download.
        try:
            captured_list = driver.execute_script("return window._anpCapture || [];")
        except Exception:
            captured_list = []

        download_req = None
        for entry in reversed(captured_list):
            url = entry.get("url", "") or entry.get("__action__", "")
            if "wwv_flow" in url:
                download_req = entry
                break
        if not download_req and captured_list:
            download_req = captured_list[-1]

        if not download_req:
            print(f"    ✗ Nenhum request interceptado")
            save_debug_screenshot(driver, output_dir, f"cap_noreq_{attempt}")
            continue

        print(f"    [capture] {len(captured_list)} request(s) interceptados: "
              f"{[e.get('__type__', e.get('type','?')) for e in captured_list]}")
        url_preview = download_req.get("url", download_req.get("__action__", "?"))
        print(f"    [capture] download_req URL: {url_preview[:120]}")

        # Read APEX session identifiers from JS environment
        try:
            apex_env = driver.execute_script("""
                try {
                    return {
                        app_id:     String(apex.env.APP_ID),
                        page_id:    String(apex.env.APP_PAGE_ID),
                        p_instance: String(apex.env.APP_SESSION)
                    };
                } catch(e) { return {}; }
            """) or {}
            raw_cookies = driver.get_cookies()
        except Exception:
            apex_env = {}
            raw_cookies = []

        session = {
            "cookies":           {c["name"]: c["value"] for c in raw_cookies},
            "cookies_full":      raw_cookies,
            "apex_env":          apex_env,
            "base_url":          ORDS_BASE,
            "download_req":      download_req,
            "captured_at":       time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "captured_periodo":  periodo,
            "captured_ambiente": ambiente,
        }

        session_path = os.path.join(output_dir, SESSION_FILENAME)
        with open(session_path, "w") as f:
            json.dump(session, f, indent=2)

        print(f"    ✓ session.json salvo")
        print(f"      cookies : {list(session['cookies'].keys())}")
        print(f"      apex_env: {apex_env}")
        print(f"      mecanismo: {download_req.get('__type__', download_req.get('type','?'))}")

        # ── Get CSV via fast download (requests) — avoids Chrome download crash ──
        fname = f"producao_poco_{periodo.replace('/', '-')}_{ambiente}.csv"
        dest  = os.path.join(output_dir, fname)

        csv_path = try_fast_download(session, periodo, ambiente, download_dir)
        if csv_path:
            n_lines = validate_csv(csv_path)
            shutil.move(csv_path, dest)
            print(f"    ✓ {dest} ({os.path.getsize(dest)/1024:.1f} KB, {n_lines} linhas)")
            return dest

        # Fallback: wait for Chrome's own file download (may crash, but try once)
        print(f"    [capture] Fast download falhou, aguardando download do Chrome...")
        csv_path = wait_for_download(download_dir, timeout=30)
        if csv_path:
            n_lines = validate_csv(csv_path)
            if n_lines > 0:
                shutil.move(csv_path, dest)
                print(f"    ✓ {dest} ({os.path.getsize(dest)/1024:.1f} KB, {n_lines} linhas)")
                return dest
            os.remove(csv_path)

        print(f"    ✗ CSV não obtido, mas session.json foi salvo")
        return dest  # session is captured even without CSV

      print(f"    ✗ Captura falhou após {MAX_RETRIES} tentativas")
      return None
    finally:
        try:
            driver.quit()
        except Exception:
            pass


# ─── Fast replay (no CAPTCHA) ────────────────────────────────────────────────
# _build_requests_session and replay_download now live in _replay.py (imported above).
# try_fast_download is a thin shim kept for backward compat with capture_session().

def try_fast_download(session_data, periodo, ambiente, download_dir):
    """
    Thin shim around replay_download() for use inside capture_session().
    Returns path to downloaded CSV on success, None otherwise.
    (The full replay_download() is also directly available for external callers.)
    """
    result = replay_download(session_data, periodo, ambiente, os.path.dirname(download_dir))
    if result.status == "ok":
        return result.csv_path
    return None


# ─── Selenium extraction (fallback) ──────────────────────────────────────────

def extract_one_selenium(ocr_engine, periodo, ambiente, output_dir, download_dir):
    """Full Selenium + CAPTCHA extraction for one period/ambiente."""
    driver = create_driver(download_dir)
    try:
      for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"    [selenium] Tentativa {attempt}/{MAX_RETRIES}...")

            for f in glob.glob(os.path.join(download_dir, "*.csv")):
                os.remove(f)

            if not do_buscar(driver, ocr_engine, periodo, ambiente):
                save_debug_screenshot(
                    driver, output_dir,
                    f"{periodo.replace('/', '-')}_{ambiente}_buscar_{attempt}"
                )
                continue

            do_acoes_download(driver, output_dir=output_dir, attempt=attempt)

            print(f"    Aguardando download...")
            csv_path = wait_for_download(download_dir, timeout=30)
            if not csv_path:
                print(f"    ✗ Download não completou")
                save_debug_screenshot(
                    driver, output_dir,
                    f"{periodo.replace('/', '-')}_{ambiente}_nodl_{attempt}"
                )
                continue

            n_lines = validate_csv(csv_path)
            if n_lines == 0:
                print(f"    ✗ CSV vazio")
                os.remove(csv_path)
                continue

            fname = f"producao_poco_{periodo.replace('/', '-')}_{ambiente}.csv"
            dest = os.path.join(output_dir, fname)
            shutil.move(csv_path, dest)
            print(f"    ✓ {dest} ({os.path.getsize(dest)/1024:.1f} KB, {n_lines} linhas)")
            return True

        except Exception as e:
            print(f"    ✗ Erro [{type(e).__name__}]: {str(e)[:200]}")
            if isinstance(e, TimeoutException):
                _dump_page_state(driver, output_dir, f"{periodo.replace('/', '-')}_{ambiente}_timeout", attempt)
            elif isinstance(e, WebDriverException):
                _diag_webdriver_exc(e)
            save_debug_screenshot(
                driver, output_dir,
                f"{periodo.replace('/', '-')}_{ambiente}_err_{attempt}"
            )
            if _is_renderer_crash(e):
                print(f"    [driver] Chrome travou, reiniciando...")
                try:
                    driver.quit()
                except Exception:
                    pass
                driver = create_driver(download_dir)
            elif attempt < MAX_RETRIES:
                time.sleep(2)

      print(f"    ✗ Falhou após {MAX_RETRIES} tentativas")
      return False
    finally:
        try:
            driver.quit()
        except Exception:
            pass


# ─── Orchestrator ────────────────────────────────────────────────────────────

def extract_one(
    periodo, ambiente, output_dir, download_dir,
    session_data=None, ocr_engine=None, use_selenium=True,
):
    """
    Extract one period/ambiente combination.
    - Skips if the output file already exists with data.
    - Tries fast (no CAPTCHA) replay if session_data is available.
    - Falls back to Selenium (new driver per call) if fast fails and use_selenium=True.
    """
    fname = f"producao_poco_{periodo.replace('/', '-')}_{ambiente}.csv"
    dest = os.path.join(output_dir, fname)
    if os.path.exists(dest) and validate_csv(dest) > 0:
        n = validate_csv(dest)
        print(f"  → {periodo}  {AMBIENTES.get(ambiente, ambiente)}: já existe ({n} linhas), pulando")
        return True

    print(f"  → {periodo}  {AMBIENTES.get(ambiente, ambiente)} ({ambiente})")

    if session_data:
        print(f"    [fast] Tentando replay sem CAPTCHA...")
        replay_result = replay_download(session_data, periodo, ambiente, output_dir)
        if replay_result.status == "ok" and replay_result.csv_path:
            # replay_download already writes to output_dir/producao_poco_*.csv
            n_lines = validate_csv(replay_result.csv_path)
            print(f"    ✓ [fast] {replay_result.csv_path} ({os.path.getsize(replay_result.csv_path)/1024:.1f} KB, {n_lines} linhas)")
            return True
        if replay_result.status == "expired":
            print(f"    [fast] Sessão APEX expirada — usando Selenium+CAPTCHA para recapturar")
        else:
            print(f"    [fast] Falhou ({replay_result.message}) — usando Selenium+CAPTCHA")

    if not use_selenium or ocr_engine is None:
        print(f"    ✗ Sem driver Selenium e sessão expirou (--replay-only ativo)")
        return False

    return extract_one_selenium(ocr_engine, periodo, ambiente, output_dir, download_dir)


# ─── Session upload to Supabase ──────────────────────────────────────────────

def _upload_session_to_supabase(session_path: Path, periodo: str, ambiente: str):
    """Upsert session.json em alertas_session table (read by alertas/ at every 2h run)."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("[session-upload] SUPABASE_URL/SERVICE_KEY missing, skipping cloud sync")
        return

    try:
        from supabase import create_client
        sb = create_client(url, key)
        session_data = json.loads(Path(session_path).read_text())
        metadata = {
            "captured_periodo": periodo,
            "captured_ambiente": ambiente,
            "uploaded_at": datetime.utcnow().isoformat() + "Z",
        }
        sb.table("alertas_session").upsert({
            "base": "anp_cdp_producao_poco",
            "session": session_data,
            "captured_at": datetime.utcnow().isoformat() + "Z",
            # APEX session ~8h, set conservative 6h TTL
            "expires_at": (datetime.utcnow() + timedelta(hours=6)).isoformat() + "Z",
            "metadata": metadata,
        }, on_conflict="base").execute()
        print("[session-upload] alertas_session synced for base=anp_cdp_producao_poco")
    except Exception as e:
        print(f"[session-upload] ERRO ao sincronizar sessão: {e}")
        # Non-fatal: ETL continues even if session upload fails


# ─── CLI helpers ─────────────────────────────────────────────────────────────

def parse_periodo(s):
    m = re.match(r"^(\d{2})/(\d{4})$", s)
    if not m:
        raise argparse.ArgumentTypeError(f"Formato inválido: {s}. Use MM/YYYY")
    month, year = int(m.group(1)), int(m.group(2))
    if not 1 <= month <= 12:
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
            m, y = 1, y + 1
    return periodos


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Extrai dados de produção por poço da ANP/CDP",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--periodo", type=parse_periodo, help="Período único MM/YYYY")
    parser.add_argument("--de",      type=parse_periodo, help="Período inicial MM/YYYY")
    parser.add_argument("--ate",     type=parse_periodo, help="Período final MM/YYYY")
    parser.add_argument("--ambiente", default="todos",
                        help="M (Mar), S (Pre-Sal), T (Terra), todos (default: todos)")
    parser.add_argument("--output", default="output/anp", help="Diretório de saída")

    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--capture", action="store_true",
                      help="Resolver CAPTCHA via Selenium, salvar session.json")
    mode.add_argument("--replay", action="store_true",
                      help="Usar session.json com fallback Selenium")
    mode.add_argument("--replay-only", action="store_true",
                      help="Usar session.json sem fallback Selenium")

    args = parser.parse_args()

    # Validate period arguments
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

    session_path = os.path.join(args.output, SESSION_FILENAME)

    print("ANP/CDP — Produção por Poço")
    print(f"Períodos : {periodos[0]} a {periodos[-1]} ({len(periodos)} meses)")
    print(f"Ambientes: {', '.join(AMBIENTES[a] for a in ambientes)}")
    print(f"Saída    : {args.output}")
    print()

    # ── CAPTURE mode ──────────────────────────────────────────────────────────
    if args.capture:
        periodo_cap = periodos[0]
        ambiente_cap = ambientes[0]
        if len(periodos) > 1 or len(ambientes) > 1:
            print(f"AVISO: --capture usa apenas {periodo_cap}/{AMBIENTES[ambiente_cap]}")

        print(f"Modo: CAPTURA")
        ocr_engine = ddddocr.DdddOcr(show_ad=False)
        try:
            result = capture_session(
                ocr_engine, periodo_cap, ambiente_cap, args.output, download_dir
            )
        finally:
            shutil.rmtree(download_dir, ignore_errors=True)

        if result:
            # Upload captured session to Supabase so the alertas monitor can use it
            # without needing Selenium between monthly captures.
            _upload_session_to_supabase(
                Path(args.output) / SESSION_FILENAME,
                periodo_cap,
                ambiente_cap,
            )

        sys.exit(0 if result else 1)

    # ── REPLAY / DEFAULT mode ─────────────────────────────────────────────────
    session_data = None
    if os.path.exists(session_path):
        with open(session_path) as f:
            session_data = json.load(f)
        print(f"Sessão carregada: {session_path}")
        print(f"  capturada em: {session_data.get('captured_at', '?')}")
        print()
    elif args.replay or args.replay_only:
        print(f"ERRO: session.json não encontrado em {session_path}")
        print(f"Execute primeiro:")
        print(f"  python scripts/anp_auto.py --capture --periodo {periodos[0]} --output {args.output}")
        sys.exit(1)

    # OCR engine is shared across calls; driver is created fresh per Selenium extraction
    ocr_engine = None
    use_selenium = not args.replay_only
    if use_selenium:
        ocr_engine = ddddocr.DdddOcr(show_ad=False)

    try:
        total = len(periodos) * len(ambientes)
        ok = 0
        fail = 0

        for periodo in periodos:
            for ambiente in ambientes:
                if extract_one(
                    periodo, ambiente, args.output, download_dir,
                    session_data=session_data,
                    ocr_engine=ocr_engine,
                    use_selenium=use_selenium,
                ):
                    ok += 1
                else:
                    fail += 1

        print()
        print(f"Concluído: {ok}/{total} com sucesso, {fail} falhas")

    finally:
        shutil.rmtree(download_dir, ignore_errors=True)

    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
