#!/usr/bin/env python3
"""
visualizar.py
=============
App Dash com toggle entre Vendas, Entregas e Importações do Painel ANP.

Uso:
    python alertas/scripts/anp_painel_combustiveis/visualizar.py
    Abrir http://localhost:8050
"""
import sys
from pathlib import Path

import duckdb
import plotly.graph_objects as go
from dash import Dash, Input, Output, callback, dcc, html

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_BASE_DIR = Path(__file__).parents[3] / "DADOS" / "anp_painel_combustiveis"
_PARQUETS = {
    "vendas":      _BASE_DIR / "vendas.parquet",
    "entregas":    _BASE_DIR / "entregas.parquet",
    "importacoes": _BASE_DIR / "importacoes_distribuidores.parquet",
}

# Validação
for nome, path in _PARQUETS.items():
    if not path.exists():
        print(f"ERRO: Parquet não encontrado: {path}")
        sys.exit(1)

print("Inicializando DuckDB...", flush=True)
_con = duckdb.connect(database=":memory:")

# Pré-computa metadados de cada dataset
def _meta(parquet: Path) -> dict:
    p = str(parquet).replace("\\", "/")
    produtos = [r[0] for r in _con.execute(
        f"SELECT DISTINCT nome_produto FROM read_parquet('{p}') WHERE nome_produto IS NOT NULL ORDER BY 1"
    ).fetchall()]
    info = _con.execute(
        f"SELECT MIN(ano), MAX(ano), COUNT(*) FROM read_parquet('{p}')"
    ).fetchone()
    return {"path": p, "produtos": produtos,
            "min_ano": info[0], "max_ano": info[1], "total": info[2]}

META = {k: _meta(v) for k, v in _PARQUETS.items()}
for k, m in META.items():
    print(f"  {k:13s} {m['total']:>10,} linhas | {m['min_ano']}-{m['max_ano']} | {len(m['produtos'])} produtos")
print("Iniciando servidor em http://localhost:8050", flush=True)

# Limites globais (para o slider funcionar com qualquer dataset)
MIN_ANO = min(m["min_ano"] for m in META.values())
MAX_ANO = max(m["max_ano"] for m in META.values())

# Listas de filtros adicionais
def _unicos(parquet: str, coluna: str) -> list[str]:
    rows = _con.execute(
        f"SELECT DISTINCT {coluna} FROM read_parquet('{parquet}') "
        f"WHERE {coluna} IS NOT NULL ORDER BY 1"
    ).fetchall()
    return [r[0] for r in rows]


app = Dash(__name__)
app.layout = html.Div([
    html.H2(f"ANP Painel Combustíveis Líquidos ({MIN_ANO}–{MAX_ANO})",
            style={"fontFamily": "Arial", "marginBottom": "16px"}),

    html.Div([
        html.Label("Dataset", style={"fontWeight": "bold"}),
        dcc.RadioItems(
            id="radio-dataset",
            options=[
                {"label": "Vendas (distribuidor → cliente)",        "value": "vendas"},
                {"label": "Entregas (refinaria/usina → distribuidor)", "value": "entregas"},
                {"label": "Importações (distribuidor importa direto)", "value": "importacoes"},
            ],
            value="vendas", inline=True,
        ),
    ], style={"marginBottom": "16px", "fontFamily": "Arial"}),

    html.Div([
        html.Div([
            html.Label("Produto", style={"fontWeight": "bold"}),
            dcc.Dropdown(id="dd-produto", multi=True, clearable=False),
        ], style={"flex": "2", "minWidth": "320px"}),

        html.Div([
            html.Label("Filtro 1 (Agente / Fornecedor / Distribuidor)",
                       style={"fontWeight": "bold"}),
            dcc.Dropdown(id="dd-filtro1", clearable=False),
        ], style={"flex": "2", "minWidth": "300px"}),

        html.Div([
            html.Label("Filtro 2 (UF Destino / Localidade)",
                       style={"fontWeight": "bold"}),
            dcc.Dropdown(id="dd-filtro2", clearable=False),
        ], style={"flex": "1", "minWidth": "180px"}),

        html.Div([
            html.Label("Granularidade", style={"fontWeight": "bold"}),
            dcc.RadioItems(
                id="radio-grupo",
                options=[{"label": "Mês", "value": "mes"},
                         {"label": "Ano", "value": "ano"}],
                value="mes", inline=True,
            ),
        ], style={"flex": "1", "minWidth": "160px", "paddingTop": "20px"}),
    ], style={"display": "flex", "gap": "16px", "flexWrap": "wrap",
              "marginBottom": "16px", "fontFamily": "Arial"}),

    html.Div([
        html.Label("Período (anos)", style={"fontWeight": "bold", "fontFamily": "Arial"}),
        dcc.RangeSlider(
            id="slider-ano",
            min=MIN_ANO, max=MAX_ANO, step=1,
            value=[max(MIN_ANO, MAX_ANO - 10), MAX_ANO],
            marks={y: str(y) for y in range(MIN_ANO, MAX_ANO + 1, 2)},
            tooltip={"placement": "bottom"},
        ),
    ], style={"marginBottom": "8px"}),

    dcc.Graph(id="grafico", style={"height": "520px"}),
    html.Div(id="info", style={"fontFamily": "Arial", "fontSize": "12px",
                               "color": "#666", "marginTop": "4px"}),
], style={"maxWidth": "1400px", "margin": "0 auto", "padding": "24px"})


# Configuração de filtros por dataset
_FILTRO_CFG = {
    "vendas":      {"col1": "agente_regulado", "col2": "uf_destino"},
    "entregas":    {"col1": "fornecedor",      "col2": "uf_destino"},
    "importacoes": {"col1": "distribuidor",    "col2": "uf"},
}


@callback(
    Output("dd-produto",  "options"),
    Output("dd-produto",  "value"),
    Output("dd-filtro1",  "options"),
    Output("dd-filtro1",  "value"),
    Output("dd-filtro2",  "options"),
    Output("dd-filtro2",  "value"),
    Input("radio-dataset", "value"),
)
def repopular_filtros(dataset):
    m = META[dataset]
    cfg = _FILTRO_CFG[dataset]

    prods = m["produtos"]
    f1 = _unicos(m["path"], cfg["col1"])
    f2 = _unicos(m["path"], cfg["col2"])

    return (
        [{"label": p, "value": p} for p in prods], prods,
        [{"label": "Todos", "value": "__ALL__"}] + [{"label": v, "value": v} for v in f1], "__ALL__",
        [{"label": "Todos", "value": "__ALL__"}] + [{"label": v, "value": v} for v in f2], "__ALL__",
    )


@callback(
    Output("grafico", "figure"),
    Output("info",    "children"),
    Input("radio-dataset", "value"),
    Input("dd-produto",   "value"),
    Input("dd-filtro1",   "value"),
    Input("dd-filtro2",   "value"),
    Input("radio-grupo",  "value"),
    Input("slider-ano",   "value"),
)
def atualizar(dataset, produtos, filtro1, filtro2, grupo, anos):
    if not produtos:
        return go.Figure(), "Selecione ao menos um produto."

    m   = META[dataset]
    cfg = _FILTRO_CFG[dataset]

    where  = ["volume_m3 IS NOT NULL"]
    params: list = []

    placeholders = ", ".join(["?"] * len(produtos))
    where.append(f"nome_produto IN ({placeholders})")
    params.extend(produtos)

    where.append("ano BETWEEN ? AND ?")
    params.extend(anos)

    if filtro1 != "__ALL__":
        where.append(f"{cfg['col1']} = ?"); params.append(filtro1)
    if filtro2 != "__ALL__":
        where.append(f"{cfg['col2']} = ?"); params.append(filtro2)

    bucket = "make_date(ano, mes, 1)" if grupo == "mes" else "make_date(ano, 1, 1)"

    sql = f"""
        SELECT {bucket} AS data, nome_produto,
               SUM(volume_m3)/1000.0 AS volume_mil_m3,
               COUNT(*) AS n
        FROM read_parquet('{m['path']}')
        WHERE {' AND '.join(where)}
        GROUP BY data, nome_produto
        ORDER BY data
    """
    grp = _con.execute(sql, params).df()

    if grp.empty:
        return go.Figure(), "Sem dados para os filtros selecionados."

    fig = go.Figure()
    for prod in sorted(grp["nome_produto"].unique()):
        g = grp[grp["nome_produto"] == prod]
        if g.empty:
            continue
        fig.add_trace(go.Scatter(
            x=g["data"], y=g["volume_mil_m3"], mode="lines", name=prod,
            hovertemplate=("<b>%{fullData.name}</b><br>"
                           "Data: %{x|%b/%Y}<br>"
                           "Volume: %{y:,.1f} mil m³<br><extra></extra>"),
        ))

    rotulo_dataset = {
        "vendas":      "Vendas (distribuidor → cliente)",
        "entregas":    "Entregas (refinaria → distribuidor)",
        "importacoes": "Importações pelos distribuidores",
    }[dataset]

    fig.update_layout(
        title=rotulo_dataset, xaxis_title="", yaxis_title="Volume (mil m³)",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        hovermode="x unified", template="plotly_white",
        margin=dict(l=70, r=20, t=80, b=40),
    )

    info = (f"{int(grp['n'].sum()):,} registros | "
            f"{grp['data'].min().strftime('%b/%Y')} -> "
            f"{grp['data'].max().strftime('%b/%Y')} | "
            f"Total: {grp['volume_mil_m3'].sum():,.0f} mil m³")
    return fig, info


if __name__ == "__main__":
    app.run(debug=False, port=8050)
