import streamlit as st
import plotly.express as px
from components.auth import requer_login
from components.database import (
    carregar_opcoes, carregar_metricas,
    carregar_por_ano, carregar_por_mes,
    carregar_por_regiao, carregar_por_agente,
    carregar_por_produto, carregar_por_uf
)

# ─── Configuração ─────────────────────────────────────────────────────────────
st.set_page_config(page_title="Meu Dashboard", page_icon="📊", layout="wide")
requer_login()

st.title("📊 Meu Dashboard")
st.markdown("---")

# ─── Opções dos filtros ───────────────────────────────────────────────────────
opcoes = carregar_opcoes()

st.sidebar.markdown("## 🔽 Filtros")
anos      = st.sidebar.multiselect("Ano",                 opcoes["anos"],           default=opcoes["anos"])
meses     = st.sidebar.multiselect("Mês",                 opcoes["meses"],          default=opcoes["meses"])
agentes   = st.sidebar.multiselect("Agente Regulado",     opcoes["agentes"],        default=opcoes["agentes"])
r_origem  = st.sidebar.multiselect("Região Origem",       opcoes["regioes_origem"], default=opcoes["regioes_origem"])
uf_origem = st.sidebar.multiselect("UF Origem",           opcoes["ufs_origem"],     default=opcoes["ufs_origem"])
r_dest    = st.sidebar.multiselect("Região Destinatário", opcoes["regioes_dest"],   default=opcoes["regioes_dest"])
uf_dest   = st.sidebar.multiselect("UF Destino",          opcoes["ufs_dest"],       default=opcoes["ufs_dest"])
mercados  = st.sidebar.multiselect("Mercado",             opcoes["mercados"],       default=opcoes["mercados"])

filtros = {
    "anos": anos, "meses": meses, "agentes": agentes,
    "regioes_origem": r_origem, "ufs_origem": uf_origem,
    "regioes_dest": r_dest, "ufs_dest": uf_dest, "mercados": mercados,
}

# ─── Métricas ─────────────────────────────────────────────────────────────────
metricas = carregar_metricas(filtros)
c1, c2, c3 = st.columns(3)
c1.metric("Total de registros",        f"{metricas['total_registros']:,}")
c2.metric("Quantidade total (mil m³)", f"{metricas['quantidade_total']:,.2f}")
c3.metric("Anos disponíveis",          f"{metricas['anos_distintos']}")

st.markdown("---")
st.subheader("📈 Análise de Vendas")

# ─── Linha 1: Ano e Mês ───────────────────────────────────────────────────────
c1, c2 = st.columns(2)
with c1:
    df = carregar_por_ano(filtros)
    if not df.empty:
        fig = px.bar(df, x="ano", y="quantidade",
                     title="Quantidade por ano",
                     labels={"ano": "Ano", "quantidade": "Quantidade (mil m³)"},
                     color_discrete_sequence=["#4C78A8"])
        st.plotly_chart(fig, use_container_width=True)

with c2:
    df = carregar_por_mes(filtros)
    if not df.empty:
        fig = px.line(df, x="mes", y="quantidade",
                      title="Quantidade por mês",
                      markers=True,
                      labels={"mes": "Mês", "quantidade": "Quantidade (mil m³)"},
                      color_discrete_sequence=["#F58518"])
        st.plotly_chart(fig, use_container_width=True)

# ─── Linha 2: Região e UF ─────────────────────────────────────────────────────
c3, c4 = st.columns(2)
with c3:
    df = carregar_por_regiao(filtros)
    if not df.empty:
        fig = px.pie(df, names="regiao", values="quantidade",
                     title="Distribuição por região origem")
        fig.update_traces(textposition="inside", textinfo="percent+label")
        st.plotly_chart(fig, use_container_width=True)

with c4:
    df = carregar_por_uf(filtros)
    if not df.empty:
        fig = px.bar(df, x="quantidade", y="uf", orientation="h",
                     title="Quantidade por UF origem",
                     labels={"uf": "UF", "quantidade": "Quantidade (mil m³)"},
                     color="quantidade", color_continuous_scale="Blues")
        fig.update_layout(yaxis={"categoryorder": "total ascending"})
        st.plotly_chart(fig, use_container_width=True)

# ─── Linha 3: Agente e Produto ────────────────────────────────────────────────
c5, c6 = st.columns(2)
with c5:
    df = carregar_por_agente(filtros)
    if not df.empty:
        fig = px.bar(df, x="quantidade", y="agente", orientation="h",
                     title="Quantidade por agente regulado",
                     labels={"agente": "Agente", "quantidade": "Quantidade (mil m³)"},
                     color="quantidade", color_continuous_scale="Oranges")
        fig.update_layout(yaxis={"categoryorder": "total ascending"})
        st.plotly_chart(fig, use_container_width=True)

with c6:
    df = carregar_por_produto(filtros)
    if not df.empty:
        fig = px.bar(df, x="quantidade", y="produto", orientation="h",
                     title="Top 20 produtos",
                     labels={"produto": "Produto", "quantidade": "Quantidade (mil m³)"},
                     color="quantidade", color_continuous_scale="Greens")
        fig.update_layout(yaxis={"categoryorder": "total ascending"})
        st.plotly_chart(fig, use_container_width=True)