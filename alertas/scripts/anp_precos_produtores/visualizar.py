#!/usr/bin/env python3
"""
visualizar.py
=============
App Dash para a série Preços Médios Ponderados Semanais (Produtores/Importadores).

Uso:
    python alertas/scripts/anp_precos_produtores/visualizar.py
    Abrir http://localhost:8050
"""
import sys
from pathlib import Path

import duckdb
import plotly.graph_objects as go
from dash import Dash, Input, Output, callback, dcc, html

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_PARQUET = Path(__file__).parents[3] / "DADOS" / "anp_precos_produtores" / "precos_produtores_consolidado.parquet"
_PARQUET_STR = str(_PARQUET).replace("\\", "/")

if not _PARQUET.exists():
    print(f"ERRO: Parquet não encontrado em {_PARQUET}")
    print("Rode antes: python alertas/scripts/anp_precos_produtores/consolidar.py")
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
REGIOES  = _unicos("regiao")
(min_dt, max_dt, total) = _con.execute(
    "SELECT MIN(data_inicio), MAX(data_inicio), COUNT(*) FROM read_parquet(?)",
    [_PARQUET_STR],
).fetchone()

print(f"  {total:,} linhas | {min_dt.date()} -> {max_dt.date()}", flush=True)
print(f"  Produtos: {len(PRODUTOS)} | Regioes: {len(REGIOES)}", flush=True)
print("Iniciando servidor em http://localhost:8050", flush=True)

DEFAULT_PRODS = [p for p in PRODUTOS if p in {
    "Gasolina A Comum",
    "Óleo Diesel",
    "Óleo Diesel S-10",
    "Gás Liquefeito de Petróleo - GLP",
    "Querosene de Aviação - QAV",
}] or PRODUTOS[:3]

app = Dash(__name__)
app.layout = html.Div([
    html.H2(f"ANP Preços Produtores/Importadores ({min_dt.year}–{max_dt.year})",
            style={"fontFamily": "Arial", "marginBottom": "16px"}),

    html.Div([
        html.Div([
            html.Label("Produto", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-produto",
                options=[{"label": p, "value": p} for p in PRODUTOS],
                value=DEFAULT_PRODS, multi=True, clearable=False,
            ),
        ], style={"flex": "2", "minWidth": "320px"}),

        html.Div([
            html.Label("Região", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-regiao",
                options=[{"label": "Todas (média Brasil)", "value": "__ALL__"}] +
                        [{"label": r, "value": r} for r in REGIOES],
                value="__ALL__", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "200px"}),
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
    Input("dd-produto", "value"),
    Input("dd-regiao",  "value"),
    Input("slider-ano", "value"),
)
def atualizar(produtos, regiao, anos):
    if not produtos:
        return go.Figure(), "Selecione ao menos um produto."

    where = ["data_inicio IS NOT NULL"]
    params: list = []
    placeholders = ", ".join(["?"] * len(produtos))
    where.append(f"produto IN ({placeholders})")
    params.extend(produtos)
    where.append("EXTRACT(year FROM data_inicio) BETWEEN ? AND ?")
    params.extend(anos)
    if regiao != "__ALL__":
        where.append("regiao = ?"); params.append(regiao)

    sql = f"""
        SELECT data_inicio AS data, produto,
               AVG(preco) AS preco,
               ANY_VALUE(unidade) AS unidade,
               COUNT(*) AS n
        FROM read_parquet(?)
        WHERE {' AND '.join(where)}
        GROUP BY data, produto
        ORDER BY data
    """
    grp = _con.execute(sql, [_PARQUET_STR, *params]).df()

    if grp.empty:
        return go.Figure(), "Sem dados para os filtros."

    fig = go.Figure()
    for prod in produtos:
        g = grp[grp["produto"] == prod]
        if g.empty:
            continue
        unid = g["unidade"].iloc[0] if "unidade" in g.columns else ""
        fig.add_trace(go.Scatter(
            x=g["data"], y=g["preco"], mode="lines",
            name=f"{prod} ({unid})" if unid else prod,
            hovertemplate=("<b>%{fullData.name}</b><br>"
                           "Data: %{x|%d/%b/%Y}<br>"
                           "Preço: %{y:.4f}<br><extra></extra>"),
        ))

    titulo = f"Preço médio ponderado semanal"
    titulo += " — Brasil (média)" if regiao == "__ALL__" else f" — {regiao}"

    fig.update_layout(
        title=titulo, xaxis_title="", yaxis_title="Preço",
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
