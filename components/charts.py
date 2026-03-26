import plotly.express as px
import plotly.graph_objects as go
import pandas as pd

ORANGE       = "#f26522"
DARK         = "#1a1a1a"
GRAY         = "#666666"
ORANGE_LIGHT = "#fde8d8"

_LAYOUT_BASE = dict(
    plot_bgcolor="white",
    paper_bgcolor="white",
    font_color=DARK,
    title_font_color=DARK,
    margin=dict(t=40, b=20, l=10, r=10),
)


def _apply_axes(fig, show_x_grid=False, show_y_grid=True):
    fig.update_xaxes(showgrid=show_x_grid, gridcolor="#f0f0f0")
    fig.update_yaxes(showgrid=show_y_grid, gridcolor="#f0f0f0")
    return fig


def grafico_barra_ano(df: pd.DataFrame) -> go.Figure:
    fig = px.bar(
        df, x="ano", y="quantidade",
        title="Volume by Year",
        labels={"ano": "Year", "quantidade": "Volume (thousand m³)"},
        color_discrete_sequence=[ORANGE],
    )
    fig.update_layout(**_LAYOUT_BASE)
    return _apply_axes(fig, show_x_grid=False)


def grafico_linha_mes(df: pd.DataFrame) -> go.Figure:
    fig = px.line(
        df, x="mes", y="quantidade",
        title="Volume by Month",
        markers=True,
        labels={"mes": "Month", "quantidade": "Volume (thousand m³)"},
        color_discrete_sequence=[ORANGE],
    )
    fig.update_layout(**_LAYOUT_BASE)
    return _apply_axes(fig, show_x_grid=False)


def grafico_pizza_regiao(df: pd.DataFrame) -> go.Figure:
    fig = px.pie(
        df, names="regiao", values="quantidade",
        title="Distribution by Origin Region",
        color_discrete_sequence=px.colors.sequential.Oranges_r,
    )
    fig.update_traces(textposition="inside", textinfo="percent+label")
    fig.update_layout(paper_bgcolor="white", font_color=DARK, title_font_color=DARK,
                      margin=dict(t=40, b=20, l=10, r=10))
    return fig


def grafico_barra_uf(df: pd.DataFrame) -> go.Figure:
    fig = px.bar(
        df, x="quantidade", y="uf", orientation="h",
        title="Volume by Origin State",
        labels={"uf": "State", "quantidade": "Volume (thousand m³)"},
        color="quantidade",
        color_continuous_scale=[[0, ORANGE_LIGHT], [1, ORANGE]],
    )
    fig.update_layout(
        **_LAYOUT_BASE,
        yaxis={"categoryorder": "total ascending"},
        coloraxis_showscale=False,
    )
    return _apply_axes(fig, show_x_grid=False)


def grafico_barra_agente(df: pd.DataFrame) -> go.Figure:
    fig = px.bar(
        df, x="quantidade", y="agente", orientation="h",
        title="Volume by Regulated Agent",
        labels={"agente": "Agent", "quantidade": "Volume (thousand m³)"},
        color="quantidade",
        color_continuous_scale=[[0, ORANGE_LIGHT], [1, ORANGE]],
    )
    fig.update_layout(
        **_LAYOUT_BASE,
        yaxis={"categoryorder": "total ascending"},
        coloraxis_showscale=False,
    )
    return _apply_axes(fig, show_x_grid=False)


def grafico_barra_produto(df: pd.DataFrame) -> go.Figure:
    fig = px.bar(
        df, x="quantidade", y="produto", orientation="h",
        title="Top 20 Products",
        labels={"produto": "Product", "quantidade": "Volume (thousand m³)"},
        color="quantidade",
        color_continuous_scale=[[0, ORANGE_LIGHT], [1, ORANGE]],
    )
    fig.update_layout(
        **_LAYOUT_BASE,
        yaxis={"categoryorder": "total ascending"},
        coloraxis_showscale=False,
    )
    return _apply_axes(fig, show_x_grid=False)
