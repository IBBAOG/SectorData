"""
_powerbi_common.py
==================
Funções compartilhadas entre os extractors do Power BI da ANP.

Exporta:
  WABI_API_URL         — endpoint da API interna do Power BI (Brazil South)
  decode_resource_key_from_view_url(url) -> str
  fetch_key_from_pages(page_urls, fallback_key) -> str
  col(source, prop) -> dict
  agg(source, prop, func=0) -> dict
  where_in(source, prop, values) -> dict
  build_payload(entities, select_cols, where_conds, model_id, app_ctx, limit) -> dict
  post_query(payload, resource_key, timeout=60) -> dict
  parse_dsr(result_json) -> list[list]
  extract_row_count(result_json) -> tuple[int | None, bool]
"""

import base64
import json
import re
import requests

# ─── Endpoint público do Power BI (Brazil South) ──────────────────────────────

WABI_API_URL = (
    "https://wabi-brazil-south-api.analysis.windows.net"
    "/public/reports/querydata?synchronous=true"
)


# ─── Resolução da resource key ────────────────────────────────────────────────

def decode_resource_key_from_view_url(url: str) -> str | None:
    """
    Extrai a resource key UUID do parâmetro ?r= de um link público do Power BI.

    O parâmetro ?r= é um JSON Base64 com campos 'k' (key) e 't' (tenant).
    Retorna None se a URL não contiver o padrão esperado.
    """
    match = re.search(r'[?&]r=([A-Za-z0-9+/=_-]+)', url)
    if not match:
        return None
    raw = match.group(1)
    try:
        pad = raw + '=' * (-len(raw) % 4)
        decoded = json.loads(base64.b64decode(pad))
        return decoded.get('k')
    except Exception:
        return None


def fetch_key_from_pages(page_urls: list[str], fallback_key: str) -> str:
    """
    Busca a resource key nas páginas fornecidas (lista de URLs HTML da ANP ou
    qualquer outra página que embede o link ?r=... do Power BI).

    Retorna a primeira key encontrada, ou fallback_key se nenhuma for encontrada.
    """
    for url in page_urls:
        try:
            r = requests.get(url, timeout=15,
                             headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            for match in re.findall(r'powerbi\.com/view\?r=([A-Za-z0-9+/=_-]+)', r.text):
                key = None
                try:
                    pad = match + '=' * (-len(match) % 4)
                    decoded = json.loads(base64.b64decode(pad))
                    key = decoded.get('k')
                except Exception:
                    continue
                if key:
                    return key
        except Exception:
            continue
    print("   [aviso] Não foi possível obter key em nenhuma página.")
    return fallback_key


# ─── Helpers de construção de query ──────────────────────────────────────────

def col(source: str, prop: str) -> dict:
    """Referência a coluna de uma entidade do modelo semântico."""
    return {"Column": {"Expression": {"SourceRef": {"Source": source}},
                       "Property": prop}}


def agg(source: str, prop: str, func: int = 0) -> dict:
    """Agregação sobre coluna (func=0 = Sum)."""
    return {"Aggregation": {"Expression": col(source, prop), "Function": func}}


def where_in(source: str, prop: str, values: list) -> dict:
    """Filtro IN sobre coluna."""
    return {"Condition": {"In": {
        "Expressions": [col(source, prop)],
        "Values": [[{"Literal": {"Value": f"'{v}'"}}] for v in values],
    }}}


def build_payload(entities: list[dict], select_cols: list, where_conds: list,
                  model_id: int, app_ctx: dict, limit: int = 100_000) -> dict:
    """
    Monta o payload SemanticQueryDataShapeCommand para a API interna do Power BI.

    Parâmetros:
      entities    — lista de From[] dicts: [{"Name": "x", "Entity": "...", "Type": 0}, ...]
      select_cols — lista de itens Select[], cada um com "Name" e expressão col()/agg()/measure
      where_conds — lista de condições Where[]
      model_id    — modelId numérico do relatório
      app_ctx     — ApplicationContext (DatasetId + Sources)
      limit       — número máximo de linhas (DataReduction Top.Count)

    O Binding usa Top.Count (adequado para Vendas e maioria dos casos).
    Para paginação Window (ex: CDP diário), construa o Binding externamente.
    """
    return {
        "version": "1.0.0",
        "queries": [{
            "Query": {
                "Commands": [{
                    "SemanticQueryDataShapeCommand": {
                        "Query": {
                            "Version": 2,
                            "From":   entities,
                            "Select": select_cols,
                            "Where":  where_conds,
                        },
                        "Binding": {
                            "Primary": {"Groupings": [{"Projections": list(range(len(select_cols)))}]},
                            "DataReduction": {"DataVolume": 4, "Primary": {"Top": {"Count": limit}}},
                            "Version": 1,
                        },
                        "ExecutionMetricsKind": 1,
                    }
                }]
            },
            "QueryId": "",
            "ApplicationContext": app_ctx,
        }],
        "cancelQueries": [],
        "modelId": model_id,
    }


# ─── HTTP ─────────────────────────────────────────────────────────────────────

def post_query(payload: dict, resource_key: str, timeout: int = 60) -> dict:
    """Envia o payload para a API pública do Power BI e retorna o JSON de resposta."""
    headers = {
        "Content-Type": "application/json",
        "X-PowerBI-ResourceKey": resource_key,
    }
    r = requests.post(WABI_API_URL, headers=headers, json=payload, timeout=timeout)
    r.raise_for_status()
    return r.json()


# ─── Parser do formato DSR comprimido ────────────────────────────────────────

def parse_dsr(result_json: dict) -> list[list]:
    """
    Converte a resposta DSR comprimida do Power BI em lista de linhas.

    O formato DSR usa ValueDicts (dicionários de desduplicação) e máscaras de
    bits (campo "R") para compressão. Esta função descomprime e devolve cada
    linha como uma lista de valores na mesma ordem do Select[].
    """
    dsr   = result_json["results"][0]["result"]["data"]["dsr"]
    ds    = dsr["DS"][0]
    dicts = ds.get("ValueDicts", {})
    items = ds["PH"][0]["DM0"]

    # Schema: posição → chave do dicionário de valores (ex: 'D0', 'D1'...)
    schema_item = next((i for i in items if "S" in i), None)
    col_dicts: list[str | None] = []
    if schema_item:
        col_dicts = [s.get("DN") for s in schema_item["S"]]

    def resolve(v, dk):
        if dk and dk in dicts and isinstance(v, int) and v < len(dicts[dk]):
            return dicts[dk][v]
        return v

    rows: list[list] = []
    prev = [None] * len(col_dicts)

    for item in items:
        if "C" not in item:
            continue
        row = list(prev)
        if "R" in item:
            # Máscara de bits: bit i=1 → herda coluna i do anterior
            mask, c_idx = item["R"], 0
            for i in range(len(col_dicts)):
                if not ((mask >> i) & 1):
                    if c_idx < len(item["C"]):
                        row[i] = resolve(item["C"][c_idx], col_dicts[i])
                        c_idx += 1
        else:
            for i, v in enumerate(item["C"]):
                if i < len(col_dicts):
                    row[i] = resolve(v, col_dicts[i])
        prev = row
        rows.append(list(row))

    return rows


# ─── Extração de métricas da resposta ─────────────────────────────────────────

def extract_row_count(result_json: dict) -> tuple[int | None, bool]:
    """
    Extrai o número de linhas retornadas pelo servidor e se o conjunto é completo.

    Retorna:
      (row_count, is_complete)
      row_count   — int com contagem de linhas, ou None se não disponível
      is_complete — True se o conjunto está completo (IC=True no DSR), False se truncado
    """
    try:
        dsr_ds = result_json["results"][0]["result"]["data"]["dsr"]["DS"][0]
        is_complete = bool(dsr_ds.get("IC", False))
    except (KeyError, IndexError):
        is_complete = False

    try:
        events = result_json["results"][0]["result"]["data"]["metrics"]["Events"]
        row_count = next(
            (e["Metrics"]["RowCount"] for e in events if e["Name"] == "Execute DAX Query"),
            None
        )
    except (KeyError, IndexError, TypeError):
        row_count = None

    return row_count, is_complete
