import plotly.express as px
import plotly.graph_objects as go
import pandas as pd

LARANJA  = "#f26522"
ESCURO   = "#1a1a1a"
CINZA    = "#666666"
LARANJA_CLARO = "#fde8d8"

_LAYOUT_BASE = dict(
    plot_bgcolor="white",
    paper_bgcolor="white",
    font_color=ESCURO,
    title_font_color=ESCURO,
    margin=dict(t=40, b=20, l=10, r=10),
)


def _apply_axes(fig, show_x_grid=False, show_y_grid=True):
    fig.update_xaxes(showgrid=show_x_grid, gridcolor="#f0f0f0")
    fig.update_yaxes(showgrid=show_y_grid, gridcolor="#f0f0f0")
    return fig


def grafico_barra_ano(df: pd.DataFrame) -> go.Figure:
    fig = px.bar(
        df, x="ano", y="quantidade",
        title="Quantidade por ano",
        labels={"ano": "Ano", "quantidade": "Quantidade (mil m³)"},
        color_discrete_sequence=[LARANJA],
    )
    fig.update_layout(**_LAYOUT_BASE)
    return _apply_axes(fig, show_x_grid=False)


def grafico_linha_mes(df: pd.DataFrame) -> go.Figure:
    fig = px.line(
        df, x="mes", y="quantidade",
        title="Quantidade por mês",
        markers=True,
        labels={"mes": "Mês", "quantidade": "Quantidade (mil m³)"},
        color_discrete_sequence=[LARANJA],
    )
    fig.update_layout(**_LAYOUT_BASE)
    return _apply_axes(fig, show_x_grid=False)


def grafico_pizza_regiao(df: pd.DataFrame) -> go.Figure:
    fig = px.pie(
        df, names="regiao", values="quantidade",
        title="Distribuição por região origem",
        color_discrete_sequence=px.colors.sequential.Oranges_r,
    )
    fig.update_traces(textposition="inside", textinfo="percent+label")
    fig.update_layout(paper_bgcolor="white", font_color=ESCURO, title_font_color=ESCURO,
                      margin=dict(t=40, b=20, l=10, r=10))
    return fig


def grafico_barra_uf(df: pd.DataFrame) -> go.Figure:
    fig = px.bar(
        df, x="quantidade", y="uf", orientation="h",
        title="Quantidade por UF origem",
        labels={"uf": "UF", "quantidade": "Quantidade (mil m³)"},
        color="quantidade",
        color_continuous_scale=[[0, LARANJA_CLARO], [1, LARANJA]],
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
        title="Quantidade por agente regulado",
        labels={"agente": "Agente", "quantidade": "Quantidade (mil m³)"},
        color="quantidade",
        color_continuous_scale=[[0, LARANJA_CLARO], [1, LARANJA]],
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
        title="Top 20 produtos",
        labels={"produto": "Produto", "quantidade": "Quantidade (mil m³)"},
        color="quantidade",
        color_continuous_scale=[[0, LARANJA_CLARO], [1, LARANJA]],
    )
    fig.update_layout(
        **_LAYOUT_BASE,
        yaxis={"categoryorder": "total ascending"},
        coloraxis_showscale=False,
    )
    return _apply_axes(fig, show_x_grid=False)
