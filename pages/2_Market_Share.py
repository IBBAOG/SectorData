import streamlit as st
import plotly.express as px
import pandas as pd
from itertools import product as _product
from components.auth import requer_login
from components.style import aplicar_estilo
from components.database import carregar_ms_opcoes, carregar_ms_serie

# ─── Config ───────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Itaú BBA | Market Share",
    page_icon="https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Ita%C3%BA_logo.svg/32px-Ita%C3%BA_logo.svg.png",
    layout="wide",
)
aplicar_estilo()
requer_login()

# ─── Constantes ───────────────────────────────────────────────────────────────
CORES = {"Vibra": "#f26522", "Raizen": "#1a1a1a", "Ipiranga": "#fbbf24"}
PLAYERS = ["Vibra", "Ipiranga", "Raizen"]

MESES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
            "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

def _fmt_data(d: str) -> str:
    try:
        y, m = d[:4], int(d[5:7])
        return f"{MESES_PT[m - 1]}/{y}"
    except Exception:
        return d

def _resolver_datas(opcoes: dict) -> list:
    datas = sorted(opcoes.get("datas") or [])
    if datas:
        return datas
    anos  = sorted(opcoes.get("anos")  or [])
    meses = sorted(opcoes.get("meses") or [])
    if anos and meses:
        return sorted(f"{a:04d}-{m:02d}-01" for a, m in _product(anos, meses))
    return []


# ─── Cabeçalho ────────────────────────────────────────────────────────────────
st.markdown("""
<div style="margin-bottom:0.5rem;">
    <div style="font-size:1.5rem;font-weight:600;color:#1a1a1a;">
        Market Share de Combustíveis Líquidos
    </div>
    <div style="font-size:0.85rem;color:#888;">
        Evolução temporal da participação por distribuidor (%)
    </div>
</div>
""", unsafe_allow_html=True)
st.markdown("---")

# ─── Filtros sidebar ──────────────────────────────────────────────────────────
opcoes = carregar_ms_opcoes()
st.sidebar.markdown("## Filtros")

datas = _resolver_datas(opcoes)
if len(datas) >= 2:
    data_inicio, data_fim = st.sidebar.select_slider(
        "Período", options=datas,
        value=(datas[0], datas[-1]),
        format_func=_fmt_data,
    )
elif len(datas) == 1:
    data_inicio = data_fim = datas[0]
    st.sidebar.info(f"Período disponível: {_fmt_data(datas[0])}")
else:
    st.sidebar.warning("⚠️ Não foi possível carregar o período.")
    data_inicio = data_fim = None

regioes  = st.sidebar.multiselect("Região",  opcoes.get("regioes", []), default=[])
ufs      = st.sidebar.multiselect("UF",      opcoes.get("ufs", []),     default=[])
mercados = st.sidebar.multiselect("Mercado", opcoes.get("mercados", []),default=[])

st.sidebar.markdown("---")
col1, col2 = st.sidebar.columns(2)
aplicar = col1.button("🔍 Aplicar", use_container_width=True)
limpar  = col2.button("🔄 Limpar",  use_container_width=True)

if limpar:
    st.cache_data.clear()
    st.rerun()

filtros_sidebar = {
    "data_inicio": data_inicio, "data_fim": data_fim,
    "regioes": regioes, "ufs": ufs, "mercados": mercados,
}
if aplicar or "ms_filtros_ativos" not in st.session_state:
    st.session_state["ms_filtros_ativos"] = filtros_sidebar
    if aplicar:
        st.toast("Filtros aplicados!", icon="✅")

filtros = st.session_state["ms_filtros_ativos"]

# ─── Carrega série completa ────────────────────────────────────────────────────
with st.spinner("Carregando dados..."):
    df_serie = carregar_ms_serie(
        filtros.get("data_inicio"),
        filtros.get("data_fim"),
        tuple(filtros.get("regioes") or []),
        tuple(filtros.get("ufs") or []),
        tuple(filtros.get("mercados") or []),
    )

if not df_serie.empty:
    df_serie["date"] = pd.to_datetime(df_serie["date"])


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _linha_ms(produto: str, segmento: str | None, titulo: str):
    """
    Cria gráfico de linha de market share temporal.
    segmento=None → agrega todos os segmentos (Total).
    """
    if df_serie.empty:
        return None

    mask = df_serie["nome_produto"] == produto
    if segmento:
        mask &= df_serie["segmento"] == segmento

    df = df_serie[mask].copy()
    if df.empty:
        return None

    # Para Total: somar todos os segmentos por (date, classificacao) antes de calcular %
    df = (
        df.groupby(["date", "classificacao"], as_index=False)["quantidade"].sum()
    )

    # % sobre o total de todas as empresas naquele mês (inclui Others no denominador)
    totais = df.groupby("date")["quantidade"].sum().rename("total")
    df = df.join(totais, on="date")
    df["pct"] = df["quantidade"] / df["total"] * 100

    df = df[df["classificacao"].isin(PLAYERS)].sort_values("date")
    if df.empty:
        return None

    # ── Escala dinâmica com margem proporcional ────────────────────────────────
    y_min = df["pct"].min()
    y_max = df["pct"].max()
    spread = y_max - y_min if y_max > y_min else 1.0
    pad = spread * 0.20                          # 20% de margem acima e abaixo
    y_lo = max(0.0,   y_min - pad)
    y_hi = min(100.0, y_max + pad)

    fig = px.line(
        df, x="date", y="pct", color="classificacao",
        title=titulo,
        color_discrete_map=CORES,
        labels={"date": "", "pct": "Market Share (%)", "classificacao": ""},
    )
    _FONT = dict(family="Arial", size=10, color="#000000")

    fig.update_traces(mode="lines+markers", marker_size=3, line_width=2)
    fig.update_layout(
        margin=dict(t=40, b=10, l=10, r=10),
        font=_FONT,
        title_font=_FONT,
        yaxis=dict(ticksuffix="%", range=[y_lo, y_hi], tickfont=_FONT, title_font=_FONT),
        xaxis=dict(tickfont=_FONT, title_font=_FONT),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1, font=_FONT),
        height=300,
        hovermode="x unified",
    )
    return fig


def _secao(produto: str, titulo_secao: str, tem_trr: bool = True):
    """Renderiza uma seção completa de gráficos para um combustível."""
    st.markdown(f"### {titulo_secao}")

    if tem_trr:
        # 2 × 2
        c1, c2 = st.columns(2)
        c3, c4 = st.columns(2)
        pares = [
            (c1, "Retail",  f"Retail"),
            (c2, "B2B",     f"B2B"),
            (c3, "TRR",     f"TRR"),
            (c4, None,      f"Total"),
        ]
    else:
        # Linha 1: Retail | B2B — Linha 2: Total (largura inteira)
        c1, c2 = st.columns(2)
        c3, _ = st.columns([1, 1])
        pares = [
            (c1, "Retail", f"Retail"),
            (c2, "B2B",    f"B2B"),
            (c3, None,     f"Total"),
        ]

    for col, seg, label in pares:
        fig = _linha_ms(produto, seg, label)
        with col:
            if fig:
                st.plotly_chart(fig, use_container_width=True)
            else:
                st.info("Nenhum dado para os filtros selecionados.")

    st.markdown("---")


# ─── Seções por combustível ───────────────────────────────────────────────────
_secao("Diesel B",         "🛢️ Diesel B",         tem_trr=True)
_secao("Gasolina C",       "⛽ Gasolina C",        tem_trr=False)
_secao("Etanol Hidratado", "🌿 Etanol Hidratado",  tem_trr=False)

# ─── Download ─────────────────────────────────────────────────────────────────
if not df_serie.empty:
    with st.expander("⬇️ Exportar dados", expanded=False):
        st.download_button(
            "Série completa (CSV)",
            df_serie.to_csv(index=False).encode("utf-8"),
            "ms_serie.csv", "text/csv",
            use_container_width=False,
        )
