#!/usr/bin/env python3
"""
visualizar.py — SINDICOM Combustíveis (2017-2026)

Uso:
    python alertas/scripts/sindicom/visualizar.py
"""
import sys
from pathlib import Path

import duckdb
import plotly.graph_objects as go
from dash import Dash, Input, Output, callback, dcc, html

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_PARQUET = Path(__file__).parents[3] / "DADOS" / "sindicom" / "sindicom_consolidado.parquet"
_PARQUET_STR = str(_PARQUET).replace("\\", "/")

if not _PARQUET.exists():
    print(f"ERRO: Parquet não encontrado em {_PARQUET}")
    sys.exit(1)

print("Inicializando DuckDB...", flush=True)
_con = duckdb.connect(database=":memory:")


def _unicos(col: str) -> list:
    rows = _con.execute(
        f"SELECT DISTINCT {col} FROM read_parquet(?) WHERE {col} IS NOT NULL ORDER BY 1",
        [_PARQUET_STR],
    ).fetchall()
    return [r[0] for r in rows]


EMPRESAS   = [e for e in _unicos("empresa") if e != "ANP"]
PRODUTOS   = _unicos("nome_produto")
SEGMENTOS  = _unicos("segmento")
REGIOES    = _unicos("regiao")
UFS        = _unicos("uf")

(min_ano, max_ano, total) = _con.execute(
    "SELECT MIN(ano), MAX(ano), COUNT(*) FROM read_parquet(?)", [_PARQUET_STR]
).fetchone()

print(f"  {total:,} linhas | {min_ano} → {max_ano}", flush=True)
print(f"  Empresas: {EMPRESAS}", flush=True)
print("Iniciando servidor em http://localhost:8050", flush=True)

_PROD_LABEL = {
    "GASOLINAS":            "Gasolinas",
    "ÓLEO DIESEL":          "Óleo Diesel",
    "ETANOL HIDRATADO":     "Etanol Hidratado",
    "QUEROSENE DE AVIAÇÃO": "QAV",
    "GNV":                  "GNV",
    "ÓLEOS COMBUSTÍVEIS":   "Óleos Combustíveis",
    "GASOLINA DE AVIAÇÃO":  "Gasolina Aviação",
    "QUEROSENE":            "Querosene",
}
_SEG_LABEL = {
    "REVENDEDOR":         "Revendedor (postos)",
    "CONSUMIDOR":         "Consumidor direto",
    "TRR":                "TRR",
    "MERCADO TOTAL - ANP":"Mercado Total (ANP)",
}

app = Dash(__name__)
app.layout = html.Div([
    html.H2(f"SINDICOM — Volumes de Combustíveis ({min_ano}–{max_ano})",
            style={"fontFamily": "Arial", "marginBottom": "16px"}),

    html.Div([
        html.Div([
            html.Label("Empresa", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-empresa",
                options=[{"label": "Todas (associadas)", "value": "__ALL__"}] +
                        [{"label": e.title(), "value": e} for e in EMPRESAS],
                value="__ALL__", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "200px"}),

        html.Div([
            html.Label("Produto", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-produto",
                options=[{"label": "Todos", "value": "__ALL__"}] +
                        [{"label": _PROD_LABEL.get(p, p), "value": p} for p in PRODUTOS],
                value="GASOLINAS", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "200px"}),

        html.Div([
            html.Label("Segmento", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-segmento",
                options=[{"label": _SEG_LABEL.get(s, s), "value": s} for s in SEGMENTOS],
                value="REVENDEDOR", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "220px"}),

        html.Div([
            html.Label("Região", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-regiao",
                options=[{"label": "Todas", "value": "__ALL__"}] +
                        [{"label": r.title(), "value": r} for r in REGIOES],
                value="__ALL__", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "180px"}),

        html.Div([
            html.Label("UF", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-uf",
                options=[{"label": "Todas", "value": "__ALL__"}] +
                        [{"label": u, "value": u} for u in UFS],
                value="__ALL__", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "120px"}),

        html.Div([
            html.Label("Quebrar por", style={"fontWeight": "bold"}),
            dcc.RadioItems(
                id="radio-quebra",
                options=[
                    {"label": "Total",   "value": "__none__"},
                    {"label": "Empresa", "value": "empresa"},
                    {"label": "Produto", "value": "nome_produto"},
                    {"label": "Região",  "value": "regiao"},
                    {"label": "UF",      "value": "uf"},
                ],
                value="empresa", inline=True,
            ),
        ], style={"flex": "2", "minWidth": "320px", "paddingTop": "20px"}),
    ], style={"display": "flex", "gap": "16px", "flexWrap": "wrap",
              "marginBottom": "16px", "fontFamily": "Arial"}),

    html.Div([
        html.Label("Período (anos)", style={"fontWeight": "bold", "fontFamily": "Arial"}),
        dcc.RangeSlider(
            id="slider-ano",
            min=min_ano, max=max_ano, step=1,
            value=[min_ano, max_ano],
            marks={y: str(y) for y in range(min_ano, max_ano + 1)},
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
    Input("dd-empresa",  "value"),
    Input("dd-produto",  "value"),
    Input("dd-segmento", "value"),
    Input("dd-regiao",   "value"),
    Input("dd-uf",       "value"),
    Input("radio-quebra","value"),
    Input("slider-ano",  "value"),
)
def atualizar(empresa, produto, segmento, regiao, uf, quebra, anos):
    where = ["volume IS NOT NULL", "empresa != 'ANP'"]
    params: list = [_PARQUET_STR]

    if empresa != "__ALL__":
        where.append("empresa = ?"); params.append(empresa)
    if produto != "__ALL__":
        where.append("nome_produto = ?"); params.append(produto)
    if segmento:
        where.append("segmento = ?"); params.append(segmento)
    if regiao != "__ALL__":
        where.append("regiao = ?"); params.append(regiao)
    if uf != "__ALL__":
        where.append("uf = ?"); params.append(uf)
    where.append("ano BETWEEN ? AND ?")
    params.extend(anos)

    bucket = "make_date(CAST(ano AS INTEGER), CAST(mes AS INTEGER), 1)"
    cond   = " AND ".join(where)

    if quebra == "__none__":
        sql = f"""
            SELECT {bucket} AS data, SUM(volume) AS valor, COUNT(*) AS n
            FROM read_parquet(?)
            WHERE {cond}
            GROUP BY data ORDER BY data
        """
        grp = _con.execute(sql, params).df()
        if grp.empty:
            return go.Figure(), "Sem dados para os filtros."
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=grp["data"], y=grp["valor"], mode="lines", name="Total",
            hovertemplate="Data: %{x|%b/%Y}<br>%{y:,.0f} m³<extra></extra>",
        ))
    else:
        sql = f"""
            SELECT {bucket} AS data, {quebra} AS grupo, SUM(volume) AS valor, COUNT(*) AS n
            FROM read_parquet(?)
            WHERE {cond}
            GROUP BY data, grupo ORDER BY data
        """
        grp = _con.execute(sql, params).df()
        if grp.empty:
            return go.Figure(), "Sem dados para os filtros."
        totais = grp.groupby("grupo")["valor"].sum().sort_values(ascending=False)
        top = totais.head(10).index.tolist()
        fig = go.Figure()
        for g in top:
            sub = grp[grp["grupo"] == g]
            label = _PROD_LABEL.get(g, g.title()) if quebra == "nome_produto" else g.title() if quebra in ("empresa","regiao") else g
            fig.add_trace(go.Scatter(
                x=sub["data"], y=sub["valor"], mode="lines", name=label,
                hovertemplate=(f"<b>%{{fullData.name}}</b><br>"
                               "Data: %{x|%b/%Y}<br>%{y:,.0f} m³<extra></extra>"),
            ))

    prod_label = _PROD_LABEL.get(produto, produto) if produto != "__ALL__" else "Todos produtos"
    titulo = f"Volume (m³) — {prod_label}"
    if empresa != "__ALL__": titulo += f" — {empresa.title()}"
    if uf != "__ALL__": titulo += f" — {uf}"
    elif regiao != "__ALL__": titulo += f" — {regiao.title()}"

    fig.update_layout(
        title=titulo, xaxis_title="", yaxis_title="Volume (m³)",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        hovermode="x unified", template="plotly_white",
        margin=dict(l=80, r=20, t=80, b=40),
    )

    info = (f"{int(grp['n'].sum()):,} registros | "
            f"{grp['data'].min().strftime('%b/%Y')} → "
            f"{grp['data'].max().strftime('%b/%Y')}")
    return fig, info


if __name__ == "__main__":
    app.run(debug=False, port=8050)
