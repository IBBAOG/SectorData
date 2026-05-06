import re
import sys
from pathlib import Path

from .base import BaseMonitor

_CHROME     = "C:/Program Files/Google/Chrome/Application/chrome.exe"
_URL_LISTA  = "https://sindicom.com.br/download-category/dados-do-setor/"
_URL_DL     = "https://sindicom.com.br/download/combustiveis/?wpdmdl=1043"


def _chrome_session():
    from playwright.sync_api import sync_playwright
    p       = sync_playwright().start()
    browser = p.chromium.launch(
        executable_path=_CHROME,
        headless=True,
        args=["--disable-blink-features=AutomationControlled"],
    )
    ctx = browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        locale="pt-BR",
        accept_downloads=True,
    )
    page = ctx.new_page()
    page.add_init_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
    )
    return p, browser, page


class Sindicom(BaseMonitor):
    slug = "sindicom"
    nome = "SINDICOM — Dados do Setor (Combustíveis)"
    url  = _URL_LISTA

    def verificar(self):
        p, browser, page = _chrome_session()
        try:
            page.goto(_URL_LISTA, timeout=30000, wait_until="load")
            # Detection signal: text next to combustiveis link, e.g. "até Março 2026"
            texto = page.inner_text("body")
            m     = re.search(r'at[eé]\s+\w+\s+\d{4}', texto, re.IGNORECASE)
            periodo = m.group(0) if m else page.title()
        finally:
            browser.close()
            p.stop()

        estado = self.ler_estado()
        if estado.get("ultimo_periodo") == periodo:
            return False, estado, ""

        return True, {"ultimo_periodo": periodo}, f"SINDICOM atualizado: {periodo}"

    def baixar(self, novo_estado):
        p, browser, page = _chrome_session()
        try:
            with page.expect_download(timeout=30000) as dl_info:
                try:
                    page.goto(_URL_DL, timeout=30000, wait_until="commit")
                except Exception as e:
                    if "Download is starting" not in str(e):
                        raise
            download = dl_info.value
            nome     = download.suggested_filename or "sindicom_combustiveis.xlsx"
            dest     = self.dados_dir / nome
            download.save_as(str(dest))
        finally:
            browser.close()
            p.stop()

        print(f"    OK {dest.name} ({dest.stat().st_size / 1024:.0f} KB)")
        return [str(dest)]
