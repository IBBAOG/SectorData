"""
Market Share page — equivalent to pages/2_Market_Share.py.
"""
import json
from itertools import product as _product

import dash
import dash_bootstrap_components as dbc
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from dash import dcc, html, Input, Output, State, callback, no_update
from flask import session

from components.filters import (
    resolver_datas, period_slider, checklist_filter,
    region_state_filter, ufs_for_region,
)
from components import database as db

dash.register_page(__name__, path="/market-share", name="Market Share")

# ─── Constants ────────────────────────────────────────────────────────────────
BIG3_MEMBERS = ["Vibra", "Ipiranga", "Raizen"]

COLORS_IND  = {"Vibra": "#f26522", "Raizen": "#1a1a1a", "Ipiranga": "#73C6A1", "Others": "#A9A9A9"}
COLORS_BIG3 = {"Big-3": "#FF5000", "Others": "#A9A9A9"}

ALL_PLAYERS_IND  = ["Vibra", "Ipiranga", "Raizen", "Others"]
ALL_PLAYERS_BIG3 = ["Big-3", "Others"]

MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

_FONT = dict(family="Arial", size=12, color="#000000")

_NO_DATA = "No data for the selected filters."


# ─────────────────────────────────────────────────────────────────────────────
# Chart builder
# ─────────────────────────────────────────────────────────────────────────────
def _linha_ms(df_serie: pd.DataFrame, produto: str, segmento, players: list,
              big3: bool = False) -> go.Figure | None:
    if df_serie.empty:
        return None

    mask = df_serie["nome_produto"] == produto
    if segmento:
        mask &= df_serie["segmento"] == segmento

    df = df_serie[mask].copy()
    if df.empty:
        return None

    df = df.groupby(["date", "classificacao"], as_index=False)["quantidade"].sum()

    if big3:
        df["classificacao"] = df["classificacao"].apply(
            lambda x: "Big-3" if x in BIG3_MEMBERS else x
        )
        df = df.groupby(["date", "classificacao"], as_index=False)["quantidade"].sum()
        colors_map = COLORS_BIG3
    else:
        colors_map = COLORS_IND

    totais = df.groupby("date")["quantidade"].sum().rename("total")
    df = df.join(totais, on="date")
    df["pct"] = df["quantidade"] / df["total"] * 100

    df = df[df["classificacao"].isin(players)].sort_values("date")
    if df.empty:
        return None

    y_min  = df["pct"].min()
    y_max  = df["pct"].max()
    spread = y_max - y_min if y_max > y_min else 1.0
    pad    = spread * 0.20
    y_lo   = max(0.0,   y_min - pad)
    y_hi   = min(100.0, y_max + pad)

    fig = px.line(
        df, x="date", y="pct", color="classificacao",
        color_discrete_map=colors_map,
        labels={"date": "", "pct": "Market Share (%)", "classificacao": ""},
        title="",
    )

    fig.update_traces(
        mode="lines",
        line_width=2.5,
        hovertemplate="%{fullData.name}: %{y:.1f}%<extra></extra>",
    )

    ultima_data = df["date"].max()
    for player in players:
        ultimo = df[(df["classificacao"] == player) & (df["date"] == ultima_data)]
        if ultimo.empty:
            continue
        fig.add_annotation(
            x=ultima_data,
            y=float(ultimo["pct"].iloc[0]),
            text=f"{float(ultimo['pct'].iloc[0]):.1f}%",
            showarrow=False,
            xanchor="left",
            xshift=6,
            yanchor="middle",
            font=dict(family="Arial", size=12, color=colors_map.get(player, "#000000")),
        )

    fig.update_layout(
        title={"text": ""},
        margin=dict(t=10, b=80, l=10, r=60),
        font=_FONT,
        yaxis=dict(
            title=dict(text="Market Share (%)", font=_FONT),
            ticksuffix="%", range=[y_lo, y_hi], tickfont=_FONT,
            nticks=10,
            showgrid=False, zeroline=False,
            showline=True, linecolor="#000000", linewidth=1,
        ),
        xaxis=dict(
            title=dict(text="", font=_FONT),
            tickfont=_FONT,
            tickformat="%b-%y",
            tickangle=-90,
            tickmode="auto",
            nticks=12,
            automargin=True,
            showgrid=False, zeroline=False,
            showline=True, linecolor="#000000", linewidth=1,
        ),
        legend=dict(orientation="h", yanchor="top", y=-0.28,
                    xanchor="center", x=0.5, font=_FONT),
        hoverlabel=dict(font=dict(family="Arial", color="#000000")),
        plot_bgcolor="white",
        paper_bgcolor="white",
        height=300,
        hovermode="x unified",
    )
    return fig


def _empty_fig() -> go.Figure:
    fig = go.Figure()
    fig.update_layout(
        paper_bgcolor="white", plot_bgcolor="white", height=300,
        xaxis={"visible": False}, yaxis={"visible": False},
        annotations=[{"text": _NO_DATA, "xref": "paper", "yref": "paper",
                       "showarrow": False, "font": {"size": 13, "family": "Arial", "color": "#888"}}],
    )
    return fig


def _section_title(label: str) -> html.Div:
    return html.Div([
        html.Div(label, className="section-title"),
        html.Hr(className="section-hr"),
    ], className="mb-2 mt-3")


def _chart_col(graph_id: str, label: str) -> dbc.Col:
    return dbc.Col(
        html.Div([
            html.Div(label, className="section-title",
                     style={"fontSize": "15px"}),
            html.Hr(className="section-hr"),
            dcc.Loading(
                dcc.Graph(id=graph_id, config={"displayModeBar": False}, figure=_empty_fig()),
                type="circle", color="#FF5000",
            ),
        ], className="chart-container"),
        md=6, className="mb-3",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Sidebar builder
# ─────────────────────────────────────────────────────────────────────────────
def _build_sidebar(opcoes: dict) -> html.Div:
    datas = resolver_datas(opcoes)
    period = period_slider(datas, slider_id="ms-slider-period")

    accordion_items = [
        dbc.AccordionItem(
            html.Div([
                dbc.RadioItems(
                    id="ms-radio-modo",
                    options=[
                        {"label": "Individual", "value": "Individual"},
                        {"label": "Big-3",      "value": "Big-3"},
                    ],
                    value="Individual",
                    inline=True,
                    labelStyle={"fontFamily": "Arial", "fontSize": "13px"},
                    inputStyle={"marginRight": "4px"},
                ),
            ]),
            title="View Mode",
        ),
        dbc.AccordionItem(
            html.Div([
                dbc.Row([
                    dbc.Col(
                        dbc.Button("All", id="ms-checklist-comp-btn-all", size="sm",
                                   color="link", style={"padding": "0", "fontSize": "11px", "color": "#FF5000"}),
                        width="auto",
                    ),
                    dbc.Col(
                        dbc.Button("Clear", id="ms-checklist-comp-btn-clr", size="sm",
                                   color="link", style={"padding": "0", "fontSize": "11px", "color": "#888"}),
                        width="auto",
                    ),
                ], className="mb-1 g-2"),
                html.Hr(style={"margin": "4px 0 6px 0", "borderTop": "1px solid #e0e0e0"}),
                dbc.Checklist(
                    id="ms-checklist-comp",
                    options=[{"label": p, "value": p} for p in ALL_PLAYERS_IND],
                    value=[],
                    labelStyle={"fontFamily": "Arial", "fontSize": "12px"},
                    inputStyle={"marginRight": "6px"},
                ),
            ]),
            title="Competitors",
        ),
        region_state_filter(
            opcoes.get("regioes", []),
            opcoes.get("ufs", []),
            reg_id="ms-checklist-regioes",
            uf_id="ms-checklist-ufs",
        ),
    ]

    return html.Div(
        id="sidebar",
        children=[
            html.Div(
                html.Img(
                    src="https://raw.githubusercontent.com/IBBAOG/SectorData/main/assets/logo.webp",
                    style={"width": "100%", "maxWidth": "160px", "marginBottom": "16px"},
                ),
                style={"textAlign": "center"},
            ),
            html.Hr(style={"borderTop": "1px solid #e0e0e0", "marginBottom": "12px"}),
            html.Div("Filters", className="sidebar-section-label"),
            period,
            dbc.Accordion(accordion_items, start_collapsed=True, flush=True, className="mb-3"),
            html.Hr(style={"borderTop": "1px solid #e0e0e0"}),
            dbc.Row([
                dbc.Col(
                    dbc.Button("Apply", id="ms-btn-apply", n_clicks=0,
                               className="btn-apply"),
                    width=6,
                ),
                dbc.Col(
                    dbc.Button("Clear", id="ms-btn-clear", n_clicks=0,
                               outline=True, color="secondary",
                               className="btn-clear"),
                    width=6,
                ),
            ], className="g-1 mt-1"),
        ],
    )


# ─────────────────────────────────────────────────────────────────────────────
# Page layout
# ─────────────────────────────────────────────────────────────────────────────
def layout():
    token  = session.get("token")
    opcoes = db.carregar_ms_opcoes(token) or {}
    datas  = resolver_datas(opcoes)

    sidebar = _build_sidebar(opcoes)

    stores = [
        dcc.Store(id="ms-store-filtros",   storage_type="session"),
        dcc.Store(id="ms-store-serie",     storage_type="memory"),
        dcc.Store(id="ms-store-datas",     data=datas, storage_type="memory"),
        dcc.Store(id="ms-store-opcoes-uf", data=opcoes.get("ufs", []), storage_type="memory"),
    ]

    header = html.Div([
        html.Div("Liquid Fuels Market Share", className="page-header-title"),
        html.Div("Temporal evolution of market share by distributor (%)",
                 className="page-header-sub"),
    ], className="mb-2")

    # Diesel B: Retail, B2B, TRR, Total
    diesel_section = html.Div([
        _section_title("Diesel B"),
        dbc.Row([
            _chart_col("ms-fig-diesel-retail", "Retail"),
            _chart_col("ms-fig-diesel-b2b",    "B2B"),
        ]),
        dbc.Row([
            _chart_col("ms-fig-diesel-trr",   "TRR"),
            _chart_col("ms-fig-diesel-total", "Total"),
        ]),
        html.Hr(style={"borderTop": "1px solid #e0e0e0", "margin": "8px 0 16px"}),
    ])

    # Gasoline C: Retail, B2B, Total
    gasoline_section = html.Div([
        _section_title("Gasoline C"),
        dbc.Row([
            _chart_col("ms-fig-gas-retail", "Retail"),
            _chart_col("ms-fig-gas-b2b",    "B2B"),
        ]),
        dbc.Row([
            _chart_col("ms-fig-gas-total", "Total"),
            dbc.Col(md=6),
        ]),
        html.Hr(style={"borderTop": "1px solid #e0e0e0", "margin": "8px 0 16px"}),
    ])

    # Ethanol: Retail, B2B, Total
    ethanol_section = html.Div([
        _section_title("Hydrated Ethanol"),
        dbc.Row([
            _chart_col("ms-fig-eth-retail", "Retail"),
            _chart_col("ms-fig-eth-b2b",    "B2B"),
        ]),
        dbc.Row([
            _chart_col("ms-fig-eth-total", "Total"),
            dbc.Col(md=6),
        ]),
        html.Hr(style={"borderTop": "1px solid #e0e0e0", "margin": "8px 0 16px"}),
    ])

    export_row = dbc.Accordion([
        dbc.AccordionItem(
            dbc.Row([
                dbc.Col(
                    dbc.Button("Full series (CSV)", id="ms-btn-dl-serie",
                               color="secondary", outline=True, size="sm"),
                    md=3,
                ),
                dcc.Download(id="ms-dl-serie"),
            ]),
            title="Export Data",
        ),
    ], start_collapsed=True, className="mb-3")

    content = html.Div([
        header,
        export_row,
        diesel_section,
        gasoline_section,
        ethanol_section,
    ], id="page-content")

    return html.Div([
        *stores,
        dbc.Row([
            dbc.Col(sidebar, width=2, style={"padding": "0"}),
            dbc.Col(content, width=10),
        ], className="g-0"),
    ])


# ─────────────────────────────────────────────────────────────────────────────
# Callback: period slider display label
# ─────────────────────────────────────────────────────────────────────────────
dash.clientside_callback(
    """
    function(value, datas) {
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug',
                      'Sep','Oct','Nov','Dec'];
        function fmt(d) {
            if (!d) return '';
            return months[parseInt(d.substring(5,7)) - 1] + '/' + d.substring(0,4);
        }
        if (!value || !datas || !datas.length)
            return window.dash_clientside.no_update;

        var start = fmt(datas[value[0]]);
        var end   = fmt(datas[value[1]]);

        // Patch tooltip DOM text scoped to this slider
        setTimeout(function() {
            var el = document.getElementById('ms-slider-period');
            if (!el) return;
            var tips = el.querySelectorAll('.rc-slider-tooltip-inner');
            if (tips.length >= 2) {
                tips[0].textContent = start;
                tips[1].textContent = end;
            }
        }, 30);

        return start + '  \u2192  ' + end;
    }
    """,
    Output("ms-slider-period-display", "children"),
    Input("ms-slider-period", "value"),
    State("ms-store-datas", "data"),
)


# ─────────────────────────────────────────────────────────────────────────────
# Callback: UF options based on selected regions
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("ms-checklist-ufs-container", "style"),
    Output("ms-checklist-ufs", "options"),
    Input("ms-checklist-regioes", "value"),
    State("ms-store-opcoes-uf", "data"),
    prevent_initial_call=False,
)
def ms_update_uf_options(sel_regioes, all_ufs):
    if not sel_regioes or not all_ufs:
        return {"display": "none"}, []
    visible = []
    for r in sel_regioes:
        for u in ufs_for_region(r, all_ufs):
            if u not in visible:
                visible.append(u)
    return {"display": "block"}, [{"label": u, "value": u} for u in visible]


# ─────────────────────────────────────────────────────────────────────────────
# Callback: Competitor options change when view mode changes
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("ms-checklist-comp", "options"),
    Output("ms-checklist-comp", "value"),
    Input("ms-radio-modo", "value"),
    prevent_initial_call=False,
)
def update_comp_options(modo):
    players = ALL_PLAYERS_BIG3 if modo == "Big-3" else ALL_PLAYERS_IND
    return [{"label": p, "value": p} for p in players], []


# ─────────────────────────────────────────────────────────────────────────────
# Callback: Select-all / Clear for Competitors
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("ms-checklist-comp", "value", allow_duplicate=True),
    Input("ms-checklist-comp-btn-all", "n_clicks"),
    Input("ms-checklist-comp-btn-clr", "n_clicks"),
    State("ms-checklist-comp", "options"),
    prevent_initial_call=True,
)
def comp_all_clear(n_all, n_clr, options):
    from dash import ctx
    if ctx.triggered_id == "ms-checklist-comp-btn-all":
        return [o["value"] for o in (options or [])]
    return []


# ─────────────────────────────────────────────────────────────────────────────
# Callback: Select-all / Clear for Regions
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("ms-checklist-regioes", "value"),
    Input("ms-checklist-regioes-btn-all", "n_clicks"),
    Input("ms-checklist-regioes-btn-clr", "n_clicks"),
    State("ms-checklist-regioes", "options"),
    prevent_initial_call=True,
)
def ms_reg_all_clear(n_all, n_clr, options):
    from dash import ctx
    if ctx.triggered_id == "ms-checklist-regioes-btn-all":
        return [o["value"] for o in (options or [])]
    return []


# ─────────────────────────────────────────────────────────────────────────────
# Callback: Apply / Clear → update filter store
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("ms-store-filtros", "data"),
    Output("ms-checklist-comp",    "value", allow_duplicate=True),
    Output("ms-checklist-regioes", "value", allow_duplicate=True),
    Output("ms-checklist-ufs",     "value"),
    Output("toast-filters",        "is_open"),
    Input("ms-btn-apply", "n_clicks"),
    Input("ms-btn-clear", "n_clicks"),
    State("ms-slider-period",        "value"),
    State("ms-store-datas",          "data"),
    State("ms-checklist-comp",       "value"),
    State("ms-checklist-regioes",    "value"),
    State("ms-checklist-ufs",        "value"),
    State("ms-radio-modo",           "value"),
    prevent_initial_call=True,
)
def ms_apply_or_clear(n_apply, n_clear, slider_val, datas,
                      comp, regioes, ufs, modo):
    from dash import ctx
    triggered = ctx.triggered_id

    if triggered == "ms-btn-clear":
        return {}, [], [], [], False

    d_inicio = datas[slider_val[0]] if datas and slider_val else None
    d_fim    = datas[slider_val[1]] if datas and slider_val else None

    players_default = ALL_PLAYERS_BIG3 if modo == "Big-3" else ALL_PLAYERS_IND

    filtros = {
        "data_inicio":  d_inicio,
        "data_fim":     d_fim,
        "competidores": comp or players_default,
        "regioes":      regioes or [],
        "ufs":          ufs or [],
        "mercados":     [],
        "modo_big3":    modo == "Big-3",
    }
    return filtros, no_update, no_update, no_update, True


# ─────────────────────────────────────────────────────────────────────────────
# Callback: Load series data into store when filters change
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("ms-store-serie", "data"),
    Input("ms-store-filtros", "data"),
    prevent_initial_call=False,
)
def load_serie(filtros):
    token = session.get("token")
    f = filtros or {}
    df = db.carregar_ms_serie(
        f.get("data_inicio"),
        f.get("data_fim"),
        tuple(f.get("regioes") or []),
        tuple(f.get("ufs")    or []),
        tuple(f.get("mercados") or []),
        token=token,
    )
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"])
        return df.to_json(date_format="iso", orient="split")
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Callback: Render all charts from series store
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("ms-fig-diesel-retail", "figure"),
    Output("ms-fig-diesel-b2b",    "figure"),
    Output("ms-fig-diesel-trr",    "figure"),
    Output("ms-fig-diesel-total",  "figure"),
    Output("ms-fig-gas-retail",    "figure"),
    Output("ms-fig-gas-b2b",       "figure"),
    Output("ms-fig-gas-total",     "figure"),
    Output("ms-fig-eth-retail",    "figure"),
    Output("ms-fig-eth-b2b",       "figure"),
    Output("ms-fig-eth-total",     "figure"),
    Input("ms-store-serie",    "data"),
    Input("ms-store-filtros",  "data"),
    prevent_initial_call=False,
)
def render_ms_charts(serie_json, filtros):
    f   = filtros or {}
    big3 = f.get("modo_big3", False)

    players_default = ALL_PLAYERS_BIG3 if big3 else ALL_PLAYERS_IND
    players = f.get("competidores") or players_default

    if not serie_json:
        figs = [_empty_fig()] * 10
        return tuple(figs)

    df_serie = pd.read_json(serie_json, orient="split")
    if "date" in df_serie.columns:
        df_serie["date"] = pd.to_datetime(df_serie["date"])

    def _get(produto, seg):
        fig = _linha_ms(df_serie, produto, seg, players, big3=big3)
        return fig if fig is not None else _empty_fig()

    return (
        # Diesel B
        _get("Diesel B", "Retail"),
        _get("Diesel B", "B2B"),
        _get("Diesel B", "TRR"),
        _get("Diesel B", None),
        # Gasoline C
        _get("Gasolina C", "Retail"),
        _get("Gasolina C", "B2B"),
        _get("Gasolina C", None),
        # Ethanol
        _get("Etanol Hidratado", "Retail"),
        _get("Etanol Hidratado", "B2B"),
        _get("Etanol Hidratado", None),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Callback: Download full series CSV
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("ms-dl-serie", "data"),
    Input("ms-btn-dl-serie", "n_clicks"),
    State("ms-store-serie", "data"),
    prevent_initial_call=True,
)
def ms_download_serie(n, serie_json):
    if not n or not serie_json:
        return no_update
    df = pd.read_json(serie_json, orient="split")
    return dcc.send_data_frame(df.to_csv, "ms_series.csv", index=False)
