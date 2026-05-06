#!/usr/bin/env python3
"""
visualizar.py
=============
App Dash para a série ANP Desembaraços de Importações.

Uso:
    python alertas/scripts/anp_desembaracos/visualizar.py
    Abrir http://localhost:8050
"""
import sys
from pathlib import Path

import duckdb
import plotly.graph_objects as go
from dash import Dash, Input, Output, callback, dcc, html

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_PARQUET = Path(__file__).parents[3] / "DADOS" / "anp_desembaracos" / "desembaracos_consolidado.parquet"
_PARQUET_STR = str(_PARQUET).replace("\\", "/")

if not _PARQUET.exists():
    print(f"ERRO: Parquet não encontrado em {_PARQUET}")
    print("Rode antes: python alertas/scripts/anp_desembaracos/consolidar.py")
    sys.exit(1)

print("Inicializando DuckDB...", flush=True)
_con = duckdb.connect(database=":memory:")

def _unicos(coluna: str, max_n: int | None = None) -> list:
    sql = (f"SELECT DISTINCT {coluna} FROM read_parquet(?) "
           f"WHERE {coluna} IS NOT NULL ORDER BY 1")
    rows = _con.execute(sql, [_PARQUET_STR]).fetchall()
    return [r[0] for r in rows][:max_n] if max_n else [r[0] for r in rows]

# NCMs com descrição (top por volume)
NCMS_DESC = _con.execute(f"""
    SELECT CAST(ncm AS BIGINT) AS ncm,
           ANY_VALUE(descricao_ncm) AS desc,
           SUM(quantidade_kg) AS vol
    FROM read_parquet(?)
    WHERE ncm IS NOT NULL
    GROUP BY ncm
    ORDER BY vol DESC
""", [_PARQUET_STR]).fetchall()

NCM_OPTIONS = [
    {"label": f"{r[0]} — {(r[1] or '')[:60]}", "value": r[0]}
    for r in NCMS_DESC
]

UFS    = _unicos("uf")
PAISES = _unicos("pais_origem")
IMPORTADORES = _unicos("importador")

(min_ano, max_ano, total) = _con.execute(
    "SELECT MIN(ano), MAX(ano), COUNT(*) FROM read_parquet(?)", [_PARQUET_STR],
).fetchone()

print(f"  {total:,} linhas | {min_ano} -> {max_ano}", flush=True)
print(f"  NCMs: {len(NCMS_DESC)} | UFs: {len(UFS)} | Paises: {len(PAISES)}", flush=True)
print(f"  Importadores: {len(IMPORTADORES)}", flush=True)
print("Iniciando servidor em http://localhost:8050", flush=True)

# Top 5 NCMs por volume como default
DEFAULT_NCMS = [r[0] for r in NCMS_DESC[:5]]

app = Dash(__name__)
app.layout = html.Div([
    html.H2(f"ANP Desembaraços de Importações ({min_ano}–{max_ano})",
            style={"fontFamily": "Arial", "marginBottom": "16px"}),

    html.Div([
        html.Div([
            html.Label("NCM (top 5 por volume default)", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-ncm",
                options=NCM_OPTIONS,
                value=DEFAULT_NCMS, multi=True,
            ),
        ], style={"flex": "3", "minWidth": "400px"}),

        html.Div([
            html.Label("UF", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-uf",
                options=[{"label": "Todas", "value": "__ALL__"}] +
                        [{"label": u, "value": u} for u in UFS],
                value="__ALL__", clearable=False,
            ),
        ], style={"flex": "1", "minWidth": "180px"}),

        html.Div([
            html.Label("País de origem", style={"fontWeight": "bold"}),
            dcc.Dropdown(
                id="dd-pais",
                options=[{"label": "Todos", "value": "__ALL__"}] +
                        [{"label": p, "value": p} for p in PAISES],
                value="__ALL__", clearable=False,
            ),
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
        html.Label("Importador", style={"fontWeight": "bold", "fontFamily": "Arial"}),
        dcc.Dropdown(
            id="dd-importador",
            options=[{"label": "Todos", "value": "__ALL__"}] +
                    [{"label": i, "value": i} for i in IMPORTADORES],
            value="__ALL__", clearable=False,
            placeholder="Buscar importador...",
        ),
    ], style={"marginBottom": "16px", "fontFamily": "Arial"}),

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
    Output("info", "children"),
    Input("dd-ncm",         "value"),
    Input("dd-uf",          "value"),
    Input("dd-pais",        "value"),
    Input("radio-grupo",    "value"),
    Input("dd-importador",  "value"),
    Input("slider-ano",     "value"),
)
def atualizar(ncms, uf, pais, grupo, importador, anos):
    if not ncms:
        return go.Figure(), "Selecione ao menos um NCM."

    where = ["quantidade_kg IS NOT NULL"]
    params: list = []
    placeholders = ", ".join(["?"] * len(ncms))
    where.append(f"ncm IN ({placeholders})")
    params.extend(ncms)
    where.append("ano BETWEEN ? AND ?")
    params.extend(anos)
    if uf != "__ALL__":
        where.append("uf = ?"); params.append(uf)
    if pais != "__ALL__":
        where.append("pais_origem = ?"); params.append(pais)
    if importador and importador != "__ALL__":
        where.append("importador = ?"); params.append(importador)

    if grupo == "mes":
        bucket = "make_date(ano, mes, 1)"
    else:
        bucket = "make_date(ano, 1, 1)"

    sql = f"""
        SELECT {bucket} AS data,
               CAST(ncm AS BIGINT) AS ncm,
               ANY_VALUE(descricao_ncm) AS desc,
               SUM(quantidade_kg)/1000.0 AS volume_t,
               COUNT(*) AS n
        FROM read_parquet(?)
        WHERE {' AND '.join(where)}
        GROUP BY data, ncm
        ORDER BY data
    """
    grp = _con.execute(sql, [_PARQUET_STR, *params]).df()

    if grp.empty:
        return go.Figure(), "Sem dados para os filtros selecionados."

    fig = go.Figure()
    for ncm_v in ncms:
        g = grp[grp["ncm"] == ncm_v]
        if g.empty:
            continue
        desc = g["desc"].iloc[0] or ""
        fig.add_trace(go.Scatter(
            x=g["data"], y=g["volume_t"], mode="lines",
            name=f"{ncm_v} — {desc[:40]}",
            hovertemplate=("<b>%{fullData.name}</b><br>"
                           "Data: %{x|%b/%Y}<br>"
                           "Volume: %{y:,.1f} t<br><extra></extra>"),
        ))

    titulo = "Volume importado (toneladas)"
    if uf != "__ALL__":     titulo += f" — UF {uf}"
    if pais != "__ALL__":   titulo += f" — Origem: {pais}"
    if importador and importador != "__ALL__":
        titulo += f" — {importador}"

    fig.update_layout(
        title=titulo, xaxis_title="", yaxis_title="Toneladas",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        hovermode="x unified", template="plotly_white",
        margin=dict(l=70, r=20, t=80, b=40),
    )

    info = (f"{int(grp['n'].sum()):,} importações | "
            f"{grp['data'].min().strftime('%b/%Y')} -> "
            f"{grp['data'].max().strftime('%b/%Y')} | "
            f"Volume total: {grp['volume_t'].sum():,.0f} t")
    return fig, info


if __name__ == "__main__":
    app.run(debug=False, port=8050)
