import pandas as pd
from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

_supabase_client = None

# cache is injected at app startup via set_cache()
_cache = None


def set_cache(cache_instance):
    global _cache
    _cache = cache_instance


def _get_supabase():
    global _supabase_client
    if _supabase_client is None:
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _supabase_client


def get_client(token=None):
    supabase = _get_supabase()
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


# ─── Filter options ───────────────────────────────────────────────────────────

def carregar_opcoes(token=None):
    if _cache is not None:
        cache_key = "carregar_opcoes"
        cached = _cache.get(cache_key)
        if cached is not None:
            return cached
    try:
        supabase = get_client(token)
        resp = supabase.rpc("get_opcoes_filtros", {}).execute()
        result = resp.data
    except Exception:
        result = {}
    if _cache is not None:
        _cache.set(cache_key, result, timeout=3600)
    return result


# ─── Cached aggregations ──────────────────────────────────────────────────────

def carregar_metricas(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos, token=None):
    if _cache is not None:
        cache_key = f"metricas:{data_inicio}:{data_fim}:{agentes}:{regioes_dest}:{ufs_dest}:{mercados}:{segmentos}"
        cached = _cache.get(cache_key)
        if cached is not None:
            return cached
    try:
        supabase = get_client(token)
        resp = supabase.rpc("get_metricas", _params(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos)).execute()
        result = resp.data
    except Exception:
        result = {"total_registros": 0, "quantidade_total": 0.0, "anos_distintos": 0}
    if _cache is not None:
        _cache.set(cache_key, result, timeout=600)
    return result


def carregar_por_ano(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos, token=None):
    if _cache is not None:
        cache_key = f"por_ano:{data_inicio}:{data_fim}:{agentes}:{regioes_dest}:{ufs_dest}:{mercados}:{segmentos}"
        cached = _cache.get(cache_key)
        if cached is not None:
            return pd.DataFrame(cached)
    try:
        supabase = get_client(token)
        resp = supabase.rpc("get_qtd_por_ano", _params(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos)).execute()
        result = resp.data
    except Exception:
        result = []
    if _cache is not None:
        _cache.set(cache_key, result, timeout=600)
    return pd.DataFrame(result)


def carregar_por_mes(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos, token=None):
    if _cache is not None:
        cache_key = f"por_mes:{data_inicio}:{data_fim}:{agentes}:{regioes_dest}:{ufs_dest}:{mercados}:{segmentos}"
        cached = _cache.get(cache_key)
        if cached is not None:
            return pd.DataFrame(cached)
    try:
        supabase = get_client(token)
        resp = supabase.rpc("get_qtd_por_mes", _params(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos)).execute()
        result = resp.data
    except Exception:
        result = []
    if _cache is not None:
        _cache.set(cache_key, result, timeout=600)
    return pd.DataFrame(result)


def carregar_por_regiao(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos, token=None):
    if _cache is not None:
        cache_key = f"por_regiao:{data_inicio}:{data_fim}:{agentes}:{regioes_dest}:{ufs_dest}:{mercados}:{segmentos}"
        cached = _cache.get(cache_key)
        if cached is not None:
            return pd.DataFrame(cached)
    try:
        supabase = get_client(token)
        resp = supabase.rpc("get_qtd_por_regiao", _params(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos)).execute()
        result = resp.data
    except Exception:
        result = []
    if _cache is not None:
        _cache.set(cache_key, result, timeout=600)
    return pd.DataFrame(result)


def carregar_por_agente(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos, token=None):
    if _cache is not None:
        cache_key = f"por_agente:{data_inicio}:{data_fim}:{agentes}:{regioes_dest}:{ufs_dest}:{mercados}:{segmentos}"
        cached = _cache.get(cache_key)
        if cached is not None:
            return pd.DataFrame(cached)
    try:
        supabase = get_client(token)
        resp = supabase.rpc("get_qtd_por_agente", _params(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos)).execute()
        result = resp.data
    except Exception:
        result = []
    if _cache is not None:
        _cache.set(cache_key, result, timeout=600)
    return pd.DataFrame(result)


def carregar_por_produto(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos, token=None):
    if _cache is not None:
        cache_key = f"por_produto:{data_inicio}:{data_fim}:{agentes}:{regioes_dest}:{ufs_dest}:{mercados}:{segmentos}"
        cached = _cache.get(cache_key)
        if cached is not None:
            return pd.DataFrame(cached)
    try:
        supabase = get_client(token)
        resp = supabase.rpc("get_qtd_por_produto", _params(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos)).execute()
        result = resp.data
    except Exception:
        result = []
    if _cache is not None:
        _cache.set(cache_key, result, timeout=600)
    return pd.DataFrame(result)


def carregar_por_uf(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos, token=None):
    if _cache is not None:
        cache_key = f"por_uf:{data_inicio}:{data_fim}:{agentes}:{regioes_dest}:{ufs_dest}:{mercados}:{segmentos}"
        cached = _cache.get(cache_key)
        if cached is not None:
            return pd.DataFrame(cached)
    try:
        supabase = get_client(token)
        resp = supabase.rpc("get_qtd_por_uf", _params(data_inicio, data_fim, agentes, regioes_dest, ufs_dest, mercados, segmentos)).execute()
        result = resp.data
    except Exception:
        result = []
    if _cache is not None:
        _cache.set(cache_key, result, timeout=600)
    return pd.DataFrame(result)


def carregar_todos(filtros: dict, token=None):
    """Load all aggregations in parallel from a filters dict."""
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
        futures = [executor.submit(fn, *args, token) for fn in fns]

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


def carregar_ms_opcoes(token=None):
    if _cache is not None:
        cache_key = "carregar_ms_opcoes"
        cached = _cache.get(cache_key)
        if cached is not None:
            return cached
    try:
        supabase = get_client(token)
        resp = supabase.rpc("get_ms_opcoes_filtros", {}).execute()
        result = resp.data
    except Exception:
        result = {}
    if _cache is not None:
        _cache.set(cache_key, result, timeout=3600)
    return result


def carregar_ms_serie(data_inicio, data_fim, regioes, ufs, mercados, token=None):
    """Full time series with product + segment — used in line charts."""
    if _cache is not None:
        cache_key = f"ms_serie:{data_inicio}:{data_fim}:{regioes}:{ufs}:{mercados}"
        cached = _cache.get(cache_key)
        if cached is not None:
            return pd.DataFrame(cached)
    try:
        supabase = get_client(token)
        params = {
            "p_data_inicio": data_inicio or None,
            "p_data_fim":    data_fim or None,
            "p_regioes":     list(regioes) or None,
            "p_ufs":         list(ufs) or None,
            "p_mercados":    list(mercados) or None,
        }
        PAGE = 1000
        all_rows = []
        offset = 0
        while True:
            resp = supabase.rpc("get_ms_serie", params).range(offset, offset + PAGE - 1).execute()
            if not resp.data:
                break
            all_rows.extend(resp.data)
            if len(resp.data) < PAGE:
                break
            offset += PAGE
        result = all_rows
    except Exception:
        result = []
    if _cache is not None:
        _cache.set(cache_key, result, timeout=600)
    return pd.DataFrame(result)
