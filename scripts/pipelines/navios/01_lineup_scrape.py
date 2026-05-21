import os
import re
import sys
import time
import warnings
from datetime import datetime, timezone, timedelta
from io import BytesIO, StringIO

import pandas as pd
import requests
from bs4 import BeautifulSoup

warnings.filterwarnings("ignore", message="Unverified HTTPS request")

# ---------------------------------------------------------------------------
# Debug / artifact dump directory (used by GHA artifact upload)
# ---------------------------------------------------------------------------

_DEBUG_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "output", "debug"
)


def _dump_debug_html(name: str, html: str) -> str | None:
    """Save HTML payload for post-mortem inspection. Returns path or None."""
    if not html:
        return None
    try:
        os.makedirs(_DEBUG_DIR, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = os.path.join(_DEBUG_DIR, f"{name}_{ts}.html")
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        return path
    except Exception as e:
        print(f"    [debug] failed to dump {name}: {e}")
        return None

# ---------------------------------------------------------------------------
# URLs / constantes
# ---------------------------------------------------------------------------

URL_SANTOS_ESPERADOS = (
    "https://www.portodesantos.com.br/"
    "informacoes-operacionais/operacoes-portuarias/"
    "navegacao-e-movimento-de-navios/navios-esperados-carga/"
)
URL_SANTOS_ATRACADOS = (
    "https://www.portodesantos.com.br/"
    "informacoes-operacionais/operacoes-portuarias/"
    "navegacao-e-movimento-de-navios/atracados-porto-terminais/"
)
URL_ITAQUI      = "https://www.portodoitaqui.com.br/porto-agora/navios/esperados"
URL_PARANAGUA   = "https://www.appaweb.appa.pr.gov.br/appaweb/pesquisa.aspx?WCI=relLineUpRetroativo"
URL_SAO_SEBAST  = "https://sisport.portoss.sp.gov.br/LineUp/ConsultaPublicaProgramacao.aspx"
SUAPE_SHEET_ID  = "1wfmbo5z4iLqDmANEIslnM-G0FYD57e0iruKHrbzniOk"
SUAPE_SHEET_RAW = "Dados Brutos"

# Colunas-padrão da tabela consolidada (ordem de exibição)
COLS_PADRAO = [
    "Porto", "Status", "Navio", "Carga",
    "Quantidade Original", "Unidade Origem", "Quantidade (m³)",
    "Chegada", "Atracação", "Desatracação",
    "Origem", "Terminal", "IMO",
]

# Status a serem excluídos da tabela final
_STATUS_EXCLUIR = {"REATRACÁVEL", "REATRACAVEL", "DESATRACADO"}

# ---------------------------------------------------------------------------
# Conversão de unidades → m³
# ---------------------------------------------------------------------------

# Densidade média do diesel S-10 (kg/L = t/m³)
_DIESEL_DENSITY = 0.835   # t/m³  → 1 t = 1/0.835 ≈ 1.198 m³

# Fatores: 1 <unidade> = ? m³
_FATOR_M3: dict[str, float] = {
    # Toneladas (métrica)
    "t":          1.0 / _DIESEL_DENSITY,
    "ton":        1.0 / _DIESEL_DENSITY,
    "tons":       1.0 / _DIESEL_DENSITY,
    "ton.":       1.0 / _DIESEL_DENSITY,
    "tons.":      1.0 / _DIESEL_DENSITY,
    "tonelada":   1.0 / _DIESEL_DENSITY,
    "toneladas":  1.0 / _DIESEL_DENSITY,
    "mt":         1.0 / _DIESEL_DENSITY,   # metric ton
    # Kilo-toneladas
    "kt":         1_000.0 / _DIESEL_DENSITY,
    # Metro cúbico (já está em m³)
    "m3":         1.0,
    "m³":         1.0,
    "c":          1.0,    # Suape: "C" = cubagem = m³
    "cb":         1.0,
    "cub":        1.0,
    # Quilolitro (= m³)
    "kl":         1.0,
    "klt":        1.0,
    # Litro
    "l":          0.001,
    "lt":         0.001,
    "lts":        0.001,
    "litros":     0.001,
    # Barril (US oil barrel)
    "bbl":        0.158987,
    "bbl.":       0.158987,
    "barrel":     0.158987,
    "barrels":    0.158987,
    # Galão (US)
    "gal":        0.003785,
    "gallon":     0.003785,
    # Galão (UK / imperial)
    "igal":       0.004546,
}


def _parse_numero(v) -> float | None:
    """
    Extrai o valor numérico de qualquer representação:
      - float/int puro                → retorna direto
      - "42.079,000 Tons."  (BR)      → 42079.0
      - "20.000"            (BR mil.) → 20000.0
      - "200.0"             (EN)      → 200.0
      - "20,000.50"         (EN mil.) → 20000.5
    """
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return None if pd.isna(v) else float(v)
    s = str(v).strip()
    # Isolar a primeira sequência numérica com separadores (ex: "42.079,000 Tons.")
    m = re.search(r"[\d][\d.,]*", s)
    if not m:
        return None
    num = m.group()

    # Decidir o formato pelo padrão de separadores:
    has_dot   = "." in num
    has_comma = "," in num

    if has_dot and has_comma:
        # Determina qual é o separador decimal (o último)
        last_dot   = num.rfind(".")
        last_comma = num.rfind(",")
        if last_comma > last_dot:
            # BR: "42.079,000"  → remove pontos, troca vírgula por ponto
            return float(num.replace(".", "").replace(",", "."))
        else:
            # EN: "20,000.50"   → remove vírgulas
            return float(num.replace(",", ""))
    elif has_comma:
        # Só vírgula — pode ser milhar EN ou decimal BR
        after_comma = num.rsplit(",", 1)[-1]
        if len(after_comma) == 3 and after_comma.isdigit():
            # "20,000" → milhar EN → 20000
            return float(num.replace(",", ""))
        # "0,835" → decimal BR → 0.835
        return float(num.replace(",", "."))
    elif has_dot:
        # Só ponto — pode ser decimal EN ou milhar BR
        after_dot = num.rsplit(".", 1)[-1]
        if len(after_dot) == 3 and after_dot.isdigit():
            # "20.000" → ambíguo: se ≥ 100 trata como milhar BR
            candidate = int(num.replace(".", ""))
            if candidate >= 100:
                return float(candidate)
        return float(num)
    else:
        return float(num)


def _inferir_unidade(v, hint: str | None = None) -> str:
    """
    Infere a unidade a partir de:
      - hint explícito (prioridade máxima)
      - texto da string (ex: "42.079,000 Tons." → "t")
      - valor "C" (Suape) → "m³"
    Retorna a unidade em letras minúsculas padronizada.
    """
    if hint:
        return hint.strip().lower()
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return "t"
    s = str(v).strip()

    # Testa se o valor inteiro é uma unidade conhecida (ex: "C", "T", "KL")
    if re.fullmatch(r"[A-Za-z³]+\.?", s):
        return s.lower().rstrip(".")

    # Procura padrão de unidade no texto após os números
    m = re.search(
        r"\b(m3|m³|kl|klt|bbl|barrel|barrels|gal|gallon|igal"
        r"|kt|ton\.?|tons\.?|tonelada[s]?|mt|cb|cub|litros?|lts?|[tTcCmM])\b",
        s,
        re.IGNORECASE,
    )
    if m:
        return m.group(1).lower().rstrip(".")
    return "t"   # padrão portuário: toneladas


def _para_m3(valor: float, unidade: str) -> float | None:
    """Converte `valor` na `unidade` fornecida para m³. Retorna None se não conversível."""
    if valor is None or pd.isna(valor):
        return None
    fator = _FATOR_M3.get(unidade.strip().lower())
    if fator is None:
        # Tentativa de correspondência parcial
        for chave, f in _FATOR_M3.items():
            if chave in unidade.lower():
                fator = f
                break
    if fator is None:
        return None   # unidade desconhecida
    return round(float(valor) * fator, 2)


# ---------------------------------------------------------------------------
# Helpers gerais
# ---------------------------------------------------------------------------

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;"
        "q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    # NOTE: We deliberately do NOT advertise `br` (Brotli) here because the
    # `requests` library does not decompress Brotli unless the `brotli` package
    # is installed AND urllib3 was built with Brotli support. Porto de Itaqui
    # started returning `Content-Encoding: br` around 2026-05-11, which silently
    # broke the scraper (gibberish bytes → BeautifulSoup parsed as junk text →
    # zero tables, zero rows, exit 0). Keeping the header at gzip+deflate forces
    # the server to fall back to gzip which requests/urllib3 handle natively.
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
}


def _get(url: str, retries: int = 3, timeout: int = 60) -> str:
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, headers=_HEADERS, verify=False, timeout=timeout)
            resp.raise_for_status()
            return resp.content.decode("utf-8", errors="replace")
        except requests.exceptions.HTTPError as e:
            # 4xx são erros definitivos do lado do cliente — não tem sentido retentar
            if e.response is not None and 400 <= e.response.status_code < 500:
                raise
            if attempt == retries:
                raise
            time.sleep(5 * attempt)
        except Exception as e:
            if attempt == retries:
                raise
            time.sleep(5 * attempt)


def _fetch_with_selenium(
    url: str,
    wait_for_selector: str | None = "table",
    wait_timeout: int = 25,
) -> str:
    """Busca URL com Chrome headless via Selenium.
    Usado como fallback quando requests é bloqueado (403) por WAF/firewall de IP.
    O fingerprint TLS do Chrome real é diferente do requests e passa pela maioria
    dos bloqueios baseados em JA3/User-Agent que afetam datacenters.

    Aguarda explicitamente até `wait_for_selector` aparecer no DOM (ou timeout),
    porque sites SPA renderizam tabelas via JS após o pageload inicial.
    """
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC

    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument(f"--user-agent={_HEADERS['User-Agent']}")
    options.add_argument("--lang=pt-BR")
    # Anti-bot hardening: hide navigator.webdriver and reduce headless fingerprint
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)

    driver = webdriver.Chrome(options=options)
    try:
        driver.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {
                "source": (
                    "Object.defineProperty(navigator, 'webdriver', "
                    "{get: () => undefined});"
                )
            },
        )
        driver.get(url)
        if wait_for_selector:
            try:
                WebDriverWait(driver, wait_timeout).until(
                    EC.presence_of_element_located((By.CSS_SELECTOR, wait_for_selector))
                )
            except Exception:
                # Wait expired — return the page anyway so the caller can dump it
                # and inspect why the selector never appeared.
                pass
        # Extra settle time for late-rendered rows
        time.sleep(1.5)
        return driver.page_source
    finally:
        driver.quit()


def _fetch_via_proxy(url: str, proxy_url: str, timeout: int = 60) -> str:
    """Busca URL através de um serviço de proxy HTTP (ex: ScraperAPI, Bright Data,
    ZenRows). O env var `SCRAPER_PROXY_URL` pode conter:
      - URL completa de gateway (ex: ScraperAPI: "http://api.scraperapi.com?api_key=K&render=true&url=")
        → o `url` alvo é APPENDED (URL-encoded) ao final
      - URL de proxy padrão (ex: "http://user:pass@host:port")
        → usada como proxy HTTP/HTTPS comum
    A heurística: se a URL contém `=` no final (gateway-style), append; senão usa
    como proxy regular.
    """
    from urllib.parse import quote_plus

    if proxy_url.rstrip().endswith("="):
        # Gateway-style: append target URL
        target = proxy_url + quote_plus(url)
        resp = requests.get(target, headers=_HEADERS, timeout=timeout, verify=False)
        resp.raise_for_status()
        return resp.content.decode("utf-8", errors="replace")
    else:
        # Standard HTTP/HTTPS proxy
        proxies = {"http": proxy_url, "https": proxy_url}
        resp = requests.get(
            url, headers=_HEADERS, timeout=timeout, verify=False, proxies=proxies
        )
        resp.raise_for_status()
        return resp.content.decode("utf-8", errors="replace")


def _col(df: pd.DataFrame, keyword: str, required: bool = True) -> str | None:
    matches = [c for c in df.columns if keyword.lower() in str(c).lower()]
    if not matches:
        if required:
            raise KeyError(f"Coluna '{keyword}' não encontrada. Colunas: {df.columns.tolist()}")
        return None
    return matches[0]


def _diesel_puro(produto: str) -> bool:
    """Retorna True apenas para diesel puro — exclui biodiesel e diesel marítimo."""
    s = str(produto).upper().strip()
    return "DIESEL" in s and "BIO" not in s and "MARIT" not in s


def _normalizar(df: pd.DataFrame, porto: str, status: str) -> pd.DataFrame:
    """Insere Porto/Status e alinha ao esquema-padrão (colunas ausentes → NaN)."""
    df = df.copy()
    df.insert(0, "Porto",  porto)
    df.insert(1, "Status", status)
    for col in COLS_PADRAO:
        if col not in df.columns:
            df[col] = pd.NA
    extras = [c for c in df.columns if c not in COLS_PADRAO]
    return df[COLS_PADRAO + extras]


# ---------------------------------------------------------------------------
# Porto de Santos – Esperados
# ---------------------------------------------------------------------------

def buscar_santos_esperados() -> pd.DataFrame:
    html = _get(URL_SANTOS_ESPERADOS)
    marcador = "LIQUIDO A GRANEL"
    idx = html.upper().index(marcador)
    inicio = html.rfind("<table", 0, idx)
    fim = html.find("</table>", idx) + len("</table>")
    df = pd.read_html(StringIO(html[inicio:fim]))[0]

    df.columns = [col[1] if col[0] != col[1] else col[0] for col in df.columns]
    df = df.loc[:, ~df.columns.str.startswith("Unnamed")]

    col_op       = _col(df, "Opera")
    col_merc     = _col(df, "Mercadoria")
    col_navio    = _col(df, "Navio")
    col_chegada  = _col(df, "Cheg")
    col_terminal = _col(df, "Terminal")
    col_peso     = _col(df, "Peso", required=False)

    mask = (
        df["Nav"].str.strip().str.upper().eq("LONG")
        & df[col_op].str.strip().str.upper().eq("DESC")
        & df[col_merc].str.strip().str.upper().eq("OLEO DIESEL")
    )
    r = df.loc[mask].copy()
    r = r.rename(columns={
        col_navio:    "Navio",
        col_merc:     "Carga",
        col_chegada:  "Chegada",
        col_terminal: "Terminal",
    })
    if col_peso:
        r = r.rename(columns={col_peso: "Quantidade (m³)"})
    r["Unidade Origem"] = "t"   # Santos reporta em toneladas métricas

    return _normalizar(r, porto="Porto de Santos", status="Esperado")


# ---------------------------------------------------------------------------
# Porto de Santos – Atracados
# ---------------------------------------------------------------------------

def buscar_santos_atracados() -> pd.DataFrame:
    html = _get(URL_SANTOS_ATRACADOS)
    df = pd.read_html(StringIO(html))[0]

    col_carga = _col(df, "Carga")
    col_navio = _col(df, "Navio")
    col_local = _col(df, "Local")
    col_desc  = _col(df, "Desc")   # Desc (t) = toneladas descarregadas
    col_emb   = _col(df, "Emb")

    mask = df[col_carga].str.strip().str.upper().eq("OLEO DIESEL")
    r = df.loc[mask].copy()
    r = r.rename(columns={
        col_navio: "Navio",
        col_carga: "Carga",
        col_local: "Terminal",
        col_desc:  "Quantidade (m³)",  # será convertida abaixo
        col_emb:   "Emb (t)",
    })
    r["Unidade Origem"] = "t"   # colunas Desc (t) / Emb (t) são toneladas

    return _normalizar(r, porto="Porto de Santos", status="Atracado")


# ---------------------------------------------------------------------------
# Porto de Itaqui – Atracados / Fundeados / Esperados
# ---------------------------------------------------------------------------

def _itaqui_html_looks_valid(html: str) -> bool:
    """Heurística para distinguir HTML real (com tabelas de lineup) de um payload
    de WAF / challenge / SPA shell que ainda não renderizou os dados.

    Critérios POSITIVOS (precisa de pelo menos um):
      - presença de `<table` E ao menos uma das palavras de status
        ("atracado", "fundeado", "esperado")
      - presença de "Qtd.Carga" / "Qtd Carga" / "Carga" + "Berço"

    Critérios NEGATIVOS (sinal de bloqueio):
      - "Just a moment", "Cloudflare", "Access Denied", "captcha" → WAF
      - < 5000 bytes → quase certo que é shell vazio
    """
    if not html or len(html) < 5000:
        return False
    low = html.lower()
    bad_markers = ("just a moment", "access denied", "captcha", "cf-chl")
    if any(m in low for m in bad_markers):
        return False
    has_table = "<table" in low
    has_status = any(s in low for s in ("atracado", "fundeado", "esperado"))
    has_cargo = ("qtd" in low and "carga" in low) or "berço" in low or "berco" in low
    return has_table and (has_status or has_cargo)


def buscar_itaqui() -> pd.DataFrame:
    """Scraper de Porto de Itaqui. Tenta em ordem:
      1. requests com Session (warm-up + cookies)
      2. Proxy residencial (se SCRAPER_PROXY_URL setado)
      3. Selenium Chrome headless com waits explícitos

    Em cada etapa, valida via _itaqui_html_looks_valid se o HTML retornado tem
    sinais de conteúdo real. Se nenhuma etapa retorna HTML válido, dumpa o último
    payload em output/debug/itaqui_*.html e levanta RuntimeError.
    """
    proxy_url = os.environ.get("SCRAPER_PROXY_URL", "").strip()
    html: str | None = None
    last_failure_reason = "unknown"

    # ---------------------------------------------------------------------
    # Etapa 1: requests com Session (warm-up + cookies)
    # ---------------------------------------------------------------------
    try:
        base = "https://www.portodoitaqui.com.br"
        session = requests.Session()
        session.headers.update(_HEADERS)
        session.get(base + "/", verify=False, timeout=30)   # warm-up / cookies
        session.headers["Referer"] = base + "/"
        session.headers["Sec-Fetch-Site"] = "same-origin"
        resp = session.get(URL_ITAQUI, verify=False, timeout=60)
        if resp.status_code == 403:
            last_failure_reason = "requests: HTTP 403 (WAF block)"
            print("    [Itaqui] requests bloqueado (403)")
        else:
            resp.raise_for_status()
            candidate = resp.content.decode("utf-8", errors="replace")
            if _itaqui_html_looks_valid(candidate):
                html = candidate
                print(f"    [Itaqui] etapa requests: HTML válido ({len(candidate):,} bytes)")
            else:
                last_failure_reason = (
                    f"requests: HTTP {resp.status_code} mas HTML sem markers válidos "
                    f"({len(candidate):,} bytes)"
                )
                print(f"    [Itaqui] {last_failure_reason}")
                # Save the suspicious payload for inspection
                dump = _dump_debug_html("itaqui_step1_requests_invalid", candidate)
                if dump:
                    print(f"    [Itaqui] dump: {dump}")
    except requests.exceptions.RequestException as e:
        last_failure_reason = f"requests: {type(e).__name__}: {e}"
        print(f"    [Itaqui] {last_failure_reason}")

    # ---------------------------------------------------------------------
    # Etapa 2: Proxy residencial (se configurado via SCRAPER_PROXY_URL)
    # ---------------------------------------------------------------------
    if html is None and proxy_url:
        try:
            print("    [Itaqui] tentando via SCRAPER_PROXY_URL...")
            candidate = _fetch_via_proxy(URL_ITAQUI, proxy_url, timeout=120)
            if _itaqui_html_looks_valid(candidate):
                html = candidate
                print(f"    [Itaqui] etapa proxy: HTML válido ({len(candidate):,} bytes)")
            else:
                last_failure_reason = (
                    f"proxy: HTML sem markers válidos ({len(candidate):,} bytes)"
                )
                print(f"    [Itaqui] {last_failure_reason}")
                dump = _dump_debug_html("itaqui_step2_proxy_invalid", candidate)
                if dump:
                    print(f"    [Itaqui] dump: {dump}")
        except Exception as e:
            last_failure_reason = f"proxy: {type(e).__name__}: {e}"
            print(f"    [Itaqui] {last_failure_reason}")
    elif html is None and not proxy_url:
        print("    [Itaqui] SCRAPER_PROXY_URL não setado — pulando etapa proxy")

    # ---------------------------------------------------------------------
    # Etapa 3: Selenium Chrome headless (fingerprint TLS de browser real)
    # ---------------------------------------------------------------------
    if html is None:
        try:
            print("    [Itaqui] tentando Chrome headless (Selenium)...")
            candidate = _fetch_with_selenium(URL_ITAQUI, wait_for_selector="table")
            if _itaqui_html_looks_valid(candidate):
                html = candidate
                print(f"    [Itaqui] etapa selenium: HTML válido ({len(candidate):,} bytes)")
            else:
                last_failure_reason = (
                    f"selenium: HTML sem markers válidos ({len(candidate):,} bytes)"
                )
                print(f"    [Itaqui] {last_failure_reason}")
                dump = _dump_debug_html("itaqui_step3_selenium_invalid", candidate)
                if dump:
                    print(f"    [Itaqui] dump: {dump}")
        except Exception as e:
            last_failure_reason = f"selenium: {type(e).__name__}: {e}"
            print(f"    [Itaqui] {last_failure_reason}")

    # ---------------------------------------------------------------------
    # Se nenhuma etapa funcionou, fail loud
    # ---------------------------------------------------------------------
    if html is None:
        raise RuntimeError(
            f"buscar_itaqui: todas as etapas falharam. Último motivo: "
            f"{last_failure_reason}. Verifique artifacts em output/debug/ e "
            f"considere configurar SCRAPER_PROXY_URL (ex: ScraperAPI key)."
        )

    # Use BeautifulSoup to extract tables with all cells as strings.
    # pd.read_html auto-converts "20.000" (BR thousands) → float 20.0, losing
    # the thousands separator context.  Parsing manually keeps values as text.
    soup = BeautifulSoup(html, "lxml")
    raw_tables: list[pd.DataFrame] = []
    for table in soup.find_all("table"):
        thead = table.find("thead")
        headers = [th.get_text(strip=True) for th in thead.find_all(["th", "td"])] if thead else []

        tbody = table.find("tbody") or table
        rows = []
        for tr in tbody.find_all("tr"):
            cells = [td.get_text(strip=True) for td in tr.find_all(["th", "td"])]
            if cells:
                rows.append(cells)

        if not headers and rows:
            headers = rows[0]
            rows = rows[1:]

        if not rows:
            continue

        ncols = len(headers)
        padded = [r[:ncols] + [""] * max(0, ncols - len(r)) for r in rows]
        raw_tables.append(pd.DataFrame(padded, columns=headers))

    # If we got valid HTML but zero parseable tables, that's a structural break
    # (page schema changed). Dump for inspection and raise.
    if not raw_tables:
        dump = _dump_debug_html("itaqui_html_no_tables", html)
        raise RuntimeError(
            f"buscar_itaqui: HTML válido mas nenhuma <table> parseável encontrada. "
            f"Schema da página pode ter mudado. Dump: {dump}"
        )

    mapeamento = {0: "Atracado", 1: "Fundeado", 2: "Esperado"}
    partes = []
    total_diesel_rows = 0

    for i, status in mapeamento.items():
        if i >= len(raw_tables):
            continue
        df = raw_tables[i].copy()

        col_carga = _col(df, "Carga", required=False)
        if col_carga is None:
            continue
        mask = df[col_carga].str.strip().str.upper().str.contains("DIESEL", na=False)
        f = df.loc[mask].copy()
        if f.empty:
            continue
        total_diesel_rows += len(f)

        col_navio = _col(df, "Navio")
        f = f.rename(columns={col_navio: "Navio", col_carga: "Carga"})

        # Berço → Terminal
        c_berco = _col(df, "Ber", required=False)
        if c_berco:
            f = f.rename(columns={c_berco: "Terminal"})

        # Qtd.Carga → Quantidade (m³) (ainda em t; será convertida no consolidar)
        c_qtd = _col(df, "Qtd", required=False)
        if c_qtd:
            f = f.rename(columns={c_qtd: "Quantidade (m³)"})

        # Prev Chegada → Chegada
        c_cheg = next(
            (c for c in df.columns if "Prev" in c and "Chegada" in c), None
        )
        if c_cheg:
            f = f.rename(columns={c_cheg: "Chegada"})

        f["Unidade Origem"] = "t"   # Itaqui reporta em toneladas

        partes.append(_normalizar(f, porto="Porto de Itaqui", status=status))

    print(
        f"    [Itaqui] tabelas parseadas: {len(raw_tables)}, "
        f"linhas diesel encontradas: {total_diesel_rows}"
    )
    return pd.concat(partes, ignore_index=True, sort=False) if partes else pd.DataFrame()


# ---------------------------------------------------------------------------
# Porto de Paranaguá – todas as tabelas
# ---------------------------------------------------------------------------

_PARANAGUA_STATUS = {
    1: "Atracado",
    2: "Programado",
    3: "Ao Largo (Reatracação)",
    4: "Ao Largo",
    5: "Esperado",
    7: "Despachado",
}


def buscar_paranagua() -> pd.DataFrame:
    html = _get(URL_PARANAGUA)
    dfs = pd.read_html(StringIO(html))
    partes = []

    for i, status in _PARANAGUA_STATUS.items():
        if i >= len(dfs):
            continue
        df = dfs[i].copy()

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [col[1] for col in df.columns]
        df = df.loc[:, ~df.columns.str.startswith("Unnamed")]

        merc_cols = [c for c in df.columns if "Mercad" in c]
        sent_cols = [c for c in df.columns if "Sentido" in c]
        if not merc_cols or not sent_cols:
            continue

        col_merc = merc_cols[0]
        col_sent = sent_cols[0]
        mask = (
            df[col_merc].str.strip().str.upper().str.contains("DIESEL", na=False)
            & df[col_sent].str.strip().str.upper().eq("IMP")
        )
        f = df.loc[mask].copy()
        if f.empty:
            continue

        col_navio  = _col(f, "Embarca")
        col_berco  = _col(f, "Ber", required=False)
        rename_map = {col_navio: "Navio", col_merc: "Carga", col_sent: "Sentido"}

        if col_berco:
            rename_map[col_berco] = "Terminal"

        # Previsto (ex: "42.079,000 Tons.") → Quantidade (m³)
        c_prev = _col(f, "Previsto", required=False)
        if c_prev:
            rename_map[c_prev] = "Quantidade (m³)"

        # Chegada: preferir coluna já chamada "Chegada"; senão ETA
        if "Chegada" not in f.columns:
            for cand in ["ETA", "Atrac\u00e7\u00e3o"]:
                if cand in f.columns:
                    rename_map[cand] = "Chegada"
                    break

        # Atracação (berthing)
        c_atrac = _col(f, "Atrac", required=False)
        if c_atrac and c_atrac not in rename_map.values():
            rename_map[c_atrac] = "Atracação"

        # Desatracação
        c_desatrac = next((c for c in f.columns if "Desatrac" in c), None)
        if c_desatrac:
            rename_map[c_desatrac] = "Desatracação"

        f = f.rename(columns=rename_map)
        f = f.loc[:, ~f.columns.duplicated()]

        # Paranaguá reporta sempre em toneladas (embutido em "Tons." na string)
        f["Unidade Origem"] = "t"

        partes.append(_normalizar(f, porto="Porto de Paranaguá", status=status))

    return pd.concat(partes, ignore_index=True, sort=False) if partes else pd.DataFrame()


# ---------------------------------------------------------------------------
# Porto de São Sebastião
# ---------------------------------------------------------------------------

_SS_STATUS_MAP = {
    "OPERANDO":    "Atracado",
    "FUNDEADO":    "Fundeado",
    "DESATRACADO": "Desatracado",
    "PROGRAMADO":  "Programado",
}


def buscar_sao_sebastiao() -> pd.DataFrame:
    html = _get(URL_SAO_SEBAST)
    dfs = pd.read_html(StringIO(html))
    partes = []

    for tab_idx, df_raw in enumerate(dfs[:2]):
        df = df_raw.copy()
        col_merc  = _col(df, "MERCAD")
        col_navio = _col(df, "NAVIO")

        mask = df[col_merc].str.strip().str.upper().str.contains("DIESEL", na=False)
        f = df.loc[mask].copy()
        if f.empty:
            continue

        f = f.rename(columns={col_navio: "Navio", col_merc: "Carga"})

        for kw, dest in [
            ("PREVIS",   "Chegada"),
            ("PESO",     "Quantidade (m³)"),
            ("LOCAL",    "Terminal"),
            ("OPERADOR", "Operador"),
            ("PRODU",    "Atracação"),
        ]:
            c = _col(df, kw, required=False)
            if c:
                f = f.rename(columns={c: dest})

        # São Sebastião reporta PESO (Ton) → toneladas
        f["Unidade Origem"] = "t"

        if tab_idx == 0:
            col_sit = _col(f, "SITUA", required=False)
            if col_sit:
                f[col_sit] = (
                    f[col_sit].str.strip().str.upper()
                    .map(_SS_STATUS_MAP).fillna(f[col_sit])
                )
                for _, grp in f.groupby(col_sit, sort=False):
                    status_val = grp[col_sit].iloc[0]
                    partes.append(
                        _normalizar(grp.drop(columns=col_sit),
                                    porto="Porto de São Sebastião",
                                    status=status_val)
                    )
            else:
                partes.append(
                    _normalizar(f, porto="Porto de São Sebastião", status="Operando")
                )
        else:
            partes.append(
                _normalizar(f, porto="Porto de São Sebastião", status="Programado")
            )

    return pd.concat(partes, ignore_index=True, sort=False) if partes else pd.DataFrame()


# ---------------------------------------------------------------------------
# Porto de Suape – Google Sheets (aba oculta "Dados Brutos", formato wide)
# ---------------------------------------------------------------------------

def buscar_suape() -> pd.DataFrame:
    url = f"https://docs.google.com/spreadsheets/d/{SUAPE_SHEET_ID}/export?format=xlsx"
    resp = requests.get(url, verify=False, timeout=60)
    resp.raise_for_status()

    xl  = pd.ExcelFile(BytesIO(resp.content))
    df  = xl.parse(SUAPE_SHEET_RAW, header=0)

    # Grupos de colunas por posição: Produto / Quantidade / Unidade
    prod_cols = [c for c in df.columns
                 if str(c).startswith("Produto")
                 and not any(k in str(c) for k in ["Tipo", "Operador", "Qtd", "Unid", "Confirm"])]
    qtd_cols  = [c for c in df.columns if str(c).startswith("Quantidade")]
    uni_cols  = [c for c in df.columns if str(c).startswith("Unidade")]

    # Alinhar os três grupos pelo mesmo índice (menor comprimento é o limitante)
    n = min(len(prod_cols), len(qtd_cols), len(uni_cols))
    prod_cols = prod_cols[:n]
    qtd_cols  = qtd_cols[:n]
    uni_cols  = uni_cols[:n]

    # Máscara: diesel PURO em qualquer coluna de produto
    mask = df[prod_cols].apply(lambda col: col.map(_diesel_puro)).any(axis=1)
    f = df.loc[mask].copy()
    if f.empty:
        return pd.DataFrame()

    col_status   = _col(df, "Status da Embarca")
    col_navio    = _col(df, "Nome da Embarca")
    col_berco    = _col(df, "Ber")
    col_imo      = _col(df, "IMO")
    col_origem   = _col(df, "ltima Escala", required=False)

    date_cols    = [c for c in df.columns
                    if any(k in str(c) for k in ["ETA / ATA", "ETB / ATB", "Desatrac"])]
    col_chegada  = next((c for c in date_cols if "ETA / ATA" in str(c)), None)
    col_atrac    = next((c for c in date_cols if "ETB / ATB" in str(c)), None)
    col_desatrac = next(
        (c for c in date_cols if "Desatrac" in str(c) and "Situa" not in str(c)), None
    )

    # Para cada navio: consolidar quantidade e unidade dos produtos diesel puro
    def _qtd_e_unidade(row):
        total   = 0.0
        units   = []
        for pc, qc, uc in zip(prod_cols, qtd_cols, uni_cols):
            if _diesel_puro(str(row[pc])):
                try:
                    total += float(row[qc])
                    u = str(row[uc]).strip()
                    if u and u.lower() != "nan":
                        units.append(u)
                except (ValueError, TypeError):
                    pass
        # Unidade: pega o valor mais comum (ou único) entre os grupos
        unidade = max(set(units), key=units.count) if units else "C"
        return pd.Series({
            "Quantidade (m³)": total if total > 0 else pd.NA,
            "Unidade Origem":  unidade,
        })

    f[["Quantidade (m³)", "Unidade Origem"]] = f.apply(_qtd_e_unidade, axis=1)

    rename_map = {
        col_status: "Status",
        col_navio:  "Navio",
        col_berco:  "Terminal",
        col_imo:    "IMO",
    }
    if col_chegada:  rename_map[col_chegada]  = "Chegada"
    if col_atrac:    rename_map[col_atrac]    = "Atracação"
    if col_desatrac: rename_map[col_desatrac] = "Desatracação"
    if col_origem:   rename_map[col_origem]   = "Origem"

    f = f.rename(columns=rename_map)
    f["Status"] = f["Status"].str.strip()

    # Excluir cabotagem: origem terminando em "-BRA" indica rota doméstica
    if "Origem" in f.columns:
        cabotagem = f["Origem"].str.strip().str.upper().str.endswith("-BRA").fillna(False)
        n_cab = cabotagem.sum()
        if n_cab > 0:
            print(f"  Suape: {n_cab} navio(s) de cabotagem removido(s) (origem -BRA)")
        f = f.loc[~cabotagem]

    # Carga: lista de produtos diesel puro por navio
    f["Carga"] = f.apply(
        lambda row: " | ".join(
            str(row[c]) for c in prod_cols if _diesel_puro(str(row[c]))
        ), axis=1
    )

    partes = []
    for status_val, grp in f.groupby("Status", sort=False):
        partes.append(
            _normalizar(grp.drop(columns="Status").copy(),
                        porto="Porto de Suape",
                        status=status_val)
        )
    return pd.concat(partes, ignore_index=True, sort=False) if partes else pd.DataFrame()


# ---------------------------------------------------------------------------
# Consolidação final + conversão para m³
# ---------------------------------------------------------------------------

def _aplicar_conversao(resultado: pd.DataFrame) -> pd.DataFrame:
    """
    Para cada linha:
      1. Extrai valor numérico de 'Quantidade (m³)' (pode conter texto como "Tons.")
         → salva em 'Quantidade Original' (valor numérico na unidade de origem)
      2. Lê 'Unidade Origem' (com fallback à inferência da string)
      3. Converte para m³ usando _FATOR_M3 → salva em 'Quantidade (m³)'
    """
    def _converter_linha(row):
        raw     = row.get("Quantidade (m³)", pd.NA)
        hint    = row.get("Unidade Origem",  pd.NA)
        hint    = None if pd.isna(hint) else str(hint)

        valor   = _parse_numero(raw)
        unidade = _inferir_unidade(raw, hint=hint)
        m3      = _para_m3(valor, unidade)

        return pd.Series({
            "Quantidade Original": valor,
            "Unidade Origem":      unidade,
            "Quantidade (m³)":     m3,
        })

    resultado[["Quantidade Original", "Unidade Origem", "Quantidade (m³)"]] = resultado.apply(
        _converter_linha, axis=1
    )
    return resultado


def _filtrar_datas_antigas(df: pd.DataFrame) -> pd.DataFrame:
    """
    Remove linhas cujas datas (Chegada, Atracação, Desatracação) são TODAS
    anteriores a 7 dias antes da data de coleta.
    Se pelo menos uma das datas for recente (ou estiver vazia), a linha é mantida.
    """
    _BRT = timezone(timedelta(hours=-3))
    limite = datetime.now(_BRT) - timedelta(days=7)
    colunas_data = ["Chegada", "Atracação", "Desatracação"]

    def _linha_valida(row):
        datas_presentes = []
        for col in colunas_data:
            val = row.get(col)
            if pd.isna(val) or str(val).strip() == "":
                continue
            try:
                dt = pd.to_datetime(str(val), dayfirst=True)
                datas_presentes.append(dt)
            except (ValueError, TypeError):
                continue
        # Se nenhuma data preenchida, manter a linha
        if not datas_presentes:
            return True
        # Manter se pelo menos uma data é >= limite
        return any(dt.replace(tzinfo=_BRT) >= limite for dt in datas_presentes)

    mask = df.apply(_linha_valida, axis=1)
    removidos = (~mask).sum()
    if removidos > 0:
        print(f"  Filtro de datas: {removidos} registro(s) removido(s) (datas > 7 dias atrás)")
    return df.loc[mask]


def consolidar(*tabelas: pd.DataFrame) -> pd.DataFrame:
    validas = [t for t in tabelas if t is not None and not t.empty]
    if not validas:
        return pd.DataFrame(columns=COLS_PADRAO)

    result = pd.concat(validas, ignore_index=True, sort=False)

    # Filtrar status excluídos
    result = result[~result["Status"].str.strip().str.upper().isin(_STATUS_EXCLUIR)]

    # Filtrar apenas diesel puro
    result = result[
        result["Carga"].apply(
            lambda v: any(_diesel_puro(p) for p in str(v).split("|"))
        )
    ]

    # Padronizar nome da carga
    result["Carga"] = "Óleo Diesel"

    # Converter quantidades para m³
    result = _aplicar_conversao(result)

    # Filtrar registros com todas as datas anteriores a 7 dias da coleta
    result = _filtrar_datas_antigas(result)

    result = result.reset_index(drop=True)
    extras = [c for c in result.columns if c not in COLS_PADRAO]
    return result[COLS_PADRAO + extras]


# ---------------------------------------------------------------------------
# Salvar CSV
# ---------------------------------------------------------------------------

def salvar_csv(resultado: pd.DataFrame) -> str:
    """Appenda o resultado em um único CSV, adicionando coluna de timestamp."""
    pasta = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
    os.makedirs(pasta, exist_ok=True)

    caminho = os.path.join(pasta, "navios_diesel.csv")

    cols = [c for c in COLS_PADRAO if c in resultado.columns]
    resultado = resultado[cols].copy()
    _BRT = timezone(timedelta(hours=-3))
    resultado.insert(0, "Consulta", datetime.now(_BRT).strftime("%Y-%m-%d %H:%M"))

    arquivo_existe = os.path.isfile(caminho) and os.path.getsize(caminho) > 0
    resultado.to_csv(
        caminho,
        mode="a" if arquivo_existe else "w",
        header=not arquivo_existe,
        index=False,
        encoding="utf-8-sig",
    )

    return caminho


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Mapping: display name → canonical porto name (multiple sources can share a porto)
    _FONTE_PORTO = {
        "Porto de Santos – Esperados":  "Porto de Santos",
        "Porto de Santos – Atracados":  "Porto de Santos",
        "Porto de Itaqui":              "Porto de Itaqui",
        "Porto de Paranaguá":           "Porto de Paranaguá",
        "Porto de São Sebastião":       "Porto de São Sebastião",
        "Porto de Suape":               "Porto de Suape",
    }

    # Watchdog: portos que DEVEM ser cobertos por pelo menos uma fonte que rode
    # sem erro. Se algum desses não tiver nenhuma fonte bem-sucedida, o job
    # encerra com exit != 0 e mensagem explícita.
    # (Empty-but-no-error é OK — porto pode legitimamente não ter diesel hoje.)
    EXPECTED_PORTS = {
        "Porto de Santos",
        "Porto de Itaqui",
        "Porto de Paranaguá",
        "Porto de São Sebastião",
        "Porto de Suape",
    }

    fontes = [
        ("Porto de Santos – Esperados",  buscar_santos_esperados),
        ("Porto de Santos – Atracados",  buscar_santos_atracados),
        ("Porto de Itaqui",              buscar_itaqui),
        ("Porto de Paranaguá",           buscar_paranagua),
        ("Porto de São Sebastião",       buscar_sao_sebastiao),
        ("Porto de Suape",               buscar_suape),
    ]

    tabelas = []
    portos_com_erro: set[str] = set()
    # Track which canonical portos had at least one source that did NOT raise.
    # An empty DataFrame here is fine — it means "scraper ran but no diesel ships".
    portos_com_fonte_ok: set[str] = set()
    erros_detalhados: list[tuple[str, str]] = []

    for nome, fn in fontes:
        print(f"Buscando {nome}...")
        porto_canon = _FONTE_PORTO[nome]
        try:
            t = fn()
            print(f"  Porto {porto_canon} ({nome}): {len(t)} registro(s).")
            tabelas.append(t)
            portos_com_fonte_ok.add(porto_canon)
        except Exception as e:
            err_msg = f"{type(e).__name__}: {e}"
            print(f"  ERRO em {nome}: {err_msg}")
            tabelas.append(pd.DataFrame())
            portos_com_erro.add(porto_canon)
            erros_detalhados.append((nome, err_msg))

    resultado = consolidar(*tabelas)

    # Adicionar linhas sentinela para portos sem nenhuma fonte bem-sucedida
    portos_sem_fonte_ok = portos_com_erro - portos_com_fonte_ok
    if portos_sem_fonte_ok:
        sentinelas = []
        for porto in sorted(portos_sem_fonte_ok):
            row = {col: pd.NA for col in COLS_PADRAO}
            row["Porto"]  = porto
            row["Status"] = "ERRO_COLETA"
            sentinelas.append(row)
        resultado = pd.concat(
            [resultado, pd.DataFrame(sentinelas)],
            ignore_index=True,
        )

    # Salvar CSV
    csv_path = salvar_csv(resultado)
    print(f"\nCSV salvo em: {csv_path}")

    # Exibir no console
    cols_exibir = [c for c in COLS_PADRAO
                   if c in resultado.columns and resultado[c].notna().any()]

    pd.set_option("display.max_rows",    None)
    pd.set_option("display.max_columns", None)
    pd.set_option("display.width",       None)
    pd.set_option("display.max_colwidth", 45)
    pd.set_option("display.float_format", "{:,.1f}".format)

    print(f"\n{'='*110}")
    print(f"TABELA CONSOLIDADA – {len(resultado)} navios | quantidades em m³")
    print(f"{'='*110}\n")
    if cols_exibir:
        print(resultado[cols_exibir].to_string(index=False))
    else:
        print("(nenhum dado disponível para exibição)")

    # ---------------------------------------------------------------------
    # WATCHDOG (Requisito B): fail loud se algum porto monitorado não teve
    # nenhuma fonte rodar sem erro.
    # ---------------------------------------------------------------------
    portos_faltando = EXPECTED_PORTS - portos_com_fonte_ok
    if portos_faltando:
        print(f"\n{'!'*110}")
        print(f"WATCHDOG: {len(portos_faltando)} porto(s) monitorado(s) sem nenhuma "
              f"fonte bem-sucedida: {sorted(portos_faltando)}")
        if erros_detalhados:
            print("\nErros detalhados:")
            for nome, err in erros_detalhados:
                print(f"  - {nome}: {err}")
        print(f"{'!'*110}\n")
        sys.exit(2)

    # Soft warning: se algum porto teve erro mas existe outra fonte bem-sucedida
    # cobrindo ele (ex: Santos – Esperados falhou mas Santos – Atracados ok),
    # apenas avisa (não falha).
    if portos_com_erro:
        cobertos = portos_com_erro & portos_com_fonte_ok
        if cobertos:
            print(
                f"\n[AVISO] Erros parciais em {len(cobertos)} porto(s), mas todos "
                f"têm fonte alternativa OK: {sorted(cobertos)}"
            )
