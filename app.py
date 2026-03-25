import streamlit as st
import plotly.express as px
from concurrent.futures import ThreadPoolExecutor
from components.auth import requer_login
from components.style import aplicar_estilo
from components.database import (
    carregar_opcoes, carregar_metricas,
    carregar_por_ano, carregar_por_mes,
    carregar_por_regiao, carregar_por_agente,
    carregar_por_produto, carregar_por_uf
)

# ─── Configuração ─────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Itaú BBA | Dashboard",
    page_icon="https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Ita%C3%BA_logo.svg/32px-Ita%C3%BA_logo.svg.png",
    layout="wide"
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

# ─── Filtros na sidebar ───────────────────────────────────────────────────────
opcoes = carregar_opcoes()

st.sidebar.markdown("## 🔽 Filtros")
anos      = st.sidebar.multiselect("Ano",                 opcoes["anos"],           default=[])
meses     = st.sidebar.multiselect("Mês",                 opcoes["meses"],          default=[])
agentes   = st.sidebar.multiselect("Agente Regulado",     opcoes["agentes"],        default=[])
r_origem  = st.sidebar.multiselect("Região Origem",       opcoes["regioes_origem"], default=[])
uf_origem = st.sidebar.multiselect("UF Origem",           opcoes["ufs_origem"],     default=[])
r_dest    = st.sidebar.multiselect("Região Destinatário", opcoes["regioes_dest"],   default=[])
uf_dest   = st.sidebar.multiselect("UF Destino",          opcoes["ufs_dest"],       default=[])
mercados  = st.sidebar.multiselect("Mercado",             opcoes["mercados"],       default=[])

aplicar = st.sidebar.button("🔍 Aplicar filtros", use_container_width=True)
st.sidebar.button("🔄 Limpar filtros", on_click=lambda: st.cache_data.clear(), use_container_width=True)

if aplicar or "filtros_ativos" not in st.session_state:
    st.session_state["filtros_ativos"] = {
        "anos": anos, "meses": meses, "agentes": agentes,
        "regioes_origem": r_origem, "ufs_origem": uf_origem,
        "regioes_dest": r_dest, "ufs_dest": uf_dest, "mercados": mercados,
    }

filtros = st.session_state["filtros_ativos"]

# ─── Carregamento em paralelo ─────────────────────────────────────────────────
with st.spinner("Carregando dados..."):
    with ThreadPoolExecutor(max_workers=6) as executor:
        f_metricas = executor.submit(carregar_metricas, filtros)
        f_ano      = executor.submit(carregar_por_ano, filtros)
        f_mes      = executor.submit(carregar_por_mes, filtros)
        f_regiao   = executor.submit(carregar_por_regiao, filtros)
        f_agente   = executor.submit(carregar_por_agente, filtros)
        f_produto  = executor.submit(carregar_por_produto, filtros)
        f_uf       = executor.submit(carregar_por_uf, filtros)

    metricas   = f_metricas.result()
    df_ano     = f_ano.result()
    df_mes     = f_mes.result()
    df_regiao  = f_regiao.result()
    df_agente  = f_agente.result()
    df_produto = f_produto.result()
    df_uf      = f_uf.result()

# ─── Métricas ─────────────────────────────────────────────────────────────────
c1, c2, c3 = st.columns(3)
c1.metric("Total de Registros",        f"{metricas['total_registros']:,}")
c2.metric("Quantidade Total (mil m³)", f"{metricas['quantidade_total']:,.2f}")
c3.metric("Anos Disponíveis",          f"{metricas['anos_distintos']}")

st.markdown("---")
st.subheader("📈 Análise de Vendas")

# Paleta de cores Itaú
LARANJA  = "#f26522"
ESCURO   = "#1a1a1a"
CINZA    = "#666666"

# ─── Linha 1: Ano e Mês ───────────────────────────────────────────────────────
c1, c2 = st.columns(2)
with c1:
    if not df_ano.empty:
        fig = px.bar(df_ano, x="ano", y="quantidade",
                     title="Quantidade por ano",
                     labels={"ano": "Ano", "quantidade": "Quantidade (mil m³)"},
                     color_discrete_sequence=[LARANJA])
        fig.update_layout(plot_bgcolor="white", paper_bgcolor="white",
                          font_color=ESCURO, title_font_color=ESCURO)
        fig.update_xaxes(showgrid=False)
        fig.update_yaxes(gridcolor="#f0f0f0")
        st.plotly_chart(fig, use_container_width=True)

with c2:
    if not df_mes.empty:
        fig = px.line(df_mes, x="mes", y="quantidade",
                      title="Quantidade por mês",
                      markers=True,
                      labels={"mes": "Mês", "quantidade": "Quantidade (mil m³)"},
                      color_discrete_sequence=[LARANJA])
        fig.update_layout(plot_bgcolor="white", paper_bgcolor="white",
                          font_color=ESCURO, title_font_color=ESCURO)
        fig.update_xaxes(showgrid=False)
        fig.update_yaxes(gridcolor="#f0f0f0")
        st.plotly_chart(fig, use_container_width=True)

# ─── Linha 2: Região e UF ─────────────────────────────────────────────────────
c3, c4 = st.columns(2)
with c3:
    if not df_regiao.empty:
        fig = px.pie(df_regiao, names="regiao", values="quantidade",
                     title="Distribuição por região origem",
                     color_discrete_sequence=px.colors.sequential.Oranges_r)
        fig.update_traces(textposition="inside", textinfo="percent+label")
        fig.update_layout(paper_bgcolor="white", font_color=ESCURO,
                          title_font_color=ESCURO)
        st.plotly_chart(fig, use_container_width=True)

with c4:
    if not df_uf.empty:
        fig = px.bar(df_uf, x="quantidade", y="uf", orientation="h",
                     title="Quantidade por UF origem",
                     labels={"uf": "UF", "quantidade": "Quantidade (mil m³)"},
                     color="quantidade",
                     color_continuous_scale=[[0, "#fde8d8"], [1, LARANJA]])
        fig.update_layout(plot_bgcolor="white", paper_bgcolor="white",
                          font_color=ESCURO, title_font_color=ESCURO,
                          yaxis={"categoryorder": "total ascending"},
                          coloraxis_showscale=False)
        fig.update_xaxes(showgrid=False)
        fig.update_yaxes(gridcolor="#f0f0f0")
        st.plotly_chart(fig, use_container_width=True)

# ─── Linha 3: Agente e Produto ────────────────────────────────────────────────
c5, c6 = st.columns(2)
with c5:
    if not df_agente.empty:
        fig = px.bar(df_agente, x="quantidade", y="agente", orientation="h",
                     title="Quantidade por agente regulado",
                     labels={"agente": "Agente", "quantidade": "Quantidade (mil m³)"},
                     color="quantidade",
                     color_continuous_scale=[[0, "#fde8d8"], [1, LARANJA]])
        fig.update_layout(plot_bgcolor="white", paper_bgcolor="white",
                          font_color=ESCURO, title_font_color=ESCURO,
                          yaxis={"categoryorder": "total ascending"},
                          coloraxis_showscale=False)
        fig.update_xaxes(showgrid=False)
        fig.update_yaxes(gridcolor="#f0f0f0")
        st.plotly_chart(fig, use_container_width=True)

with c6:
    if not df_produto.empty:
        fig = px.bar(df_produto, x="quantidade", y="produto", orientation="h",
                     title="Top 20 produtos",
                     labels={"produto": "Produto", "quantidade": "Quantidade (mil m³)"},
                     color="quantidade",
                     color_continuous_scale=[[0, "#fde8d8"], [1, LARANJA]])
        fig.update_layout(plot_bgcolor="white", paper_bgcolor="white",
                          font_color=ESCURO, title_font_color=ESCURO,
                          yaxis={"categoryorder": "total ascending"},
                          coloraxis_showscale=False)
        fig.update_xaxes(showgrid=False)
        fig.update_yaxes(gridcolor="#f0f0f0")
        st.plotly_chart(fig, use_container_width=True)