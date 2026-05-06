#!/usr/bin/env python3
"""
visualizar.py
=============
App Dash para a série ANP Vendas de GLP por Recipiente.

Uso:
    python alertas/scripts/anp_glp/visualizar.py
    Abrir http://localhost:8050
"""
import sys
from pathlib import Path

import duckdb
import plotly.graph_objects as go
from dash import Dash, Input, Output, callback, dcc, html

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_PARQUET = Path(__file__).parents[3] / "DADOS" / "anp_glp" / "glp_consolidado.parquet"
_PARQUET_STR = str(_PARQUET).replace("\\", "/")

if not _PARQUET.exists():
    print(f"ERRO: Parquet não encontrado em {_PARQUET}")
    print("Rode antes: python alertas/scripts/anp_glp/consolidar.py")
    sys.exit(1)

print("Inicializando DuckDB...", flush=True)
_con = duckdb.connect(database=":memory:")

def _unicos(coluna: str) -> list:
    rows = _con.execute(
        f"SELECT DISTINCT {coluna} FROM read_parquet(?) "
        f"WHERE {coluna} IS NOT NULL ORDER BY 1",
        [_PARQUET_STR],
    ).fetchall()
    return [r[0] for r in rows]

DISTRIBUIDORAS = _unicos("distribuidora")
CATEGORIAS     = _unicos("categoria")
(min_dt, max_dt, total) = _con.execute(
    "SELECT MIN(mes_data), MAX(mes_data), COUNT(*) FROM read_parquet(?)",
    [_PARQUET_STR],
).fetchone()

print(f"  {total:,} linhas | {min_dt.date()} -> {max_dt.date()}", flush=True)
print(f"  Distribuidoras: {len(DISTRIBUIDORAS)} | Categorias: {len(CATEGORIAS)}", flush=True)
print("Iniciando servidor em http://localhost:8050", flush=True)


app = Dash(__name__)
app.layout = html.Div([
    html.H2(f"ANP Vendas de GLP por Recipiente ({min_dt.year}–{max_dt.year})",
            style={"fontFamily": "Arial", "marginBottom": "16px"}),

    html.Div([
        html.Div([
            html.Label("Categoria", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-categoria",
                options=[{"label": c, "value": c} for c in CATEGORIAS],
                value=["P13", "Outros (total)"], multi=True, clearable=False,
            ),
        ], style={"flex": "2", "minWidth": "320px"}),

        html.Div([
            html.Label("Distribuidora", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-distribuidora",
                options=[{"label": "Todas (mercado)", "value": "__ALL__"}] +
                        [{"label": d, "value": d} for d in DISTRIBUIDORAS],
                value="__ALL__", clearable=False,
            ),
        ], style={"flex": "2", "minWidth": "300px"}),

        html.Div([
            html.Label("Unidade", style={"fontWeight": "bold"}),
            dcc.RadioItems(
                id="radio-unidade",
                options=[
                    {"label": "kg",       "value": "kg"},
                    {"label": "Toneladas", "value": "t"},
                ],
                value="t", inline=True,
            ),
        ], style={"flex": "1", "minWidth": "180px", "paddingTop": "20px"}),
    ], style={"display": "flex", "gap": "16px", "flexWrap": "wrap",
              "marginBottom": "16px", "fontFamily": "Arial"}),

    html.Div([
        html.Label("Período (anos)", style={"fontWeight": "bold", "fontFamily": "Arial"}),
        dcc.RangeSlider(
            id="slider-ano",
            min=min_dt.year, max=max_dt.year, step=1,
            value=[min_dt.year, max_dt.year],
            marks={y: str(y) for y in range(min_dt.year, max_dt.year + 1)},
            tooltip={"placement": "bottom"},
        ),
    ], style={"marginBottom": "8px"}),

    dcc.Graph(id="grafico", style={"height": "520px"}),
    html.Div(id="info", style={"fontFamily": "Arial", "fontSize": "12px",
                               "color": "#666", "marginTop": "4px"}),
], style={"maxWidth": "1400px", "margin": "0 auto", "padding": "24px"})


@callback(
    Output("grafico", "figure"),
    Output("info",    "children"),
    Input("dd-categoria",    "value"),
    Input("dd-distribuidora", "value"),
    Input("radio-unidade",   "value"),
    Input("slider-ano",      "value"),
)
def atualizar(categorias, distribuidora, unidade, anos):
    if not categorias:
        return go.Figure(), "Selecione ao menos uma categoria."

    where  = ["vendas_kg IS NOT NULL"]
    params: list = []
    placeholders = ", ".join(["?"] * len(categorias))
    where.append(f"categoria IN ({placeholders})")
    params.extend(categorias)
    where.append("ano BETWEEN ? AND ?")
    params.extend(anos)
    if distribuidora != "__ALL__":
        where.append("distribuidora = ?"); params.append(distribuidora)

    fator = 1.0 if unidade == "kg" else 1.0 / 1000.0  # kg → t

    sql = f"""
        SELECT mes_data AS data, categoria,
               SUM(vendas_kg) * {fator} AS valor,
               COUNT(*) AS n
        FROM read_parquet(?)
        WHERE {' AND '.join(where)}
        GROUP BY data, categoria
        ORDER BY data
    """
    grp = _con.execute(sql, [_PARQUET_STR, *params]).df()

    if grp.empty:
        return go.Figure(), "Sem dados para os filtros selecionados."

    fig = go.Figure()
    for cat in categorias:
        g = grp[grp["categoria"] == cat]
        if g.empty:
            continue
        fig.add_trace(go.Scatter(
            x=g["data"], y=g["valor"], mode="lines", name=cat,
            hovertemplate=("<b>%{fullData.name}</b><br>"
                           "Data: %{x|%b/%Y}<br>"
                           f"Vendas: %{{y:,.0f}} {unidade}<br><extra></extra>"),
        ))

    titulo = "Vendas mensais de GLP"
    titulo += " — Mercado total" if distribuidora == "__ALL__" else f" — {distribuidora}"

    fig.update_layout(
        title=titulo, xaxis_title="",
        yaxis_title=("kg" if unidade == "kg" else "Toneladas"),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        hovermode="x unified", template="plotly_white",
        margin=dict(l=80, r=20, t=80, b=40),
    )

    info = (f"{int(grp['n'].sum()):,} registros | "
            f"{grp['data'].min().strftime('%b/%Y')} -> "
            f"{grp['data'].max().strftime('%b/%Y')} | "
            f"Total: {grp['valor'].sum():,.0f} {unidade}")
    return fig, info


if __name__ == "__main__":
    app.run(debug=False, port=8050)
