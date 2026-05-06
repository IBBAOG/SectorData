#!/usr/bin/env python3
"""
visualizar.py
=============
App Dash para a série ANP Dados Abertos — Importações/Exportações.

Uso:
    python alertas/scripts/anp_dados_abertos_ie/visualizar.py
    Abrir http://localhost:8050
"""
import sys
from pathlib import Path

import duckdb
import plotly.graph_objects as go
from dash import Dash, Input, Output, callback, dcc, html

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_PARQUET = Path(__file__).parents[3] / "DADOS" / "anp_dados_abertos_ie" / "dados_abertos_ie_consolidado.parquet"
_PARQUET_STR = str(_PARQUET).replace("\\", "/")

if not _PARQUET.exists():
    print(f"ERRO: Parquet não encontrado em {_PARQUET}")
    print("Rode antes: python alertas/scripts/anp_dados_abertos_ie/consolidar.py")
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

PRODUTOS = _unicos("produto")

(min_ano, max_ano, total) = _con.execute(
    "SELECT MIN(ano), MAX(ano), COUNT(*) FROM read_parquet(?)", [_PARQUET_STR],
).fetchone()

print(f"  {total:,} linhas | {min_ano} -> {max_ano}", flush=True)
print(f"  Produtos: {len(PRODUTOS)}", flush=True)
print("Iniciando servidor em http://localhost:8050", flush=True)

DEFAULT_PRODS = [p for p in PRODUTOS if p in {
    "PETRÓLEO", "ÓLEO DIESEL", "GASOLINA A", "GLP", "QUEROSENE DE AVIAÇÃO",
}] or PRODUTOS[:4]

app = Dash(__name__)
app.layout = html.Div([
    html.H2(f"ANP Dados Abertos — Importações/Exportações ({min_ano}–{max_ano})",
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
            html.Label("Operação", style={"fontWeight": "bold"}),
            dcc.RadioItems(
                id="radio-operacao",
                options=[
                    {"label": "Importação", "value": "IMPORTAÇÃO"},
                    {"label": "Exportação", "value": "EXPORTAÇÃO"},
                    {"label": "Líquido (IMP - EXP)", "value": "__NET__"},
                    {"label": "Ambos",     "value": "__BOTH__"},
                ],
                value="IMPORTAÇÃO", inline=True,
            ),
        ], style={"flex": "1", "minWidth": "260px", "paddingTop": "20px"}),

        html.Div([
            html.Label("Métrica", style={"fontWeight": "bold"}),
            dcc.RadioItems(
                id="radio-metrica",
                options=[
                    {"label": "Volume (m³)",  "value": "volume_m3"},
                    {"label": "Valor (USD)",  "value": "valor_usd"},
                ],
                value="volume_m3", inline=True,
            ),
        ], style={"flex": "1", "minWidth": "200px", "paddingTop": "20px"}),

        html.Div([
            html.Label("Granularidade", style={"fontWeight": "bold"}),
            dcc.RadioItems(
                id="radio-grupo",
                options=[{"label": "Mês", "value": "mes"},
                         {"label": "Ano", "value": "ano"}],
                value="ano", inline=True,
            ),
        ], style={"flex": "1", "minWidth": "160px", "paddingTop": "20px"}),
    ], style={"display": "flex", "gap": "16px", "flexWrap": "wrap",
              "marginBottom": "16px", "fontFamily": "Arial"}),

    html.Div([
        html.Label("Período (anos)", style={"fontWeight": "bold", "fontFamily": "Arial"}),
        dcc.RangeSlider(
            id="slider-ano",
            min=min_ano, max=max_ano, step=1,
            value=[min_ano, max_ano],
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
    Output("info", "children"),
    Input("dd-produto",      "value"),
    Input("radio-operacao",  "value"),
    Input("radio-metrica",   "value"),
    Input("radio-grupo",     "value"),
    Input("slider-ano",      "value"),
)
def atualizar(produtos, operacao, metrica, grupo, anos):
    if not produtos:
        return go.Figure(), "Selecione ao menos um produto."

    where = [f"{metrica} IS NOT NULL"]
    params: list = []
    placeholders = ", ".join(["?"] * len(produtos))
    where.append(f"produto IN ({placeholders})")
    params.extend(produtos)
    where.append("ano BETWEEN ? AND ?")
    params.extend(anos)

    if operacao in ("IMPORTAÇÃO", "EXPORTAÇÃO"):
        where.append("operacao = ?"); params.append(operacao)

    if grupo == "mes":
        bucket = "make_date(ano, mes, 1)"
    else:
        bucket = "make_date(ano, 1, 1)"

    if operacao == "__NET__":
        sql = f"""
            SELECT {bucket} AS data, produto,
                   SUM(CASE WHEN operacao = 'IMPORTAÇÃO' THEN {metrica} ELSE 0 END)
                 - SUM(CASE WHEN operacao = 'EXPORTAÇÃO' THEN {metrica} ELSE 0 END) AS valor,
                   COUNT(*) AS n
            FROM read_parquet(?)
            WHERE {' AND '.join(where)}
            GROUP BY data, produto
            ORDER BY data
        """
    elif operacao == "__BOTH__":
        sql = f"""
            SELECT {bucket} AS data, produto || ' (' || operacao || ')' AS produto,
                   SUM({metrica}) AS valor,
                   COUNT(*) AS n
            FROM read_parquet(?)
            WHERE {' AND '.join(where)}
            GROUP BY data, produto, operacao
            ORDER BY data
        """
    else:
        sql = f"""
            SELECT {bucket} AS data, produto,
                   SUM({metrica}) AS valor,
                   COUNT(*) AS n
            FROM read_parquet(?)
            WHERE {' AND '.join(where)}
            GROUP BY data, produto
            ORDER BY data
        """

    grp = _con.execute(sql, [_PARQUET_STR, *params]).df()
    if grp.empty:
        return go.Figure(), "Sem dados para os filtros selecionados."

    fig = go.Figure()
    for prod in sorted(grp["produto"].unique()):
        g = grp[grp["produto"] == prod]
        if g.empty:
            continue
        fmt = "%{y:,.0f} m³" if metrica == "volume_m3" else "US$ %{y:,.0f}"
        fig.add_trace(go.Scatter(
            x=g["data"], y=g["valor"], mode="lines", name=prod,
            hovertemplate=("<b>%{fullData.name}</b><br>"
                           "Data: %{x|%b/%Y}<br>"
                           f"{fmt}<br><extra></extra>"),
        ))

    rotulo_op = {
        "IMPORTAÇÃO": "Importações",
        "EXPORTAÇÃO": "Exportações",
        "__NET__":    "Saldo (IMP - EXP)",
        "__BOTH__":   "IMP + EXP",
    }[operacao]
    rotulo_metrica = "Volume" if metrica == "volume_m3" else "Valor (USD)"
    titulo = f"{rotulo_op} — {rotulo_metrica}"

    fig.update_layout(
        title=titulo, xaxis_title="",
        yaxis_title="m³" if metrica == "volume_m3" else "USD",
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
