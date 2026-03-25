import streamlit as st
import plotly.express as px
import plotly.graph_objects as go
import pandas as pd
from components.auth import requer_login
from components.style import aplicar_estilo
from components.database import (
    carregar_ms_opcoes, carregar_ms_todos,
)

st.set_page_config(
    page_title="Itaú BBA | Market Share",
    page_icon="https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Ita%C3%BA_logo.svg/32px-Ita%C3%BA_logo.svg.png",
    layout="wide",
)

aplicar_estilo()
requer_login()

# ─── Paleta por player ────────────────────────────────────────────────────────
CORES = {
    "Vibra":    "#f26522",
    "Raizen":   "#1a1a1a",
    "Ipiranga": "#fbbf24",
    "Others":   "#94a3b8",
}

# ─── Cabeçalho ────────────────────────────────────────────────────────────────
st.markdown("""
<div style="display:flex;align-items:center;gap:12px;margin-bottom:0.5rem;">
    <div>
        <div style="font-size:1.5rem;font-weight:600;color:#1a1a1a;">
            Market Share de Combustíveis Líquidos
        </div>
        <div style="font-size:0.85rem;color:#888;">
            Participação por distribuidor (mil m³)
        </div>
    </div>
</div>
""", unsafe_allow_html=True)
st.markdown("---")

# ─── Filtros ──────────────────────────────────────────────────────────────────
opcoes = carregar_ms_opcoes()

st.sidebar.markdown("## Filtros")
anos    = st.sidebar.multiselect("Ano",    opcoes.get("anos", []),    default=[])
meses   = st.sidebar.multiselect("Mês",    opcoes.get("meses", []),   default=[])
regioes = st.sidebar.multiselect("Região", opcoes.get("regioes", []), default=[])
ufs     = st.sidebar.multiselect("UF",     opcoes.get("ufs", []),     default=[])
mercados= st.sidebar.multiselect("Mercado",opcoes.get("mercados", []),default=[])

st.sidebar.markdown("---")
col1, col2 = st.sidebar.columns(2)
aplicar = col1.button("🔍 Aplicar", use_container_width=True)
limpar  = col2.button("🔄 Limpar",  use_container_width=True)

if limpar:
    st.cache_data.clear()
    st.rerun()

filtros_sidebar = {
    "anos": anos, "meses": meses, "regioes": regioes, "ufs": ufs, "mercados": mercados,
}

if aplicar or "ms_filtros_ativos" not in st.session_state:
    st.session_state["ms_filtros_ativos"] = filtros_sidebar
    if aplicar:
        st.toast("Filtros aplicados!", icon="✅")

filtros = st.session_state["ms_filtros_ativos"]

# ─── Dados ────────────────────────────────────────────────────────────────────
with st.spinner("Carregando dados..."):
    df_totais, df_ano, df_mes, df_regiao = carregar_ms_todos(filtros)

_SEM_DADOS = "Nenhum dado para os filtros selecionados."

# ─── KPI cards ────────────────────────────────────────────────────────────────
if not df_totais.empty:
    players = ["Vibra", "Raizen", "Ipiranga", "Others"]
    cols = st.columns(len(players))
    for col, player in zip(cols, players):
        row = df_totais[df_totais["classificacao"] == player]
        pct = float(row["pct"].iloc[0]) if not row.empty else 0.0
        qtd = float(row["quantidade"].iloc[0]) if not row.empty else 0.0
        cor = CORES.get(player, "#888")
        col.markdown(f"""
        <div style="border-left:4px solid {cor};padding:0.6rem 1rem;background:#fafafa;border-radius:6px;">
            <div style="font-size:0.8rem;color:#888;font-weight:500;">{player}</div>
            <div style="font-size:1.6rem;font-weight:700;color:{cor};">{pct:.1f}%</div>
            <div style="font-size:0.75rem;color:#aaa;">{qtd:,.0f} mil m³</div>
        </div>
        """, unsafe_allow_html=True)

st.markdown("---")

# ─── Linha 1: Pizza total + Evolução mensal ───────────────────────────────────
c1, c2 = st.columns(2)

with c1:
    if df_totais.empty:
        st.info(_SEM_DADOS)
    else:
        fig = px.pie(
            df_totais,
            names="classificacao",
            values="quantidade",
            title="Market Share Total",
            color="classificacao",
            color_discrete_map=CORES,
            hole=0.45,
        )
        fig.update_traces(textposition="outside", textinfo="percent+label")
        fig.update_layout(
            showlegend=False,
            margin=dict(t=40, b=10, l=10, r=10),
            font=dict(family="Inter, sans-serif"),
        )
        st.plotly_chart(fig, use_container_width=True)

with c2:
    if df_mes.empty:
        st.info(_SEM_DADOS)
    else:
        df_mes["date"] = pd.to_datetime(df_mes["date"])
        fig = px.line(
            df_mes,
            x="date",
            y="pct",
            color="classificacao",
            title="Evolução do Market Share (% mensal)",
            color_discrete_map=CORES,
            labels={"date": "", "pct": "Market Share (%)", "classificacao": "Player"},
        )
        fig.update_traces(mode="lines+markers", marker_size=4)
        fig.update_layout(
            margin=dict(t=40, b=10, l=10, r=10),
            font=dict(family="Inter, sans-serif"),
            yaxis=dict(ticksuffix="%"),
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        )
        st.plotly_chart(fig, use_container_width=True)

# ─── Linha 2: Por ano + Por região ────────────────────────────────────────────
c3, c4 = st.columns(2)

with c3:
    if df_ano.empty:
        st.info(_SEM_DADOS)
    else:
        fig = px.bar(
            df_ano,
            x="ano",
            y="pct",
            color="classificacao",
            title="Market Share por Ano (%)",
            barmode="stack",
            color_discrete_map=CORES,
            labels={"ano": "Ano", "pct": "Market Share (%)", "classificacao": "Player"},
        )
        fig.update_layout(
            margin=dict(t=40, b=10, l=10, r=10),
            font=dict(family="Inter, sans-serif"),
            yaxis=dict(ticksuffix="%", range=[0, 100]),
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
            xaxis=dict(type="category"),
        )
        st.plotly_chart(fig, use_container_width=True)

with c4:
    if df_regiao.empty:
        st.info(_SEM_DADOS)
    else:
        fig = px.bar(
            df_regiao,
            x="regiao_destinatario",
            y="pct",
            color="classificacao",
            title="Market Share por Região (%)",
            barmode="stack",
            color_discrete_map=CORES,
            labels={"regiao_destinatario": "Região", "pct": "Market Share (%)", "classificacao": "Player"},
        )
        fig.update_layout(
            margin=dict(t=40, b=10, l=10, r=10),
            font=dict(family="Inter, sans-serif"),
            yaxis=dict(ticksuffix="%", range=[0, 100]),
            legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        )
        st.plotly_chart(fig, use_container_width=True)

# ─── Download ─────────────────────────────────────────────────────────────────
with st.expander("⬇️ Exportar dados", expanded=False):
    dcol1, dcol2 = st.columns(2)
    if not df_totais.empty:
        dcol1.download_button(
            "Totais (CSV)", df_totais.to_csv(index=False).encode("utf-8"),
            "ms_totais.csv", "text/csv", use_container_width=True,
        )
    if not df_mes.empty:
        dcol2.download_button(
            "Por mês (CSV)", df_mes.to_csv(index=False).encode("utf-8"),
            "ms_por_mes.csv", "text/csv", use_container_width=True,
        )
