import plotly.express as px
import pandas as pd

def grafico_linha_tempo(df, col_data, col_quantidade):
    """Quantidade de produtos vendidos ao longo do tempo"""
    # Extrai as colunas como Series explicitamente para evitar duplicatas
    serie_data = df[col_data]
    if isinstance(serie_data, pd.DataFrame):
        serie_data = serie_data.iloc[:, 0]

    serie_qtd = df[col_quantidade]
    if isinstance(serie_qtd, pd.DataFrame):
        serie_qtd = serie_qtd.iloc[:, 0]

    df_temp = pd.DataFrame({col_data: serie_data.values, col_quantidade: serie_qtd.values})
    df_agrupado = df_temp.groupby(col_data, as_index=False)[col_quantidade].sum()

    fig = px.line(
        df_agrupado,
        x=col_data,
        y=col_quantidade,
        title="📈 Quantidade vendida ao longo do tempo",
        markers=True,
        labels={col_quantidade: "Quantidade", col_data: "Data"}
    )
    fig.update_layout(hovermode="x unified")
    return fig

def grafico_barra_categoria(df, col_categoria, col_quantidade):
    """Quantidade total por categoria"""
    df_agrupado = df.groupby(col_categoria)[col_quantidade].sum().reset_index()
    df_agrupado = df_agrupado.sort_values(col_quantidade, ascending=False)
    fig = px.bar(
        df_agrupado,
        x=col_categoria,
        y=col_quantidade,
        title="📊 Quantidade total por categoria",
        labels={col_quantidade: "Quantidade", col_categoria: "Categoria"},
        color=col_quantidade,
        color_continuous_scale="Blues"
    )
    return fig

def grafico_barra_produto(df, col_produto, col_quantidade, top_n=10):
    """Top N produtos mais vendidos"""
    df_agrupado = df.groupby(col_produto)[col_quantidade].sum().reset_index()
    df_agrupado = df_agrupado.sort_values(col_quantidade, ascending=False).head(top_n)
    fig = px.bar(
        df_agrupado,
        x=col_quantidade,
        y=col_produto,
        orientation="h",
        title=f"🏆 Top {top_n} produtos mais vendidos",
        labels={col_quantidade: "Quantidade", col_produto: "Produto"},
        color=col_quantidade,
        color_continuous_scale="Greens"
    )
    fig.update_layout(yaxis={"categoryorder": "total ascending"})
    return fig

def grafico_pizza_regiao(df, col_regiao, col_quantidade):
    """Distribuição de vendas por região/loja"""
    df_agrupado = df.groupby(col_regiao)[col_quantidade].sum().reset_index()
    fig = px.pie(
        df_agrupado,
        names=col_regiao,
        values=col_quantidade,
        title="🗺️ Distribuição por região/loja",
    )
    fig.update_traces(textposition="inside", textinfo="percent+label")
    return fig

def grafico_vendedor(df, col_vendedor, col_quantidade):
    """Ranking de vendas por vendedor"""
    df_agrupado = df.groupby(col_vendedor)[col_quantidade].sum().reset_index()
    df_agrupado = df_agrupado.sort_values(col_quantidade, ascending=False)
    fig = px.bar(
        df_agrupado,
        x=col_vendedor,
        y=col_quantidade,
        title="👤 Quantidade vendida por vendedor",
        labels={col_quantidade: "Quantidade", col_vendedor: "Vendedor"},
        color=col_quantidade,
        color_continuous_scale="Oranges"
    )
    return fig