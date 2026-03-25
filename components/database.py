import pandas as pd
import streamlit as st
from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = st.secrets.get("SUPABASE_URL") if hasattr(st, "secrets") else None
SUPABASE_URL = SUPABASE_URL or os.getenv("SUPABASE_URL")
SUPABASE_KEY = st.secrets.get("SUPABASE_KEY") if hasattr(st, "secrets") else None
SUPABASE_KEY = SUPABASE_KEY or os.getenv("SUPABASE_KEY")


@st.cache_resource
def _get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def get_client():
    supabase = _get_supabase()
    token = st.session_state.get("token")
    if token:
        supabase.postgrest.auth(token)
    return supabase


def _params(anos, meses, agentes, regioes_origem, ufs_origem, regioes_dest, ufs_dest, mercados):
    return {
        "p_anos":           list(anos) or None,
        "p_meses":          list(meses) or None,
        "p_agentes":        list(agentes) or None,
        "p_regioes_origem": list(regioes_origem) or None,
        "p_ufs_origem":     list(ufs_origem) or None,
        "p_regioes_dest":   list(regioes_dest) or None,
        "p_ufs_dest":       list(ufs_dest) or None,
        "p_mercados":       list(mercados) or None,
    }


def _filtros_para_tuplas(filtros: dict):
    """Converte valores do dict de filtros para tuplas (hasheáveis pelo Streamlit)."""
    return tuple(tuple(filtros.get(k) or []) for k in [
        "anos", "meses", "agentes", "regioes_origem",
        "ufs_origem", "regioes_dest", "ufs_dest", "mercados"
    ])


# ─── Opções dos filtros ───────────────────────────────────────────────────────

@st.cache_data(ttl=3600, show_spinner=False)
def carregar_opcoes():
    try:
        supabase = get_client()
        resp = supabase.rpc("get_opcoes_filtros", {}).execute()
        return resp.data
    except Exception:
        st.warning("Não foi possível carregar as opções de filtro.")
        return {}


# ─── Agregações cacheadas por tupla de filtros ────────────────────────────────

@st.cache_data(ttl=600, show_spinner=False)
def carregar_metricas(anos, meses, agentes, regioes_origem, ufs_origem, regioes_dest, ufs_dest, mercados):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_metricas", _params(
            anos, meses, agentes, regioes_origem, ufs_origem, regioes_dest, ufs_dest, mercados
        )).execute()
        return resp.data
    except Exception:
        return {"total_registros": 0, "quantidade_total": 0.0, "anos_distintos": 0}


@st.cache_data(ttl=600, show_spinner=False)
def carregar_por_ano(anos, meses, agentes, regioes_origem, ufs_origem, regioes_dest, ufs_dest, mercados):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_qtd_por_ano", _params(
            anos, meses, agentes, regioes_origem, ufs_origem, regioes_dest, ufs_dest, mercados
        )).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=600, show_spinner=False)
def carregar_por_mes(anos, meses, agentes, regioes_origem, ufs_origem, regioes_dest, ufs_dest, mercados):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_qtd_por_mes", _params(
            anos, meses, agentes, regioes_origem, ufs_origem, regioes_dest, ufs_dest, mercados
        )).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=600, show_spinner=False)
def carregar_por_regiao(anos, meses, agentes, regioes_origem, ufs_origem, regioes_dest, ufs_dest, mercados):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_qtd_por_regiao", _params(
            anos, meses, agentes, regioes_origem, ufs_origem, regioes_dest, ufs_dest, mercados
        )).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=600, show_spinner=False)
def carregar_por_agente(anos, meses, agentes, regioes_origem, ufs_origem, regioes_dest, ufs_dest, mercados):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_qtd_por_agente", _params(
            anos, meses, agentes, regioes_origem, ufs_origem, regioes_dest, ufs_dest, mercados
        )).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=600, show_spinner=False)
def carregar_por_produto(anos, meses, agentes, regioes_origem, ufs_origem, regioes_dest, ufs_dest, mercados):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_qtd_por_produto", _params(
            anos, meses, agentes, regioes_origem, ufs_origem, regioes_dest, ufs_dest, mercados
        )).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=600, show_spinner=False)
def carregar_por_uf(anos, meses, agentes, regioes_origem, ufs_origem, regioes_dest, ufs_dest, mercados):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_qtd_por_uf", _params(
            anos, meses, agentes, regioes_origem, ufs_origem, regioes_dest, ufs_dest, mercados
        )).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


def carregar_todos(filtros: dict):
    """Carrega todos os dados em paralelo a partir de um dict de filtros."""
    from concurrent.futures import ThreadPoolExecutor

    args = tuple(tuple(filtros.get(k) or []) for k in [
        "anos", "meses", "agentes", "regioes_origem",
        "ufs_origem", "regioes_dest", "ufs_dest", "mercados"
    ])

    fns = [
        carregar_metricas,
        carregar_por_ano,
        carregar_por_mes,
        carregar_por_regiao,
        carregar_por_agente,
        carregar_por_produto,
        carregar_por_uf,
    ]

    with ThreadPoolExecutor(max_workers=7) as executor:
        futures = [executor.submit(fn, *args) for fn in fns]

    return [f.result() for f in futures]
