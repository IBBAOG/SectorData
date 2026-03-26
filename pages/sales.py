"""
Sales Dashboard — equivalent to the original app.py Sales content.
"""
import json
from datetime import datetime

import dash
import dash_bootstrap_components as dbc
from dash import dcc, html, Input, Output, State, callback, no_update
from flask import session

from components.filters import (
    resolver_datas, period_slider, checklist_filter,
    region_state_filter, ufs_for_region,
)
from components.charts import (
    grafico_barra_ano, grafico_linha_mes, grafico_pizza_regiao,
    grafico_barra_uf, grafico_barra_agente, grafico_barra_produto,
)
from components import database as db

dash.register_page(__name__, path="/", name="Sales")

_NO_DATA = "No data for the selected filters."


# ─────────────────────────────────────────────────────────────────────────────
# Sidebar helper
# ─────────────────────────────────────────────────────────────────────────────
def _build_sidebar(opcoes: dict) -> html.Div:
    datas = resolver_datas(opcoes)

    period = period_slider(datas, slider_id="sales-slider-period")

    accordion_items = [
        checklist_filter(
            "Segment",
            ["B2B", "Retail", "TRR", "Others"],
            "sales-checklist-seg",
        ),
        checklist_filter(
            "Regulated Agent",
            opcoes.get("agentes", []),
            "sales-checklist-agt",
        ),
        region_state_filter(
            opcoes.get("regioes_dest", []),
            opcoes.get("ufs_dest", []),
            reg_id="sales-checklist-regioes",
            uf_id="sales-checklist-ufs",
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
                    dbc.Button("Apply", id="sales-btn-apply", n_clicks=0,
                               className="btn-apply"),
                    width=6,
                ),
                dbc.Col(
                    dbc.Button("Clear", id="sales-btn-clear", n_clicks=0,
                               outline=True, color="secondary",
                               className="btn-clear"),
                    width=6,
                ),
            ], className="g-1 mt-1"),
            html.Div(id="sales-last-updated",
                     style={"fontSize": "11px", "color": "#aaa", "marginTop": "8px",
                            "textAlign": "center"}),
        ],
    )


# ─────────────────────────────────────────────────────────────────────────────
# Page layout
# ─────────────────────────────────────────────────────────────────────────────
def layout():
    token = session.get("token")
    opcoes = db.carregar_opcoes(token) or {}
    datas  = resolver_datas(opcoes)

    sidebar = _build_sidebar(opcoes)

    # Store for active filters and available dates list
    stores = [
        dcc.Store(id="sales-store-filtros",   storage_type="session"),
        dcc.Store(id="sales-store-datas",     data=datas,              storage_type="memory"),
        dcc.Store(id="sales-store-opcoes-uf", data=opcoes.get("ufs_dest", []), storage_type="memory"),
    ]

    header = html.Div([
        html.Div([
            html.Div("Sales Dashboard",
                     className="page-header-title"),
            html.Div("Product volume analysis (thousand m³)",
                     className="page-header-sub"),
        ]),
    ], className="mb-2")

    metrics_row = dbc.Row([
        dbc.Col(html.Div([
            html.Div("Total Records",   className="metric-label"),
            html.Div(id="sales-metric-registros", className="metric-value"),
        ], className="metric-card"), md=4, className="mb-3"),
        dbc.Col(html.Div([
            html.Div("Total Volume (thousand m³)", className="metric-label"),
            html.Div(id="sales-metric-volume",     className="metric-value"),
        ], className="metric-card"), md=4, className="mb-3"),
        dbc.Col(html.Div([
            html.Div("Available Years", className="metric-label"),
            html.Div(id="sales-metric-anos",       className="metric-value"),
        ], className="metric-card"), md=4, className="mb-3"),
    ], className="mb-3")

    export_accordion = dbc.Accordion([
        dbc.AccordionItem(
            dbc.Row([
                dbc.Col(
                    html.A("By year (CSV)", id="sales-dl-ano",   download="volume_by_year.csv",
                           href="", style={"display": "none"}),
                    md=4,
                ),
                dbc.Col(
                    html.A("By month (CSV)", id="sales-dl-mes",  download="volume_by_month.csv",
                           href="", style={"display": "none"}),
                    md=4,
                ),
                dbc.Col(
                    html.A("By agent (CSV)", id="sales-dl-agt",  download="volume_by_agent.csv",
                           href="", style={"display": "none"}),
                    md=4,
                ),
                dbc.Col(dbc.Button("Download Year CSV",  id="sales-btn-dl-ano",  color="secondary",
                                   outline=True, size="sm", className="w-100 mb-1"), md=4),
                dbc.Col(dbc.Button("Download Month CSV", id="sales-btn-dl-mes",  color="secondary",
                                   outline=True, size="sm", className="w-100 mb-1"), md=4),
                dbc.Col(dbc.Button("Download Agent CSV", id="sales-btn-dl-agt",  color="secondary",
                                   outline=True, size="sm", className="w-100 mb-1"), md=4),
            ]),
            title="Export Data",
        ),
    ], start_collapsed=True, className="mb-3")

    charts_section = html.Div([
        html.Hr(style={"borderTop": "2px solid #e0e0e0", "marginBottom": "12px"}),
        html.Div([
            html.Div("Liquid Fuels Sales", className="section-title"),
            html.Hr(className="section-hr"),
        ], className="mb-3"),

        # Row 1: Year + Month
        dbc.Row([
            dbc.Col(html.Div([
                dcc.Loading(dcc.Graph(id="sales-fig-ano",    config={"displayModeBar": False}),
                            type="circle", color="#FF5000"),
            ], className="chart-container"), md=6, className="mb-3"),
            dbc.Col(html.Div([
                dcc.Loading(dcc.Graph(id="sales-fig-mes",    config={"displayModeBar": False}),
                            type="circle", color="#FF5000"),
            ], className="chart-container"), md=6, className="mb-3"),
        ]),

        # Row 2: Region + State
        dbc.Row([
            dbc.Col(html.Div([
                dcc.Loading(dcc.Graph(id="sales-fig-regiao", config={"displayModeBar": False}),
                            type="circle", color="#FF5000"),
            ], className="chart-container"), md=6, className="mb-3"),
            dbc.Col(html.Div([
                dcc.Loading(dcc.Graph(id="sales-fig-uf",     config={"displayModeBar": False}),
                            type="circle", color="#FF5000"),
            ], className="chart-container"), md=6, className="mb-3"),
        ]),

        # Row 3: Agent + Product
        dbc.Row([
            dbc.Col(html.Div([
                dcc.Loading(dcc.Graph(id="sales-fig-agente",  config={"displayModeBar": False}),
                            type="circle", color="#FF5000"),
            ], className="chart-container"), md=6, className="mb-3"),
            dbc.Col(html.Div([
                dcc.Loading(dcc.Graph(id="sales-fig-produto", config={"displayModeBar": False}),
                            type="circle", color="#FF5000"),
            ], className="chart-container"), md=6, className="mb-3"),
        ]),
    ])

    return html.Div([
        *stores,
        dbc.Row([
            dbc.Col(sidebar, width=2, style={"padding": "0"}),
            dbc.Col(
                html.Div(
                    [header, metrics_row, export_accordion, charts_section],
                    id="page-content",
                ),
                width=10,
            ),
        ], className="g-0"),
    ])


# ─────────────────────────────────────────────────────────────────────────────
# Callback: period slider display label
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("sales-slider-period-display", "children"),
    Input("sales-slider-period", "value"),
    State("sales-store-datas", "data"),
    prevent_initial_call=False,
)
def sales_update_period_display(slider_val, datas):
    from components.filters import _fmt_data
    if not datas or not slider_val:
        return ""
    start = _fmt_data(datas[slider_val[0]])
    end   = _fmt_data(datas[slider_val[1]])
    return f"{start}  →  {end}"


# ─────────────────────────────────────────────────────────────────────────────
# Callback: show/hide UF checklist based on selected regions
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("sales-checklist-ufs-container", "style"),
    Output("sales-checklist-ufs", "options"),
    Input("sales-checklist-regioes", "value"),
    State("sales-store-opcoes-uf", "data"),
    prevent_initial_call=False,
)
def update_uf_options(sel_regioes, all_ufs):
    if not sel_regioes or not all_ufs:
        return {"display": "none"}, []
    visible_ufs = []
    for r in sel_regioes:
        for u in ufs_for_region(r, all_ufs):
            if u not in visible_ufs:
                visible_ufs.append(u)
    options = [{"label": u, "value": u} for u in visible_ufs]
    return {"display": "block"}, options


# ─────────────────────────────────────────────────────────────────────────────
# Callback: Select-all / Clear for Segment
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("sales-checklist-seg", "value"),
    Input("sales-checklist-seg-btn-all", "n_clicks"),
    Input("sales-checklist-seg-btn-clr", "n_clicks"),
    State("sales-checklist-seg", "options"),
    prevent_initial_call=True,
)
def seg_all_clear(n_all, n_clr, options):
    from dash import ctx
    if not ctx.triggered_id:
        return no_update
    if ctx.triggered_id == "sales-checklist-seg-btn-all":
        return [o["value"] for o in (options or [])]
    return []


# ─────────────────────────────────────────────────────────────────────────────
# Callback: Select-all / Clear for Agent
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("sales-checklist-agt", "value"),
    Input("sales-checklist-agt-btn-all", "n_clicks"),
    Input("sales-checklist-agt-btn-clr", "n_clicks"),
    State("sales-checklist-agt", "options"),
    prevent_initial_call=True,
)
def agt_all_clear(n_all, n_clr, options):
    from dash import ctx
    if not ctx.triggered_id:
        return no_update
    if ctx.triggered_id == "sales-checklist-agt-btn-all":
        return [o["value"] for o in (options or [])]
    return []


# ─────────────────────────────────────────────────────────────────────────────
# Callback: Select-all / Clear for Region
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("sales-checklist-regioes", "value"),
    Input("sales-checklist-regioes-btn-all", "n_clicks"),
    Input("sales-checklist-regioes-btn-clr", "n_clicks"),
    State("sales-checklist-regioes", "options"),
    prevent_initial_call=True,
)
def reg_all_clear(n_all, n_clr, options):
    from dash import ctx
    if not ctx.triggered_id:
        return no_update
    if ctx.triggered_id == "sales-checklist-regioes-btn-all":
        return [o["value"] for o in (options or [])]
    return []


# ─────────────────────────────────────────────────────────────────────────────
# Callback: Apply / Clear buttons → update store
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("sales-store-filtros",    "data"),
    Output("sales-last-updated",     "children"),
    Output("sales-checklist-seg",    "value", allow_duplicate=True),
    Output("sales-checklist-agt",    "value", allow_duplicate=True),
    Output("sales-checklist-regioes","value", allow_duplicate=True),
    Output("sales-checklist-ufs",    "value"),
    Output("toast-filters",          "is_open"),
    Input("sales-btn-apply", "n_clicks"),
    Input("sales-btn-clear", "n_clicks"),
    State("sales-slider-period",       "value"),
    State("sales-store-datas",         "data"),
    State("sales-checklist-seg",       "value"),
    State("sales-checklist-agt",       "value"),
    State("sales-checklist-regioes",   "value"),
    State("sales-checklist-ufs",       "value"),
    prevent_initial_call=True,
)
def apply_or_clear(n_apply, n_clear, slider_val, datas, seg, agt, regioes, ufs):
    from dash import ctx
    triggered = ctx.triggered_id

    if triggered == "sales-btn-clear":
        return {}, "", [], [], [], [], False

    # Apply
    d_inicio = datas[slider_val[0]] if datas and slider_val else None
    d_fim    = datas[slider_val[1]] if datas and slider_val else None

    filtros = {
        "data_inicio":  d_inicio,
        "data_fim":     d_fim,
        "segmentos":    seg or [],
        "agentes":      agt or [],
        "regioes_dest": regioes or [],
        "ufs_dest":     ufs or [],
        "mercados":     [],
    }
    ts = datetime.now().strftime("%m/%d/%Y %H:%M")
    return filtros, f"Updated on {ts}", no_update, no_update, no_update, no_update, True


# ─────────────────────────────────────────────────────────────────────────────
# Callback: Render charts from store
# ─────────────────────────────────────────────────────────────────────────────
@callback(
    Output("sales-metric-registros", "children"),
    Output("sales-metric-volume",    "children"),
    Output("sales-metric-anos",      "children"),
    Output("sales-fig-ano",          "figure"),
    Output("sales-fig-mes",          "figure"),
    Output("sales-fig-regiao",       "figure"),
    Output("sales-fig-uf",           "figure"),
    Output("sales-fig-agente",       "figure"),
    Output("sales-fig-produto",      "figure"),
    Input("sales-store-filtros", "data"),
    prevent_initial_call=False,
)
def render_charts(filtros):
    import plotly.graph_objects as go

    token = session.get("token")
    f = filtros or {}

    metricas, df_ano, df_mes, df_regiao, df_agente, df_produto, df_uf = db.carregar_todos(f, token)

    # Metrics
    reg_val = f"{metricas.get('total_registros', 0):,}" if isinstance(metricas, dict) else "—"
    vol_val = f"{metricas.get('quantidade_total', 0.0):,.2f}" if isinstance(metricas, dict) else "—"
    ano_val = f"{metricas.get('anos_distintos', 0)}" if isinstance(metricas, dict) else "—"

    _empty = go.Figure()
    _empty.update_layout(
        paper_bgcolor="white", plot_bgcolor="white",
        xaxis={"visible": False}, yaxis={"visible": False},
        annotations=[{"text": _NO_DATA, "xref": "paper", "yref": "paper",
                       "showarrow": False, "font": {"size": 13, "family": "Arial", "color": "#888"}}],
    )

    fig_ano     = grafico_barra_ano(df_ano)    if not df_ano.empty    else _empty
    fig_mes     = grafico_linha_mes(df_mes)    if not df_mes.empty    else _empty
    fig_regiao  = grafico_pizza_regiao(df_regiao) if not df_regiao.empty else _empty
    fig_uf      = grafico_barra_uf(df_uf)      if not df_uf.empty     else _empty
    fig_agente  = grafico_barra_agente(df_agente) if not df_agente.empty else _empty
    fig_produto = grafico_barra_produto(df_produto) if not df_produto.empty else _empty

    return reg_val, vol_val, ano_val, fig_ano, fig_mes, fig_regiao, fig_uf, fig_agente, fig_produto
