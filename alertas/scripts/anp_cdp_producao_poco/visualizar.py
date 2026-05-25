#!/usr/bin/env python3
"""
visualizar.py
=============
App Dash para a série ANP CDP — Produção por Poço (2005-2023).

Uso:
    python alertas/scripts/anp_cdp_producao_poco/visualizar.py
"""
import sys
from pathlib import Path

import duckdb
import plotly.graph_objects as go
from dash import Dash, Input, Output, callback, dcc, html

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_PARQUET = Path(__file__).parents[3] / "DADOS" / "anp_cdp_producao_poco" / "cdp_consolidado.parquet"
_PARQUET_STR = str(_PARQUET).replace("\\", "/")

if not _PARQUET.exists():
    print(f"ERRO: Parquet não encontrado em {_PARQUET}")
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

BACIAS    = _unicos("bacia")
ESTADOS   = _unicos("estado")
OPERADORES = _unicos("operador")
CAMPOS    = _unicos("campo")
LOCALS = _unicos("local")

(min_ano, max_ano, total) = _con.execute(
    "SELECT MIN(ano), MAX(ano), COUNT(*) FROM read_parquet(?)", [_PARQUET_STR],
).fetchone()

print(f"  {total:,} linhas | {min_ano} -> {max_ano}", flush=True)
print(f"  Bacias: {len(BACIAS)} | Estados: {len(ESTADOS)} | Operadores: {len(OPERADORES)} | Campos: {len(CAMPOS)}", flush=True)
print("Iniciando servidor em http://localhost:8050", flush=True)


_LOCAL_LABEL = {"PosSal": "Pós-Sal (mar)", "PreSal": "Pré-Sal", "Terra": "Terra"}

app = Dash(__name__)
app.layout = html.Div([
    html.H2(f"ANP CDP — Produção por Poço ({min_ano}–{max_ano})",
            style={"fontFamily": "Arial", "marginBottom": "16px"}),

    html.Div([
        html.Div([
            html.Label("Local", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-local",
                options=[{"label": _LOCAL_LABEL.get(a, a), "value": a} for a in LOCALS],
                value=LOCALS, multi=True, clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "200px"}),

        html.Div([
            html.Label("Bacia", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-bacia",
                options=[{"label": "Todas", "value": "__ALL__"}] +
                        [{"label": b, "value": b} for b in BACIAS],
                value="__ALL__", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "180px"}),

        html.Div([
            html.Label("Estado", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-estado",
                options=[{"label": "Todos", "value": "__ALL__"}] +
                        [{"label": e, "value": e} for e in ESTADOS],
                value="__ALL__", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "180px"}),

        html.Div([
            html.Label("Operador", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-operador",
                options=[{"label": "Todos", "value": "__ALL__"}] +
                        [{"label": o, "value": o} for o in OPERADORES],
                value="__ALL__", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "240px"}),

        html.Div([
            html.Label("Campo", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-campo",
                options=[{"label": "Todos", "value": "__ALL__"}] +
                        [{"label": c, "value": c} for c in CAMPOS],
                value="__ALL__", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "240px"}),

        html.Div([
            html.Label("Métrica", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-metrica",
                options=[
                    {"label": "Petróleo (bbl/dia)",          "value": "petroleo_bbl_dia"},
                    {"label": "Óleo (bbl/dia)",              "value": "oleo_bbl_dia"},
                    {"label": "Gás Natural Total (Mm³/dia)", "value": "gas_natural_total_mm3_dia"},
                    {"label": "Água (bbl/dia)",              "value": "agua_bbl_dia"},
                ],
                value="petroleo_bbl_dia", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "240px"}),

        html.Div([
            html.Label("Quebrar por", style={"fontWeight": "bold"}),
            dcc.RadioItems(
                id="radio-quebra",
                options=[
                    {"label": "Total",    "value": "__none__"},
                    {"label": "Bacia",    "value": "bacia"},
                    {"label": "Estado",   "value": "estado"},
                    {"label": "Operador", "value": "operador"},
                    {"label": "Campo",    "value": "campo"},
                    {"label": "Local",    "value": "local"},
                ],
                value="__none__", inline=True,
            ),
        ], style={"flex": "2", "minWidth": "320px", "paddingTop": "20px"}),
    ], style={"display": "flex", "gap": "16px", "flexWrap": "wrap",
              "marginBottom": "16px", "fontFamily": "Arial"}),

    html.Div([
        html.Label("Período (anos)", style={"fontWeight": "bold", "fontFamily": "Arial"}),
        dcc.RangeSlider(
            id="slider-ano",
            min=min_ano, max=max_ano, step=1,
            value=[max(min_ano, max_ano - 10), max_ano],
            marks={y: str(y) for y in range(min_ano, max_ano + 1, 2)},
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
    Input("dd-local",     "value"),
    Input("dd-bacia",     "value"),
    Input("dd-estado",    "value"),
    Input("dd-operador",  "value"),
    Input("dd-campo",     "value"),
    Input("dd-metrica",   "value"),
    Input("radio-quebra", "value"),
    Input("slider-ano",   "value"),
)
def atualizar(locals, bacia, estado, operador, campo, metrica, quebra, anos):
    if not locals:
        return go.Figure(), "Selecione ao menos um local."

    where = [f"{metrica} IS NOT NULL"]
    params: list = []
    placeholders = ", ".join(["?"] * len(locals))
    where.append(f"local IN ({placeholders})")
    params.extend(locals)
    where.append("ano BETWEEN ? AND ?")
    params.extend(anos)
    if bacia != "__ALL__":
        where.append("bacia = ?"); params.append(bacia)
    if estado != "__ALL__":
        where.append("estado = ?"); params.append(estado)
    if operador != "__ALL__":
        where.append("operador = ?"); params.append(operador)
    if campo != "__ALL__":
        where.append("campo = ?"); params.append(campo)

    bucket = "make_date(ano, mes, 1)"
    if quebra == "__none__":
        sql = f"""
            SELECT {bucket} AS data, SUM({metrica}) AS valor, COUNT(*) AS n
            FROM read_parquet(?)
            WHERE {' AND '.join(where)}
            GROUP BY data ORDER BY data
        """
        grp = _con.execute(sql, [_PARQUET_STR, *params]).df()
        if grp.empty:
            return go.Figure(), "Sem dados para os filtros."
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=grp["data"], y=grp["valor"], mode="lines", name="Total",
            hovertemplate=("Data: %{x|%b/%Y}<br>"
                           "%{y:,.0f}<br><extra></extra>"),
        ))
    else:
        sql = f"""
            SELECT {bucket} AS data, {quebra} AS grupo, SUM({metrica}) AS valor, COUNT(*) AS n
            FROM read_parquet(?)
            WHERE {' AND '.join(where)}
            GROUP BY data, grupo ORDER BY data
        """
        grp = _con.execute(sql, [_PARQUET_STR, *params]).df()
        if grp.empty:
            return go.Figure(), "Sem dados para os filtros."
        # Top 10 grupos por volume total
        totais = grp.groupby("grupo")["valor"].sum().sort_values(ascending=False)
        top = totais.head(10).index.tolist()
        fig = go.Figure()
        for g in top:
            sub = grp[grp["grupo"] == g]
            label = _LOCAL_LABEL.get(g, g) if quebra == "local" else g
            fig.add_trace(go.Scatter(
                x=sub["data"], y=sub["valor"], mode="lines", name=label,
                hovertemplate=("<b>%{fullData.name}</b><br>"
                               "Data: %{x|%b/%Y}<br>"
                               "%{y:,.0f}<br><extra></extra>"),
            ))

    metricas_label = {
        "petroleo_bbl_dia":          "Petróleo (bbl/dia)",
        "oleo_bbl_dia":              "Óleo (bbl/dia)",
        "gas_natural_total_mm3_dia": "Gás Natural Total (Mm³/dia)",
        "agua_bbl_dia":              "Água (bbl/dia)",
    }
    titulo = metricas_label.get(metrica, metrica)
    if bacia != "__ALL__":     titulo += f" — Bacia {bacia}"
    elif estado != "__ALL__":  titulo += f" — Estado {estado}"
    if operador != "__ALL__":  titulo += f" — {operador}"

    fig.update_layout(
        title=titulo, xaxis_title="", yaxis_title=metricas_label.get(metrica, ""),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        hovermode="x unified", template="plotly_white",
        margin=dict(l=80, r=20, t=80, b=40),
    )

    info = (f"{int(grp['n'].sum()):,} registros | "
            f"{grp['data'].min().strftime('%b/%Y')} -> "
            f"{grp['data'].max().strftime('%b/%Y')}")
    return fig, info


if __name__ == "__main__":
    app.run(debug=False, port=8050)
