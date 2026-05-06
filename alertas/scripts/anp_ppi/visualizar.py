#!/usr/bin/env python3
"""
visualizar.py
=============
App Dash para explorar a série PPI consolidada.

Uso:
    python alertas/scripts/anp_ppi/visualizar.py
    Abrir http://localhost:8050
"""
import sys
from pathlib import Path

import duckdb
import plotly.graph_objects as go
from dash import Dash, Input, Output, callback, dcc, html

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_PARQUET = Path(__file__).parents[3] / "DADOS" / "anp_ppi" / "ppi_consolidado.parquet"
_PARQUET_STR = str(_PARQUET).replace("\\", "/")

if not _PARQUET.exists():
    print(f"ERRO: Parquet não encontrado em {_PARQUET}")
    print(f"Rode primeiro: python alertas/scripts/anp_ppi/consolidar.py")
    sys.exit(1)

print("Inicializando DuckDB...", flush=True)
_con = duckdb.connect(database=":memory:")

def _unicos(coluna: str) -> list[str]:
    rows = _con.execute(
        f"SELECT DISTINCT {coluna} FROM read_parquet(?) "
        f"WHERE {coluna} IS NOT NULL ORDER BY 1",
        [_PARQUET_STR],
    ).fetchall()
    return [r[0] for r in rows]

PRODUTOS = _unicos("produto")
LOCAIS   = _unicos("local")
(min_dt, max_dt, total) = _con.execute(
    "SELECT MIN(data_inicio), MAX(data_fim), COUNT(*) FROM read_parquet(?)",
    [_PARQUET_STR],
).fetchone()

print(f"  {total:,} linhas | {min_dt.date()} -> {max_dt.date()}", flush=True)
print(f"  Produtos: {PRODUTOS} | Locais: {len(LOCAIS)}", flush=True)
print("Iniciando servidor em http://localhost:8050", flush=True)

app = Dash(__name__)
app.layout = html.Div([
    html.H2(f"ANP PPI — Preços de Paridade de Importação ({min_dt.year}–{max_dt.year})",
            style={"fontFamily": "Arial", "marginBottom": "16px"}),

    html.Div([
        html.Div([
            html.Label("Produto", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-produto",
                options=[{"label": p, "value": p} for p in PRODUTOS],
                value=["Gasolina A Comum", "Diesel A S10"],
                multi=True, clearable=False,
            ),
        ], style={"flex": "2", "minWidth": "300px"}),

        html.Div([
            html.Label("Local", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-local",
                options=[{"label": "Todos (média)", "value": "__ALL__"}] +
                        [{"label": l, "value": l} for l in LOCAIS],
                value="__ALL__", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "180px"}),

        html.Div([
            html.Label("Métrica", style={"fontWeight": "bold"}),
            dcc.RadioItems(
                id="radio-metrica",
                options=[
                    {"label": "Preço",        "value": "preco"},
                    {"label": "Variação % semanal", "value": "variacao_pct"},
                ],
                value="preco", inline=True,
            ),
        ], style={"flex": "1", "minWidth": "200px", "paddingTop": "20px"}),
    ], style={"display": "flex", "gap": "16px", "flexWrap": "wrap",
              "marginBottom": "16px", "fontFamily": "Arial"}),

    html.Div([
        html.Label("Período", style={"fontWeight": "bold", "fontFamily": "Arial"}),
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
    Output("info", "children"),
    Input("dd-produto",   "value"),
    Input("dd-local",     "value"),
    Input("radio-metrica", "value"),
    Input("slider-ano",   "value"),
)
def atualizar(produtos, local, metrica, anos):
    if not produtos:
        return go.Figure(), "Selecione ao menos um produto."

    where = ["data_inicio IS NOT NULL"]
    params: list = []
    placeholders = ", ".join(["?"] * len(produtos))
    where.append(f"produto IN ({placeholders})")
    params.extend(produtos)
    where.append("EXTRACT(year FROM data_inicio) BETWEEN ? AND ?")
    params.extend(anos)
    if local != "__ALL__":
        where.append("local = ?"); params.append(local)

    if local == "__ALL__":
        sql = f"""
            SELECT data_inicio AS data, produto,
                   AVG({metrica}) AS valor,
                   ANY_VALUE(unidade) AS unidade,
                   COUNT(*) AS n
            FROM read_parquet(?)
            WHERE {' AND '.join(where)}
            GROUP BY data, produto
            ORDER BY data
        """
    else:
        sql = f"""
            SELECT data_inicio AS data, produto,
                   {metrica} AS valor,
                   unidade,
                   1 AS n
            FROM read_parquet(?)
            WHERE {' AND '.join(where)}
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
        unidade = g["unidade"].iloc[0] if "unidade" in g.columns else ""
        if metrica == "variacao_pct":
            y = g["valor"] * 100
            ytmpl = "%{y:.2f}%"
        else:
            y = g["valor"]
            ytmpl = "R$ %{y:.4f}"
        fig.add_trace(go.Scatter(
            x=g["data"], y=y, mode="lines",
            name=f"{prod} ({unidade})" if metrica == "preco" else prod,
            hovertemplate=("<b>%{fullData.name}</b><br>"
                           "Data: %{x|%d/%b/%Y}<br>"
                           f"{ytmpl}<br><extra></extra>"),
        ))

    if metrica == "variacao_pct":
        titulo = "Variação % semanal vs semana anterior"
        ytitle = "Variação (%)"
    else:
        titulo = "Preço de Paridade de Importação"
        ytitle = "Preço"
    if local != "__ALL__":
        titulo += f" — {local}"
    else:
        titulo += " — Média entre locais"

    fig.update_layout(
        title=titulo, xaxis_title="", yaxis_title=ytitle,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        hovermode="x unified", template="plotly_white",
        margin=dict(l=60, r=20, t=80, b=40),
    )

    info = (f"{int(grp['n'].sum()):,} registros | "
            f"{grp['data'].min().strftime('%d/%b/%Y')} -> "
            f"{grp['data'].max().strftime('%d/%b/%Y')}")
    return fig, info


if __name__ == "__main__":
    app.run(debug=False, port=8050)
