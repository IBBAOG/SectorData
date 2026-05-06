#!/usr/bin/env python3
"""
visualizar.py
=============
App Dash interativo para explorar a série histórica LPC consolidada.
Usa DuckDB para consultar o Parquet sem carregar tudo na RAM.

Uso:
    python alertas/scripts/anp_lpc_ultimas/visualizar.py
    Abrir http://localhost:8050 no navegador
"""
import sys
from pathlib import Path

import duckdb
import plotly.graph_objects as go
from dash import Dash, Input, Output, callback, dcc, html

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_PARQUET = Path(__file__).parents[3] / "DADOS" / "anp_lpc_ultimas" / "lpc_consolidado.parquet"
_PARQUET_STR = str(_PARQUET).replace("\\", "/")

if not _PARQUET.exists():
    print(f"ERRO: Parquet não encontrado em {_PARQUET}")
    sys.exit(1)

print("Inicializando DuckDB...", flush=True)
_con = duckdb.connect(database=":memory:")

# ── pré-computa listas de filtros (queries pequenas, cabem em RAM) ───────────

print("Lendo metadados...", flush=True)

def _unicos(coluna: str) -> list[str]:
    rows = _con.execute(
        f"SELECT DISTINCT {coluna} FROM read_parquet(?) "
        f"WHERE {coluna} IS NOT NULL ORDER BY 1",
        [_PARQUET_STR],
    ).fetchall()
    return [r[0] for r in rows]

PRODUTOS  = _unicos("produto")
ESTADOS   = ["Todos"] + _unicos("estado")
REGIOES   = ["Todas"] + _unicos("regiao")
BANDEIRAS = ["Todas"] + _unicos("bandeira")

(min_dt, max_dt) = _con.execute(
    "SELECT MIN(data_coleta), MAX(data_coleta) FROM read_parquet(?)",
    [_PARQUET_STR],
).fetchone()
total_linhas = _con.execute(
    "SELECT COUNT(*) FROM read_parquet(?)", [_PARQUET_STR]
).fetchone()[0]

print(f"  {total_linhas:,} linhas | {min_dt.date()} → {max_dt.date()}", flush=True)
print(f"  Produtos: {len(PRODUTOS)} | Bandeiras: {len(BANDEIRAS)-1}", flush=True)
print("Iniciando servidor em http://localhost:8050", flush=True)

# ── dash app ─────────────────────────────────────────────────────────────────

DEFAULT_PRODS = [p for p in PRODUTOS if p in {
    "GASOLINA", "GASOLINA COMUM", "GASOLINA ADITIVADA",
    "ETANOL", "ETANOL HIDRATADO", "DIESEL", "DIESEL S10",
}] or PRODUTOS[:5]

app = Dash(__name__)
app.layout = html.Div([
    html.H2(f"ANP LPC — Série Histórica de Preços ({min_dt.year}–{max_dt.year})",
            style={"fontFamily": "Arial", "marginBottom": "16px"}),

    html.Div([
        html.Div([
            html.Label("Produto", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-produto",
                options=[{"label": p, "value": p} for p in PRODUTOS],
                value=DEFAULT_PRODS, multi=True, clearable=False,
            ),
        ], style={"flex": "2", "minWidth": "300px"}),

        html.Div([
            html.Label("Região", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-regiao",
                options=[{"label": r, "value": r} for r in REGIOES],
                value="Todas", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "140px"}),

        html.Div([
            html.Label("Estado", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-estado",
                options=[{"label": e, "value": e} for e in ESTADOS],
                value="Todos", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "120px"}),

        html.Div([
            html.Label("Bandeira", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-bandeira",
                options=[{"label": b, "value": b} for b in BANDEIRAS],
                value="Todas", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "160px"}),

        html.Div([
            html.Label("Agrupar por", style={"fontWeight": "bold"}),
            dcc.RadioItems(
                id="radio-grupo",
                options=[{"label": "Semana", "value": "semana"},
                         {"label": "Mês", "value": "mes"}],
                value="mes", inline=True,
            ),
        ], style={"flex": "1", "minWidth": "160px", "paddingTop": "20px"}),
    ], style={"display": "flex", "gap": "16px", "flexWrap": "wrap",
              "marginBottom": "16px", "fontFamily": "Arial"}),

    html.Div([
        html.Label("Período", style={"fontWeight": "bold", "fontFamily": "Arial"}),
        dcc.RangeSlider(
            id="slider-ano",
            min=min_dt.year, max=max_dt.year, step=1,
            value=[max(min_dt.year, max_dt.year - 10), max_dt.year],
            marks={y: str(y) for y in range(min_dt.year, max_dt.year + 1, 2)},
            tooltip={"placement": "bottom"},
        ),
    ], style={"marginBottom": "8px"}),

    dcc.Graph(id="grafico", style={"height": "520px"}),

    html.Div(id="info", style={"fontFamily": "Arial", "fontSize": "12px",
                               "color": "#666", "marginTop": "4px"}),
], style={"maxWidth": "1400px", "margin": "0 auto", "padding": "24px"})


@callback(
    Output("grafico", "figure"),
    Output("info", "children"),
    Input("dd-produto",  "value"),
    Input("dd-regiao",   "value"),
    Input("dd-estado",   "value"),
    Input("dd-bandeira", "value"),
    Input("radio-grupo", "value"),
    Input("slider-ano",  "value"),
)
def atualizar(produtos, regiao, estado, bandeira, grupo, anos):
    if not produtos:
        return go.Figure(), "Selecione ao menos um produto."

    where = ["data_coleta IS NOT NULL"]
    params: list = []

    placeholders = ", ".join(["?"] * len(produtos))
    where.append(f"produto IN ({placeholders})")
    params.extend(produtos)

    where.append("EXTRACT(year FROM data_coleta) BETWEEN ? AND ?")
    params.extend(anos)

    if regiao != "Todas":
        where.append("regiao = ?"); params.append(regiao)
    if estado != "Todos":
        where.append("estado = ?"); params.append(estado)
    if bandeira != "Todas":
        where.append("bandeira = ?"); params.append(bandeira)

    bucket = "date_trunc('month', data_coleta)" if grupo == "mes" else "data_coleta"

    sql = f"""
        SELECT {bucket} AS data, produto, AVG(preco_venda) AS media, COUNT(*) AS n
        FROM read_parquet(?)
        WHERE {' AND '.join(where)}
        GROUP BY data, produto
        ORDER BY data
    """
    grp = _con.execute(sql, [_PARQUET_STR, *params]).df()

    if grp.empty:
        return go.Figure(), "Sem dados para os filtros selecionados."

    fig = go.Figure()
    for prod in produtos:
        g = grp[grp["produto"] == prod]
        if g.empty:
            continue
        fig.add_trace(go.Scatter(
            x=g["data"], y=g["media"], mode="lines", name=prod,
            hovertemplate=("<b>%{fullData.name}</b><br>"
                           "Data: %{x|%b/%Y}<br>"
                           "Média: R$ %{y:.4f}<br><extra></extra>"),
        ))

    titulo = "Preço médio de venda (R$/L)"
    if estado != "Todos":     titulo += f" — {estado}"
    elif regiao != "Todas":   titulo += f" — Região {regiao}"
    if bandeira != "Todas":   titulo += f" — {bandeira}"

    fig.update_layout(
        title=titulo, xaxis_title="", yaxis_title="R$/Litro",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        hovermode="x unified", template="plotly_white",
        margin=dict(l=60, r=20, t=80, b=40),
    )

    total_n = int(grp["n"].sum())
    info = (f"{total_n:,} registros | "
            f"{grp['data'].min().strftime('%b/%Y')} → "
            f"{grp['data'].max().strftime('%b/%Y')}")
    return fig, info


if __name__ == "__main__":
    app.run(debug=False, port=8050)
