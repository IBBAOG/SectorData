-- Migration: hotfix get_data_sources_freshness — subsidy reform fallout.
--
-- Context
--   * Migration 20260526200000_data_sources_freshness.sql created the RPC with a
--     UNION branch reading public.anp_subsidy_history.
--   * The subsidy reform (20260527200000_subsidy_reform.sql) DROPPED that table
--     and replaced it with two new tables: anp_subsidy_caps and
--     anp_subsidy_commercialization. Both carry inserted_at timestamptz.
--   * As a result the RPC crashes at runtime ("relation public.anp_subsidy_history
--     does not exist") and /home breaks for every visitor tier.
--
-- This migration drops the old function definition outright (cannot CREATE OR
-- REPLACE while the body still references a missing table) and re-creates it
-- with:
--   * The anp_subsidy_history branch removed.
--   * Two new branches for anp_subsidy_caps and anp_subsidy_commercialization,
--     keyed on MAX(inserted_at) as the freshness signal (these tables are
--     ingest-stamped, not date-of-event indexed in the same way the legacy
--     anp_subsidy_history was).
--
-- All other branches are preserved verbatim from the previous definition.
-- LANGUAGE sql STABLE SECURITY DEFINER + pinned search_path retained per
-- CLAUDE.md Pegadinha #18. GRANT EXECUTE to anon + authenticated retained.

DROP FUNCTION IF EXISTS public.get_data_sources_freshness();

CREATE FUNCTION public.get_data_sources_freshness()
RETURNS TABLE (
  source_key text,
  last_update timestamptz,
  row_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'anp_cdp_diaria'::text,
         MAX(data)::timestamptz,
         count(*)::bigint
  FROM public.anp_cdp_diaria
  UNION ALL
  SELECT 'anp_cdp_diaria_instalacao'::text,
         MAX(data)::timestamptz,
         count(*)::bigint
  FROM public.anp_cdp_diaria_instalacao
  UNION ALL
  SELECT 'anp_cdp_diaria_poco'::text,
         MAX(data)::timestamptz,
         count(*)::bigint
  FROM public.anp_cdp_diaria_poco
  UNION ALL
  SELECT 'anp_cdp_producao'::text,
         MAX(make_date(ano::int, mes::int, 1))::timestamptz,
         count(*)::bigint
  FROM public.anp_cdp_producao
  UNION ALL
  SELECT 'anp_voip'::text,
         MAX(make_date(ano_publicacao::int, 1, 1))::timestamptz,
         count(*)::bigint
  FROM public.anp_voip
  UNION ALL
  SELECT 'vendas'::text,
         MAX(date)::timestamptz,
         count(*)::bigint
  FROM public.vendas
  UNION ALL
  -- anp_precos_produtores stores a reporting WINDOW (data_inicio..data_fim), not
  -- a single date. Use data_fim (upper edge of the most recent published week).
  SELECT 'anp_precos_produtores'::text,
         MAX(data_fim)::timestamptz,
         count(*)::bigint
  FROM public.anp_precos_produtores
  UNION ALL
  SELECT 'anp_glp'::text,
         MAX(make_date(ano::int, mes::int, 1))::timestamptz,
         count(*)::bigint
  FROM public.anp_glp
  UNION ALL
  -- anp_lpc carries data_fim only (weekly LPC publishes a closing week).
  SELECT 'anp_lpc'::text,
         MAX(data_fim)::timestamptz,
         count(*)::bigint
  FROM public.anp_lpc
  UNION ALL
  SELECT 'anp_precos_distribuicao'::text,
         MAX(data_referencia)::timestamptz,
         count(*)::bigint
  FROM public.anp_precos_distribuicao
  UNION ALL
  SELECT 'anp_subsidy_diesel_reference'::text,
         MAX(data_referencia)::timestamptz,
         count(*)::bigint
  FROM public.anp_subsidy_diesel_reference
  UNION ALL
  -- anp_subsidy_caps replaces the dropped anp_subsidy_history. Freshness signal
  -- is ingest time (inserted_at) — these rows are append-only and the ETL
  -- timestamp is what /home wants to surface.
  SELECT 'anp_subsidy_caps'::text,
         MAX(inserted_at),
         count(*)::bigint
  FROM public.anp_subsidy_caps
  UNION ALL
  SELECT 'anp_subsidy_commercialization'::text,
         MAX(inserted_at),
         count(*)::bigint
  FROM public.anp_subsidy_commercialization
  UNION ALL
  SELECT 'mdic_comex'::text,
         MAX(make_date(ano::int, mes::int, 1))::timestamptz,
         count(*)::bigint
  FROM public.mdic_comex
  UNION ALL
  SELECT 'anp_daie'::text,
         MAX(make_date(ano::int, mes::int, 1))::timestamptz,
         count(*)::bigint
  FROM public.anp_daie
  UNION ALL
  SELECT 'anp_desembaracos'::text,
         MAX(make_date(ano::int, mes::int, 1))::timestamptz,
         count(*)::bigint
  FROM public.anp_desembaracos
  UNION ALL
  SELECT 'navios_diesel'::text,
         MAX(collected_at),
         count(*)::bigint
  FROM public.navios_diesel
  UNION ALL
  SELECT 'vessel_positions'::text,
         MAX(ts),
         count(*)::bigint
  FROM public.vessel_positions
  UNION ALL
  SELECT 'port_arrivals'::text,
         MAX(detected_at),
         count(*)::bigint
  FROM public.port_arrivals
  UNION ALL
  SELECT 'import_candidates'::text,
         MAX(last_seen_at),
         count(*)::bigint
  FROM public.import_candidates
  UNION ALL
  -- d_g_margins.week is text in "W/YYYY" form (ISO week / ISO year).
  -- Parse via to_date('IW/IYYY') so MAX is chronological rather than lexicographic.
  -- to_date returns the Monday of the ISO week.
  SELECT 'd_g_margins'::text,
         MAX(to_date(week, 'IW/IYYY'))::timestamptz,
         count(*)::bigint
  FROM public.d_g_margins
  UNION ALL
  SELECT 'price_bands'::text,
         MAX(date)::timestamptz,
         count(*)::bigint
  FROM public.price_bands
  UNION ALL
  SELECT 'news_articles'::text,
         MAX(found_at),
         count(*)::bigint
  FROM public.news_articles;
$$;

GRANT EXECUTE ON FUNCTION public.get_data_sources_freshness() TO anon, authenticated;

COMMENT ON FUNCTION public.get_data_sources_freshness() IS
  'Returns MAX(temporal_col) + count(*) per ETL-fed table. Backs the /home Data Sources live table. SECURITY DEFINER + pinned search_path so anon callers bypass RLS on per-table policies. 2026-05-27: anp_subsidy_history branch removed (table dropped); added anp_subsidy_caps + anp_subsidy_commercialization branches keyed on inserted_at.';
