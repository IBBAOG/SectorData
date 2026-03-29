#!/usr/bin/env python3
"""
Extração automática de dados de produção por poço — ANP/CDP.

Resolve CAPTCHA via Tesseract OCR (offline, gratuito).
Uso:
    python scripts/anp_auto.py --periodo 01/2025 --ambiente M --output output/anp
    python scripts/anp_auto.py --de 01/2023 --ate 12/2024 --ambiente todos --output output/anp
"""

import argparse
import os
import re
import sys
import time
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path

import pytesseract
import requests
from bs4 import BeautifulSoup
from PIL import Image, ImageFilter, ImageOps

BASE_URL = "https://cdp.anp.gov.br"
PAGE_URL = f"{BASE_URL}/ords/r/cdp_apex/consulta-dados-publicos-cdp/consulta-produção-por-poço"
FLOW_ACCEPT = f"{BASE_URL}/ords/wwv_flow.accept"
FLOW_SHOW = f"{BASE_URL}/ords/wwv_flow.show"
FLOW_ID = "117"
STEP_ID = "54"

AMBIENTES = {"M": "M", "S": "S", "T": "T"}
AMBIENTE_NOMES = {"M": "Mar", "S": "Pre-Sal", "T": "Terra"}
MAX_RETRIES = 5


def get_session(http: requests.Session):
    """Abre a página e extrai p_instance, p_page_submission_id e plugin token."""
    resp = http.get(PAGE_URL, timeout=60)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    p_instance = None
    p_page_submission_id = None
    plugin_token = None

    # p_instance from hidden input or URL
    inp = soup.find("input", {"name": "p_instance"})
    if inp:
        p_instance = inp["value"]
    else:
        m = re.search(r"p_instance[=:](\d+)", resp.text)
        if m:
            p_instance = m.group(1)

    # p_page_submission_id
    inp = soup.find("input", {"name": "p_page_submission_id"})
    if inp:
        p_page_submission_id = inp["value"]

    # Plugin token (p_request value for captcha image calls)
    m = re.search(r"p_request[=:]([A-Z0-9_]+PLUGIN[A-Z0-9_]*)", resp.text, re.IGNORECASE)
    if m:
        plugin_token = m.group(1)
    else:
        # Fallback: look for PLUGIN= pattern in script tags
        for script in soup.find_all("script"):
            txt = script.string or ""
            m2 = re.search(r'"p_request"\s*:\s*"([^"]*PLUGIN[^"]*)"', txt, re.IGNORECASE)
            if m2:
                plugin_token = m2.group(1)
                break
            m2 = re.search(r'p_request=([A-Z0-9_]+PLUGIN[A-Z0-9_]*)', txt, re.IGNORECASE)
            if m2:
                plugin_token = m2.group(1)
                break

    if not p_instance:
        raise RuntimeError("Não foi possível extrair p_instance da página")

    return p_instance, p_page_submission_id, plugin_token


def solve_captcha(http: requests.Session, p_instance: str, plugin_token: str):
    """Baixa as 5 imagens do CAPTCHA e resolve via Tesseract OCR."""
    captcha = ""
    ts = int(time.time() * 1000)

    for i in range(1, 6):
        url = (
            f"{FLOW_SHOW}?p_flow_id={FLOW_ID}&p_flow_step_id={STEP_ID}"
            f"&p_instance={p_instance}&x01=show_image&x02={i}"
            f"&p_request={plugin_token}&time={ts + i}"
        )
        resp = http.get(url, timeout=30)
        resp.raise_for_status()

        img = Image.open(BytesIO(resp.content))

        # Pre-process
        img = img.convert("L")  # grayscale
        w, h = img.size
        img = img.resize((w * 6, h * 6), Image.LANCZOS)
        img = img.point(lambda p: 255 if p > 140 else 0)  # binarize

        # Invert if background is dark (more black pixels than white)
        pixels = list(img.getdata())
        if sum(1 for p in pixels if p == 0) > len(pixels) // 2:
            img = ImageOps.invert(img)

        img = img.filter(ImageFilter.MedianFilter(3))

        char = pytesseract.image_to_string(
            img,
            config="--psm 10 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        ).strip()

        if char:
            captcha += char[0]
        else:
            captcha += "X"  # placeholder if OCR fails

    return captcha


def submit_busca(http, p_instance, p_page_submission_id, periodo, ambiente, captcha):
    """POST p_request=Buscar para validar CAPTCHA e filtrar dados."""
    today = datetime.utcnow().strftime("%d/%m/%Y")
    payload = {
        "p_flow_id": FLOW_ID,
        "p_flow_step_id": STEP_ID,
        "p_instance": p_instance,
        "p_page_submission_id": p_page_submission_id or "",
        "p_request": "Buscar",
        "p_reload_on_submit": "A",
        "P54_PERIODO": periodo,
        "P54_AMBIENTE": ambiente,
        "P54_CAPTCHA": captcha,
        "p_accept_processing": "25",
        "P54_NOME_ARQUIVO": "",
        "P54_DATA_ULTIMA_ATUALIZACAO": today,
        "P54_STATUS_CONSULTA": "1",
    }
    context_path = f"consulta-dados-publicos-cdp/consulta-produção-por-poço/{p_instance}"
    url = f"{FLOW_ACCEPT}?p_context={context_path}"
    resp = http.post(url, data=payload, timeout=120)
    resp.raise_for_status()
    return resp


def export_csv(http, p_instance, p_page_submission_id, periodo, ambiente):
    """POST p_request=Exportar para baixar o CSV completo."""
    today = datetime.utcnow().strftime("%d/%m/%Y")
    payload = {
        "p_flow_id": FLOW_ID,
        "p_flow_step_id": STEP_ID,
        "p_instance": p_instance,
        "p_page_submission_id": p_page_submission_id or "",
        "p_request": "Exportar",
        "p_reload_on_submit": "A",
        "P54_PERIODO": periodo,
        "P54_AMBIENTE": ambiente,
        "p_accept_processing": "25",
        "P54_NOME_ARQUIVO": "",
        "P54_DATA_ULTIMA_ATUALIZACAO": today,
        "P54_STATUS_CONSULTA": "1",
    }
    context_path = f"consulta-dados-publicos-cdp/consulta-produção-por-poço/{p_instance}"
    url = f"{FLOW_ACCEPT}?p_context={context_path}"
    resp = http.post(url, data=payload, timeout=300, stream=True)
    resp.raise_for_status()
    return resp


def extract_one(http, periodo, ambiente, output_dir, reuse_session=None):
    """Extrai dados para um período/ambiente. Retorna (session_info, success)."""
    amb_nome = AMBIENTE_NOMES.get(ambiente, ambiente)
    print(f"  → Período {periodo}, Ambiente {amb_nome} ({ambiente})")

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            if reuse_session and attempt == 1:
                p_instance, p_page_sub, plugin_token = reuse_session
                print(f"    Reutilizando sessão {p_instance}")
            else:
                # New session for each retry
                session = requests.Session()
                session.headers.update({
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                })
                http = session
                print(f"    Tentativa {attempt}/{MAX_RETRIES} — nova sessão...")
                p_instance, p_page_sub, plugin_token = get_session(http)
                print(f"    p_instance={p_instance}")

            if not reuse_session or attempt > 1:
                # Need to solve CAPTCHA for new sessions
                if not plugin_token:
                    print("    ⚠ Plugin token não encontrado, tentando sem CAPTCHA...")
                    captcha = ""
                else:
                    captcha = solve_captcha(http, p_instance, plugin_token)
                    print(f"    CAPTCHA resolvido: {captcha}")

                resp = submit_busca(http, p_instance, p_page_sub, periodo, ambiente, captcha)

                # Check if captcha failed (page reloaded with error)
                if "CAPTCHA" in resp.text.upper() and "INCORRETO" in resp.text.upper():
                    print(f"    ✗ CAPTCHA incorreto (tentativa {attempt})")
                    reuse_session = None
                    continue
                if "P54_CAPTCHA" in resp.text and attempt < MAX_RETRIES:
                    # Page still showing captcha field = likely failed
                    soup = BeautifulSoup(resp.text, "lxml")
                    err = soup.find(class_="t-Alert--danger") or soup.find(class_="apex-error")
                    if err:
                        print(f"    ✗ Erro: {err.get_text(strip=True)[:100]}")
                        reuse_session = None
                        continue

            # Export CSV
            resp = export_csv(http, p_instance, p_page_sub, periodo, ambiente)

            content_type = resp.headers.get("Content-Type", "")
            if "text/csv" in content_type or "application/octet" in content_type or "text/plain" in content_type:
                fname = f"producao_poco_{periodo.replace('/', '-')}_{ambiente}.csv"
                fpath = Path(output_dir) / fname
                with open(fpath, "wb") as f:
                    for chunk in resp.iter_content(8192):
                        f.write(chunk)
                size_kb = fpath.stat().st_size / 1024
                print(f"    ✓ Salvo: {fpath} ({size_kb:.0f} KB)")
                return (p_instance, p_page_sub, plugin_token), True

            # If HTML returned, captcha likely failed
            if "text/html" in content_type:
                print(f"    ✗ Exportação retornou HTML (CAPTCHA pode ter falhado)")
                reuse_session = None
                continue

            # Unknown content type — save anyway
            fname = f"producao_poco_{periodo.replace('/', '-')}_{ambiente}.csv"
            fpath = Path(output_dir) / fname
            with open(fpath, "wb") as f:
                for chunk in resp.iter_content(8192):
                    f.write(chunk)
            print(f"    ? Salvo com content-type desconhecido: {content_type}")
            return (p_instance, p_page_sub, plugin_token), True

        except Exception as e:
            print(f"    ✗ Erro na tentativa {attempt}: {e}")
            reuse_session = None
            if attempt < MAX_RETRIES:
                time.sleep(2)

    print(f"    ✗ Falhou após {MAX_RETRIES} tentativas")
    return None, False


def parse_periodo(s):
    """Valida formato MM/YYYY."""
    m = re.match(r"^(\d{2})/(\d{4})$", s)
    if not m:
        raise argparse.ArgumentTypeError(f"Formato inválido: {s}. Use MM/YYYY")
    month, year = int(m.group(1)), int(m.group(2))
    if month < 1 or month > 12:
        raise argparse.ArgumentTypeError(f"Mês inválido: {month}")
    if year < 2023:
        raise argparse.ArgumentTypeError(f"Dados disponíveis a partir de 01/2023")
    return s


def generate_periodos(de, ate):
    """Gera lista de MM/YYYY entre de e ate (inclusive)."""
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
    parser.add_argument(
        "--ambiente",
        default="todos",
        help="Ambiente: M (Mar), S (Pre-Sal), T (Terra), ou 'todos' (default: todos)",
    )
    parser.add_argument("--output", default="output/anp", help="Diretório de saída (default: output/anp)")
    args = parser.parse_args()

    # Validate arguments
    if args.periodo and (args.de or args.ate):
        parser.error("Use --periodo OU --de/--ate, não ambos")
    if not args.periodo and not args.de:
        parser.error("Informe --periodo ou --de/--ate")
    if args.de and not args.ate:
        args.ate = args.de
    if args.ate and not args.de:
        args.de = args.ate

    # Build period list
    if args.periodo:
        periodos = [args.periodo]
    else:
        periodos = generate_periodos(args.de, args.ate)

    # Build ambiente list
    if args.ambiente.lower() == "todos":
        ambientes = ["M", "S", "T"]
    else:
        amb = args.ambiente.upper()
        if amb not in AMBIENTES:
            parser.error(f"Ambiente inválido: {amb}. Use M, S, T ou todos")
        ambientes = [amb]

    # Create output dir
    os.makedirs(args.output, exist_ok=True)

    print(f"ANP/CDP — Produção por Poço")
    print(f"Períodos: {periodos[0]} a {periodos[-1]} ({len(periodos)} meses)")
    print(f"Ambientes: {', '.join(AMBIENTE_NOMES[a] for a in ambientes)}")
    print(f"Saída: {args.output}")
    print()

    http = requests.Session()
    http.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    })

    total = len(periodos) * len(ambientes)
    ok = 0
    fail = 0
    reuse = None

    for periodo in periodos:
        for ambiente in ambientes:
            session_info, success = extract_one(http, periodo, ambiente, args.output, reuse_session=reuse)
            if success:
                ok += 1
                reuse = session_info  # Reuse session after first success
            else:
                fail += 1
                reuse = None  # Reset on failure

    print()
    print(f"Concluído: {ok}/{total} extrações com sucesso, {fail} falhas")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
