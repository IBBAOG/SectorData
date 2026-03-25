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


_supabase_client = None

def _get_supabase():
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _supabase_client


def get_client():
    supabase = _get_supabase()
    token = st.session_state.get("token")
    if token:
        supabase.postgrest.auth(token)
    return supabase


def _params(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos):
    return {
        "p_data_inicio":  data_inicio or None,
        "p_data_fim":     data_fim or None,
        "p_agentes":      list(agentes) or None,
        "p_regioes_dest": list(regioes_dest) or None,
        "p_ufs_dest":     list(ufs_dest) or None,
        "p_mercados":     list(mercados) or None,
        "p_segmentos":    list(segmentos) or None,
    }


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


# ─── Agregações cacheadas ─────────────────────────────────────────────────────

@st.cache_data(ttl=600, show_spinner=False)
def carregar_metricas(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_metricas", _params(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos)).execute()
        return resp.data
    except Exception:
        return {"total_registros": 0, "quantidade_total": 0.0, "anos_distintos": 0}


@st.cache_data(ttl=600, show_spinner=False)
def carregar_por_ano(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_qtd_por_ano", _params(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos)).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=600, show_spinner=False)
def carregar_por_mes(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_qtd_por_mes", _params(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos)).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=600, show_spinner=False)
def carregar_por_regiao(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_qtd_por_regiao", _params(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos)).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=600, show_spinner=False)
def carregar_por_agente(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_qtd_por_agente", _params(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos)).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=600, show_spinner=False)
def carregar_por_produto(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_qtd_por_produto", _params(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos)).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=600, show_spinner=False)
def carregar_por_uf(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_qtd_por_uf", _params(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos)).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


def carregar_todos(filtros: dict):
    """Carrega todos os dados em paralelo a partir de um dict de filtros."""
    from concurrent.futures import ThreadPoolExecutor

    args = (
        filtros.get("data_inicio"),
        filtros.get("data_fim"),
        tuple(filtros.get("agentes") or []),
        tuple(filtros.get("regioes_dest") or []),
        tuple(filtros.get("ufs_dest") or []),
        tuple(filtros.get("mercados") or []),
        tuple(filtros.get("segmentos") or []),
    )

    fns = [
        carregar_metricas, carregar_por_ano, carregar_por_mes,
        carregar_por_regiao, carregar_por_agente, carregar_por_produto, carregar_por_uf,
    ]

    with ThreadPoolExecutor(max_workers=7) as executor:
        futures = [executor.submit(fn, *args) for fn in fns]

    return [f.result() for f in futures]


# ─── Market Share ─────────────────────────────────────────────────────────────

def _ms_params(data_inicio, data_fim, produtos, regioes, ufs, mercados, segmentos):
    return {
        "p_data_inicio": data_inicio or None,
        "p_data_fim":    data_fim or None,
        "p_produtos":    list(produtos) or None,
        "p_regioes":     list(regioes) or None,
        "p_ufs":         list(ufs) or None,
        "p_mercados":    list(mercados) or None,
        "p_segmentos":   list(segmentos) or None,
    }


@st.cache_data(ttl=3600, show_spinner=False)
def carregar_ms_opcoes():
    try:
        supabase = get_client()
        resp = supabase.rpc("get_ms_opcoes_filtros", {}).execute()
        return resp.data
    except Exception:
        return {}


@st.cache_data(ttl=600, show_spinner=False)
def carregar_ms_totais(data_inicio, data_fim, produtos, regioes, ufs, mercados, segmentos):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_ms_totais", _ms_params(data_inicio, data_fim, produtos, regioes, ufs, mercados, segmentos)).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=600, show_spinner=False)
def carregar_ms_por_ano(data_inicio, data_fim, produtos, regioes, ufs, mercados, segmentos):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_ms_por_ano", _ms_params(data_inicio, data_fim, produtos, regioes, ufs, mercados, segmentos)).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=600, show_spinner=False)
def carregar_ms_por_mes(data_inicio, data_fim, produtos, regioes, ufs, mercados, segmentos):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_ms_por_mes", _ms_params(data_inicio, data_fim, produtos, regioes, ufs, mercados, segmentos)).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=600, show_spinner=False)
def carregar_ms_por_regiao(data_inicio, data_fim, produtos, regioes, ufs, mercados, segmentos):
    try:
        supabase = get_client()
        resp = supabase.rpc("get_ms_por_regiao", _ms_params(data_inicio, data_fim, produtos, regioes, ufs, mercados, segmentos)).execute()
        return pd.DataFrame(resp.data)
    except Exception:
        return pd.DataFrame()


def carregar_ms_todos(filtros: dict):
    from concurrent.futures import ThreadPoolExecutor

    args = (
        filtros.get("data_inicio"),
        filtros.get("data_fim"),
        tuple(filtros.get("produtos") or []),
        tuple(filtros.get("regioes") or []),
        tuple(filtros.get("ufs") or []),
        tuple(filtros.get("mercados") or []),
        tuple(filtros.get("segmentos") or []),
    )

    fns = [carregar_ms_totais, carregar_ms_por_ano, carregar_ms_por_mes, carregar_ms_por_regiao]

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(fn, *args) for fn in fns]

    return [f.result() for f in futures]
