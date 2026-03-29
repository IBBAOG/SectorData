#!/usr/bin/env python3
"""
Extração automática de dados de produção por poço — ANP/CDP.

Resolve CAPTCHA via ddddocr (rede neural offline, gratuita).
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

import ddddocr
import requests
from bs4 import BeautifulSoup
from PIL import Image

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


def _parse_page(html):
    """Parse page HTML to extract session info, CAPTCHA token, and IR token."""
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

    # CAPTCHA plugin token from image src
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

    # IR region plugin token (for AJAX download — starts with UkVHSU9O)
    ir_token = None
    for script in soup.find_all("script"):
        txt = script.string or ""
        for m in re.finditer(r'"ajaxIdentifier"\s*:\s*"([^"]+)"', txt):
            if m.group(1).startswith("UkVHSU9O"):
                ir_token = "PLUGIN=" + m.group(1)
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


def get_session(http):
    resp = http.get(PAGE_URL, timeout=60)
    resp.raise_for_status()
    return _parse_page(resp.text)


def solve_captcha(http, session_info, ocr_engine):
    """Baixa as 5 imagens do CAPTCHA, monta composição e resolve via ddddocr."""
    p_instance = session_info["p_instance"]
    captcha_token = session_info["captcha_token"]
    if not captcha_token:
        raise RuntimeError("CAPTCHA token não encontrado")

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

    # Stitch into composite (tight spacing for ddddocr)
    gap = 2
    total_w = sum(img.size[0] for img in char_images) + gap * 4
    max_h = max(img.size[1] for img in char_images)
    composite = Image.new("RGB", (total_w, max_h), (255, 255, 255))
    x = 0
    for img in char_images:
        composite.paste(img.convert("RGB"), (x, 0))
        x += img.size[0] + gap

    buf = BytesIO()
    composite.save(buf, format="PNG")
    result = ocr_engine.classification(buf.getvalue())
    captcha = "".join(c for c in result.upper() if c.isalnum())
    return captcha[:5] if len(captcha) >= 5 else captcha


def submit_buscar(http, session_info, periodo, ambiente, captcha):
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
    """Download CSV via IR widget (Ações → Fazer Download → CSV). No CAPTCHA needed."""
    p_instance = session_info["p_instance"]
    ir_token = session_info["ir_token"]
    if not ir_token:
        return None

    context_path = quote(
        f"consulta-dados-publicos-cdp/consulta-produção-por-poço/{p_instance}", safe="/-"
    )

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
        "f01": [
            f"{IR_REGION_ID}_download_format",
            f"{IR_REGION_ID}_data_only",
            f"{IR_REGION_ID}_pdf_page_size",
            IR_REGION_ID,
        ],
    }
    headers = {
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "text/html, */*; q=0.01",
    }

    resp = http.post(f"{AJAX_URL}?p_context={context_path}", data=payload, headers=headers, timeout=60)
    resp.raise_for_status()

    download_path = resp.text.strip()
    if not download_path.startswith("/") or "<!DOCTYPE" in download_path:
        return None

    resp = http.get(BASE_URL + download_path, timeout=300, stream=True)
    resp.raise_for_status()
    return resp


def extract_one(http, ocr_engine, periodo, ambiente, output_dir):
    """Extrai dados: CAPTCHA → Buscar → IR Download CSV."""
    amb_nome = AMBIENTE_NOMES.get(ambiente, ambiente)
    print(f"  → Período {periodo}, Ambiente {amb_nome} ({ambiente})")

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"    Tentativa {attempt}/{MAX_RETRIES}...")
            session_info = get_session(http)
            print(f"    p_instance={session_info['p_instance']}")

            if not session_info["captcha_token"]:
                print("    ✗ CAPTCHA token não encontrado")
                continue

            captcha = solve_captcha(http, session_info, ocr_engine)
            print(f"    CAPTCHA: {captcha}")

            if len(captcha) != 5:
                print(f"    ✗ CAPTCHA com {len(captcha)} chars (precisa 5)")
                continue

            resp = submit_buscar(http, session_info, periodo, ambiente, captcha)

            if "incorreto" in resp.text.lower() or "inválido" in resp.text.lower():
                print(f"    ✗ CAPTCHA incorreto")
                time.sleep(1)
                continue

            print(f"    ✓ Buscar submetido")
            session_info = _parse_page(resp.text)

            resp = ir_download_csv(http, session_info)
            if resp is None:
                print(f"    ✗ Download falhou (CAPTCHA provavelmente errado)")
                time.sleep(1)
                continue

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

    # Initialize OCR engine once (loads model)
    ocr_engine = ddddocr.DdddOcr(show_ad=False)

    http = requests.Session()
    http.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    })

    total = len(periodos) * len(ambientes)
    ok = 0
    fail = 0

    for periodo in periodos:
        for ambiente in ambientes:
            if extract_one(http, ocr_engine, periodo, ambiente, args.output):
                ok += 1
            else:
                fail += 1

    print()
    print(f"Concluído: {ok}/{total} extrações com sucesso, {fail} falhas")
    if fail > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
