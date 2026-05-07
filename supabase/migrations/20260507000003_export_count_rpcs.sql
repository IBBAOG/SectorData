-- ============================================================================
-- Export size calculator RPCs
-- Each function mirrors the filter signature of its "sister" serie RPC but
-- returns only count(*)::bigint — no rows transferred.
-- Frontend multiplies the count by AVG_BYTES_PER_ROW to estimate XLSX/CSV size.
--
-- SECURITY INVOKER: RLS applies as the calling user; no data bypass intended.
-- STABLE: count does not change within a single transaction.
-- GRANT EXECUTE TO authenticated: same audience as the serie RPCs.
--
-- RPC #5 (get_navios_radar_export_count) OMITTED:
--   Dashboard /navios-diesel-radar does not exist in src/app/(dashboard)/.
-- ============================================================================

-- ── RPC 1: get_ms_export_count ───────────────────────────────────────────────
-- Shared by /market-share and /sales-volumes.
-- Mirrors the filter predicate of get_ms_serie_fast (vendas table path).
-- When no geo filters are passed, both dashboards hit the materialized view;
-- for the count estimate the vendas raw table is fine either way (same rows).

CREATE OR REPLACE FUNCTION public.get_ms_export_count(
    p_data_inicio text    DEFAULT NULL,
    p_data_fim    text    DEFAULT NULL,
    p_regioes     text[]  DEFAULT NULL,
    p_ufs         text[]  DEFAULT NULL,
    p_mercados    text[]  DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
    SELECT count(*)::bigint
    FROM public.vendas v
    WHERE
        (p_data_inicio IS NULL OR v.date >= p_data_inicio::date)
        AND (p_data_fim    IS NULL OR v.date <= p_data_fim::date)
        AND (p_regioes     IS NULL OR v.regiao_destinatario  = ANY(p_regioes))
        AND (p_ufs         IS NULL OR v.uf_destino           = ANY(p_ufs))
        AND (p_mercados    IS NULL OR v.mercado_destinatario = ANY(p_mercados));
$$;

GRANT EXECUTE ON FUNCTION public.get_ms_export_count(text, text, text[], text[], text[])
    TO authenticated;


-- ── RPC 2: get_mdic_comex_export_count ──────────────────────────────────────
-- Mirrors get_mdic_comex_serie.

CREATE OR REPLACE FUNCTION public.get_mdic_comex_export_count(
    p_flow        text    DEFAULT NULL,
    p_ncms        text[]  DEFAULT NULL,
    p_ano_inicio  int     DEFAULT NULL,
    p_ano_fim     int     DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
    SELECT count(*)::bigint
    FROM public.mdic_comex
    WHERE
        (p_flow       IS NULL OR flow       = p_flow)
        AND (p_ncms   IS NULL OR ncm_codigo = ANY(p_ncms))
        AND (p_ano_inicio IS NULL OR ano    >= p_ano_inicio)
        AND (p_ano_fim    IS NULL OR ano    <= p_ano_fim);
$$;

GRANT EXECUTE ON FUNCTION public.get_mdic_comex_export_count(text, text[], int, int)
    TO authenticated;


-- ── RPC 3: get_anp_cdp_export_count ─────────────────────────────────────────
-- Mirrors get_anp_cdp_poco_serie (defined in 20260504000009_anp_cdp_v5.sql).

CREATE OR REPLACE FUNCTION public.get_anp_cdp_export_count(
    p_pocos            text[]  DEFAULT NULL,
    p_campos           text[]  DEFAULT NULL,
    p_bacoes           text[]  DEFAULT NULL,
    p_locais           text[]  DEFAULT NULL,
    p_estados          text[]  DEFAULT NULL,
    p_operadores       text[]  DEFAULT NULL,
    p_instalacoes      text[]  DEFAULT NULL,
    p_tipos_instalacao text[]  DEFAULT NULL,
    p_ano_inicio       integer DEFAULT NULL,
    p_ano_fim          integer DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
    SELECT count(*)::bigint
    FROM public.anp_cdp_producao
    WHERE
        (p_pocos            IS NULL OR poco               = ANY(p_pocos))
        AND (p_campos       IS NULL OR campo              = ANY(p_campos))
        AND (p_bacoes       IS NULL OR bacia              = ANY(p_bacoes))
        AND (p_locais       IS NULL OR local              = ANY(p_locais))
        AND (p_estados      IS NULL OR estado             = ANY(p_estados))
        AND (p_operadores   IS NULL OR operador           = ANY(p_operadores))
        AND (p_instalacoes  IS NULL OR instalacao_destino = ANY(p_instalacoes))
        AND (p_tipos_instalacao IS NULL OR tipo_instalacao = ANY(p_tipos_instalacao))
        AND (p_ano_inicio   IS NULL OR ano                >= p_ano_inicio)
        AND (p_ano_fim      IS NULL OR ano                <= p_ano_fim);
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_export_count(
    text[], text[], text[], text[], text[], text[], text[], text[], integer, integer
) TO authenticated;


-- ── RPC 4: get_anp_lpc_export_count ─────────────────────────────────────────
-- Mirrors get_anp_lpc_serie.

CREATE OR REPLACE FUNCTION public.get_anp_lpc_export_count(
    p_produtos    text[]  DEFAULT NULL,
    p_estados     text[]  DEFAULT NULL,
    p_data_inicio date    DEFAULT NULL,
    p_data_fim    date    DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
    SELECT count(*)::bigint
    FROM public.anp_lpc
    WHERE
        (p_produtos   IS NULL OR produto  = ANY(p_produtos))
        AND (p_estados IS NULL OR estado  = ANY(p_estados))
        AND (p_data_inicio IS NULL OR data_fim >= p_data_inicio)
        AND (p_data_fim    IS NULL OR data_fim <= p_data_fim);
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_lpc_export_count(text[], text[], date, date)
    TO authenticated;
