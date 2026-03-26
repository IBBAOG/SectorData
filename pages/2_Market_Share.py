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

# ─── Constants ────────────────────────────────────────────────────────────────
COLORS = {"Vibra": "#f26522", "Raizen": "#1a1a1a", "Ipiranga": "#73C6A1", "Others": "#94a3b8"}
ALL_PLAYERS = ["Vibra", "Ipiranga", "Raizen", "Others"]

MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

def _fmt_data(d: str) -> str:
    try:
        y, m = d[:4], int(d[5:7])
        return f"{MONTHS_EN[m - 1]}/{y}"
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


# ─── Header ───────────────────────────────────────────────────────────────────
st.markdown("""
<div style="margin-bottom:0.5rem;">
    <div style="font-size:1.5rem;font-weight:600;color:#1a1a1a;">
        Liquid Fuels Market Share
    </div>
    <div style="font-size:0.85rem;color:#888;">
        Temporal evolution of market share by distributor (%)
    </div>
</div>
""", unsafe_allow_html=True)
st.markdown("---")

# ─── Sidebar filters ──────────────────────────────────────────────────────────
opcoes = carregar_ms_opcoes()
st.sidebar.markdown("## Filters")

datas = _resolver_datas(opcoes)
if len(datas) >= 2:
    data_inicio, data_fim = st.sidebar.select_slider(
        "Period", options=datas,
        value=(datas[0], datas[-1]),
        format_func=_fmt_data,
    )
elif len(datas) == 1:
    data_inicio = data_fim = datas[0]
    st.sidebar.info(f"Available period: {_fmt_data(datas[0])}")
else:
    st.sidebar.warning("Unable to load the period.")
    data_inicio = data_fim = None

competidores = st.sidebar.multiselect(
    "Competitors", ALL_PLAYERS, default=ALL_PLAYERS
)
regioes  = st.sidebar.multiselect("Region",  opcoes.get("regioes", []), default=[])
ufs      = st.sidebar.multiselect("State",   opcoes.get("ufs", []),     default=[])
mercados = st.sidebar.multiselect("Market",  opcoes.get("mercados", []), default=[])

st.sidebar.markdown("---")
col1, col2 = st.sidebar.columns(2)
aplicar = col1.button("Apply", use_container_width=True)
limpar  = col2.button("Clear", use_container_width=True)

if limpar:
    st.cache_data.clear()
    st.rerun()

filtros_sidebar = {
    "data_inicio": data_inicio, "data_fim": data_fim,
    "competidores": competidores or ALL_PLAYERS,
    "regioes": regioes, "ufs": ufs, "mercados": mercados,
}
_estado_antigo = st.session_state.get("ms_filtros_ativos", {})
if aplicar or "ms_filtros_ativos" not in st.session_state or "competidores" not in _estado_antigo:
    st.session_state["ms_filtros_ativos"] = filtros_sidebar
    if aplicar:
        st.toast("Filters applied!")

filtros = st.session_state["ms_filtros_ativos"]

# ─── Load full series ─────────────────────────────────────────────────────────
with st.spinner("Loading data..."):
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
def _linha_ms(produto: str, segmento: str | None, titulo: str, players: list):
    """
    Builds a temporal market share line chart.
    segmento=None → aggregates all segments (Total).
    players → list of companies to display.
    """
    if df_serie.empty:
        return None

    mask = df_serie["nome_produto"] == produto
    if segmento:
        mask &= df_serie["segmento"] == segmento

    df = df_serie[mask].copy()
    if df.empty:
        return None

    # Aggregate by (date, classificacao) — required for the Total chart
    df = df.groupby(["date", "classificacao"], as_index=False)["quantidade"].sum()

    # % over the total of ALL companies in that month (denominator includes Others)
    totais = df.groupby("date")["quantidade"].sum().rename("total")
    df = df.join(totais, on="date")
    df["pct"] = df["quantidade"] / df["total"] * 100

    df = df[df["classificacao"].isin(players)].sort_values("date")
    if df.empty:
        return None

    # ── Dynamic scale with proportional padding ────────────────────────────
    y_min = df["pct"].min()
    y_max = df["pct"].max()
    spread = y_max - y_min if y_max > y_min else 1.0
    pad = spread * 0.20
    y_lo = max(0.0,   y_min - pad)
    y_hi = min(100.0, y_max + pad)

    _FONT = dict(family="Arial", size=12, color="#000000")

    fig = px.line(
        df, x="date", y="pct", color="classificacao",
        color_discrete_map=COLORS,
        labels={"date": "", "pct": "Market Share (%)", "classificacao": ""},
        title="",
    )

    fig.update_traces(
        mode="lines",
        line_width=2.5,
        hovertemplate="%{fullData.name}: %{y:.1f}%<extra></extra>",
    )

    # Data label on the last point of each line
    ultima_data = df["date"].max()
    for player in players:
        ultimo = df[(df["classificacao"] == player) & (df["date"] == ultima_data)]
        if ultimo.empty:
            continue
        fig.add_annotation(
            x=ultima_data,
            y=float(ultimo["pct"].iloc[0]),
            text=f"{float(ultimo['pct'].iloc[0]):.1f}%",
            showarrow=False,
            xanchor="left",
            xshift=6,
            yanchor="middle",
            font=dict(family="Arial", size=12, color=COLORS.get(player, "#000000")),
        )

    fig.update_layout(
        title={"text": ""},
        margin=dict(t=10, b=80, l=10, r=60),
        font=_FONT,
        yaxis=dict(
            title=dict(text="Market Share (%)", font=_FONT),
            ticksuffix="%", range=[y_lo, y_hi], tickfont=_FONT,
            nticks=10,
            showgrid=False, zeroline=False,
            showline=True, linecolor="#000000", linewidth=1,
        ),
        xaxis=dict(
            title=dict(text="", font=_FONT),
            tickfont=_FONT,
            tickformat="%b-%y",
            tickangle=-90,
            tickmode="auto",
            nticks=12,
            automargin=True,
            showgrid=False, zeroline=False,
            showline=True, linecolor="#000000", linewidth=1,
        ),
        legend=dict(orientation="h", yanchor="top", y=-0.28, xanchor="center", x=0.5, font=_FONT),
        hoverlabel=dict(font=dict(family="Arial", color="#000000")),
        plot_bgcolor="white",
        height=300,
        hovermode="x unified",
    )
    return fig


def _secao(produto: str, titulo_secao: str, players: list, tem_trr: bool = True):
    """Renders a full chart section for one fuel type."""
    st.markdown(f"### {titulo_secao}")

    if tem_trr:
        c1, c2 = st.columns(2)
        c3, c4 = st.columns(2)
        pares = [
            (c1, "Retail", "Retail"),
            (c2, "B2B",    "B2B"),
            (c3, "TRR",    "TRR"),
            (c4, None,     "Total"),
        ]
    else:
        c1, c2 = st.columns(2)
        c3, _ = st.columns([1, 1])
        pares = [
            (c1, "Retail", "Retail"),
            (c2, "B2B",    "B2B"),
            (c3, None,     "Total"),
        ]

    for col, seg, label in pares:
        fig = _linha_ms(produto, seg, label, players)
        with col:
            st.markdown(
                f"<div style='font-family:Arial;font-size:18px;font-weight:600;"
                f"color:#FF5000;margin-bottom:2px;'>{label}</div>"
                f"<hr style='border:none;border-top:1px solid #BFBFBF;margin:0 30px 4px 0;'>",
                unsafe_allow_html=True,
            )
            if fig:
                st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})
            else:
                st.info("No data for the selected filters.")

    st.markdown("---")


# ─── Sections by fuel type ────────────────────────────────────────────────────
players_ativos = filtros.get("competidores") or ALL_PLAYERS

_secao("Diesel B",         "Diesel B",         players=players_ativos, tem_trr=True)
_secao("Gasolina C",       "Gasoline C",       players=players_ativos, tem_trr=False)
_secao("Etanol Hidratado", "Hydrated Ethanol", players=players_ativos, tem_trr=False)

# ─── Export ───────────────────────────────────────────────────────────────────
if not df_serie.empty:
    with st.expander("Export Data", expanded=False):
        st.download_button(
            "Full series (CSV)",
            df_serie.to_csv(index=False).encode("utf-8"),
            "ms_series.csv", "text/csv",
            use_container_width=False,
        )
