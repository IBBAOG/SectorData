import pandas as pd
import streamlit as st
from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")


def get_client():
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    token = st.session_state.get("token")
    if token:
        supabase.postgrest.auth(token)
    return supabase


def _params(filtros):
    return {
        "p_anos":           filtros.get("anos") or None,
        "p_meses":          filtros.get("meses") or None,
        "p_agentes":        filtros.get("agentes") or None,
        "p_regioes_origem": filtros.get("regioes_origem") or None,
        "p_ufs_origem":     filtros.get("ufs_origem") or None,
        "p_regioes_dest":   filtros.get("regioes_dest") or None,
        "p_ufs_dest":       filtros.get("ufs_dest") or None,
        "p_mercados":       filtros.get("mercados") or None,
    }


@st.cache_data(ttl=3600)
def carregar_opcoes():
    supabase = get_client()
    resp = supabase.rpc("get_opcoes_filtros", {}).execute()
    return resp.data


@st.cache_data(ttl=600)
def carregar_metricas(filtros):
    supabase = get_client()
    resp = supabase.rpc("get_metricas", _params(filtros)).execute()
    return resp.data


@st.cache_data(ttl=600)
def carregar_por_ano(filtros):
    supabase = get_client()
    resp = supabase.rpc("get_qtd_por_ano", _params(filtros)).execute()
    return pd.DataFrame(resp.data)


@st.cache_data(ttl=600)
def carregar_por_mes(filtros):
    supabase = get_client()
    resp = supabase.rpc("get_qtd_por_mes", _params(filtros)).execute()
    return pd.DataFrame(resp.data)


@st.cache_data(ttl=600)
def carregar_por_regiao(filtros):
    supabase = get_client()
    resp = supabase.rpc("get_qtd_por_regiao", _params(filtros)).execute()
    return pd.DataFrame(resp.data)


@st.cache_data(ttl=600)
def carregar_por_agente(filtros):
    supabase = get_client()
    resp = supabase.rpc("get_qtd_por_agente", _params(filtros)).execute()
    return pd.DataFrame(resp.data)


@st.cache_data(ttl=600)
def carregar_por_produto(filtros):
    supabase = get_client()
    resp = supabase.rpc("get_qtd_por_produto", _params(filtros)).execute()
    return pd.DataFrame(resp.data)


@st.cache_data(ttl=600)
def carregar_por_uf(filtros):
    supabase = get_client()
    resp = supabase.rpc("get_qtd_por_uf", _params(filtros)).execute()
    return pd.DataFrame(resp.data)