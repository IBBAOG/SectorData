import plotly.express as px
import plotly.graph_objects as go
import pandas as pd

ORANGE       = "#FF5000"
DARK         = "#1a1a1a"
GRAY         = "#666666"
ORANGE_LIGHT = "#fde8d8"

_FONT = dict(family="Arial", size=12, color="#000000")

_LAYOUT_BASE = dict(
    plot_bgcolor="white",
    paper_bgcolor="white",
    font=_FONT,
    font_color=DARK,
    title_font_color=DARK,
    margin=dict(t=40, b=20, l=10, r=10),
)

_AXIS_STYLE = dict(
    showgrid=False,
    zeroline=False,
    showline=True,
    linecolor="#000000",
    linewidth=1,
    tickfont=_FONT,
)


def grafico_barra_ano(df: pd.DataFrame) -> go.Figure:
    fig = px.bar(
        df, x="ano", y="quantidade",
        title="Volume by Year",
        labels={"ano": "Year", "quantidade": "Volume (thousand m³)"},
        color_discrete_sequence=[ORANGE],
    )
    fig.update_layout(
        **_LAYOUT_BASE,
        xaxis=dict(**_AXIS_STYLE, title=dict(text="Year", font=_FONT)),
        yaxis=dict(**_AXIS_STYLE, title=dict(text="Volume (thousand m³)", font=_FONT)),
    )
    return fig


def grafico_linha_mes(df: pd.DataFrame) -> go.Figure:
    fig = px.line(
        df, x="mes", y="quantidade",
        title="Volume by Month",
        markers=True,
        labels={"mes": "Month", "quantidade": "Volume (thousand m³)"},
        color_discrete_sequence=[ORANGE],
    )
    fig.update_traces(line_width=2)
    fig.update_layout(
        **_LAYOUT_BASE,
        xaxis=dict(**_AXIS_STYLE, title=dict(text="Month", font=_FONT)),
        yaxis=dict(**_AXIS_STYLE, title=dict(text="Volume (thousand m³)", font=_FONT)),
    )
    return fig


def grafico_pizza_regiao(df: pd.DataFrame) -> go.Figure:
    fig = px.pie(
        df, names="regiao", values="quantidade",
        title="Distribution by Origin Region",
        color_discrete_sequence=px.colors.sequential.Oranges_r,
    )
    fig.update_traces(
        textposition="inside",
        textinfo="percent+label",
        textfont=_FONT,
        hovertemplate="%{label}: %{value:,.2f} (%{percent})<extra></extra>",
    )
    fig.update_layout(
        paper_bgcolor="white",
        font=_FONT,
        font_color=DARK,
        title_font_color=DARK,
        margin=dict(t=40, b=20, l=10, r=10),
    )
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
        yaxis=dict(**_AXIS_STYLE, categoryorder="total ascending",
                   title=dict(text="State", font=_FONT)),
        xaxis=dict(**_AXIS_STYLE, title=dict(text="Volume (thousand m³)", font=_FONT)),
        coloraxis_showscale=False,
    )
    return fig


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
        yaxis=dict(**_AXIS_STYLE, categoryorder="total ascending",
                   title=dict(text="Agent", font=_FONT)),
        xaxis=dict(**_AXIS_STYLE, title=dict(text="Volume (thousand m³)", font=_FONT)),
        coloraxis_showscale=False,
    )
    return fig


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
        yaxis=dict(**_AXIS_STYLE, categoryorder="total ascending",
                   title=dict(text="Product", font=_FONT)),
        xaxis=dict(**_AXIS_STYLE, title=dict(text="Volume (thousand m³)", font=_FONT)),
        coloraxis_showscale=False,
    )
    return fig
