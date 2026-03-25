import streamlit as st
from datetime import datetime

MESES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
            "Jul", "Ago", "Set", "Out", "Nov", "Dez"]


def _fmt_data(d: str) -> str:
    """Converte '2021-01-01' → 'Jan/2021'."""
    try:
        y, m = d[:4], int(d[5:7])
        return f"{MESES_PT[m - 1]}/{y}"
    except Exception:
        return d


def render_sidebar_filtros(opcoes: dict) -> dict:
    """
    Renderiza os filtros na sidebar e retorna o dict de filtros ativos.
    """
    st.sidebar.markdown("## Filtros")

    # ── Slider de período ──────────────────────────────────────────────────────
    datas = sorted(opcoes.get("datas", []))
    if len(datas) >= 2:
        data_inicio, data_fim = st.sidebar.select_slider(
            "Período",
            options=datas,
            value=(datas[0], datas[-1]),
            format_func=_fmt_data,
        )
    elif len(datas) == 1:
        data_inicio = data_fim = datas[0]
        st.sidebar.info(f"Período único: {_fmt_data(datas[0])}")
    else:
        data_inicio = data_fim = None

    # ── Outros filtros ─────────────────────────────────────────────────────────
    agentes  = st.sidebar.multiselect("Agente Regulado",     opcoes.get("agentes", []),      default=[])
    r_dest   = st.sidebar.multiselect("Região Destinatário", opcoes.get("regioes_dest", []), default=[])
    uf_dest  = st.sidebar.multiselect("UF Destino",          opcoes.get("ufs_dest", []),     default=[])
    mercados = st.sidebar.multiselect("Mercado",             opcoes.get("mercados", []),     default=[])

    st.sidebar.markdown("---")

    col1, col2 = st.sidebar.columns(2)
    aplicar = col1.button("🔍 Aplicar", use_container_width=True)
    limpar  = col2.button("🔄 Limpar",  use_container_width=True)

    if limpar:
        st.cache_data.clear()
        st.rerun()

    filtros_sidebar = {
        "data_inicio":  data_inicio,
        "data_fim":     data_fim,
        "agentes":      agentes,
        "regioes_dest": r_dest,
        "ufs_dest":     uf_dest,
        "mercados":     mercados,
    }

    if aplicar or "filtros_ativos" not in st.session_state:
        st.session_state["filtros_ativos"] = filtros_sidebar
        if aplicar:
            st.toast("Filtros aplicados!", icon="✅")

    if "ultima_atualizacao" not in st.session_state or aplicar:
        st.session_state["ultima_atualizacao"] = datetime.now().strftime("%d/%m/%Y %H:%M")

    st.sidebar.markdown(
        f"<small style='color:#aaa;'>Atualizado em {st.session_state['ultima_atualizacao']}</small>",
        unsafe_allow_html=True,
    )

    return st.session_state["filtros_ativos"]
