"""
anp_cdp_powerbi.py
==================
POC de extracao da tabela "Producao por Campo" do Power BI ANP/CDP.

Fonte: relatorio publico "Painel Dinamico de Producao Diaria de Petroleo e Gas Natural"
       pagina 4 ("Campos"), tabela inferior direita "Producao por Campo".
URL:   https://app.powerbi.com/view?r=eyJrIjoiZjQ0NjIzNmYtNzY3Ni00MzZkLWI0MTQtYzk4ZWY0ZGI4ODQ5IiwidCI6IjQ0OTlmNGZmLTI0YTYtNGI0Mi1iN2VmLTEyNGFmY2FkYzkxMyJ9

Granularidade: diaria x campo x bacia
Colunas: data, bacia, campo, petroleo_bbl_dia, gas_mm3_dia

Filtro inicial: campo = PEREGRINO (validacao com 1 campo antes de generalizar)
Output: output/anp_cdp_diaria_<campo>.csv  (CSV virgula UTF-8 BOM)

Constantes descobertas via Chrome MCP em 2026-05-08.

Uso:
  python scripts/extractors/anp_cdp_powerbi.py
  python scripts/extractors/anp_cdp_powerbi.py --campo PEREGRINO
  python scripts/extractors/anp_cdp_powerbi.py --campo PEREGRINO --window 1000
"""

import argparse
import csv
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

try:
    from scripts.extractors._powerbi_common import post_query, extract_row_count
except ModuleNotFoundError:
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from extractors._powerbi_common import post_query, extract_row_count  # type: ignore[import]

# ─── Constantes descobertas via Chrome MCP (2026-05-08) ──────────────────────

RESOURCE_KEY = "f446236f-7676-436d-b414-c98ef4db8849"   # decodificado do ?r= via base64
MODEL_ID     = 3418545
DATASET_ID   = "5dd23708-9095-4e35-b585-d1039d481990"
REPORT_ID    = "0f6fa041-4098-458c-a4ac-1603e4eebbd2"
VISUAL_ID    = "0cb9bc972ac667eac72b"   # tabela "Producao por Campo"

APP_CTX = {
    "DatasetId": DATASET_ID,
    "Sources": [{"ReportId": REPORT_ID, "VisualId": VISUAL_ID}],
}

DEFAULT_OUTPUT = Path("output")
DEFAULT_CAMPO  = "PEREGRINO"


# ─── Helpers de construcao do payload (especificos para CDP) ─────────────────

def _column(src: str, prop: str) -> dict:
    return {"Column": {"Expression": {"SourceRef": {"Source": src}}, "Property": prop}}


def _measure(src: str, prop: str) -> dict:
    return {"Measure": {"Expression": {"SourceRef": {"Source": src}}, "Property": prop}}


def _where_in(src: str, prop: str, values: list) -> dict:
    return {"Condition": {"In": {
        "Expressions": [_column(src, prop)],
        "Values": [[{"Literal": {"Value": f"'{v}'"}}] for v in values],
    }}}


def _where_date_range(src: str, prop: str, start_date: date, end_date_excl: date) -> dict:
    """
    Reproduz exato o shape capturado: And de dois Comparisons.
      ComparisonKind 2 = >= (start, inclusive)
      ComparisonKind 3 = <  (end,   exclusive)
    """
    def _lit(d: date) -> dict:
        return {"Literal": {"Value": f"datetime'{d.isoformat()}T00:00:00'"}}

    return {"Condition": {"And": {
        "Left":  {"Comparison": {"ComparisonKind": 2,
                                 "Left":  _column(src, prop),
                                 "Right": _lit(start_date)}},
        "Right": {"Comparison": {"ComparisonKind": 3,
                                 "Left":  _column(src, prop),
                                 "Right": _lit(end_date_excl)}},
    }}}


def build_cdp_payload(campo: str, start_date: date, end_date_excl: date,
                      window: int = 500) -> dict:
    """
    Monta o payload SemanticQueryDataShapeCommand para a tabela "Producao por Campo".

    Usa Binding Window (paginado) em vez de Top — o shape exato capturado no
    Power BI para este visual. Window.Count=500 e suficiente para PEREGRINO
    (~16 meses diarios = ~485 linhas). Aumente 'window' se necessario.
    """
    # Select — 5 entradas; ordem define os indices 0-4 para o mapeamento
    select_cols = [
        {**_column("d", "Data"),      "Name": "Datas.Data"},
        {**_column("v", "Campo"),     "Name": "v_campos_detalhe.Campo"},
        {**_column("v", "Bacia"),     "Name": "v_campos_detalhe.Bacia"},
        {**_measure("m", "Petróleo"), "Name": "Medidas.Petroleo"},
        {**_measure("m", "Gás Mm3"),  "Name": "Medidas.Gas"},
    ]

    where_conds = [
        _where_in("c", "Unidade", ["bbl"]),          # filtro de unidade
        _where_date_range("d", "Data", start_date, end_date_excl),
        _where_in("v", "Campo", [campo]),             # filtro do campo
    ]

    order_by = [
        {"Direction": 2, "Expression": _column("d", "Data")}   # DESC
    ]

    return {
        "version": "1.0.0",
        "queries": [{
            "Query": {"Commands": [{"SemanticQueryDataShapeCommand": {
                "Query": {
                    "Version": 2,
                    "From": [
                        {"Name": "d", "Entity": "Datas",            "Type": 0},
                        {"Name": "v", "Entity": "v_campos_detalhe", "Type": 0},
                        {"Name": "m", "Entity": "Medidas",          "Type": 0},
                        {"Name": "c", "Entity": "Correção",         "Type": 0},
                    ],
                    "Select":  select_cols,
                    "Where":   where_conds,
                    "OrderBy": order_by,
                },
                "Binding": {
                    "Primary": {"Groupings": [{"Projections": [0, 1, 2, 3, 4], "Subtotal": 1}]},
                    "DataReduction": {"DataVolume": 3, "Primary": {"Window": {"Count": window}}},
                    "Version": 1,
                },
                "ExecutionMetricsKind": 1,
            }}]},
            "QueryId": "",
            "ApplicationContext": APP_CTX,
        }],
        "cancelQueries": [],
        "modelId": MODEL_ID,
    }


# ─── Conversores (definidos antes do parser que os usa) ──────────────────────

def _to_float(v) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ─── Parser DSR especifico para o relatorio CDP ──────────────────────────────

def parse_dsr_cdp(result_json: dict) -> list[dict]:
    """
    Parser dedicado para o formato DSR retornado pelo relatorio CDP (producao diaria).

    Diferencas vs. relatorio de Vendas:
    - Os dados detalhados estao em PH[1].DM1 (nao PH[0].DM0 que contem subtotais)
    - A data e Unix timestamp em milissegundos, nao uma string
    - Measures (Petroleo, Gas) nao passam por ValueDict; sao strings numericas diretas
    - R: 6 (bits 1+2) indica heranca de Campo e Bacia do item anterior

    Schema das colunas em DM1 (ordem dos indices 0-4 em PH[1].DM1[0].S):
      idx 0 -> G0 = Data (timestamp ms)
      idx 1 -> G1 = Campo  (lookup em D0 — indice inteiro ou string)
      idx 2 -> G2 = Bacia  (lookup em D1 — indice inteiro ou string)
      idx 3 -> M0 = Petroleo (string numerica, bbl/dia)
      idx 4 -> M1 = Gas     (string numerica, Mm3/dia)
    """
    dsr   = result_json["results"][0]["result"]["data"]["dsr"]
    ds    = dsr["DS"][0]
    dicts = ds.get("ValueDicts", {})

    # Dados detalhados estao em PH[1].DM1 (PH[0].DM0 tem subtotais/totais)
    items = ds["PH"][1]["DM1"]

    # Schema: esquema da primeira linha (contem "S")
    schema_item = next((i for i in items if "S" in i), None)
    col_dicts: list[str | None] = []
    if schema_item:
        col_dicts = [s.get("DN") for s in schema_item["S"]]
    # col_dicts = [None, "D0", "D1", None, None]
    # (G0=Data sem dict, G1=Campo via D0, G2=Bacia via D1, M0=Petroleo sem dict, M1=Gas sem dict)

    def resolve(v, dk):
        """Resolve valor via ValueDict se disponivel."""
        if dk and dk in dicts and isinstance(v, int) and v < len(dicts[dk]):
            return dicts[dk][v]
        return v

    def ts_to_date(ts) -> str | None:
        """Converte Unix timestamp em ms para string ISO YYYY-MM-DD."""
        if ts is None:
            return None
        try:
            return datetime.fromtimestamp(float(ts) / 1000, tz=timezone.utc).date().isoformat()
        except (TypeError, ValueError, OSError):
            return str(ts)

    rows: list[dict] = []
    prev = [None] * len(col_dicts)

    for item in items:
        if "C" not in item:
            continue
        row = list(prev)
        if "R" in item:
            # Mascara de bits: bit i=1 -> herda coluna i do anterior
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
        prev = row[:]
        rows.append({
            "data":             ts_to_date(row[0]),
            "campo":            row[1],
            "bacia":            row[2],
            "petroleo_bbl_dia": _to_float(row[3]),
            "gas_mm3_dia":      _to_float(row[4]),
        })

    return rows


# ─── Extracao ─────────────────────────────────────────────────────────────────

def extract_producao_diaria(
    campo: str = DEFAULT_CAMPO,
    start_date: date | None = None,
    end_date_excl: date | None = None,
    window: int = 500,
) -> list[dict]:
    """
    Extrai producao diaria do campo indicado.

    Retorna lista de dicts com:
      data, campo, bacia, petroleo_bbl_dia, gas_mm3_dia

    O select tem 5 colunas na ordem: Data(0), Campo(1), Bacia(2), Petroleo(3), Gas(4).
    O mapeamento abaixo pressupoe essa ordem — confirmar com _debug_cdp_response.json
    no primeiro run.
    """
    start   = start_date   or date(2025, 1, 1)
    end_excl = end_date_excl or (date.today() + timedelta(days=1))

    print(f"[CDP] Extraindo producao diaria: campo={campo}, "
          f"{start.isoformat()} ate {end_excl.isoformat()} (excl.), window={window}")

    payload = build_cdp_payload(campo, start, end_excl, window)

    # Salvar payload para debug (util para inspecionar se a resposta vier vazia)
    DEFAULT_OUTPUT.mkdir(parents=True, exist_ok=True)
    (DEFAULT_OUTPUT / "_debug_cdp_payload.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    data = post_query(payload, RESOURCE_KEY)

    # Salvar resposta crua para debug e validacao da ordem das colunas
    (DEFAULT_OUTPUT / "_debug_cdp_response.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    row_count, complete = extract_row_count(data)
    print(f"   Linhas API: {row_count} | Completo: {complete}")
    if complete is False:
        print(f"   ATENCAO: Truncado em {window} linhas — aumente --window se necessario")

    rows = parse_dsr_cdp(data)
    print(f"   Linhas parseadas: {len(rows)}")
    return rows


# ─── Escrita do CSV ───────────────────────────────────────────────────────────

def write_csv(rows: list[dict], output_path: Path) -> None:
    """Escreve CSV virgula UTF-8 BOM (Excel-friendly)."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["data", "campo", "bacia", "petroleo_bbl_dia", "gas_mm3_dia"]
    with open(output_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, delimiter=",")
        w.writeheader()
        w.writerows(rows)
    print(f"CSV salvo: {output_path} ({len(rows)} linhas)")


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="POC ANP CDP Power BI extractor")
    p.add_argument("--campo",  default=DEFAULT_CAMPO,
                   help=f"Nome do campo (padrao: {DEFAULT_CAMPO})")
    p.add_argument("--output", type=Path, default=None,
                   help="Caminho de saida do CSV (padrao: output/anp_cdp_diaria_<campo>.csv)")
    p.add_argument("--window", type=int, default=500,
                   help="Limite de linhas da Window do Power BI (padrao: 500)")
    args = p.parse_args()

    out = args.output or (DEFAULT_OUTPUT / f"anp_cdp_diaria_{args.campo.lower()}.csv")

    try:
        rows = extract_producao_diaria(args.campo, window=args.window)
    except requests.HTTPError as e:
        print(f"ERRO HTTP {e.response.status_code}: {e.response.text[:400]}", file=sys.stderr)
        sys.exit(1)

    if not rows:
        print("ERRO: Nenhuma linha retornada.", file=sys.stderr)
        print("Inspecione output/_debug_cdp_response.json para diagnostico.", file=sys.stderr)
        sys.exit(1)

    write_csv(rows, out)

    # Spot check: primeiras 3 linhas
    print("\n--- Spot check (primeiras 3 linhas) ---")
    for r in rows[:3]:
        print(f"  data={r['data']}  campo={r['campo']}  bacia={r['bacia']}  "
              f"petroleo={r['petroleo_bbl_dia']}  gas={r['gas_mm3_dia']}")


if __name__ == "__main__":
    main()
