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


def _ocr_single(img_bw, psm=10):
    """Run Tesseract on a preprocessed B&W image, return (char, confidence)."""
    WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    cfg = f"--psm {psm} -c tessedit_char_whitelist={WHITELIST}"
    try:
        data = pytesseract.image_to_data(img_bw, config=cfg, output_type=pytesseract.Output.DICT)
        for i, txt in enumerate(data["text"]):
            txt = txt.strip()
            if txt and txt[0] in WHITELIST:
                conf = float(data["conf"][i])
                return txt[0], conf
    except Exception:
        pass
    return "", 0.0


def ocr_captcha_char(img):
    """Pre-process a single CAPTCHA character image and OCR it.

    Uses voting across multiple preprocessing strategies and PSM modes
    to reduce false reads (especially '7' misreads).
    """
    img_rgb = img.convert("RGB")
    w, h = img_rgb.size
    candidates = []  # list of (char, confidence)

    # --- Prepare preprocessed images ---
    preprocessed = []

    # 1) Saturation channel (best for colored chars on white bg)
    img_hsv = img_rgb.convert("HSV")
    _, s_channel, _ = img_hsv.split()
    s_up = s_channel.resize((w * 8, h * 8), Image.LANCZOS)
    s_bin = s_up.point(lambda p: 0 if p > 50 else 255)
    s_bin = s_bin.filter(ImageFilter.MedianFilter(3))
    preprocessed.append(s_bin)

    # Also try saturation with lower threshold
    s_bin2 = s_up.point(lambda p: 0 if p > 35 else 255)
    s_bin2 = s_bin2.filter(ImageFilter.MedianFilter(3))
    preprocessed.append(s_bin2)

    # 2) Grayscale with key thresholds
    img_gray = img_rgb.convert("L")
    img_up = img_gray.resize((w * 8, h * 8), Image.LANCZOS)
    for threshold in (120, 140, 160):
        binarized = img_up.point(lambda p, t=threshold: 0 if p < t else 255)
        binarized = binarized.filter(ImageFilter.MedianFilter(3))
        preprocessed.append(binarized)
        preprocessed.append(ImageOps.invert(binarized))

    # 3) Per-channel (R, G, B) — inverted + binarized
    for ch_idx in range(3):
        ch = img_rgb.split()[ch_idx]
        ch_up = ch.resize((w * 8, h * 8), Image.LANCZOS)
        ch_inv = ImageOps.invert(ch_up)
        ch_bin = ch_inv.point(lambda p: 0 if p > 128 else 255)
        ch_bin = ch_bin.filter(ImageFilter.MedianFilter(3))
        preprocessed.append(ch_bin)

    # --- OCR each preprocessed image with multiple PSM modes ---
    for img_bw in preprocessed:
        for psm in (10, 8, 13):
            char, conf = _ocr_single(img_bw, psm)
            if char:
                candidates.append((char, conf))

    if not candidates:
        return "X"

    # --- Vote: pick the most frequent char, weighted by confidence ---
    from collections import Counter
    vote_scores = Counter()
    for char, conf in candidates:
        vote_scores[char] += max(conf, 1.0)  # at least 1 point per vote

    best_char = vote_scores.most_common(1)[0][0]
    return best_char


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

    # CAPTCHA is required for both Buscar and Exportar
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


def parse_response_session(resp_text, old_session_info):
    """Re-parse the HTML response after Buscar to get updated form fields and new CAPTCHA token."""
    soup = BeautifulSoup(resp_text, "lxml")
    form = soup.find("form", id="wwvFlowForm")
    if not form:
        return old_session_info

    updated_fields = {}
    for inp in form.find_all("input", {"type": "hidden"}):
        name = inp.get("name") or inp.get("id", "")
        if name:
            updated_fields[name] = inp.get("value", "")

    form_action = form.get("action", old_session_info["form_action"])

    # Extract new CAPTCHA plugin token from the regenerated captcha images
    plugin_token = None
    captcha_div = soup.find(id="anp_p54_captcha")
    if captcha_div:
        img = captcha_div.find("img")
        if img and img.get("src"):
            m = re.search(r'[?&]p_request=([^&]+)', img["src"])
            if m:
                plugin_token = m.group(1)

    if not plugin_token:
        for script in soup.find_all("script"):
            txt = script.string or ""
            m = re.search(r'pluginUrl\("([^"]+)"', txt)
            if m:
                plugin_token = "PLUGIN=" + m.group(1)
                break

    return {
        "form_action": form_action,
        "hidden_fields": updated_fields,
        "p_instance": updated_fields.get("p_instance", old_session_info["p_instance"]),
        "plugin_token": plugin_token or old_session_info["plugin_token"],
    }


def extract_one(http: requests.Session, periodo: str, ambiente: str, output_dir: str, reuse_session=None):
    """Extrai dados para um período/ambiente. Retorna (session_info, success).

    Flow: CAPTCHA #1 → Buscar → CAPTCHA #2 → Exportar → CSV
    """
    amb_nome = AMBIENTE_NOMES.get(ambiente, ambiente)
    print(f"  → Período {periodo}, Ambiente {amb_nome} ({ambiente})")

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            # Step 1: Get session
            print(f"    Tentativa {attempt}/{MAX_RETRIES} — nova sessão...")
            session_info = get_session(http)
            print(f"    p_instance={session_info['p_instance']}")

            if not session_info["plugin_token"]:
                print("    ✗ Plugin token do CAPTCHA não encontrado")
                continue

            # Step 2: Solve CAPTCHA #1 for Buscar
            captcha1 = solve_captcha(http, session_info)
            print(f"    CAPTCHA #1: {captcha1}")

            # Step 3: Submit Buscar
            payload = build_payload(session_info, periodo, ambiente, captcha1, "Buscar")
            resp = submit_form(http, session_info, payload)

            success, err_msg = check_buscar_success(resp)
            if not success:
                print(f"    ✗ Buscar: {err_msg}")
                time.sleep(2)
                continue

            print(f"    ✓ Buscar submetido")

            # Step 4: Parse response to get updated form + new CAPTCHA
            session_info = parse_response_session(resp.text, session_info)

            if not session_info["plugin_token"]:
                print("    ✗ Novo plugin token não encontrado após Buscar")
                continue

            # Step 5: Solve CAPTCHA #2 for Exportar
            captcha2 = solve_captcha(http, session_info)
            print(f"    CAPTCHA #2: {captcha2}")

            # Step 6: Submit Exportar with CAPTCHA #2
            payload = build_payload(session_info, periodo, ambiente, captcha2, "Exportar")
            resp = submit_form(http, session_info, payload, stream=True)

            content_type = resp.headers.get("Content-Type", "")
            saved = None

            if "text/csv" in content_type or "application/octet" in content_type or "text/plain" in content_type:
                saved = save_csv(resp, periodo, ambiente, output_dir)
            elif "text/html" in content_type:
                body = resp.content
                if b"," in body and b"\n" in body and len(body) > 1000:
                    saved = save_csv_bytes(body, periodo, ambiente, output_dir)
                else:
                    print(f"    ✗ Exportação retornou HTML ({len(body)} bytes) — CAPTCHA #2 pode ter falhado")
            else:
                saved = save_csv(resp, periodo, ambiente, output_dir)

            if saved:
                return session_info, True

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
