import streamlit as st
from datetime import datetime
from itertools import product as _product

MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _fmt_data(d: str) -> str:
    """Converts '2021-01-01' → 'Jan/2021'."""
    try:
        y, m = d[:4], int(d[5:7])
        return f"{MONTHS_EN[m - 1]}/{y}"
    except Exception:
        return d


def _resolver_datas(opcoes: dict) -> list[str]:
    """
    Returns sorted list of ISO dates ('YYYY-MM-01').
    Tries 'datas' field first; falls back to 'anos' × 'meses' cartesian product.
    """
    datas = sorted(opcoes.get("datas") or [])
    if datas:
        return datas

    anos  = sorted(opcoes.get("anos")  or [])
    meses = sorted(opcoes.get("meses") or [])
    if anos and meses:
        return sorted(f"{a:04d}-{m:02d}-01" for a, m in _product(anos, meses))

    return []


def render_sidebar_filtros(opcoes: dict) -> dict:
    """
    Renders sidebar filters and returns the active filters dict.
    """
    st.sidebar.markdown("## Filters")

    # ── Period slider ──────────────────────────────────────────────────────
    datas = _resolver_datas(opcoes)

    if len(datas) >= 2:
        data_inicio, data_fim = st.sidebar.select_slider(
            "Period",
            options=datas,
            value=(datas[0], datas[-1]),
            format_func=_fmt_data,
        )
    elif len(datas) == 1:
        data_inicio = data_fim = datas[0]
        st.sidebar.info(f"Available period: {_fmt_data(datas[0])}")
    else:
        st.sidebar.warning("Unable to load the period. Check the database connection.")
        data_inicio = data_fim = None

    # ── Other filters ──────────────────────────────────────────────────────
    segmentos = st.sidebar.multiselect("Segment",            ["B2B", "Retail", "TRR", "Others"], default=[])
    agentes   = st.sidebar.multiselect("Regulated Agent",   opcoes.get("agentes", []),      default=[])
    r_dest    = st.sidebar.multiselect("Destination Region", opcoes.get("regioes_dest", []), default=[])
    uf_dest   = st.sidebar.multiselect("Destination State",  opcoes.get("ufs_dest", []),     default=[])
    mercados  = st.sidebar.multiselect("Market",             opcoes.get("mercados", []),     default=[])

    st.sidebar.markdown("---")

    col1, col2 = st.sidebar.columns(2)
    aplicar = col1.button("Apply", use_container_width=True)
    limpar  = col2.button("Clear", use_container_width=True)

    if limpar:
        st.cache_data.clear()
        st.rerun()

    filtros_sidebar = {
        "data_inicio":  data_inicio,
        "data_fim":     data_fim,
        "segmentos":    segmentos,
        "agentes":      agentes,
        "regioes_dest": r_dest,
        "ufs_dest":     uf_dest,
        "mercados":     mercados,
    }

    if aplicar or "filtros_ativos" not in st.session_state:
        st.session_state["filtros_ativos"] = filtros_sidebar
        if aplicar:
            st.toast("Filters applied!")

    if "ultima_atualizacao" not in st.session_state or aplicar:
        st.session_state["ultima_atualizacao"] = datetime.now().strftime("%m/%d/%Y %H:%M")

    st.sidebar.markdown(
        f"<small style='color:#aaa;'>Updated on {st.session_state['ultima_atualizacao']}</small>",
        unsafe_allow_html=True,
    )

    return st.session_state["filtros_ativos"]
