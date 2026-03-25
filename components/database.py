import pandas as pd
import streamlit as st
from supabase import create_client
import os
import hashlib
import json
from dotenv import load_dotenv

load_dotenv()

# Funciona tanto local (.env) quanto no Streamlit Cloud (st.secrets)
SUPABASE_URL = st.secrets.get("SUPABASE_URL") if hasattr(st, "secrets") else None
SUPABASE_URL = SUPABASE_URL or os.getenv("SUPABASE_URL")
SUPABASE_KEY = st.secrets.get("SUPABASE_KEY") if hasattr(st, "secrets") else None
SUPABASE_KEY = SUPABASE_KEY or os.getenv("SUPABASE_KEY")


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


def _hash_filtros(filtros):
    """Gera uma chave única para o conjunto de filtros para uso no cache."""
    return hashlib.md5(
        json.dumps(filtros, sort_keys=True, default=str).encode()
    ).hexdigest()


# ─── Opções dos filtros ───────────────────────────────────────────────────────

@st.cache_data(ttl=3600)
def carregar_opcoes():
    supabase = get_client()
    resp = supabase.rpc("get_opcoes_filtros", {}).execute()
    return resp.data


# ─── Agregações com cache por hash dos filtros ────────────────────────────────

def carregar_metricas(filtros):
    return _carregar_metricas_cached(_hash_filtros(filtros), filtros)

@st.cache_data(ttl=600)
def _carregar_metricas_cached(chave, filtros):
    supabase = get_client()
    resp = supabase.rpc("get_metricas", _params(filtros)).execute()
    return resp.data


def carregar_por_ano(filtros):
    return _carregar_por_ano_cached(_hash_filtros(filtros), filtros)

@st.cache_data(ttl=600)
def _carregar_por_ano_cached(chave, filtros):
    supabase = get_client()
    resp = supabase.rpc("get_qtd_por_ano", _params(filtros)).execute()
    return pd.DataFrame(resp.data)


def carregar_por_mes(filtros):
    return _carregar_por_mes_cached(_hash_filtros(filtros), filtros)

@st.cache_data(ttl=600)
def _carregar_por_mes_cached(chave, filtros):
    supabase = get_client()
    resp = supabase.rpc("get_qtd_por_mes", _params(filtros)).execute()
    return pd.DataFrame(resp.data)


def carregar_por_regiao(filtros):
    return _carregar_por_regiao_cached(_hash_filtros(filtros), filtros)

@st.cache_data(ttl=600)
def _carregar_por_regiao_cached(chave, filtros):
    supabase = get_client()
    resp = supabase.rpc("get_qtd_por_regiao", _params(filtros)).execute()
    return pd.DataFrame(resp.data)


def carregar_por_agente(filtros):
    return _carregar_por_agente_cached(_hash_filtros(filtros), filtros)

@st.cache_data(ttl=600)
def _carregar_por_agente_cached(chave, filtros):
    supabase = get_client()
    resp = supabase.rpc("get_qtd_por_agente", _params(filtros)).execute()
    return pd.DataFrame(resp.data)


def carregar_por_produto(filtros):
    return _carregar_por_produto_cached(_hash_filtros(filtros), filtros)

@st.cache_data(ttl=600)
def _carregar_por_produto_cached(chave, filtros):
    supabase = get_client()
    resp = supabase.rpc("get_qtd_por_produto", _params(filtros)).execute()
    return pd.DataFrame(resp.data)


def carregar_por_uf(filtros):
    return _carregar_por_uf_cached(_hash_filtros(filtros), filtros)

@st.cache_data(ttl=600)
def _carregar_por_uf_cached(chave, filtros):
    supabase = get_client()
    resp = supabase.rpc("get_qtd_por_uf", _params(filtros)).execute()
    return pd.DataFrame(resp.data)