"""
Dash filter components.

All functions return Dash layout components (not rendered directly).
The sidebar is assembled in pages/sales.py and pages/market_share.py.
"""
from itertools import product as _product

import dash_bootstrap_components as dbc
from dash import dcc, html

MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Standard Brazilian region → UF mapping
REGIAO_UF_MAP = {
    "Norte":        ["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
    "N":            ["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
    "Nordeste":     ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
    "NE":           ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
    "Centro-Oeste": ["DF", "GO", "MS", "MT"],
    "CO":           ["DF", "GO", "MS", "MT"],
    "Sudeste":      ["ES", "MG", "RJ", "SP"],
    "SE":           ["ES", "MG", "RJ", "SP"],
    "Sul":          ["PR", "RS", "SC"],
    "S":            ["PR", "RS", "SC"],
}


def _fmt_data(d: str) -> str:
    try:
        y, m = d[:4], int(d[5:7])
        return f"{MONTHS_EN[m - 1]}/{y}"
    except Exception:
        return d


def resolver_datas(opcoes: dict) -> list:
    datas = sorted(opcoes.get("datas") or [])
    if datas:
        return datas
    anos  = sorted(opcoes.get("anos")  or [])
    meses = sorted(opcoes.get("meses") or [])
    if anos and meses:
        return sorted(f"{a:04d}-{m:02d}-01" for a, m in _product(anos, meses))
    return []


def period_slider(datas: list, slider_id: str = "slider-period") -> html.Div:
    """
    Returns a RangeSlider + selected-range display.
    The display div has id  f'{slider_id}-display'  and must be updated
    by a page-level callback (see sales.py / market_share.py).
    """
    if not datas:
        return html.Div(
            dbc.Alert("Unable to load the period.", color="warning", className="mb-2"),
        )

    # One mark every 2 years (Jan) to avoid label overlap
    marks = {}
    seen_years = set()
    for i, d in enumerate(datas):
        try:
            y, m = int(d[:4]), int(d[5:7])
            if m == 1 and y % 2 == 1 and str(y) not in seen_years:
                marks[i] = {"label": str(y),
                            "style": {"fontSize": "10px", "color": "#888"}}
                seen_years.add(str(y))
        except Exception:
            pass

    start_label = _fmt_data(datas[0])
    end_label   = _fmt_data(datas[-1])

    return html.Div([
        html.Label("Period", style={"fontFamily": "Arial", "fontSize": "13px",
                                    "fontWeight": "600", "color": "#1a1a1a",
                                    "marginBottom": "6px", "display": "block"}),
        # Selected range display — updated by page callback
        html.Div(
            id=f"{slider_id}-display",
            children=f"{start_label}  →  {end_label}",
            style={
                "fontFamily": "Arial", "fontSize": "11px", "color": "#FF5000",
                "fontWeight": "600", "textAlign": "center",
                "background": "#fff3ee", "borderRadius": "4px",
                "padding": "3px 6px", "marginBottom": "8px",
            },
        ),
        dcc.RangeSlider(
            id=slider_id,
            min=0,
            max=len(datas) - 1,
            value=[0, len(datas) - 1],
            marks=marks,
            step=1,
        ),
    ], style={"marginBottom": "20px"})


def checklist_filter(label: str, options: list, checklist_id: str) -> dbc.AccordionItem:
    """Returns a dbc.AccordionItem containing a dbc.Checklist."""
    if not options:
        return dbc.AccordionItem(
            html.Div("No options available.", style={"fontSize": "12px", "color": "#888"}),
            title=label,
        )

    items = [{"label": str(o), "value": o} for o in options]

    return dbc.AccordionItem(
        html.Div([
            dbc.Row([
                dbc.Col(
                    dbc.Button("All", id=f"{checklist_id}-btn-all", size="sm",
                               color="link", style={"padding": "0", "fontSize": "11px", "color": "#FF5000"}),
                    width="auto",
                ),
                dbc.Col(
                    dbc.Button("Clear", id=f"{checklist_id}-btn-clr", size="sm",
                               color="link", style={"padding": "0", "fontSize": "11px", "color": "#888"}),
                    width="auto",
                ),
            ], className="mb-1 g-2"),
            html.Hr(style={"margin": "4px 0 6px 0", "borderTop": "1px solid #e0e0e0"}),
            dbc.Checklist(
                id=checklist_id,
                options=items,
                value=[],
                labelStyle={"fontFamily": "Arial", "fontSize": "12px"},
                inputStyle={"marginRight": "6px"},
            ),
        ]),
        title=label,
    )


def region_state_filter(
    regioes: list,
    ufs: list,
    reg_id: str = "checklist-regioes",
    uf_id: str  = "checklist-ufs",
) -> dbc.AccordionItem:
    """
    Returns an AccordionItem with a region checklist and a separate UF checklist.
    A callback in the page will show/hide the UF list based on selected regions.
    """
    if not regioes:
        return dbc.AccordionItem(
            html.Div("No regions available.", style={"fontSize": "12px", "color": "#888"}),
            title="Region / State",
        )

    region_items = [{"label": str(r), "value": r} for r in regioes]
    uf_items     = [{"label": str(u), "value": u} for u in ufs]

    return dbc.AccordionItem(
        html.Div([
            dbc.Row([
                dbc.Col(
                    dbc.Button("All regions", id=f"{reg_id}-btn-all", size="sm",
                               color="link", style={"padding": "0", "fontSize": "11px", "color": "#FF5000"}),
                    width="auto",
                ),
                dbc.Col(
                    dbc.Button("Clear", id=f"{reg_id}-btn-clr", size="sm",
                               color="link", style={"padding": "0", "fontSize": "11px", "color": "#888"}),
                    width="auto",
                ),
            ], className="mb-1 g-2"),
            html.Hr(style={"margin": "4px 0 6px 0", "borderTop": "1px solid #e0e0e0"}),
            dbc.Checklist(
                id=reg_id,
                options=region_items,
                value=[],
                labelStyle={"fontFamily": "Arial", "fontSize": "12px"},
                inputStyle={"marginRight": "6px"},
            ),
            html.Div(
                id=f"{uf_id}-container",
                children=[
                    html.Hr(style={"margin": "6px 0", "borderTop": "1px solid #e0e0e0"}),
                    html.Label("States", style={"fontSize": "11px", "color": "#888", "marginBottom": "4px"}),
                    dbc.Checklist(
                        id=uf_id,
                        options=uf_items,
                        value=[],
                        labelStyle={"fontFamily": "Arial", "fontSize": "12px", "paddingLeft": "12px"},
                        inputStyle={"marginRight": "6px"},
                    ),
                ],
                style={"display": "none"},
            ),
        ]),
        title="Region / State",
    )


def ufs_for_region(reg: str, all_ufs: list) -> list:
    """Returns the subset of all_ufs that belong to the given region."""
    mapped = REGIAO_UF_MAP.get(reg, [])
    result = [u for u in all_ufs if u in mapped]
    return result if result else list(all_ufs)
