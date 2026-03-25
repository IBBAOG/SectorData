import streamlit as st
from components.auth import requer_login
from components.style import aplicar_estilo
from components.filters import render_sidebar_filtros
from components.database import carregar_opcoes, carregar_todos
from components.charts import (
    grafico_barra_ano, grafico_linha_mes, grafico_pizza_regiao,
    grafico_barra_uf, grafico_barra_agente, grafico_barra_produto,
)

# ─── Configuração ─────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Itaú BBA | Dashboard",
    page_icon="https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Ita%C3%BA_logo.svg/32px-Ita%C3%BA_logo.svg.png",
    layout="wide",
)

aplicar_estilo()
requer_login()

# ─── Cabeçalho ────────────────────────────────────────────────────────────────
st.markdown("""
<div style="display:flex;align-items:center;gap:12px;margin-bottom:0.5rem;">
    <div>
        <div style="font-size:1.5rem;font-weight:600;color:#1a1a1a;">
            Dashboard de Vendas
        </div>
        <div style="font-size:0.85rem;color:#888;">
            Análise de quantidade de produto (mil m³)
        </div>
    </div>
</div>
""", unsafe_allow_html=True)
st.markdown("---")

# ─── Filtros ──────────────────────────────────────────────────────────────────
opcoes  = carregar_opcoes()
filtros = render_sidebar_filtros(opcoes)

# ─── Carregamento em paralelo ─────────────────────────────────────────────────
with st.spinner("Carregando dados..."):
    metricas, df_ano, df_mes, df_regiao, df_agente, df_produto, df_uf = carregar_todos(filtros)

# ─── Métricas ─────────────────────────────────────────────────────────────────
c1, c2, c3 = st.columns(3)
c1.metric("Total de Registros",        f"{metricas.get('total_registros', 0):,}")
c2.metric("Quantidade Total (mil m³)", f"{metricas.get('quantidade_total', 0.0):,.2f}")
c3.metric("Anos Disponíveis",          f"{metricas.get('anos_distintos', 0)}")

# ─── Download ─────────────────────────────────────────────────────────────────
with st.expander("Exportar dados", expanded=False):
    ecol1, ecol2, ecol3 = st.columns(3)
    if not df_ano.empty:
        ecol1.download_button(
            "Por ano (CSV)", df_ano.to_csv(index=False).encode("utf-8"),
            "quantidade_por_ano.csv", "text/csv", use_container_width=True,
        )
    if not df_mes.empty:
        ecol2.download_button(
            "Por mês (CSV)", df_mes.to_csv(index=False).encode("utf-8"),
            "quantidade_por_mes.csv", "text/csv", use_container_width=True,
        )
    if not df_agente.empty:
        ecol3.download_button(
            "Por agente (CSV)", df_agente.to_csv(index=False).encode("utf-8"),
            "quantidade_por_agente.csv", "text/csv", use_container_width=True,
        )

st.markdown("---")
st.subheader("Comercialização de Combustíveis Líquidos")

_SEM_DADOS = "Nenhum dado para os filtros selecionados."

# ─── Linha 1: Ano e Mês ───────────────────────────────────────────────────────
c1, c2 = st.columns(2)
with c1:
    if df_ano.empty:
        st.info(_SEM_DADOS)
    else:
        st.plotly_chart(grafico_barra_ano(df_ano), use_container_width=True)

with c2:
    if df_mes.empty:
        st.info(_SEM_DADOS)
    else:
        st.plotly_chart(grafico_linha_mes(df_mes), use_container_width=True)

# ─── Linha 2: Região e UF ─────────────────────────────────────────────────────
c3, c4 = st.columns(2)
with c3:
    if df_regiao.empty:
        st.info(_SEM_DADOS)
    else:
        st.plotly_chart(grafico_pizza_regiao(df_regiao), use_container_width=True)

with c4:
    if df_uf.empty:
        st.info(_SEM_DADOS)
    else:
        st.plotly_chart(grafico_barra_uf(df_uf), use_container_width=True)

# ─── Linha 3: Agente e Produto ────────────────────────────────────────────────
c5, c6 = st.columns(2)
with c5:
    if df_agente.empty:
        st.info(_SEM_DADOS)
    else:
        st.plotly_chart(grafico_barra_agente(df_agente), use_container_width=True)

with c6:
    if df_produto.empty:
        st.info(_SEM_DADOS)
    else:
        st.plotly_chart(grafico_barra_produto(df_produto), use_container_width=True)
