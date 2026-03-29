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
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin, urlparse, parse_qs

import pytesseract
import requests
from bs4 import BeautifulSoup
from PIL import Image, ImageFilter, ImageOps

BASE_URL = "https://cdp.anp.gov.br"
PAGE_PATH = "/ords/r/cdp_apex/consulta-dados-publicos-cdp/consulta-produção-por-poço"
PAGE_URL = BASE_URL + PAGE_PATH

AMBIENTES = {"M": "M", "S": "S", "T": "T"}
AMBIENTE_NOMES = {"M": "Mar", "S": "Pre-Sal", "T": "Terra"}
MAX_RETRIES = 5


def get_session(http: requests.Session):
    """Abre a página e extrai todos os campos do formulário APEX + plugin token do CAPTCHA."""
    resp = http.get(PAGE_URL, timeout=60)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    form = soup.find("form", id="wwvFlowForm")
    if not form:
        raise RuntimeError("Formulário wwvFlowForm não encontrado na página")

    # Extract form action (relative URL)
    form_action = form.get("action", "")

    # Collect ALL hidden inputs from the form
    hidden_fields = {}
    for inp in form.find_all("input", {"type": "hidden"}):
        name = inp.get("name") or inp.get("id", "")
        if name:
            hidden_fields[name] = inp.get("value", "")

    p_instance = hidden_fields.get("p_instance", "")
    if not p_instance:
        raise RuntimeError("p_instance não encontrado na página")

    # Extract CAPTCHA plugin token from captcha image src attributes
    plugin_token = None
    captcha_div = soup.find(id="anp_p54_captcha")
    if captcha_div:
        img = captcha_div.find("img")
        if img and img.get("src"):
            src = img["src"]
            # Extract p_request param from image URL
            m = re.search(r'[?&]p_request=([^&]+)', src)
            if m:
                plugin_token = m.group(1)

    # Fallback: look in script tags for pluginUrl call
    if not plugin_token:
        for script in soup.find_all("script"):
            txt = script.string or ""
            m = re.search(r'pluginUrl\("([^"]+)"', txt)
            if m:
                plugin_token = "PLUGIN=" + m.group(1)
                break

    return {
        "form_action": form_action,
        "hidden_fields": hidden_fields,
        "p_instance": p_instance,
        "plugin_token": plugin_token,
    }


def ocr_captcha_char(img):
    """Pre-process a single CAPTCHA character image and OCR it.

    Characters are colorful (red, green, blue, yellow) on a pale/white noisy
    background.  Plain grayscale loses light-colored chars like yellow.  Using
    the saturation channel (HSV) separates colored chars from the low-saturation
    background.
    """
    WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    TSR_CFG = f"--psm 10 -c tessedit_char_whitelist={WHITELIST}"

    img_rgb = img.convert("RGB")
    w, h = img_rgb.size

    # --- Strategy 1: Saturation channel (best for colored chars on white bg) ---
    img_hsv = img_rgb.convert("HSV")
    _, s_channel, _ = img_hsv.split()
    s_up = s_channel.resize((w * 8, h * 8), Image.LANCZOS)
    # High saturation = character pixels → invert so char becomes black on white
    s_bin = s_up.point(lambda p: 0 if p > 50 else 255)
    s_bin = s_bin.filter(ImageFilter.MedianFilter(3))

    result = pytesseract.image_to_string(s_bin, config=TSR_CFG).strip()
    if result and result[0] in WHITELIST:
        return result[0]

    # --- Strategy 2: Grayscale with multiple thresholds ---
    img_gray = img_rgb.convert("L")
    img_up = img_gray.resize((w * 8, h * 8), Image.LANCZOS)

    for threshold in (140, 120, 100, 160, 180):
        binarized = img_up.point(lambda p, t=threshold: 0 if p < t else 255)
        binarized = binarized.filter(ImageFilter.MedianFilter(3))

        # Try both normal and inverted
        for candidate in (binarized, ImageOps.invert(binarized)):
            result = pytesseract.image_to_string(candidate, config=TSR_CFG).strip()
            if result and result[0] in WHITELIST:
                return result[0]

    # --- Strategy 3: Per-channel max contrast ---
    for ch_idx in range(3):
        ch = img_rgb.split()[ch_idx]
        ch_up = ch.resize((w * 8, h * 8), Image.LANCZOS)
        ch_inv = ImageOps.invert(ch_up)
        ch_bin = ch_inv.point(lambda p: 0 if p > 140 else 255)
        ch_bin = ch_bin.filter(ImageFilter.MedianFilter(3))

        result = pytesseract.image_to_string(ch_bin, config=TSR_CFG).strip()
        if result and result[0] in WHITELIST:
            return result[0]

    return "X"


def solve_captcha(http: requests.Session, session_info: dict):
    """Baixa as 5 imagens do CAPTCHA e resolve via Tesseract OCR."""
    p_instance = session_info["p_instance"]
    plugin_token = session_info["plugin_token"]

    if not plugin_token:
        raise RuntimeError("Plugin token do CAPTCHA não encontrado")

    captcha = ""
    ts = int(time.time() * 1000)

    for i in range(1, 6):
        url = (
            f"{BASE_URL}/ords/wwv_flow.show"
            f"?p_flow_id=117&p_flow_step_id=54"
            f"&p_instance={p_instance}&x01=show_image&x02={i}"
            f"&p_request={plugin_token}&time={ts + i}"
        )
        resp = http.get(url, timeout=30)
        resp.raise_for_status()

        img = Image.open(BytesIO(resp.content))
        char = ocr_captcha_char(img)
        captcha += char

    return captcha


def build_payload(session_info: dict, periodo: str, ambiente: str, captcha: str, request_type: str):
    """Monta o payload completo do formulário APEX a partir dos campos extraídos."""
    today = datetime.now(timezone.utc).strftime("%d/%m/%Y")

    # Start with all hidden fields from the page
    payload = dict(session_info["hidden_fields"])

    # Set the submission values
    payload["p_request"] = request_type  # 'Buscar' or 'Exportar'
    payload["P54_PERIODO"] = periodo
    payload["P54_AMBIENTE"] = ambiente
    payload["P54_DATA_ULTIMA_ATUALIZACAO"] = today

    if request_type == "Buscar":
        payload["P54_CAPTCHA"] = captcha

    return payload


def submit_form(http: requests.Session, session_info: dict, payload: dict, stream: bool = False):
    """POST no formulário APEX."""
    form_action = session_info["form_action"]
    if form_action.startswith("wwv_flow"):
        url = f"{BASE_URL}/ords/{form_action}"
    elif form_action.startswith("/"):
        url = BASE_URL + form_action
    else:
        url = urljoin(BASE_URL + "/ords/", form_action)

    resp = http.post(url, data=payload, timeout=300, stream=stream)
    resp.raise_for_status()
    return resp


def check_buscar_success(resp):
    """Verifica se o POST de Buscar teve sucesso (CAPTCHA aceito)."""
    text = resp.text
    # CAPTCHA error indicators
    if "incorreto" in text.lower() or "inválido" in text.lower():
        return False, "CAPTCHA incorreto"
    # If the response still has the captcha input and an error alert
    soup = BeautifulSoup(text, "lxml")
    err = soup.find(class_="t-Alert--danger")
    if err:
        return False, err.get_text(strip=True)[:100]
    return True, ""


def extract_one(http: requests.Session, periodo: str, ambiente: str, output_dir: str, reuse_session=None):
    """Extrai dados para um período/ambiente. Retorna (session_info, success)."""
    amb_nome = AMBIENTE_NOMES.get(ambiente, ambiente)
    print(f"  → Período {periodo}, Ambiente {amb_nome} ({ambiente})")

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            if reuse_session and attempt == 1:
                session_info = reuse_session
                print(f"    Reutilizando sessão {session_info['p_instance']}")
                payload = build_payload(session_info, periodo, ambiente, "", "Exportar")
                resp = submit_form(http, session_info, payload, stream=True)

                content_type = resp.headers.get("Content-Type", "")
                if "text/csv" in content_type or "application/octet" in content_type:
                    saved = save_csv(resp, periodo, ambiente, output_dir)
                    if saved:
                        return session_info, True

                print(f"    ✗ Sessão expirada ou dados vazios, tentando nova sessão...")
                reuse_session = None

            # New session
            print(f"    Tentativa {attempt}/{MAX_RETRIES} — nova sessão...")
            session_info = get_session(http)
            print(f"    p_instance={session_info['p_instance']}")

            if not session_info["plugin_token"]:
                print("    ✗ Plugin token do CAPTCHA não encontrado")
                continue

            # Solve CAPTCHA
            captcha = solve_captcha(http, session_info)
            print(f"    CAPTCHA resolvido: {captcha}")

            # Submit Buscar
            payload = build_payload(session_info, periodo, ambiente, captcha, "Buscar")
            resp = submit_form(http, session_info, payload)

            success, err_msg = check_buscar_success(resp)
            if not success:
                print(f"    ✗ {err_msg} (tentativa {attempt})")
                time.sleep(2)
                continue

            print(f"    ✓ CAPTCHA aceito")

            # Now we need to get a fresh page state after Buscar redirect
            # APEX typically redirects back to the page after successful submit
            # Re-parse the response to get updated form fields
            soup = BeautifulSoup(resp.text, "lxml")
            form = soup.find("form", id="wwvFlowForm")
            if form:
                updated_fields = {}
                for inp in form.find_all("input", {"type": "hidden"}):
                    name = inp.get("name") or inp.get("id", "")
                    if name:
                        updated_fields[name] = inp.get("value", "")
                form_action = form.get("action", session_info["form_action"])
                session_info = {
                    "form_action": form_action,
                    "hidden_fields": updated_fields,
                    "p_instance": updated_fields.get("p_instance", session_info["p_instance"]),
                    "plugin_token": session_info["plugin_token"],
                }

            # Export CSV
            payload = build_payload(session_info, periodo, ambiente, "", "Exportar")
            resp = submit_form(http, session_info, payload, stream=True)

            content_type = resp.headers.get("Content-Type", "")
            saved = None

            if "text/csv" in content_type or "application/octet" in content_type or "text/plain" in content_type:
                saved = save_csv(resp, periodo, ambiente, output_dir)
            elif "text/html" in content_type:
                body = resp.content
                if b"," in body and b"\n" in body and len(body) > 100:
                    saved = save_csv_bytes(body, periodo, ambiente, output_dir)
                else:
                    print(f"    ✗ Exportação retornou HTML ({len(body)} bytes)")
            else:
                saved = save_csv(resp, periodo, ambiente, output_dir)

            if saved:
                return session_info, True

            # CSV was empty (only headers) — CAPTCHA likely wrong, retry
            time.sleep(2)
            continue

        except Exception as e:
            print(f"    ✗ Erro na tentativa {attempt}: {e}")
            if attempt < MAX_RETRIES:
                time.sleep(2)

    print(f"    ✗ Falhou após {MAX_RETRIES} tentativas")
    return None, False


def save_csv(resp, periodo, ambiente, output_dir):
    """Salva a resposta streamed como CSV. Retorna None se CSV só tem header."""
    fname = f"producao_poco_{periodo.replace('/', '-')}_{ambiente}.csv"
    fpath = Path(output_dir) / fname
    with open(fpath, "wb") as f:
        for chunk in resp.iter_content(8192):
            f.write(chunk)

    # Validate: CSV must have data rows, not just headers
    size = fpath.stat().st_size
    with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
        lines = [l.strip() for l in f if l.strip()]

    if len(lines) <= 1:
        print(f"    ✗ CSV vazio (só header, {size} bytes) — CAPTCHA provavelmente falhou")
        fpath.unlink()
        return None

    size_kb = size / 1024
    print(f"    ✓ Salvo: {fpath} ({size_kb:.1f} KB, {len(lines)-1} linhas de dados)")
    return "ok"


def save_csv_bytes(data, periodo, ambiente, output_dir):
    """Salva bytes como CSV. Retorna None se CSV só tem header."""
    fname = f"producao_poco_{periodo.replace('/', '-')}_{ambiente}.csv"
    fpath = Path(output_dir) / fname
    with open(fpath, "wb") as f:
        f.write(data)

    lines = [l for l in data.decode("utf-8", errors="ignore").splitlines() if l.strip()]
    if len(lines) <= 1:
        print(f"    ✗ CSV vazio (só header) — CAPTCHA provavelmente falhou")
        fpath.unlink()
        return None

    size_kb = len(data) / 1024
    print(f"    ✓ Salvo: {fpath} ({size_kb:.1f} KB, {len(lines)-1} linhas de dados)")
    return "ok"


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

    if args.periodo and (args.de or args.ate):
        parser.error("Use --periodo OU --de/--ate, não ambos")
    if not args.periodo and not args.de:
        parser.error("Informe --periodo ou --de/--ate")
    if args.de and not args.ate:
        args.ate = args.de
    if args.ate and not args.de:
        args.de = args.ate

    if args.periodo:
        periodos = [args.periodo]
    else:
        periodos = generate_periodos(args.de, args.ate)

    if args.ambiente.lower() == "todos":
        ambientes = ["M", "S", "T"]
    else:
        amb = args.ambiente.upper()
        if amb not in AMBIENTES:
            parser.error(f"Ambiente inválido: {amb}. Use M, S, T ou todos")
        ambientes = [amb]

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
                reuse = session_info
            else:
                fail += 1
                reuse = None

    print()
    print(f"Concluído: {ok}/{total} extrações com sucesso, {fail} falhas")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
