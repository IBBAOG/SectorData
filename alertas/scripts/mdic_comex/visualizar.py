#!/usr/bin/env python3
"""
visualizar.py
=============
App Dash para a série MDIC Comex Stat — Petróleo / Gasolinas / Diesel por país.

Uso:
    python alertas/scripts/mdic_comex/visualizar.py
"""
import sys
from pathlib import Path

import duckdb
import plotly.graph_objects as go
from dash import Dash, Input, Output, callback, dcc, html

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_PARQUET = Path(__file__).parents[3] / "DADOS" / "mdic_comex" / "comex_consolidado.parquet"
_PARQUET_STR = str(_PARQUET).replace("\\", "/")

if not _PARQUET.exists():
    print(f"ERRO: Parquet não encontrado em {_PARQUET}")
    print("Rode antes: python alertas/scripts/mdic_comex/consolidar.py")
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

NCMS_RAW = _con.execute(
    "SELECT DISTINCT ncm_codigo, ANY_VALUE(ncm_nome) FROM read_parquet(?) "
    "WHERE ncm_codigo IS NOT NULL GROUP BY ncm_codigo ORDER BY 1",
    [_PARQUET_STR],
).fetchall()
NCM_OPTIONS = [{"label": f"{r[0]} — {r[1]}", "value": r[0]} for r in NCMS_RAW]

PAISES = _unicos("pais")
(min_ano, max_ano, total) = _con.execute(
    "SELECT MIN(ano), MAX(ano), COUNT(*) FROM read_parquet(?)", [_PARQUET_STR],
).fetchone()

print(f"  {total:,} linhas | {min_ano} -> {max_ano}", flush=True)
print(f"  NCMs: {len(NCMS_RAW)} | Paises: {len(PAISES)}", flush=True)
print("Iniciando servidor em http://localhost:8050", flush=True)


app = Dash(__name__)
app.layout = html.Div([
    html.H2(f"MDIC Comex Stat — Petróleo / Gasolinas / Diesel ({min_ano}–{max_ano})",
            style={"fontFamily": "Arial", "marginBottom": "16px"}),

    html.Div([
        html.Div([
            html.Label("NCM", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-ncm", options=NCM_OPTIONS,
                value=[r["value"] for r in NCM_OPTIONS], multi=True, clearable=False,
            ),
        ], style={"flex": "2", "minWidth": "320px"}),

        html.Div([
            html.Label("País de origem", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-pais",
                options=[{"label": "Todos", "value": "__ALL__"}] +
                        [{"label": p, "value": p} for p in PAISES],
                value="__ALL__", clearable=False,
            ),
        ], style={"flex": "2", "minWidth": "240px"}),

        html.Div([
            html.Label("Fluxo", style={"fontWeight": "bold"}),
            dcc.RadioItems(
                id="radio-flow",
                options=[
                    {"label": "Importação", "value": "import"},
                    {"label": "Exportação", "value": "export"},
                    {"label": "Ambos",      "value": "__BOTH__"},
                ],
                value="import", inline=True,
            ),
        ], style={"flex": "1", "minWidth": "240px", "paddingTop": "20px"}),

        html.Div([
            html.Label("Métrica", style={"fontWeight": "bold"}),
            dcc.RadioItems(
                id="radio-metrica",
                options=[
                    {"label": "Volume (kg)", "value": "volume_kg"},
                    {"label": "Valor (USD)", "value": "valor_fob_usd"},
                ],
                value="volume_kg", inline=True,
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
    Output("info",    "children"),
    Input("dd-ncm",       "value"),
    Input("dd-pais",      "value"),
    Input("radio-flow",   "value"),
    Input("radio-metrica", "value"),
    Input("radio-grupo",  "value"),
    Input("slider-ano",   "value"),
)
def atualizar(ncms, pais, flow, metrica, grupo, anos):
    if not ncms:
        return go.Figure(), "Selecione ao menos um NCM."

    where  = [f"{metrica} IS NOT NULL"]
    params: list = []
    placeholders = ", ".join(["?"] * len(ncms))
    where.append(f"ncm_codigo IN ({placeholders})")
    params.extend(ncms)
    where.append("ano BETWEEN ? AND ?")
    params.extend(anos)
    if pais != "__ALL__":
        where.append("pais = ?"); params.append(pais)
    if flow in ("import", "export"):
        where.append("flow = ?"); params.append(flow)

    bucket = "make_date(ano, mes, 1)" if grupo == "mes" else "make_date(ano, 1, 1)"

    sql = f"""
        SELECT {bucket} AS data,
               ncm_codigo,
               ANY_VALUE(ncm_nome) AS ncm_nome,
               flow,
               SUM({metrica}) AS valor,
               COUNT(*) AS n
        FROM read_parquet(?)
        WHERE {' AND '.join(where)}
        GROUP BY data, ncm_codigo, flow
        ORDER BY data
    """
    grp = _con.execute(sql, [_PARQUET_STR, *params]).df()

    if grp.empty:
        return go.Figure(), "Sem dados para os filtros selecionados."

    fig = go.Figure()
    for _, sub in grp.groupby(["ncm_codigo", "flow"]):
        ncm = sub["ncm_codigo"].iloc[0]
        fl  = sub["flow"].iloc[0]
        nome = sub["ncm_nome"].iloc[0]
        label = f"{ncm} — {nome[:30]}"
        if flow == "__BOTH__":
            label += f" ({fl})"
        fmt = "%{y:,.0f} kg" if metrica == "volume_kg" else "US$ %{y:,.0f}"
        fig.add_trace(go.Scatter(
            x=sub["data"], y=sub["valor"], mode="lines", name=label,
            hovertemplate=("<b>%{fullData.name}</b><br>"
                           "Data: %{x|%b/%Y}<br>"
                           f"{fmt}<br><extra></extra>"),
        ))

    rotulo_flow = {"import": "Importações", "export": "Exportações", "__BOTH__": "IMP + EXP"}[flow]
    rotulo_metrica = "Volume" if metrica == "volume_kg" else "Valor (USD)"
    titulo = f"{rotulo_flow} — {rotulo_metrica}"
    if pais != "__ALL__":
        titulo += f" — Origem: {pais}"

    fig.update_layout(
        title=titulo, xaxis_title="",
        yaxis_title=("kg" if metrica == "volume_kg" else "USD"),
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
