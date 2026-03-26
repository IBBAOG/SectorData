import streamlit as st
from datetime import datetime
from itertools import product as _product

MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Standard Brazilian region → UF mapping (full names and abbreviations)
REGIAO_UF_MAP = {
    "Norte":        ["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
    "N":            ["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
    "Nordeste":     ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
    "NE":           ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
    "Centro-Oeste": ["DF", "GO", "MS", "MT"],
    "CO":           ["DF", "GO", "MS", "MT"],
    "Sudeste":      ["ES", "MG", "RJ", "SP"],
    "SE":           ["ES", "MG", "RJ", "SP"],
    "Sul":          ["PR", "RS", "SC"],
    "S":            ["PR", "RS", "SC"],
}

_HR = "<hr style='border:none;border-top:1px solid #e0e0e0;margin:4px 0 6px 0;'>"


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


def _checkbox_filter(label: str, options: list, prefix: str) -> list:
    """Expander with checkboxes. Returns selected options; empty = no filter."""
    if not options:
        return []

    checked = [o for o in options if st.session_state.get(f"_f_{prefix}_{o}", False)]
    n = len(checked)
    header = f"{label}  ·  {n} selected" if n > 0 else label

    with st.sidebar.expander(header, expanded=False):
        # Use buttons side-by-side via markdown trick (no st.columns in sidebar)
        sel_all = st.button("Select all", key=f"_f_{prefix}_all", use_container_width=True)
        clr_all = st.button("Clear all",  key=f"_f_{prefix}_clr", use_container_width=True)
        if sel_all:
            for o in options:
                st.session_state[f"_f_{prefix}_{o}"] = True
            st.rerun()
        if clr_all:
            for o in options:
                st.session_state[f"_f_{prefix}_{o}"] = False
            st.rerun()
        st.markdown(_HR, unsafe_allow_html=True)
        for o in options:
            st.checkbox(str(o), key=f"_f_{prefix}_{o}")

    return [o for o in options if st.session_state.get(f"_f_{prefix}_{o}", False)]


def _region_state_filter(
    all_regioes: list,
    all_ufs: list,
    reg_prefix: str = "reg",
    uf_prefix: str  = "uf",
) -> tuple:
    """
    Combined Region / State expander.
    Each region has its own checkbox; when checked, its states appear
    indented directly below it as sub-items.
    Returns (selected_regioes, selected_ufs).
    """
    if not all_regioes:
        return [], []

    # Build region → [ufs_in_data] map
    def _ufs_for_region(reg: str) -> list:
        mapped = REGIAO_UF_MAP.get(reg, [])
        result = [u for u in all_ufs if u in mapped]
        # Fallback: if mapping produced nothing, return all UFs
        return result if result else list(all_ufs)

    # Read current states (before rendering, for header label)
    sel_regioes = [r for r in all_regioes if st.session_state.get(f"_f_{reg_prefix}_{r}", False)]
    all_visible_ufs = []
    for r in sel_regioes:
        all_visible_ufs += [u for u in _ufs_for_region(r) if u not in all_visible_ufs]
    sel_ufs = [u for u in all_visible_ufs if st.session_state.get(f"_f_{uf_prefix}_{u}", False)]

    # Header label
    parts = []
    if sel_regioes:
        parts.append(f"{len(sel_regioes)} region{'s' if len(sel_regioes) > 1 else ''}")
    if sel_ufs:
        parts.append(f"{len(sel_ufs)} state{'s' if len(sel_ufs) > 1 else ''}")
    header = "Region / State" + (f"  ·  {', '.join(parts)}" if parts else "")

    with st.sidebar.expander(header, expanded=False):
        # Action buttons
        all_btn = st.button("All regions", key=f"_f_{reg_prefix}_all", use_container_width=True)
        clr_btn = st.button("Clear",       key=f"_f_{reg_prefix}_clr", use_container_width=True)
        if all_btn:
            for r in all_regioes:
                st.session_state[f"_f_{reg_prefix}_{r}"] = True
            st.rerun()
        if clr_btn:
            for r in all_regioes:
                st.session_state[f"_f_{reg_prefix}_{r}"] = False
            for u in all_ufs:
                st.session_state[f"_f_{uf_prefix}_{u}"] = False
            st.rerun()

        st.markdown(_HR, unsafe_allow_html=True)

        # Render each region + its states as sub-items
        for reg in all_regioes:
            st.checkbox(str(reg), key=f"_f_{reg_prefix}_{reg}")
            reg_checked = st.session_state.get(f"_f_{reg_prefix}_{reg}", False)
            if reg_checked:
                ufs_here = _ufs_for_region(reg)
                for i, uf in enumerate(ufs_here):
                    connector = "└─" if i == len(ufs_here) - 1 else "├─"
                    st.checkbox(
                        f"{connector} {uf}",
                        key=f"_f_{uf_prefix}_{uf}",
                    )

    # Re-read final selection
    sel_regioes = [r for r in all_regioes if st.session_state.get(f"_f_{reg_prefix}_{r}", False)]
    all_visible_ufs = []
    for r in sel_regioes:
        all_visible_ufs += [u for u in _ufs_for_region(r) if u not in all_visible_ufs]
    sel_ufs = [u for u in all_visible_ufs if st.session_state.get(f"_f_{uf_prefix}_{u}", False)]
    return sel_regioes, sel_ufs


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

    st.sidebar.markdown("<div style='height:4px'></div>", unsafe_allow_html=True)

    # ── Filters ────────────────────────────────────────────────────────────
    segmentos = _checkbox_filter("Segment",           ["B2B", "Retail", "TRR", "Others"], "seg")
    agentes   = _checkbox_filter("Regulated Agent",   opcoes.get("agentes", []),           "agt")
    r_dest, uf_dest = _region_state_filter(
        opcoes.get("regioes_dest", []),
        opcoes.get("ufs_dest", []),
        reg_prefix="reg_dest",
        uf_prefix="uf_dest",
    )

    st.sidebar.markdown("---")
    col1, col2 = st.sidebar.columns(2)
    aplicar = col1.button("Apply", use_container_width=True)
    limpar  = col2.button("Clear", use_container_width=True)

    if limpar:
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
        "mercados":     [],
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
