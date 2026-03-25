import streamlit as st
import pandas as pd
import os
from components.charts import (
    grafico_linha_tempo,
    grafico_barra_categoria,
    grafico_barra_produto,
    grafico_pizza_regiao,
    grafico_vendedor
)

# ─── Configuração da página ───────────────────────────────────────────────────
st.set_page_config(
    page_title="Meu Dashboard",
    page_icon="📊",
    layout="wide"
)

st.title("📊 Meu Dashboard")
st.markdown("---")

# ─── Função para carregar dados ───────────────────────────────────────────────
@st.cache_data
def carregar_arquivo(caminho):
    ext = os.path.splitext(caminho)[1].lower()
    if ext == ".csv":
        for encoding in ["utf-8", "latin-1", "cp1252"]:
            try:
                return pd.read_csv(
                    caminho,
                    encoding=encoding,
                    sep=None,
                    engine="python",
                    on_bad_lines="skip"
                )
            except UnicodeDecodeError:
                continue
        st.error("Não foi possível detectar o encoding do arquivo.")
        return None
    elif ext in [".xlsx", ".xls"]:
        return pd.read_excel(caminho)
    else:
        return None

# ─── Função para gerar filtros automáticos ───────────────────────────────────
def aplicar_filtros(df):
    st.sidebar.markdown("## 🔽 Filtros")
    df_filtrado = df.copy()

    for coluna in df.columns:
        tipo = df[coluna].dtype

        if tipo == "object":
            valores_unicos = df[coluna].dropna().unique().tolist()
            if 1 < len(valores_unicos) <= 50:
                selecionados = st.sidebar.multiselect(
                    f"{coluna}",
                    options=valores_unicos,
                    default=valores_unicos
                )
                df_filtrado = df_filtrado[df_filtrado[coluna].isin(selecionados)]

        elif pd.api.types.is_numeric_dtype(tipo):
            val_min = float(df[coluna].min())
            val_max = float(df[coluna].max())
            if val_min < val_max:
                intervalo = st.sidebar.slider(
                    f"{coluna}",
                    min_value=val_min,
                    max_value=val_max,
                    value=(val_min, val_max)
                )
                df_filtrado = df_filtrado[
                    df_filtrado[coluna].between(intervalo[0], intervalo[1])
                ]

        elif pd.api.types.is_datetime64_any_dtype(tipo):
            data_min = df[coluna].min().date()
            data_max = df[coluna].max().date()
            intervalo = st.sidebar.date_input(
                f"{coluna}",
                value=(data_min, data_max)
            )
            if len(intervalo) == 2:
                df_filtrado = df_filtrado[
                    df_filtrado[coluna].dt.date.between(intervalo[0], intervalo[1])
                ]

    return df_filtrado

# ─── Listagem automática dos arquivos em /data ────────────────────────────────
arquivos_disponiveis = [
    f for f in os.listdir("data")
    if f.endswith((".csv", ".xlsx", ".xls"))
]

if not arquivos_disponiveis:
    st.warning("Nenhum arquivo encontrado na pasta /data.")
else:
    arquivo_selecionado = st.sidebar.selectbox(
        "📂 Base de dados",
        arquivos_disponiveis
    )

    df = carregar_arquivo(os.path.join("data", arquivo_selecionado))

    if df is not None:

        for col in df.columns:
            if df[col].dtype == "object":
                try:
                    df[col] = pd.to_datetime(df[col])
                except Exception:
                    pass

        df_filtrado = aplicar_filtros(df)

        # Remove colunas duplicadas mantendo apenas a primeira ocorrência
        df_filtrado = df_filtrado.loc[:, ~df_filtrado.columns.duplicated()]
        df = df.loc[:, ~df.columns.duplicated()]
        
        # ─── Métricas resumo ─────────────────────────────────────────────────
        st.subheader(f"📁 {arquivo_selecionado}")
        col1, col2, col3 = st.columns(3)
        col1.metric("Total de linhas", f"{df.shape[0]:,}")
        col2.metric("Linhas filtradas", f"{df_filtrado.shape[0]:,}")
        col3.metric("Colunas", f"{df.shape[1]}")
        st.markdown("---")

        # ─── Mapeamento de colunas ───────────────────────────────────────────
        st.sidebar.markdown("## 🗂️ Mapeamento de colunas")
        colunas = df_filtrado.columns.tolist()
        colunas_data = [c for c in colunas if pd.api.types.is_datetime64_any_dtype(df_filtrado[c])]
        colunas_texto = [c for c in colunas if df_filtrado[c].dtype == "object"]
        colunas_numericas = [c for c in colunas if pd.api.types.is_numeric_dtype(df_filtrado[c])]

        col_data = st.sidebar.selectbox("📅 Coluna de data", colunas_data if colunas_data else colunas)
        col_quantidade = st.sidebar.selectbox("🔢 Coluna de quantidade", colunas_numericas if colunas_numericas else colunas)
        col_produto = st.sidebar.selectbox("📦 Coluna de produto/item", colunas_texto if colunas_texto else colunas)
        col_categoria = st.sidebar.selectbox("🏷️ Coluna de categoria", colunas_texto if colunas_texto else colunas)
        col_vendedor = st.sidebar.selectbox("👤 Coluna de vendedor", colunas_texto if colunas_texto else colunas)
        col_regiao = st.sidebar.selectbox("🗺️ Coluna de região/loja", colunas_texto if colunas_texto else colunas)

        # ─── Gráficos ────────────────────────────────────────────────────────
        st.subheader("📈 Análise de Vendas")

        # Linha do tempo (largura total)
        if col_data and col_quantidade:
            st.plotly_chart(
                grafico_linha_tempo(df_filtrado, col_data, col_quantidade),
                use_container_width=True
            )

        # Categoria e Produto lado a lado
        c1, c2 = st.columns(2)
        with c1:
            if col_categoria and col_quantidade:
                st.plotly_chart(
                    grafico_barra_categoria(df_filtrado, col_categoria, col_quantidade),
                    use_container_width=True
                )
        with c2:
            if col_produto and col_quantidade:
                top_n = st.slider("Top N produtos", min_value=5, max_value=20, value=10)
                st.plotly_chart(
                    grafico_barra_produto(df_filtrado, col_produto, col_quantidade, top_n),
                    use_container_width=True
                )

        # Região e Vendedor lado a lado
        c3, c4 = st.columns(2)
        with c3:
            if col_regiao and col_quantidade:
                st.plotly_chart(
                    grafico_pizza_regiao(df_filtrado, col_regiao, col_quantidade),
                    use_container_width=True
                )
        with c4:
            if col_vendedor and col_quantidade:
                st.plotly_chart(
                    grafico_vendedor(df_filtrado, col_vendedor, col_quantidade),
                    use_container_width=True
                )

        st.markdown("---")

        # ─── Tabela e download ───────────────────────────────────────────────
        st.subheader("📋 Dados")
        st.dataframe(df_filtrado, use_container_width=True)
        csv_download = df_filtrado.to_csv(index=False).encode("utf-8")
        st.download_button(
            label="⬇️ Baixar dados filtrados (.csv)",
            data=csv_download,
            file_name="dados_filtrados.csv",
            mime="text/csv"
        )