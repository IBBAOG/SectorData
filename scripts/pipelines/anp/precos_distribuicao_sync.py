#!/usr/bin/env python3
"""
precos_distribuicao_sync.py
===========================
Baixa os XLSX de Precos de Distribuicao de Combustiveis da ANP,
parseia cada um e upserta em anp_precos_distribuicao.
Idempotente — ON CONFLICT DO UPDATE via UNIQUE(data_referencia, produto, granularidade, uf, municipio).

Fontes:
  - combustiveis-liquidos-brasil*.xlsx  → semanal, granularidade='brasil'
  - glp-estados*.xlsx                   → mensal, granularidade='uf', produto='GLP P13'
  - combustiveis-liquidos-municipios*.xlsx → mensal, granularidade='municipio'

Uso:
    python scripts/pipelines/anp/precos_distribuicao_sync.py

Credenciais: SUPABASE_URL + SUPABASE_SERVICE_KEY (env ou .env)
"""

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
_HEADERS = {"User-Agent": "Mozilla/5.0"}
_BATCH = 1000

# Canonical product name mapping (normalise variations found in XLSX headers)
_PRODUTO_MAP = {
    "gasolina comum":         "Gasolina Comum",
    "gasolina c":             "Gasolina Comum",
    "gasolina":               "Gasolina Comum",
    "etanol hidratado":       "Etanol Hidratado",
    "etanol":                 "Etanol Hidratado",
    "alcool etilico hidratado combustivel": "Etanol Hidratado",
    "diesel s10":             "Diesel S10",
    "oleo diesel s10":        "Diesel S10",
    "diesel s500":            "Diesel S500",
    "oleo diesel s500":       "Diesel S500",
    "oleo diesel":            "Diesel S500",
    "gnv":                    "GNV",
    "gas natural veicular":   "GNV",
    "glp":                    "GLP P13",
    "glp p13":                "GLP P13",
    "gas liqüefeito de petroleo": "GLP P13",
    "gas liquefeito de petroleo": "GLP P13",
}

# Filename patterns to look for on the ANP page
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

def _discover_links() -> dict[str, list[tuple[str, str]]]:
    """Return {'brasil': [(url, filename), ...], 'uf': [...], 'municipio': [...]}"""
    r = requests.get(_PAGE_URL, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    found: dict[str, list[tuple[str, str]]] = {k: [] for k, _ in _PATTERNS}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not href.lower().endswith(".xlsx"):
            continue
        fname = href.split("/")[-1]
        full_url = href if href.startswith("http") else "https://www.gov.br" + href
        for key, pat in _PATTERNS:
            if pat.search(fname):
                found[key].append((full_url, fname))
                break
    return found


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
    # remove accents for matching
    key = (key
           .replace("á", "a").replace("é", "e").replace("í", "i")
           .replace("ó", "o").replace("ú", "u").replace("ã", "a")
           .replace("â", "a").replace("ê", "e").replace("ô", "o")
           .replace("ç", "c").replace("ü", "u"))
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

        # Scan for header row (row containing 'produto' or 'data')
        header_row = None
        for i, row in raw.iterrows():
            vals = [str(v).strip().lower() for v in row if pd.notna(v)]
            if any(v in ("produto", "combustivel", "data", "data inicial", "semana") for v in vals):
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
            elif re.search(r"^data|semana|periodo", c) and "data" not in col_map:
                col_map["data"] = col
            elif re.search(r"medio|médio|media|média", c) and "medio" not in col_map:
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

        header_row = None
        for i, row in raw.iterrows():
            vals = [str(v).strip().lower() for v in row if pd.notna(v)]
            if any(v in ("municipio", "município", "localidade", "cidade") for v in vals):
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
            if re.search(r"municipio|município|localidade|cidade", c) and "municipio" not in col_map:
                col_map["municipio"] = col
            elif re.search(r"^uf|^estado", c) and "uf" not in col_map:
                col_map["uf"] = col
            elif re.search(r"produto|combustivel", c) and "produto" not in col_map:
                col_map["produto"] = col
            elif re.search(r"^data|^mes|^mês|^periodo", c) and "data" not in col_map:
                col_map["data"] = col
            elif re.search(r"medio|médio", c) and "medio" not in col_map:
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
            on_conflict="data_referencia,produto,granularidade,uf,municipio",
        ).execute()
        total += len(batch)
        print(f"  [{label}] batch {i // _BATCH + 1}/{n_batches} — {total:,}/{len(records):,}")
    return total


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("Descobrindo links na pagina ANP Precos Distribuicao...")
    links = _discover_links()
    for key, lst in links.items():
        print(f"  {key}: {len(lst)} arquivo(s) encontrado(s)")

    url, key = _get_creds()
    sb = create_client(url, key)

    grand_total = 0

    # --- Brasil (semanal) ---
    for xlsx_url, fname in links.get("brasil", []):
        print(f"\nBaixando {fname}...")
        content = _download(xlsx_url)
        print(f"  {len(content) / 1024:.0f} KB")
        rows = _parse_brasil(content, fname)
        print(f"  Parseados: {len(rows):,} linhas")
        rows = _dedup(rows)
        print(f"  Apos dedup: {len(rows):,} linhas")
        if rows:
            n = _upsert(sb, rows, "brasil")
            grand_total += n

    # --- UF / GLP (mensal) ---
    for xlsx_url, fname in links.get("uf", []):
        print(f"\nBaixando {fname}...")
        content = _download(xlsx_url)
        print(f"  {len(content) / 1024:.0f} KB")
        rows = _parse_uf(content, fname)
        print(f"  Parseados: {len(rows):,} linhas")
        rows = _dedup(rows)
        print(f"  Apos dedup: {len(rows):,} linhas")
        if rows:
            n = _upsert(sb, rows, "uf")
            grand_total += n

    # --- Municipios (mensal) ---
    for xlsx_url, fname in links.get("municipio", []):
        print(f"\nBaixando {fname}...")
        content = _download(xlsx_url)
        print(f"  {len(content) / 1024:.0f} KB")
        rows = _parse_municipio(content, fname)
        print(f"  Parseados: {len(rows):,} linhas")
        rows = _dedup(rows)
        print(f"  Apos dedup: {len(rows):,} linhas")
        if rows:
            n = _upsert(sb, rows, "municipio")
            grand_total += n

    if grand_total == 0:
        print("\nNenhum dado inserido/atualizado. Verificar layout dos XLSX.")
        sys.exit(1)

    print(f"\nConcluido: {grand_total:,} registros em anp_precos_distribuicao")


if __name__ == "__main__":
    main()
