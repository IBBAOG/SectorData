#!/usr/bin/env python3
"""
precos_distribuicao_sync.py
===========================
Baixa os XLSX de Precos de Distribuicao de Combustiveis da ANP,
parseia cada um e upserta em anp_precos_distribuicao.
Idempotente — ON CONFLICT DO UPDATE via UNIQUE(data_referencia, produto, granularidade, uf, municipio, regiao).

Fontes (semanal — /pdc/semanal/):
  - combustiveis-liquidos-brasil.xlsx     → semanal, granularidade='brasil'
  - combustiveis-liquidos-estados.xlsx    → semanal, granularidade='uf', liquidos
  - combustiveis-liquidos-municipios-*.xlsx → semanal, granularidade='municipio', liquidos (split 2020-2023 / desde2024)
  - combustiveis-liquidos-regioes.xlsx    → semanal, granularidade='regiao', liquidos
  - glp-brasil.xlsx                       → semanal, granularidade='brasil', GLP P13
  - glp-estados.xlsx                      → semanal, granularidade='uf', GLP P13
  - glp-municipios.xlsx                   → semanal, granularidade='municipio', GLP P13
  - glp-regioes.xlsx                      → semanal, granularidade='regiao', GLP P13

Fontes (mensal — /pdc/mensal/):
  - combustiveis-liquidos-brasil.xlsx     → mensal, granularidade='brasil', liquidos
  - combustiveis-liquidos-estados.xlsx    → mensal, granularidade='uf', liquidos
  - combustiveis-liquidos-municipios.xlsx → mensal, granularidade='municipio', liquidos
  - combustiveis-liquidos-regioes.xlsx    → mensal, granularidade='regiao', liquidos
  - glp-brasil.xlsx                       → mensal, granularidade='brasil', GLP P13
  - glp-estados.xlsx                      → mensal, granularidade='uf', GLP P13
  - glp-municipios.xlsx                   → mensal, granularidade='municipio', GLP P13
  - glp-regioes.xlsx                      → mensal, granularidade='regiao', GLP P13

Ignorados intencionalmente (produto fora dos 6 canonicos):
  - combustiveis-aviacao-*.xlsx

Uso:
    python scripts/pipelines/anp/precos_distribuicao_sync.py
    python scripts/pipelines/anp/precos_distribuicao_sync.py --discover-only

Credenciais: SUPABASE_URL + SUPABASE_SERVICE_KEY (env ou .env)
"""

import argparse
import io
import math
import os
import re
import sys
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup
from supabase import create_client

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_PAGE_URL = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
    "/precos/precos-de-distribuicao-de-combustiveis"
)
_BASE_SEMANAL = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
    "/precos/pdc/semanal"
)
_BASE_MENSAL = (
    "https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia"
    "/precos/pdc/mensal"
)
_HEADERS = {"User-Agent": "Mozilla/5.0"}
_BATCH = 1000

# Canonical product name mapping (normalise variations found in XLSX headers)
# Keys must be lowercase + de-accented (same transformation as _normalise_produto).
_PRODUTO_MAP = {
    # Gasolina
    "gasolina comum":                          "Gasolina Comum",
    "gasolina c":                              "Gasolina Comum",
    "gasolina c comum":                        "Gasolina Comum",
    "gasolina c comum aditivada":              "Gasolina Comum",
    "gasolina c premium":                      "Gasolina Comum",
    "gasolina":                                "Gasolina Comum",
    # Etanol
    "etanol hidratado":                        "Etanol Hidratado",
    "etanol hidratado comum":                  "Etanol Hidratado",
    "etanol hidratado aditivado":              "Etanol Hidratado",
    "etanol":                                  "Etanol Hidratado",
    "alcool etilico hidratado combustivel":    "Etanol Hidratado",
    # Diesel S10
    "diesel s10":                              "Diesel S10",
    "oleo diesel s10":                         "Diesel S10",
    "oleo diesel b s10 - comum":               "Diesel S10",
    "oleo diesel b s10 - aditivado":           "Diesel S10",
    "oleo diesel b s10 para geracao de energia eletrica": "Diesel S10",
    # Diesel S500
    "diesel s500":                             "Diesel S500",
    "oleo diesel s500":                        "Diesel S500",
    "oleo diesel b s500 - comum":              "Diesel S500",
    "oleo diesel b s500 - aditivado":          "Diesel S500",
    "oleo diesel":                             "Diesel S500",
    # Diesel S1800 (não rodoviário — mapear para S500 como fallback)
    "oleo diesel b s1800 nao rodovario comum": "Diesel S500",
    "oleo diesel b s1800 nao rodovario aditivado": "Diesel S500",
    # GNV
    "gnv":                                     "GNV",
    "gas natural veicular":                    "GNV",
    # GLP
    "glp":                                     "GLP P13",
    "glp p13":                                 "GLP P13",
    "glp 13 kg":                               "GLP P13",
    "gas liqüefeito de petroleo":              "GLP P13",
    "gas liquefeito de petroleo":              "GLP P13",
}

# ---------------------------------------------------------------------------
# File catalog — explicit URLs avoid fragile HTML scraping of /pdc/ subfolders.
# Each entry: (key, url, parser_type, periodicidade)
# parser_type: 'brasil_semanal' | 'uf_semanal' | 'municipio_semanal' |
#              'brasil_mensal'  | 'uf_mensal'  | 'municipio_mensal'
# Arquivos com eixo 'regiao' sao ignorados — schema nao suporta granularidade='regiao'.
# Combustiveis-aviacao sao ignorados — produtos fora dos 6 canonicos.
# ---------------------------------------------------------------------------
_FILE_CATALOG: list[tuple[str, str, str, str]] = [
    # --- Semanal ---
    ("brasil",    f"{_BASE_SEMANAL}/combustiveis-liquidos-brasil.xlsx",            "brasil_semanal",    "semanal"),
    ("brasil",    f"{_BASE_SEMANAL}/glp-brasil.xlsx",                             "brasil_semanal",    "semanal"),
    ("uf",        f"{_BASE_SEMANAL}/combustiveis-liquidos-estados.xlsx",           "uf_semanal",        "semanal"),
    ("uf",        f"{_BASE_SEMANAL}/glp-estados.xlsx",                            "uf_semanal",        "semanal"),
    ("municipio", f"{_BASE_SEMANAL}/combustiveis-liquidos-municipios-ago2020_a_dez2023.xlsx",
                                                                                   "municipio_semanal", "semanal"),
    ("municipio", f"{_BASE_SEMANAL}/combustiveis-liquidos-municipios_desde2024.xlsx",
                                                                                   "municipio_semanal", "semanal"),
    ("municipio", f"{_BASE_SEMANAL}/glp-municipios.xlsx",                         "municipio_semanal", "semanal"),
    ("regiao",    f"{_BASE_SEMANAL}/combustiveis-liquidos-regioes.xlsx",           "regiao_semanal",    "semanal"),
    ("regiao",    f"{_BASE_SEMANAL}/glp-regioes.xlsx",                            "regiao_semanal",    "semanal"),
    # --- Mensal ---
    ("brasil",    f"{_BASE_MENSAL}/combustiveis-liquidos-brasil.xlsx",             "brasil_mensal",     "mensal"),
    ("brasil",    f"{_BASE_MENSAL}/glp-brasil.xlsx",                              "brasil_mensal",     "mensal"),
    ("uf",        f"{_BASE_MENSAL}/combustiveis-liquidos-estados.xlsx",            "uf_mensal",         "mensal"),
    ("uf",        f"{_BASE_MENSAL}/glp-estados.xlsx",                             "uf_mensal",         "mensal"),
    ("municipio", f"{_BASE_MENSAL}/combustiveis-liquidos-municipios.xlsx",         "municipio_mensal",  "mensal"),
    ("municipio", f"{_BASE_MENSAL}/glp-municipios.xlsx",                          "municipio_mensal",  "mensal"),
    ("regiao",    f"{_BASE_MENSAL}/combustiveis-liquidos-regioes.xlsx",            "regiao_mensal",     "mensal"),
    ("regiao",    f"{_BASE_MENSAL}/glp-regioes.xlsx",                             "regiao_mensal",     "mensal"),
]

# Legacy HTML-scrape patterns (kept for backward compat / extra files ANP may add):
_PATTERNS = [
    ("brasil",     re.compile(r"combustiveis-liquidos-brasil", re.I)),
    ("uf",         re.compile(r"glp-estados",                  re.I)),
    ("municipio",  re.compile(r"combustiveis-liquidos-municipios", re.I)),
]


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------

def _get_creds():
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        env = Path(__file__).parent.parent.parent / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip()
                if k == "SUPABASE_URL" and not url:
                    url = v
                if k == "SUPABASE_SERVICE_KEY" and not key:
                    key = v
    if not url or not key:
        print("Erro: SUPABASE_URL ou SUPABASE_SERVICE_KEY nao definidos")
        sys.exit(1)
    return url, key


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

def _discover_links() -> list[tuple[str, str, str, str]]:
    """
    Return list of (granularidade_key, url, parser_type, periodicidade).
    Primary source: _FILE_CATALOG (explicit URLs, stable).
    Secondary: HTML scrape of _PAGE_URL for any extra XLSX files ANP may publish.
    """
    # Start with explicit catalog
    catalog_urls = {entry[1] for entry in _FILE_CATALOG}
    result: list[tuple[str, str, str, str]] = list(_FILE_CATALOG)

    # Scrape HTML page for extra XLSX not already in catalog (avoids missing new files)
    try:
        r = requests.get(_PAGE_URL, headers=_HEADERS, timeout=30)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "lxml")
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if not href.lower().endswith(".xlsx"):
                continue
            full_url = href if href.startswith("http") else "https://www.gov.br" + href
            if full_url in catalog_urls:
                continue  # already included
            fname = href.split("/")[-1].lower()
            # Skip: aviacao (produtos fora dos 6 canonicos)
            if re.search(r"aviacao", fname, re.I):
                continue
            # Classify extra files
            if re.search(r"combustiveis-liquidos-brasil|glp-brasil", fname, re.I):
                parser_type = "brasil_semanal"
                key = "brasil"
                period = "semanal"
            elif re.search(r"estados|glp-estados", fname, re.I):
                parser_type = "uf_semanal"
                key = "uf"
                period = "semanal"
            elif re.search(r"municipio", fname, re.I):
                parser_type = "municipio_semanal"
                key = "municipio"
                period = "semanal"
            elif re.search(r"regioes?", fname, re.I):
                parser_type = "regiao_semanal"
                key = "regiao"
                period = "semanal"
            else:
                continue
            result.append((key, full_url, parser_type, period))
            catalog_urls.add(full_url)
    except Exception as e:
        print(f"  WARNING: scrape da pagina HTML falhou ({e}) — usando apenas catalogo")

    return result


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def _download(url: str) -> bytes:
    r = requests.get(url, headers=_HEADERS, stream=True, timeout=300)
    r.raise_for_status()
    return r.content


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalise_produto(raw: str) -> str | None:
    key = raw.strip().lower()
    # remove accents and replacement chars (U+FFFD) for matching
    key = (key
           .replace("�", "")   # openpyxl encoding corruption placeholder
           .replace("á", "a").replace("é", "e").replace("í", "i")
           .replace("ó", "o").replace("ú", "u").replace("ã", "a")
           .replace("â", "a").replace("ê", "e").replace("ô", "o")
           .replace("ç", "c").replace("ü", "u").replace("à", "a")
           .replace("õ", "o").replace("ñ", "n"))
    # collapse multiple spaces that may appear after stripping chars
    key = re.sub(r"\s+", " ", key).strip()
    return _PRODUTO_MAP.get(key)


def _to_float(v) -> float | None:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    try:
        f = float(str(v).replace(",", ".").strip())
        return f if not math.isnan(f) else None
    except (TypeError, ValueError):
        return None


def _to_int(v) -> int | None:
    f = _to_float(v)
    return int(round(f)) if f is not None else None


def _parse_date(v) -> str | None:
    """Parse date-like value → ISO string or None."""
    if v is None:
        return None
    if isinstance(v, pd.Timestamp):
        return v.date().isoformat()
    s = str(v).strip()
    # DD/MM/YYYY
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", s)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{mo}-{d}"
    # YYYY-MM-DD already
    m2 = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m2:
        return s[:10]
    return None


# ---------------------------------------------------------------------------
# Parser: Brasil (semanal, combustiveis-liquidos-brasil)
# ---------------------------------------------------------------------------

def _parse_brasil(content: bytes, fname: str) -> list[dict]:
    """
    Layout típico: row 0 = título; row 1 = headers com produto, data, preco_medio,
    preco_minimo, preco_maximo, numero_postos, unidade.
    Pode ter múltiplos blocos de produto na mesma planilha.
    Tenta ler como tabela simples, identifica colunas por nome.
    """
    rows_out: list[dict] = []

    # Try all sheets
    try:
        xl = pd.ExcelFile(io.BytesIO(content))
        sheet_names = xl.sheet_names
    except Exception as e:
        print(f"  [brasil] Erro ao abrir {fname}: {e}")
        return rows_out

    for sheet in sheet_names:
        try:
            raw = xl.parse(sheet, header=None)
        except Exception:
            continue

        # Scan for header row (row containing 'produto' or 'data'/'mes')
        # All ANP XLSX in this series have 7 metadata rows then the header at row 8.
        # We scan dynamically to be resilient to format changes.
        header_row = None
        for i, row in raw.iterrows():
            vals = [str(v).strip().lower() for v in row if pd.notna(v)]
            if any(v in ("produto", "combustivel", "data", "data inicial", "semana",
                         "mes", "mês") for v in vals):
                header_row = i
                break
            # Also accept rows where any value starts with 'data' or equals 'mes'
            if any(v.startswith("data") or v in ("mes", "mês", "m�s") for v in vals):
                header_row = i
                break

        if header_row is None:
            continue

        df = raw.iloc[header_row:].copy()
        df.columns = [str(v).strip().lower() if pd.notna(v) else f"col_{j}"
                      for j, v in enumerate(df.iloc[0])]
        df = df.iloc[1:].reset_index(drop=True)

        # Identify key columns flexibly
        col_map = {}
        for col in df.columns:
            c = col.lower()
            if re.search(r"produto|combustivel", c) and "produto" not in col_map:
                col_map["produto"] = col
            elif re.search(r"^data|semana|periodo|^m.s$|^mes$", c) and "data" not in col_map:
                col_map["data"] = col
            elif re.search(r"m.dio|medio|media", c) and "medio" not in col_map:
                col_map["medio"] = col
            elif re.search(r"minim", c) and "minimo" not in col_map:
                col_map["minimo"] = col
            elif re.search(r"maxim", c) and "maximo" not in col_map:
                col_map["maximo"] = col
            elif re.search(r"posto|estabel", c) and "postos" not in col_map:
                col_map["postos"] = col
            elif re.search(r"unidade", c) and "unidade" not in col_map:
                col_map["unidade"] = col

        if "data" not in col_map or "medio" not in col_map:
            continue

        for _, row in df.iterrows():
            data_val = _parse_date(row.get(col_map["data"]))
            if not data_val:
                continue

            preco_medio = _to_float(row.get(col_map["medio"]))
            if preco_medio is None:
                continue

            # produto: either from column or constant per sheet
            produto_raw = row.get(col_map.get("produto"), sheet)
            produto = _normalise_produto(str(produto_raw))
            if not produto:
                # try sheet name
                produto = _normalise_produto(sheet)
            if not produto:
                continue

            unidade_raw = str(row.get(col_map.get("unidade", ""), "R$/L")).strip()
            unidade = unidade_raw if unidade_raw and unidade_raw != "nan" else "R$/L"

            rows_out.append({
                "data_referencia": data_val,
                "periodicidade":   "semanal",
                "produto":         produto,
                "granularidade":   "brasil",
                "uf":              None,
                "municipio":       None,
                "preco_medio":     preco_medio,
                "preco_minimo":    _to_float(row.get(col_map.get("minimo"))),
                "preco_maximo":    _to_float(row.get(col_map.get("maximo"))),
                "numero_postos":   _to_int(row.get(col_map.get("postos"))),
                "unidade":         unidade,
                "fonte_arquivo":   fname,
            })

    return rows_out


# ---------------------------------------------------------------------------
# Parser: Estados / GLP (mensal, glp-estados)
# ---------------------------------------------------------------------------

def _parse_uf(content: bytes, fname: str) -> list[dict]:
    """
    Layout típico: linhas com estado, data (ou ano/mês), preco_medio, preco_minimo,
    preco_maximo, numero_postos. Produto = GLP P13, unidade = R$/13kg.
    """
    rows_out: list[dict] = []
    try:
        xl = pd.ExcelFile(io.BytesIO(content))
    except Exception as e:
        print(f"  [uf] Erro ao abrir {fname}: {e}")
        return rows_out

    for sheet in xl.sheet_names:
        try:
            raw = xl.parse(sheet, header=None)
        except Exception:
            continue

        header_row = None
        for i, row in raw.iterrows():
            vals = [str(v).strip().lower() for v in row if pd.notna(v)]
            if any(v in ("estado", "uf", "data", "mes", "mês", "ano") for v in vals):
                header_row = i
                break

        if header_row is None:
            continue

        df = raw.iloc[header_row:].copy()
        df.columns = [str(v).strip().lower() if pd.notna(v) else f"col_{j}"
                      for j, v in enumerate(df.iloc[0])]
        df = df.iloc[1:].reset_index(drop=True)

        col_map = {}
        for col in df.columns:
            c = col.lower()
            if re.search(r"^estado|^uf", c) and "uf" not in col_map:
                col_map["uf"] = col
            elif re.search(r"^data|^mes|^mês|^ano|^periodo", c) and "data" not in col_map:
                col_map["data"] = col
            elif re.search(r"medio|médio", c) and "medio" not in col_map:
                col_map["medio"] = col
            elif re.search(r"minim", c) and "minimo" not in col_map:
                col_map["minimo"] = col
            elif re.search(r"maxim", c) and "maximo" not in col_map:
                col_map["maximo"] = col
            elif re.search(r"posto|estabel", c) and "postos" not in col_map:
                col_map["postos"] = col

        if "data" not in col_map or "medio" not in col_map:
            continue

        for _, row in df.iterrows():
            data_val = _parse_date(row.get(col_map["data"]))
            if not data_val:
                continue
            preco_medio = _to_float(row.get(col_map["medio"]))
            if preco_medio is None:
                continue

            uf_val = str(row.get(col_map.get("uf", ""), "")).strip().upper() or None
            if uf_val in ("NAN", "", "NONE"):
                uf_val = None

            rows_out.append({
                "data_referencia": data_val,
                "periodicidade":   "mensal",
                "produto":         "GLP P13",
                "granularidade":   "uf",
                "uf":              uf_val,
                "municipio":       None,
                "preco_medio":     preco_medio,
                "preco_minimo":    _to_float(row.get(col_map.get("minimo"))),
                "preco_maximo":    _to_float(row.get(col_map.get("maximo"))),
                "numero_postos":   _to_int(row.get(col_map.get("postos"))),
                "unidade":         "R$/13kg",
                "fonte_arquivo":   fname,
            })

    return rows_out


# ---------------------------------------------------------------------------
# Parser: Municípios (mensal, combustiveis-liquidos-municipios)
# ---------------------------------------------------------------------------

def _parse_municipio(content: bytes, fname: str) -> list[dict]:
    """
    Layout típico: colunas municipio, uf, produto, data, preco_medio, preco_minimo,
    preco_maximo, numero_postos.
    """
    rows_out: list[dict] = []
    try:
        xl = pd.ExcelFile(io.BytesIO(content))
    except Exception as e:
        print(f"  [municipio] Erro ao abrir {fname}: {e}")
        return rows_out

    for sheet in xl.sheet_names:
        try:
            raw = xl.parse(sheet, header=None)
        except Exception:
            continue

        # Header detection: ANP municipio XLSX always has 7 metadata rows then header at row 8.
        # The column 'MUNICÍPIO' may be stored with U+FFFD replacing the accented char.
        # We scan for a row that contains BOTH a date-like column AND a municipio-like column,
        # which distinguishes the actual header from the metadata line "TIPO RELATÓRIO: MUNICÍPIO".
        header_row = None
        for i, row in raw.iterrows():
            vals = [str(v).strip().lower() for v in row if pd.notna(v)]
            row_str = " | ".join(vals)
            # The actual header row has multiple columns, one being 'estado' or 'data'
            # AND one matching municipio — avoids the single-cell metadata lines
            has_municipio = any(v in ("municipio", "município") for v in vals) or \
                            any(re.search(r"munic.pio$", v) for v in vals)
            has_date_col = any(v.startswith("data") or v in ("mes", "mês", "m�s") for v in vals)
            has_estado = any(v in ("estado", "uf") for v in vals)
            if has_municipio and (has_date_col or has_estado):
                header_row = i
                break

        if header_row is None:
            continue

        df = raw.iloc[header_row:].copy()
        df.columns = [str(v).strip().lower() if pd.notna(v) else f"col_{j}"
                      for j, v in enumerate(df.iloc[0])]
        df = df.iloc[1:].reset_index(drop=True)

        col_map = {}
        for col in df.columns:
            c = col.lower()
            # municipio col may have U+FFFD in place of í — use dot-wildcard regex
            if re.search(r"munic.pio|municipio|localidade|cidade", c) and "municipio" not in col_map:
                col_map["municipio"] = col
            elif re.search(r"^uf|^estado", c) and "uf" not in col_map:
                col_map["uf"] = col
            elif re.search(r"produto|combustivel", c) and "produto" not in col_map:
                col_map["produto"] = col
            elif re.search(r"^data|^m.s$|^mes$|^periodo", c) and "data" not in col_map:
                col_map["data"] = col
            elif re.search(r"m.dio|medio|media", c) and "medio" not in col_map:
                col_map["medio"] = col
            elif re.search(r"minim", c) and "minimo" not in col_map:
                col_map["minimo"] = col
            elif re.search(r"maxim", c) and "maximo" not in col_map:
                col_map["maximo"] = col
            elif re.search(r"posto|estabel", c) and "postos" not in col_map:
                col_map["postos"] = col
            elif re.search(r"unidade", c) and "unidade" not in col_map:
                col_map["unidade"] = col

        if "data" not in col_map or "medio" not in col_map:
            continue

        for _, row in df.iterrows():
            data_val = _parse_date(row.get(col_map["data"]))
            if not data_val:
                continue
            preco_medio = _to_float(row.get(col_map["medio"]))
            if preco_medio is None:
                continue

            produto_raw = str(row.get(col_map.get("produto", ""), "")).strip()
            produto = _normalise_produto(produto_raw)
            if not produto:
                continue

            municipio_val = str(row.get(col_map.get("municipio", ""), "")).strip() or None
            if municipio_val in ("nan", "", "None"):
                municipio_val = None

            uf_val = str(row.get(col_map.get("uf", ""), "")).strip().upper() or None
            if uf_val in ("NAN", "", "NONE"):
                uf_val = None

            unidade_raw = str(row.get(col_map.get("unidade", ""), "R$/L")).strip()
            unidade = unidade_raw if unidade_raw and unidade_raw != "nan" else "R$/L"

            rows_out.append({
                "data_referencia": data_val,
                "periodicidade":   "mensal",
                "produto":         produto,
                "granularidade":   "municipio",
                "uf":              uf_val,
                "municipio":       municipio_val,
                "preco_medio":     preco_medio,
                "preco_minimo":    _to_float(row.get(col_map.get("minimo"))),
                "preco_maximo":    _to_float(row.get(col_map.get("maximo"))),
                "numero_postos":   _to_int(row.get(col_map.get("postos"))),
                "unidade":         unidade,
                "fonte_arquivo":   fname,
            })

    return rows_out


# ---------------------------------------------------------------------------
# Parser: UF liquidos semanal (combustiveis-liquidos-estados + glp-estados semanal)
# Layout: DATA INICIAL | DATA FINAL | REGIAO | ESTADO | PRODUTO | UNIDADE DE MEDIDA |
#         PRECO MEDIO DISTRIBUICAO | DESVIO PADRAO
# ---------------------------------------------------------------------------

def _parse_uf_liquidos(content: bytes, fname: str, periodicidade: str = "semanal") -> list[dict]:
    """
    Parser para combustiveis-liquidos-estados.xlsx e glp-estados.xlsx (semanal e mensal).

    Layout semanal: DATA INICIAL / DATA FINAL / REGIAO / ESTADO / PRODUTO /
                    UNIDADE DE MEDIDA / PRECO MEDIO DISTRIBUICAO / DESVIO PADRAO
    Layout mensal:  MES / PRODUTO / REGIAO / ESTADO / UNIDADE DE MEDIDA /
                    PRECO MEDIO DE DISTRIBUICAO / DESVIO PADRAO

    Usa DATA INICIAL como data_referencia (para semanal) ou MES (para mensal).
    Ignora coluna REGIAO — granularidade='uf', campo uf=ESTADO.
    """
    rows_out: list[dict] = []
    try:
        xl = pd.ExcelFile(io.BytesIO(content))
    except Exception as e:
        print(f"  [uf_liquidos] Erro ao abrir {fname}: {e}")
        return rows_out

    for sheet in xl.sheet_names:
        try:
            raw = xl.parse(sheet, header=None)
        except Exception:
            continue

        # Find header row: has 'estado' or 'uf' AND ('data' or 'mes')
        header_row = None
        for i, row in raw.iterrows():
            vals = [str(v).strip().lower() for v in row if pd.notna(v) and str(v).strip() not in ("", "nan")]
            has_estado = any(v in ("estado", "uf") for v in vals)
            has_date = any(v.startswith("data") or v in ("mes", "mês", "m��s") for v in vals)
            if has_estado and has_date:
                header_row = i
                break

        if header_row is None:
            continue

        df = raw.iloc[header_row:].copy()
        df.columns = [
            str(v).strip().lower() if pd.notna(v) and str(v).strip() not in ("", "nan") else f"col_{j}"
            for j, v in enumerate(df.iloc[0])
        ]
        df = df.iloc[1:].reset_index(drop=True)

        col_map: dict[str, str] = {}
        for col in df.columns:
            c = col.lower()
            # date: prefer 'data inicial' over 'data final'; also 'mes'
            if re.search(r"data\s*inicial|^data$|^m.s$|^mes$", c) and "data" not in col_map:
                col_map["data"] = col
            elif re.search(r"^estado$|^uf$", c) and "uf" not in col_map:
                col_map["uf"] = col
            elif re.search(r"produto|combustivel", c) and "produto" not in col_map:
                col_map["produto"] = col
            elif re.search(r"m.dio|medio|media", c) and "medio" not in col_map:
                col_map["medio"] = col
            elif re.search(r"minim", c) and "minimo" not in col_map:
                col_map["minimo"] = col
            elif re.search(r"maxim", c) and "maximo" not in col_map:
                col_map["maximo"] = col
            elif re.search(r"posto|estabel", c) and "postos" not in col_map:
                col_map["postos"] = col
            elif re.search(r"unidade", c) and "unidade" not in col_map:
                col_map["unidade"] = col

        if "data" not in col_map or "medio" not in col_map or "uf" not in col_map:
            continue

        for _, row in df.iterrows():
            data_val = _parse_date(row.get(col_map["data"]))
            if not data_val:
                continue
            preco_medio = _to_float(row.get(col_map["medio"]))
            if preco_medio is None:
                continue

            uf_val = str(row.get(col_map["uf"], "")).strip().upper() or None
            if uf_val in ("NAN", "", "NONE"):
                uf_val = None

            produto_raw = str(row.get(col_map.get("produto", ""), "")).strip()
            produto = _normalise_produto(produto_raw)
            if not produto:
                continue

            unidade_raw = str(row.get(col_map.get("unidade", ""), "R$/L")).strip()
            unidade = unidade_raw if unidade_raw and unidade_raw != "nan" else "R$/L"

            rows_out.append({
                "data_referencia": data_val,
                "periodicidade":   periodicidade,
                "produto":         produto,
                "granularidade":   "uf",
                "uf":              uf_val,
                "municipio":       None,
                "preco_medio":     preco_medio,
                "preco_minimo":    _to_float(row.get(col_map.get("minimo"))),
                "preco_maximo":    _to_float(row.get(col_map.get("maximo"))),
                "numero_postos":   _to_int(row.get(col_map.get("postos"))),
                "unidade":         unidade,
                "fonte_arquivo":   fname,
            })

    if len(rows_out) == 0:
        print(f"  WARNING [{fname}]: 0 linhas parseadas — possivel mudanca de layout no XLSX da ANP")
    return rows_out


# ---------------------------------------------------------------------------
# Parser: Brasil mensal (combustiveis-liquidos-brasil + glp-brasil mensais)
# Layout: MES | PRODUTO | UNIDADE DE MEDIDA | PRECO MEDIO DE DISTRIBUICAO | DESVIO PADRAO
# Reutiliza _parse_brasil com periodicidade='mensal' — o parser dinamico ja cobre.
# Alias apenas para clareza de logging.
# ---------------------------------------------------------------------------

def _parse_brasil_mensal(content: bytes, fname: str) -> list[dict]:
    """
    Mensal brasil: mesmo layout do semanal mas com coluna 'MES' em vez de 'DATA'.
    _parse_brasil ja detecta 'mes' como coluna de data — reutilizamos com
    periodicidade ajustada pos-fato.
    """
    rows = _parse_brasil(content, fname)
    # Patch periodicidade: se o arquivo e mensal (infere pelo fname ou forca)
    for r in rows:
        r["periodicidade"] = "mensal"
    return rows


# ---------------------------------------------------------------------------
# Parser: Municipio mensal (glp-municipios + combustiveis-liquidos-municipios mensais)
# Layout: MES | PRODUTO | REGIAO | ESTADO | MUNICIPIO | UNIDADE DE MEDIDA |
#         PRECO MEDIO DE DISTRIBUICAO | DESVIO PADRAO
# ---------------------------------------------------------------------------

def _parse_municipio_mensal(content: bytes, fname: str) -> list[dict]:
    """
    Mensal municipio: similar ao _parse_municipio mas com coluna 'MES' e
    sem colunas 'PRECO MINIMO' / 'PRECO MAXIMO' / 'NUMERO POSTOS'.
    Reutiliza _parse_municipio com periodicidade patched.
    """
    rows = _parse_municipio(content, fname)
    for r in rows:
        r["periodicidade"] = "mensal"
    return rows


# ---------------------------------------------------------------------------
# Parser: GLP municipios semanal (glp-municipios.xlsx)
# Layout: DATA INICIAL | DATA FINAL | REGIAO | ESTADO | MUNICIPIO | PRODUTO |
#         UNIDADE DE MEDIDA | PRECO MEDIO DISTRIBUICAO | DESVIO PADRAO
# ---------------------------------------------------------------------------

def _parse_glp_municipio_semanal(content: bytes, fname: str) -> list[dict]:
    """
    GLP municipios semanal: DATA INICIAL/FINAL + ESTADO + MUNICIPIO + PRODUTO.
    Granularidade='municipio'.
    """
    rows_out: list[dict] = []
    try:
        xl = pd.ExcelFile(io.BytesIO(content))
    except Exception as e:
        print(f"  [glp_municipio_semanal] Erro ao abrir {fname}: {e}")
        return rows_out

    for sheet in xl.sheet_names:
        try:
            raw = xl.parse(sheet, header=None)
        except Exception:
            continue

        header_row = None
        for i, row in raw.iterrows():
            vals = [str(v).strip().lower() for v in row if pd.notna(v) and str(v).strip() not in ("", "nan")]
            has_municipio = any(re.search(r"munic.pio|municipio", v) for v in vals)
            has_date = any(v.startswith("data") or v in ("mes", "mês") for v in vals)
            if has_municipio and has_date:
                header_row = i
                break

        if header_row is None:
            continue

        df = raw.iloc[header_row:].copy()
        df.columns = [
            str(v).strip().lower() if pd.notna(v) and str(v).strip() not in ("", "nan") else f"col_{j}"
            for j, v in enumerate(df.iloc[0])
        ]
        df = df.iloc[1:].reset_index(drop=True)

        col_map: dict[str, str] = {}
        for col in df.columns:
            c = col.lower()
            if re.search(r"data\s*inicial|^data$|^m.s$|^mes$", c) and "data" not in col_map:
                col_map["data"] = col
            elif re.search(r"^estado$|^uf$", c) and "uf" not in col_map:
                col_map["uf"] = col
            elif re.search(r"munic.pio|municipio|localidade|cidade", c) and "municipio" not in col_map:
                col_map["municipio"] = col
            elif re.search(r"produto|combustivel", c) and "produto" not in col_map:
                col_map["produto"] = col
            elif re.search(r"m.dio|medio|media", c) and "medio" not in col_map:
                col_map["medio"] = col
            elif re.search(r"minim", c) and "minimo" not in col_map:
                col_map["minimo"] = col
            elif re.search(r"maxim", c) and "maximo" not in col_map:
                col_map["maximo"] = col
            elif re.search(r"posto|estabel", c) and "postos" not in col_map:
                col_map["postos"] = col
            elif re.search(r"unidade", c) and "unidade" not in col_map:
                col_map["unidade"] = col

        if "data" not in col_map or "medio" not in col_map:
            continue

        for _, row in df.iterrows():
            data_val = _parse_date(row.get(col_map["data"]))
            if not data_val:
                continue
            preco_medio = _to_float(row.get(col_map["medio"]))
            if preco_medio is None:
                continue

            produto_raw = str(row.get(col_map.get("produto", ""), "")).strip()
            produto = _normalise_produto(produto_raw)
            if not produto:
                continue

            municipio_val = str(row.get(col_map.get("municipio", ""), "")).strip() or None
            if municipio_val in ("nan", "", "None"):
                municipio_val = None

            uf_val = str(row.get(col_map.get("uf", ""), "")).strip().upper() or None
            if uf_val in ("NAN", "", "NONE"):
                uf_val = None

            unidade_raw = str(row.get(col_map.get("unidade", ""), "R$/kg")).strip()
            unidade = unidade_raw if unidade_raw and unidade_raw != "nan" else "R$/kg"

            rows_out.append({
                "data_referencia": data_val,
                "periodicidade":   "semanal",
                "produto":         produto,
                "granularidade":   "municipio",
                "uf":              uf_val,
                "municipio":       municipio_val,
                "preco_medio":     preco_medio,
                "preco_minimo":    _to_float(row.get(col_map.get("minimo"))),
                "preco_maximo":    _to_float(row.get(col_map.get("maximo"))),
                "numero_postos":   _to_int(row.get(col_map.get("postos"))),
                "unidade":         unidade,
                "fonte_arquivo":   fname,
            })

    if len(rows_out) == 0:
        print(f"  WARNING [{fname}]: 0 linhas parseadas — possivel mudanca de layout no XLSX da ANP")
    return rows_out


# ---------------------------------------------------------------------------
# Parser: Regioes semanal e mensal
# Semanal: DATA INICIAL | DATA FINAL | REGIAO | PRODUTO | UNIDADE DE MEDIDA |
#          PRECO MEDIO DISTRIBUICAO | DESVIO PADRAO
# Mensal:  MES | PRODUTO | REGIAO | UNIDADE DE MEDIDA |
#          PRECO MEDIO DE DISTRIBUICAO | DESVIO PADRAO
# Nao tem PRECO MINIMO / PRECO MAXIMO / NUMERO POSTOS.
# Regioes possíveis: NORTE, NORDESTE, CENTRO OESTE, SUDESTE, SUL
# (ANP usa "CENTRO OESTE" sem hifen — verificado nos arquivos reais)
# ---------------------------------------------------------------------------

_VALID_REGIOES = {"NORTE", "NORDESTE", "CENTRO OESTE", "SUDESTE", "SUL"}


def _parse_regiao(content: bytes, fname: str, periodicidade: str) -> list[dict]:
    """
    Parser para *-regioes.xlsx (semanal e mensal, combustiveis-liquidos e glp).

    Semanal layout: DATA INICIAL / DATA FINAL / REGIAO / PRODUTO /
                    UNIDADE DE MEDIDA / PRECO MEDIO DISTRIBUICAO / DESVIO PADRAO
    Mensal layout:  MES / PRODUTO / REGIAO /
                    UNIDADE DE MEDIDA / PRECO MEDIO DE DISTRIBUICAO / DESVIO PADRAO

    Nenhum dos 4 arquivos tem PRECO MINIMO, PRECO MAXIMO ou NUMERO POSTOS —
    essas colunas ficam None.
    """
    rows_out: list[dict] = []
    try:
        xl = pd.ExcelFile(io.BytesIO(content))
    except Exception as e:
        print(f"  [regiao] Erro ao abrir {fname}: {e}")
        return rows_out

    for sheet in xl.sheet_names:
        try:
            raw = xl.parse(sheet, header=None)
        except Exception:
            continue

        # Find header row: must have a REGIAO-like col AND a date-like col.
        # The column name has U+FFFD corruption: "REGI��O" — use regex dot-wildcard.
        header_row = None
        for i, row in raw.iterrows():
            vals = [str(v).strip().lower() for v in row if pd.notna(v) and str(v).strip() not in ("", "nan")]
            has_regiao = any(re.search(r"regi.o", v) for v in vals)
            has_date = any(v.startswith("data") or v in ("mes", "mês", "m�s") for v in vals)
            if has_regiao and has_date:
                header_row = i
                break

        if header_row is None:
            continue

        df = raw.iloc[header_row:].copy()
        df.columns = [
            str(v).strip().lower() if pd.notna(v) and str(v).strip() not in ("", "nan") else f"col_{j}"
            for j, v in enumerate(df.iloc[0])
        ]
        df = df.iloc[1:].reset_index(drop=True)

        col_map: dict[str, str] = {}
        for col in df.columns:
            c = col.lower()
            # date: prefer 'data inicial' for semanal, 'mes' for mensal
            if re.search(r"data\s*inicial|^data$|^m.s$|^mes$", c) and "data" not in col_map:
                col_map["data"] = col
            elif re.search(r"regi.o", c) and "regiao" not in col_map:
                col_map["regiao"] = col
            elif re.search(r"produto|combustivel", c) and "produto" not in col_map:
                col_map["produto"] = col
            elif re.search(r"m.dio|medio|media", c) and "medio" not in col_map:
                col_map["medio"] = col
            elif re.search(r"unidade", c) and "unidade" not in col_map:
                col_map["unidade"] = col

        if "data" not in col_map or "medio" not in col_map or "regiao" not in col_map:
            continue

        for _, row in df.iterrows():
            data_val = _parse_date(row.get(col_map["data"]))
            if not data_val:
                continue
            preco_medio = _to_float(row.get(col_map["medio"]))
            if preco_medio is None:
                continue

            regiao_raw = str(row.get(col_map["regiao"], "")).strip().upper()
            # Normalise corruption variants (e.g. "CENTRO�OESTE") — replace
            # any non-ASCII with space and collapse, then strip.
            regiao_val = re.sub(r"[^\x00-\x7F]+", " ", regiao_raw)
            regiao_val = re.sub(r"\s+", " ", regiao_val).strip()
            if regiao_val not in _VALID_REGIOES:
                continue  # skip header repetitions or garbage rows

            produto_raw = str(row.get(col_map.get("produto", ""), "")).strip()
            produto = _normalise_produto(produto_raw)
            if not produto:
                continue

            unidade_raw = str(row.get(col_map.get("unidade", ""), "R$/L")).strip()
            unidade = unidade_raw if unidade_raw and unidade_raw != "nan" else "R$/L"

            rows_out.append({
                "data_referencia": data_val,
                "periodicidade":   periodicidade,
                "produto":         produto,
                "granularidade":   "regiao",
                "uf":              None,
                "municipio":       None,
                "regiao":          regiao_val,
                "preco_medio":     preco_medio,
                "preco_minimo":    None,
                "preco_maximo":    None,
                "numero_postos":   None,
                "unidade":         unidade,
                "fonte_arquivo":   fname,
            })

    if len(rows_out) == 0:
        print(f"  WARNING [{fname}]: 0 linhas parseadas — possivel mudanca de layout no XLSX da ANP")
    return rows_out


# ---------------------------------------------------------------------------
# Dispatch: seleciona parser pelo parser_type
# ---------------------------------------------------------------------------

def _dispatch_parser(content: bytes, fname: str, parser_type: str) -> list[dict]:
    """Route to correct parser based on parser_type from _FILE_CATALOG."""
    if parser_type == "brasil_semanal":
        return _parse_brasil(content, fname)
    elif parser_type == "brasil_mensal":
        return _parse_brasil_mensal(content, fname)
    elif parser_type == "uf_semanal":
        return _parse_uf_liquidos(content, fname, periodicidade="semanal")
    elif parser_type == "uf_mensal":
        return _parse_uf_liquidos(content, fname, periodicidade="mensal")
    elif parser_type == "municipio_semanal":
        # glp-municipios.xlsx uses same layout as combustiveis-liquidos-municipios
        # _parse_glp_municipio_semanal handles DATA INICIAL pattern;
        # _parse_municipio handles DATA/MES pattern.
        # Try glp variant first (handles DATA INICIAL), fall back to standard.
        rows = _parse_glp_municipio_semanal(content, fname)
        if not rows:
            rows = _parse_municipio(content, fname)
        return rows
    elif parser_type == "municipio_mensal":
        rows = _parse_municipio_mensal(content, fname)
        if not rows:
            # try glp variant
            rows = _parse_glp_municipio_semanal(content, fname)
            for r in rows:
                r["periodicidade"] = "mensal"
        return rows
    elif parser_type == "regiao_semanal":
        return _parse_regiao(content, fname, periodicidade="semanal")
    elif parser_type == "regiao_mensal":
        return _parse_regiao(content, fname, periodicidade="mensal")
    else:
        print(f"  WARNING: parser_type desconhecido '{parser_type}' para {fname}")
        return []


# ---------------------------------------------------------------------------
# Deduplication (avoid ON CONFLICT double-update with same key in same batch)
# ---------------------------------------------------------------------------

def _dedup(records: list[dict]) -> list[dict]:
    seen: set[tuple] = set()
    out: list[dict] = []
    for r in records:
        key = (
            r["data_referencia"],
            r["produto"],
            r["granularidade"],
            r.get("uf"),
            r.get("municipio"),
            r.get("regiao"),
        )
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


# ---------------------------------------------------------------------------
# Upsert
# ---------------------------------------------------------------------------

def _upsert(sb, records: list[dict], label: str) -> int:
    total = 0
    n_batches = math.ceil(len(records) / _BATCH)
    for i in range(0, len(records), _BATCH):
        batch = records[i: i + _BATCH]
        sb.table("anp_precos_distribuicao").upsert(
            batch,
            on_conflict="data_referencia,produto,granularidade,uf,municipio,regiao",
        ).execute()
        total += len(batch)
        print(f"  [{label}] batch {i // _BATCH + 1}/{n_batches} — {total:,}/{len(records):,}")
    return total


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="ANP Precos Distribuicao sync")
    parser.add_argument(
        "--discover-only", action="store_true",
        help="Lista as URLs que seriam baixadas sem fazer download nem upsert"
    )
    args = parser.parse_args()

    print("Descobrindo arquivos ANP Precos Distribuicao...")
    entries = _discover_links()

    print(f"  Total: {len(entries)} arquivo(s)")
    for gran_key, xlsx_url, parser_type, period in entries:
        fname = xlsx_url.split("/")[-1]
        print(f"    [{gran_key}/{period}/{parser_type}] {fname}")
        print(f"      {xlsx_url}")

    if args.discover_only:
        print("\n--discover-only: encerrando sem download.")
        return

    url_sup, svc_key = _get_creds()
    sb = create_client(url_sup, svc_key)

    grand_total = 0
    seen_urls: set[str] = set()

    for gran_key, xlsx_url, parser_type, period in entries:
        fname = xlsx_url.split("/")[-1]

        # Idempotencia no loop: pula URLs duplicadas (caso HTML scrape encontre repetido)
        if xlsx_url in seen_urls:
            print(f"\nSkip (duplicado): {fname}")
            continue
        seen_urls.add(xlsx_url)

        print(f"\nBaixando {fname} [{parser_type}]...")
        try:
            content = _download(xlsx_url)
        except Exception as e:
            print(f"  WARNING: falha ao baixar {xlsx_url}: {e}")
            continue
        print(f"  {len(content) / 1024:.0f} KB")

        rows = _dispatch_parser(content, fname, parser_type)
        print(f"  Parseados: {len(rows):,} linhas")
        if len(rows) == 0:
            # _dispatch_parser ja emite WARNING — nao duplicar aqui
            continue

        rows = _dedup(rows)
        print(f"  Apos dedup: {len(rows):,} linhas")
        if rows:
            n = _upsert(sb, rows, f"{gran_key}/{period}")
            grand_total += n

    if grand_total == 0:
        print("\nNenhum dado inserido/atualizado. Verificar layout dos XLSX.")
        sys.exit(1)

    print(f"\nConcluido: {grand_total:,} registros em anp_precos_distribuicao")


if __name__ == "__main__":
    main()
