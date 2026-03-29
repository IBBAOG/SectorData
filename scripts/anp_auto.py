#!/usr/bin/env python3
"""
Extração automática de dados de produção por poço — ANP/CDP.

Resolve CAPTCHA via Tesseract OCR (offline, gratuito).
Usa o download nativo do Interactive Report (Ações → Fazer Download → CSV),
que não exige segundo CAPTCHA após o Buscar.

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
from urllib.parse import urljoin, quote

import pytesseract
import requests
from bs4 import BeautifulSoup
from PIL import Image, ImageFilter, ImageOps

BASE_URL = "https://cdp.anp.gov.br"
PAGE_URL = f"{BASE_URL}/ords/r/cdp_apex/consulta-dados-publicos-cdp/consulta-produção-por-poço"
AJAX_URL = f"{BASE_URL}/ords/wwv_flow.ajax"

AMBIENTES = {"M": "M", "S": "S", "T": "T"}
AMBIENTE_NOMES = {"M": "Mar", "S": "Pre-Sal", "T": "Terra"}
MAX_RETRIES = 8

# Fixed IDs from the ANP APEX Interactive Report widget
IR_WORKSHEET_ID = "535711077407731650"
IR_REPORT_ID = "532675064491918620"
IR_REGION_ID = "R535711499414731654"


def get_session(http: requests.Session):
    """Abre a página e extrai sessão, campos do form, CAPTCHA token e IR token."""
    resp = http.get(PAGE_URL, timeout=60)
    resp.raise_for_status()
    return _parse_page(resp.text)


def _parse_page(html):
    """Parse page HTML to extract all session info."""
    soup = BeautifulSoup(html, "lxml")

    form = soup.find("form", id="wwvFlowForm")
    if not form:
        raise RuntimeError("Formulário wwvFlowForm não encontrado")

    form_action = form.get("action", "")

    hidden_fields = {}
    for inp in form.find_all("input", {"type": "hidden"}):
        name = inp.get("name") or inp.get("id", "")
        if name:
            hidden_fields[name] = inp.get("value", "")

    p_instance = hidden_fields.get("p_instance", "")
    if not p_instance:
        raise RuntimeError("p_instance não encontrado")

    # CAPTCHA plugin token (from image src)
    captcha_token = None
    captcha_div = soup.find(id="anp_p54_captcha")
    if captcha_div:
        img = captcha_div.find("img")
        if img and img.get("src"):
            m = re.search(r'[?&]p_request=([^&]+)', img["src"])
            if m:
                captcha_token = m.group(1)

    if not captcha_token:
        for script in soup.find_all("script"):
            txt = script.string or ""
            m = re.search(r'pluginUrl\("([^"]+)"', txt)
            if m:
                captcha_token = "PLUGIN=" + m.group(1)
                break

    # IR region plugin token (for download AJAX — starts with UkVHSU9O)
    ir_token = None
    for script in soup.find_all("script"):
        txt = script.string or ""
        # Find ajaxIdentifier that's NOT the captcha one
        for m in re.finditer(r'"ajaxIdentifier"\s*:\s*"([^"]+)"', txt):
            aid = m.group(1)
            if aid.startswith("UkVHSU9O"):
                ir_token = "PLUGIN=" + aid
                break
        if ir_token:
            break

    return {
        "form_action": form_action,
        "hidden_fields": hidden_fields,
        "p_instance": p_instance,
        "captcha_token": captcha_token,
        "ir_token": ir_token,
    }


def solve_captcha(http: requests.Session, session_info: dict):
    """Baixa as 5 imagens do CAPTCHA, monta composição e resolve via Tesseract."""
    from collections import Counter
    from PIL import ImageChops

    p_instance = session_info["p_instance"]
    captcha_token = session_info["captcha_token"]

    if not captcha_token:
        raise RuntimeError("CAPTCHA token não encontrado")

    # Download 5 character images
    char_images = []
    ts = int(time.time() * 1000)
    for i in range(1, 6):
        url = (
            f"{BASE_URL}/ords/wwv_flow.show"
            f"?p_flow_id=117&p_flow_step_id=54"
            f"&p_instance={p_instance}&x01=show_image&x02={i}"
            f"&p_request={captcha_token}&time={ts + i}"
        )
        resp = http.get(url, timeout=30)
        resp.raise_for_status()
        char_images.append(Image.open(BytesIO(resp.content)))

    # Stitch into composite with padding
    gap = 8
    total_w = sum(img.size[0] for img in char_images) + gap * 6
    max_h = max(img.size[1] for img in char_images) + gap * 2
    composite = Image.new("RGB", (total_w, max_h), (255, 255, 255))
    x = gap
    for img in char_images:
        composite.paste(img.convert("RGB"), (x, gap))
        x += img.size[0] + gap

    # Preprocess with saturation channel
    w, h = composite.size
    scale = 6
    img_hsv = composite.convert("HSV")
    _, s_ch, _ = img_hsv.split()
    s_up = s_ch.resize((w * scale, h * scale), Image.LANCZOS)

    WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    candidates = []

    for sat_thresh in (40, 50, 60):
        bw = s_up.point(lambda p, t=sat_thresh: 0 if p > t else 255)
        bw = bw.filter(ImageFilter.MedianFilter(3)).convert("L")

        for psm in (7, 8, 6):
            cfg = f"--psm {psm} -c tessedit_char_whitelist={WHITELIST}"
            try:
                text = pytesseract.image_to_string(bw, config=cfg).strip()
                text = "".join(c for c in text if c in WHITELIST)
                if len(text) == 5:
                    candidates.append(text)
            except Exception:
                pass

    # Min-channel fallback
    r, g, b = composite.split()
    min_ch = ImageChops.darker(ImageChops.darker(r, g), b)
    min_up = min_ch.resize((w * scale, h * scale), Image.LANCZOS)
    min_inv = ImageOps.invert(min_up)
    for thresh in (100, 120):
        bw = min_inv.point(lambda p, t=thresh: 0 if p > t else 255)
        bw = bw.filter(ImageFilter.MedianFilter(3)).convert("L")
        try:
            text = pytesseract.image_to_string(
                bw, config=f"--psm 7 -c tessedit_char_whitelist={WHITELIST}"
            ).strip()
            text = "".join(c for c in text if c in WHITELIST)
            if len(text) == 5:
                candidates.append(text)
        except Exception:
            pass

    if candidates:
        return Counter(candidates).most_common(1)[0][0]

    # Last resort fallback
    bw = s_up.point(lambda p: 0 if p > 45 else 255)
    bw = bw.filter(ImageFilter.MedianFilter(3)).convert("L")
    try:
        text = pytesseract.image_to_string(
            bw, config=f"--psm 7 -c tessedit_char_whitelist={WHITELIST}"
        ).strip()
        result = "".join(c for c in text if c in WHITELIST)[:5]
        return result if result else "XXXXX"
    except Exception:
        return "XXXXX"


def submit_buscar(http, session_info, periodo, ambiente, captcha):
    """POST Buscar to load data into the IR."""
    today = datetime.now(timezone.utc).strftime("%d/%m/%Y")
    payload = dict(session_info["hidden_fields"])
    payload["p_request"] = "Buscar"
    payload["P54_PERIODO"] = periodo
    payload["P54_AMBIENTE"] = ambiente
    payload["P54_CAPTCHA"] = captcha
    payload["P54_DATA_ULTIMA_ATUALIZACAO"] = today

    form_action = session_info["form_action"]
    if form_action.startswith("wwv_flow"):
        url = f"{BASE_URL}/ords/{form_action}"
    elif form_action.startswith("/"):
        url = BASE_URL + form_action
    else:
        url = urljoin(BASE_URL + "/ords/", form_action)

    resp = http.post(url, data=payload, timeout=120)
    resp.raise_for_status()
    return resp


def ir_download_csv(http, session_info):
    """Use the IR widget's built-in download (Ações → Fazer Download → CSV).

    This does NOT require a second CAPTCHA — it works within the existing session
    after a successful Buscar.
    """
    p_instance = session_info["p_instance"]
    ir_token = session_info["ir_token"]

    if not ir_token:
        raise RuntimeError("IR plugin token não encontrado")

    # Step 1: POST wwv_flow.ajax with GET_DOWNLOAD_LINK to get a temp download URL
    context_path = quote(f"consulta-dados-publicos-cdp/consulta-produção-por-poço/{p_instance}", safe="/-")
    ajax_url = f"{AJAX_URL}?p_context={context_path}"

    payload = {
        "p_flow_id": "117",
        "p_flow_step_id": "54",
        "p_instance": p_instance,
        "p_debug": "",
        "p_request": ir_token,
        "p_widget_name": "worksheet",
        "p_widget_mod": "ACTION",
        "p_widget_action": "GET_DOWNLOAD_LINK",
        "p_widget_num_return": "25",
        "x01": IR_WORKSHEET_ID,
        "x02": IR_REPORT_ID,
    }

    # f01 values specify format and options
    f01_values = [
        f"{IR_REGION_ID}_download_format",  # format field
        f"{IR_REGION_ID}_data_only",        # data only field
        f"{IR_REGION_ID}_pdf_page_size",    # pdf page size field
        IR_REGION_ID,                        # region
    ]

    headers = {
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "text/html, */*; q=0.01",
    }
    resp = http.post(ajax_url, data={**payload, "f01": f01_values}, headers=headers, timeout=60)
    resp.raise_for_status()

    # Response should be a download URL path (starts with /)
    download_path = resp.text.strip()
    if not download_path.startswith("/") or "<!DOCTYPE" in download_path:
        return None  # CAPTCHA was wrong or session expired

    # Step 2: GET the download URL to fetch the CSV
    download_url = BASE_URL + download_path
    resp = http.get(download_url, timeout=300, stream=True)
    resp.raise_for_status()
    return resp


def buscar_has_data(resp_text):
    """Check if the Buscar response contains data in the IR table."""
    # Look for table body cells with data
    soup = BeautifulSoup(resp_text, "lxml")

    # Check for error alerts
    err = soup.find(class_="t-Alert--danger") or soup.find(class_="t-Alert--warning")
    if err:
        err_text = err.get_text(strip=True)
        if "erro" in err_text.lower():
            return False, err_text[:100]

    # Check for IR table rows
    ir_table = soup.find("table", class_="a-IRR-table")
    if ir_table:
        rows = ir_table.find("tbody")
        if rows and rows.find("tr"):
            return True, ""

    # Fallback: check for any table with data cells
    for table in soup.find_all("table"):
        tbody = table.find("tbody")
        if tbody:
            tds = tbody.find_all("td")
            if len(tds) > 5:
                return True, ""

    return False, "Sem dados na tabela"


def extract_one(http, periodo, ambiente, output_dir):
    """Extrai dados para um período/ambiente.

    Flow: CAPTCHA → Buscar → IR Download CSV (no 2nd CAPTCHA needed)
    """
    amb_nome = AMBIENTE_NOMES.get(ambiente, ambiente)
    print(f"  → Período {periodo}, Ambiente {amb_nome} ({ambiente})")

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"    Tentativa {attempt}/{MAX_RETRIES} — nova sessão...")
            session_info = get_session(http)
            print(f"    p_instance={session_info['p_instance']}")

            if not session_info["captcha_token"]:
                print("    ✗ CAPTCHA token não encontrado")
                continue

            # Solve CAPTCHA (only 1 needed!)
            captcha = solve_captcha(http, session_info)
            print(f"    CAPTCHA: {captcha}")

            # Submit Buscar
            resp = submit_buscar(http, session_info, periodo, ambiente, captcha)

            # Check for explicit error in response
            if "incorreto" in resp.text.lower() or "inválido" in resp.text.lower():
                print(f"    ✗ CAPTCHA incorreto")
                time.sleep(1)
                continue

            print(f"    ✓ Buscar submetido")

            # Re-parse session from Buscar response (get updated IR token)
            session_info = _parse_page(resp.text)

            # Download CSV via IR widget (no CAPTCHA needed!)
            if not session_info.get("ir_token"):
                print("    ✗ IR token não encontrado na resposta do Buscar")
                continue

            resp = ir_download_csv(http, session_info)

            if resp is None:
                print(f"    ✗ Download falhou (CAPTCHA provavelmente errado)")
                time.sleep(1)
                continue

            # Save CSV
            fname = f"producao_poco_{periodo.replace('/', '-')}_{ambiente}.csv"
            fpath = Path(output_dir) / fname
            with open(fpath, "wb") as f:
                for chunk in resp.iter_content(8192):
                    f.write(chunk)

            size = fpath.stat().st_size
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                lines = [l for l in f if l.strip()]

            if len(lines) <= 1:
                print(f"    ✗ CSV vazio ({size} bytes)")
                fpath.unlink()
                continue

            print(f"    ✓ Salvo: {fpath} ({size/1024:.1f} KB, {len(lines)-1} linhas)")
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
        raise argparse.ArgumentTypeError(f"Dados disponíveis a partir de 01/2023")
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
        ambientes = ["M", "S", "T"]
    else:
        amb = args.ambiente.upper()
        if amb not in AMBIENTES:
            parser.error(f"Ambiente inválido: {amb}. Use M, S, T ou todos")
        ambientes = [amb]

    os.makedirs(args.output, exist_ok=True)

    print("ANP/CDP — Produção por Poço")
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

    for periodo in periodos:
        for ambiente in ambientes:
            if extract_one(http, periodo, ambiente, args.output):
                ok += 1
            else:
                fail += 1

    print()
    print(f"Concluído: {ok}/{total} extrações com sucesso, {fail} falhas")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
