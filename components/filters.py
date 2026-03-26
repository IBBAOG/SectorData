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
    datas = sorted(opcoes.get("datas") or [])
    if datas:
        return datas
    anos  = sorted(opcoes.get("anos")  or [])
    meses = sorted(opcoes.get("meses") or [])
    if anos and meses:
        return sorted(f"{a:04d}-{m:02d}-01" for a, m in _product(anos, meses))
    return []


def _checkbox_filter(label: str, options: list, prefix: str) -> list:
    """
    Renders a sober dropdown (expander) with one checkbox per option.
    Returns the list of selected options; empty list = no filter applied.
    """
    if not options:
        return []

    # Count how many are currently checked
    checked = [o for o in options if st.session_state.get(f"_f_{prefix}_{o}", False)]
    n = len(checked)
    header = f"{label}  ·  {n} selected" if n > 0 else label

    with st.sidebar.expander(header, expanded=False):
        c1, c2 = st.columns(2)
        if c1.button("Select all", key=f"_f_{prefix}_all", use_container_width=True):
            for o in options:
                st.session_state[f"_f_{prefix}_{o}"] = True
            st.rerun()
        if c2.button("Clear all", key=f"_f_{prefix}_clr", use_container_width=True):
            for o in options:
                st.session_state[f"_f_{prefix}_{o}"] = False
            st.rerun()

        st.markdown(
            "<hr style='border:none;border-top:1px solid #e0e0e0;margin:4px 0 6px 0;'>",
            unsafe_allow_html=True,
        )
        for o in options:
            st.checkbox(str(o), key=f"_f_{prefix}_{o}")

    return [o for o in options if st.session_state.get(f"_f_{prefix}_{o}", False)]


def render_sidebar_filtros(opcoes: dict) -> dict:
    """Renders sidebar filters and returns the active filters dict."""
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

    st.sidebar.markdown(
        "<div style='height:6px'></div>",
        unsafe_allow_html=True,
    )

    # ── Checkbox-dropdown filters ──────────────────────────────────────────
    segmentos = _checkbox_filter("Segment",             ["B2B", "Retail", "TRR", "Others"],  "seg")
    agentes   = _checkbox_filter("Regulated Agent",     opcoes.get("agentes", []),            "agt")
    r_dest    = _checkbox_filter("Destination Region",  opcoes.get("regioes_dest", []),       "reg")
    uf_dest   = _checkbox_filter("Destination State",   opcoes.get("ufs_dest", []),           "uf")
    mercados  = _checkbox_filter("Market",              opcoes.get("mercados", []),           "mkt")

    st.sidebar.markdown("---")
    col1, col2 = st.sidebar.columns(2)
    aplicar = col1.button("Apply", use_container_width=True)
    limpar  = col2.button("Clear", use_container_width=True)

    if limpar:
        # Reset all checkbox states
        for k in list(st.session_state.keys()):
            if k.startswith("_f_"):
                del st.session_state[k]
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
