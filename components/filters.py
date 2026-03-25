import streamlit as st
from datetime import datetime


def render_sidebar_filtros(opcoes: dict) -> dict:
    """
    Renderiza os filtros na sidebar e retorna o dict de filtros ativos.
    """
    st.sidebar.markdown("## Filtros")

    anos      = st.sidebar.multiselect("Ano",                 opcoes.get("anos", []),           default=[])
    meses     = st.sidebar.multiselect("Mês",                 opcoes.get("meses", []),          default=[])
    agentes   = st.sidebar.multiselect("Agente Regulado",     opcoes.get("agentes", []),        default=[])
    r_origem  = st.sidebar.multiselect("Região Origem",       opcoes.get("regioes_origem", []), default=[])
    uf_origem = st.sidebar.multiselect("UF Origem",           opcoes.get("ufs_origem", []),     default=[])
    r_dest    = st.sidebar.multiselect("Região Destinatário", opcoes.get("regioes_dest", []),   default=[])
    uf_dest   = st.sidebar.multiselect("UF Destino",          opcoes.get("ufs_dest", []),       default=[])
    mercados  = st.sidebar.multiselect("Mercado",             opcoes.get("mercados", []),       default=[])

    st.sidebar.markdown("---")

    col1, col2 = st.sidebar.columns(2)
    aplicar = col1.button("🔍 Aplicar", use_container_width=True)
    limpar  = col2.button("🔄 Limpar",  use_container_width=True)

    if limpar:
        st.cache_data.clear()
        st.rerun()

    filtros_sidebar = {
        "anos": anos, "meses": meses, "agentes": agentes,
        "regioes_origem": r_origem, "ufs_origem": uf_origem,
        "regioes_dest": r_dest, "ufs_dest": uf_dest, "mercados": mercados,
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
