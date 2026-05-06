"""
anp_extrator.py
===============
Extrai do Painel ANP (Power BI público) os dados do ÚLTIMO MÊS disponível.

Colunas extraídas:
  ANO | MES | PRODUTO | REGIAO | ESTADO | MERCADO_DEST | AGENTE | QTD_MIL_M3

Dependências (instale uma vez):
  pip install requests

Uso:
  python anp_extrator.py
  Gera ANP_<MES>_<ANO>.csv na pasta onde o script for executado.

══════════════════════════════════════════════════════════════════════════════
SOBRE A KEY DE ACESSO
══════════════════════════════════════════════════════════════════════════════
A autenticação usa X-PowerBI-ResourceKey, extraída do link público do painel
que a ANP publica em gov.br. Ela SÓ muda se a ANP regenerar manualmente o
embed do relatório — o que é raro (o painel existe desde 2020 sem alteração
de link). O script tenta buscar a key atualizada no site da ANP antes de
cada execução. Se o site estiver fora do ar, usa a última key conhecida como
fallback. Você não precisa atualizar nada manualmente.
"""

import base64
import csv
import json
import re
import sys
import requests

# ─── Endpoints e configuração ─────────────────────────────────────────────────
API_URL = (
    "https://wabi-brazil-south-api.analysis.windows.net"
    "/public/reports/querydata?synchronous=true"
)

# Páginas oficiais da ANP — o script tenta cada uma até achar a resource key
ANP_PAGE_URLS = [
    "https://www.gov.br/anp/pt-br/centrais-de-conteudo/paineis-dinamicos-da-anp"
    "/paineis-dinamicos-do-abastecimento"
    "/painel-dinamico-do-mercado-brasileiro-de-combustiveis-liquidos",
    "https://www.gov.br/anp/pt-br/centrais-de-conteudo/paineis-dinamicos-da-anp"
    "/paineis-dinamicos-do-abastecimento",
    "https://www.gov.br/anp/pt-br/centrais-de-conteudo/paineis-dinamicos-da-anp"
    "/paineis-dinamicos-sobre-combustiveis",
]

# Fallback: última configuração conhecida e validada
_FALLBACK_KEY      = "be31645f-6a3a-4eec-ad08-fb6738ff3c88"
_FALLBACK_MODEL_ID = 2953717
_FALLBACK_APP_CTX  = {
    "DatasetId": "fb32d51e-43ed-4066-8cbb-cb2690a142e6",
    "Sources": [{"ReportId": "ab5668ef-7441-4c08-a527-bc1c459f7e2a",
                 "VisualId": "e2851d3876dd02101cbe"}]
}

MESES_ORDER = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]


# ─── Resolução da key de acesso ───────────────────────────────────────────────

def _fetch_key_from_anp_page() -> str | None:
    """Busca a resource key nas páginas oficiais da ANP."""
    for url in ANP_PAGE_URLS:
        try:
            r = requests.get(url, timeout=15,
                             headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            for match in re.findall(r'powerbi\.com/view\?r=([A-Za-z0-9+/=_-]+)', r.text):
                try:
                    pad = match + '=' * (-len(match) % 4)
                    decoded = json.loads(base64.b64decode(pad))
                    if 'k' in decoded:
                        return decoded['k']
                except Exception:
                    continue
        except Exception:
            continue
    print("   [aviso] Não foi possível obter key em nenhuma página da ANP.")
    return None


def resolve_config() -> tuple[str, int, dict]:
    """
    Retorna (resource_key, model_id, app_ctx).
    Prioriza a key publicada no site da ANP; usa fallback se necessário.
    """
    print("🔑 Buscando key de acesso no site oficial da ANP...")
    key = _fetch_key_from_anp_page()
    if key and key != _FALLBACK_KEY:
        print(f"   ✅ Nova key encontrada: {key[:8]}... (fallback atualizado)")
    elif key:
        print(f"   ✅ Key confirmada: {key[:8]}...")
    else:
        key = _FALLBACK_KEY
        print(f"   ⚠️  Usando fallback: {key[:8]}...")
    return key, _FALLBACK_MODEL_ID, _FALLBACK_APP_CTX


# ─── Funções de consulta ──────────────────────────────────────────────────────

def post_query(payload: dict, resource_key: str) -> dict:
    headers = {
        "Content-Type": "application/json",
        "X-PowerBI-ResourceKey": resource_key,
    }
    r = requests.post(API_URL, headers=headers, json=payload, timeout=60)
    r.raise_for_status()
    return r.json()


def col(source: str, prop: str) -> dict:
    return {"Column": {"Expression": {"SourceRef": {"Source": source}},
                       "Property": prop}}


def agg(source: str, prop: str, func: int = 0) -> dict:
    return {"Aggregation": {"Expression": col(source, prop), "Function": func}}


def where_in(source: str, prop: str, values: list) -> dict:
    return {"Condition": {"In": {
        "Expressions": [col(source, prop)],
        "Values": [[{"Literal": {"Value": f"'{v}'"}}] for v in values],
    }}}


def build_payload(select_cols: list, where_conds: list,
                  model_id: int, app_ctx: dict, limit: int = 100_000) -> dict:
    return {
        "version": "1.0.0",
        "queries": [{
            "Query": {
                "Commands": [{
                    "SemanticQueryDataShapeCommand": {
                        "Query": {
                            "Version": 2,
                            "From": [
                                {"Name": "f", "Entity": "(Movimento) - FT_SDL_MOVIMENTO",  "Type": 0},
                                {"Name": "d", "Entity": "DM_TEMPO",                        "Type": 0},
                                {"Name": "p", "Entity": "(Movimento) - DM_PRODUTO_SIMP",   "Type": 0},
                                {"Name": "e", "Entity": "(Movimento) - DM_SIMP_EMPRESA",   "Type": 0},
                            ],
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


# ─── Parser do formato DSR comprimido do Power BI ────────────────────────────

def parse_dsr(result_json: dict) -> list[list]:
    """
    Converte a resposta DSR comprimida do Power BI em lista de linhas.
    O DSR usa dicionários de valores e máscaras de bits (R) para compressão.
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


# ─── Passo 1: descobrir último mês disponível ─────────────────────────────────

def get_ultimo_mes(resource_key: str, model_id: int, app_ctx: dict) -> tuple[str, str]:
    print("🔍 Buscando último mês disponível na base...")

    payload = build_payload(
        select_cols=[
            {**col("d", "ANO"),           "Name": "ANO"},
            {**col("d", "NOM_MES_ABREV"), "Name": "MES"},
        ],
        where_conds=[where_in("f", "TIPO_EXTRACAO", ["Vendas"])],
        model_id=model_id, app_ctx=app_ctx, limit=500,
    )

    data = post_query(payload, resource_key)
    rows = parse_dsr(data)

    def sort_key(r):
        ano = str(r[0]) if r[0] else "0"
        mes = MESES_ORDER.index(r[1]) if r[1] in MESES_ORDER else -1
        return (ano, mes)

    validos = [r for r in rows if r[0] and r[1] in MESES_ORDER]
    if not validos:
        raise RuntimeError("Não foi possível obter os meses disponíveis.")

    ultimo = max(validos, key=sort_key)
    ano, mes = str(ultimo[0]), str(ultimo[1])
    print(f"   ✅ Último mês disponível: {mes}/{ano}")
    return ano, mes


# ─── Passo 2: extrair dados completos do mês ─────────────────────────────────

def get_dados_mes(ano: str, mes: str,
                  resource_key: str, model_id: int, app_ctx: dict) -> list[list]:
    print(f"📦 Extraindo dados de {mes}/{ano} (todos os produtos e estados)...")

    payload = build_payload(
        select_cols=[
            {**col("d", "ANO"),              "Name": "ANO"},
            {**col("d", "NOM_MES_ABREV"),    "Name": "MES"},
            {**col("p", "GRP_PRODUTO_VENDAS"),"Name": "PRODUTO"},
            {**col("f", "C_REGIAO"),          "Name": "REGIAO"},
            {**col("f", "C_UF"),              "Name": "ESTADO"},
            {**col("f", "QUALIF_DEST"),       "Name": "MERCADO_DEST"},
            {**col("e", "NOM_RAZAO_SOCIAL"),  "Name": "AGENTE"},
            {**agg("f", "QTD_PRODUTO"),       "Name": "QTD"},
        ],
        where_conds=[
            where_in("d", "ANO",           [ano]),
            where_in("d", "NOM_MES_ABREV", [mes]),
            where_in("f", "TIPO_EXTRACAO", ["Vendas"]),
        ],
        model_id=model_id, app_ctx=app_ctx, limit=100_000,
    )

    data   = post_query(payload, resource_key)
    dsr_ds = data["results"][0]["result"]["data"]["dsr"]["DS"][0]
    ic     = dsr_ds.get("IC", False)
    events = data["results"][0]["result"]["data"]["metrics"]["Events"]
    row_count = next((e["Metrics"]["RowCount"]
                      for e in events if e["Name"] == "Execute DAX Query"), "?")

    print(f"   Linhas na API: {row_count} | Conjunto completo: {ic}")
    if not ic:
        print("   ⚠️  Atenção: pode haver mais de 100.000 linhas. Dados truncados.")

    rows = parse_dsr(data)
    print(f"   Linhas parseadas: {len(rows)}")
    return rows


# ─── Passo 3: gerar CSV ──────────────────────────────────────────────────────

def gerar_csv(rows: list[list], ano: str, mes: str, caminho: str):
    print(f"📊 Gerando CSV: {caminho}")
    COLS = ["ANO", "MES", "PRODUTO", "REGIAO", "ESTADO", "MERCADO_DEST", "AGENTE", "QTD_MIL_M3"]

    with open(caminho, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow(COLS)
        for row in rows:
            try:
                qtd = float(row[7]) if row[7] is not None else 0.0
            except (TypeError, ValueError):
                qtd = 0.0
            writer.writerow([
                str(row[0] or ""),
                str(row[1] or ""),
                str(row[2] or ""),
                str(row[3] or ""),
                str(row[4] or ""),
                str(row[5] or ""),
                str(row[6] or ""),
                qtd,
            ])

    print(f"✅ CSV salvo: {caminho}")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  ANP Extrator — Painel de Mercados de Combustíveis")
    print("=" * 60)
    try:
        resource_key, model_id, app_ctx = resolve_config()

        ano, mes = get_ultimo_mes(resource_key, model_id, app_ctx)
        rows     = get_dados_mes(ano, mes, resource_key, model_id, app_ctx)

        if not rows:
            print("❌ Nenhuma linha retornada pela API.")
            sys.exit(1)

        nome_arquivo = f"ANP_{mes}_{ano}.csv"
        gerar_csv(rows, ano, mes, nome_arquivo)

        print()
        print("=" * 60)
        print(f"  Concluído! {len(rows):,} linhas extraídas.")
        print(f"  Arquivo: {nome_arquivo}")
        print("=" * 60)

    except requests.HTTPError as e:
        print(f"\n❌ Erro HTTP {e.response.status_code}: {e.response.text[:400]}")
        sys.exit(1)
    except Exception as e:
        import traceback
        print(f"\n❌ Erro: {e}")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
