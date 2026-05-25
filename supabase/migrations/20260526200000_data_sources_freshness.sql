-- Migration: get_data_sources_freshness RPC for /home live "Data Sources" table.
--
-- Single RPC that aggregates MAX(temporal_col) and count(*) for every ETL-fed
-- table the home page needs to display freshness for. The frontend has a
-- corresponding TS catalog keyed by source_key.
--
-- Notes
--   * LANGUAGE sql STABLE + SECURITY DEFINER + pinned search_path so the
--     function works for anon callers even though most underlying tables
--     are RLS-restricted to authenticated. See CLAUDE.md Pegadinha #18.
--   * UNION ALL avoids dedup overhead; each row carries a literal source_key.
--   * For monthly-grain tables (ano/mes columns), we synthesize a DATE via
--     make_date(ano, mes, 1) and cast to timestamptz at the rollup level.
--     This means last_update represents "month covered", not "ingest moment".
--     Acceptable for freshness display because the gap between the covered
--     month and the next ingest is what the home page is trying to surface.
--   * timestamptz unification: DATE columns are explicitly cast so the UNION
--     ALL type-checks cleanly.

CREATE OR REPLACE FUNCTION public.get_data_sources_freshness()
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
  SELECT 'anp_subsidy_history'::text,
         MAX(vigente_desde)::timestamptz,
         count(*)::bigint
  FROM public.anp_subsidy_history
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
  'Returns MAX(temporal_col) + count(*) per ETL-fed table. Backs the /home Data Sources live table. SECURITY DEFINER + pinned search_path so anon callers bypass RLS on per-table policies.';
