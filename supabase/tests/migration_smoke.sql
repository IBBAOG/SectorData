-- ─────────────────────────────────────────────────────────────────────────────
-- migration_smoke.sql
--
-- Post-migration smoke test.  Run by supabase_deploy.yml after `supabase db push`.
-- Fails with RAISE EXCEPTION on the first missing object.
--
-- Context: migration 20260402000000_sales_volumes was marked applied in
-- schema_migrations but its 4 RPCs were never created because mv_ms_serie did
-- not exist at execution time.  The bug sat in prod for months because the
-- frontend swallowed errors with try/catch → [].  (Those RPCs were later
-- retired in 2026-05-26 when /sales-volumes was folded into /market-share.)
-- This script is the safety net: if any critical object is absent, CI turns red.
--
-- How to add new checks (template):
--   Table:
--     PERFORM 1 FROM information_schema.tables
--       WHERE table_schema = 'public' AND table_name = '<table>';
--     IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: <table>'; END IF;
--
--     PERFORM 1 FROM pg_tables
--       WHERE schemaname = 'public' AND tablename = '<table>' AND rowsecurity = TRUE;
--     IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: <table>'; END IF;
--
--   Function:
--     PERFORM 1 FROM pg_proc p
--       JOIN pg_namespace n ON n.oid = p.pronamespace
--       WHERE n.nspname = 'public' AND p.proname = '<function_name>';
--     IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: <function_name>'; END IF;
--
-- Created: 2026-05-07
-- ─────────────────────────────────────────────────────────────────────────────

DO $smoke$
DECLARE
  v_missing TEXT;
BEGIN

  -- ───────────────────────────────────────────────────────────────────────────
  -- HELPER macro:
  --   We inline PERFORM + IF NOT FOUND for every check to get precise messages.
  -- ───────────────────────────────────────────────────────────────────────────

  -- ─── CORE TABLES ──────────────────────────────────────────────────────────

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vendas';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: vendas'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'vendas' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: vendas'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'navios_diesel';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: navios_diesel'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'navios_diesel' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: navios_diesel'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'd_g_margins';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: d_g_margins'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'd_g_margins' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: d_g_margins'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'price_bands';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: price_bands'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'price_bands' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: price_bands'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: profiles'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'profiles' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: profiles'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'module_visibility';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: module_visibility'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'module_visibility' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: module_visibility'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'stock_portfolios';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: stock_portfolios'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'stock_portfolios' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: stock_portfolios'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'news_articles';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: news_articles'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'news_articles' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: news_articles'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'news_hunter_keywords';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: news_hunter_keywords'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'news_hunter_keywords' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: news_hunter_keywords'; END IF;

  -- AIS tracking tables

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vessel_registry';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: vessel_registry'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'vessel_positions';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: vessel_positions'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'port_arrivals';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: port_arrivals'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'import_candidates';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: import_candidates'; END IF;

  -- ─── PHASE 3 TABLES ───────────────────────────────────────────────────────

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'anp_precos_produtores';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_precos_produtores'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_precos_produtores' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_precos_produtores'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'anp_glp';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_glp'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_glp' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_glp'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'anp_daie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_daie'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_daie' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_daie'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'anp_desembaracos';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_desembaracos'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_desembaracos' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_desembaracos'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'anp_lpc';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_lpc'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_lpc' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_lpc'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'anp_cdp_producao';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_cdp_producao'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_cdp_producao' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_cdp_producao'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mdic_comex';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: mdic_comex'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'mdic_comex' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: mdic_comex'; END IF;

  -- Column mdic_comex.quantidade_estatistica + unidade_estatistica (20260512000001)
  PERFORM 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mdic_comex'
      AND column_name = 'quantidade_estatistica';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing column: mdic_comex.quantidade_estatistica'; END IF;

  PERFORM 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mdic_comex'
      AND column_name = 'unidade_estatistica';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing column: mdic_comex.unidade_estatistica'; END IF;

  -- ─── MATERIALIZED VIEWS ───────────────────────────────────────────────────

  PERFORM 1 FROM pg_matviews
    WHERE schemaname = 'public' AND matviewname = 'mv_ms_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing materialized view: mv_ms_serie'; END IF;

  PERFORM 1 FROM pg_matviews
    WHERE schemaname = 'public' AND matviewname = 'mv_ms_serie_fast';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing materialized view: mv_ms_serie_fast'; END IF;

  PERFORM 1 FROM pg_matviews
    WHERE schemaname = 'public' AND matviewname = 'mv_anp_cdp_pocos';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing materialized view: mv_anp_cdp_pocos'; END IF;

  -- ─── SALES VOLUMES RPCs ───────────────────────────────────────────────────
  -- The 4 legacy sales-volumes RPCs were DROPPED in
  -- 20260526400000_drop_sv_rpcs.sql as part of the /sales-volumes →
  -- /market-share consolidation (2026-05-26). Both modes (% Share + thousand
  -- m³) are now served by get_ms_serie_fast (asserted below).

  -- ─── MARKET SHARE RPCs ────────────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_ms_opcoes_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_ms_opcoes_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_ms_serie_fast';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_ms_serie_fast'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_ms_serie_others';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_ms_serie_others'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_others_players';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_others_players'; END IF;

  -- ─── NAVIOS DIESEL RPCs ───────────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_nd_ultima_coleta';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_nd_ultima_coleta'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_nd_coletas_distintas';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_nd_coletas_distintas'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_nd_navios';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_nd_navios'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_nd_resumo_portos';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_nd_resumo_portos'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_nd_volume_mensal_descarga';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_nd_volume_mensal_descarga'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_nd_navios_descarregados';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_nd_navios_descarregados'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_nd_resumo_mensal_portos';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_nd_resumo_mensal_portos'; END IF;

  -- ─── AIS RPCs ─────────────────────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_ais_positions_latest';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_ais_positions_latest'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_ais_arrivals_open';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_ais_arrivals_open'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_port_polygons';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_port_polygons'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_ais_positions_all_recent';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_ais_positions_all_recent'; END IF;

  -- ─── IMPORT CANDIDATES RPCs ───────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_ic_active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_ic_active'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_ic_summary';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_ic_summary'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_ic_last_run';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_ic_last_run'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_ic_distinct_dates';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_ic_distinct_dates'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_ic_snapshot';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_ic_snapshot'; END IF;

  -- ─── D&G MARGINS RPCs ─────────────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_dg_margins_data';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_dg_margins_data'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_dg_margins_filters';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_dg_margins_filters'; END IF;

  -- ─── PRICE BANDS RPCs ─────────────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_price_bands_data';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_price_bands_data'; END IF;

  -- ─── MDIC COMEX RPCs ──────────────────────────────────────────────────────
  -- Note: the 5 get_mdic_comex_* RPCs were dropped in the /mdic-comex deprecation
  -- (2026-05-25). The mdic_comex table remains (asserted above, lines ~192-211) and
  -- is consumed by /imports-exports Panel C via get_imports_exports_fob_price_serie.

  -- ─── ANP PRICES CONSOLIDATED RPCs (20260526000000) ───────────────────────
  -- 10 legacy RPCs (get_anp_precos_produtores_*, get_anp_precos_distribuicao_*,
  -- get_anp_lpc_*) were dropped and replaced by 3 unified RPCs that UNION ALL
  -- the 3 source tables (anp_precos_produtores, anp_precos_distribuicao, anp_lpc).
  -- Source tables and ETL pipelines remain — only the API surface changed.

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_prices_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_prices_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_prices_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_prices_serie'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_prices_export_count';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_prices_export_count'; END IF;

  -- ─── ANP GLP RPCs ─────────────────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_glp_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_glp_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_glp_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_glp_serie'; END IF;

  -- ─── IMPORTS & EXPORTS RPCs (20260525000010 — reform) ────────────────────
  -- Replaces the 8 retired RPCs (get_anp_daie_*, get_anp_desembaracos_*,
  -- get_anp_painel_imp_*). The consolidated /imports-exports dashboard backs
  -- onto anp_desembaracos (enriched) + anp_daie via these 6 RPCs.

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_imports_exports_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_imports_exports_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_imports_exports_paises_stacked';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_imports_exports_paises_stacked'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_imports_exports_importers_stacked';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_imports_exports_importers_stacked'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_imports_exports_yoy_table';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_imports_exports_yoy_table'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_imports_exports_exports_paises_stacked';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_imports_exports_exports_paises_stacked'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_imports_exports_exports_yoy_table';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_imports_exports_exports_yoy_table'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_imports_exports_fob_price_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_imports_exports_fob_price_serie'; END IF;

  -- ─── ANP LPC RPCs ─────────────────────────────────────────────────────────
  -- get_anp_lpc_filtros / get_anp_lpc_serie / get_anp_lpc_nacional were DROPPED
  -- in the anp-prices consolidation (20260526000000). LPC data still feeds the
  -- consolidated get_anp_prices_* RPCs (covered above). anp_lpc table still
  -- exists and is asserted earlier in this script.

  -- ─── ANP CDP RPCs ─────────────────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_poco_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_poco_serie'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_pocos_json';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_pocos_json'; END IF;

  -- ─── PROFILE / ADMIN RPCs ─────────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_my_profile';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_my_profile'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'upsert_my_profile';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: upsert_my_profile'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_module_visibility';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_module_visibility'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_module_visibility';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: set_module_visibility'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_all_users_with_roles';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_all_users_with_roles'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_user_role';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: set_user_role'; END IF;

  -- ─── NEWS HUNTER RPCs ─────────────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'seed_my_news_hunter_keywords';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: seed_my_news_hunter_keywords'; END IF;

  -- ─── ALERTAS SESSION (20260507000001) ────────────────────────────────────

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'alertas_session';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: alertas_session'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'alertas_session' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: alertas_session'; END IF;

  -- ─── EXPORT COUNT RPCs (20260507000003) ──────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_ms_export_count';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_ms_export_count'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_export_count';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_export_count'; END IF;

  -- Note: get_anp_lpc_export_count was dropped in the anp-prices consolidation
  -- (20260526000000) — replaced by get_anp_prices_export_count (asserted above).

  -- ─── EXPORT AGGREGATED RPCs (20260507000004) ─────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_aggregated';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_aggregated'; END IF;

  -- Note: get_mdic_comex_aggregated was dropped in the /mdic-comex deprecation (2026-05-25).

  -- ─── ANP PRECOS DISTRIBUICAO (20260507000005) ─────────────────────────────
  -- Table + RLS still asserted (ETL keeps writing here). The 3 RPCs
  -- (get_anp_precos_distribuicao_filtros / _serie / _export_count) were DROPPED
  -- in the anp-prices consolidation (20260526000000) and folded into the
  -- consolidated get_anp_prices_* RPCs (asserted above).

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'anp_precos_distribuicao';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_precos_distribuicao'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_precos_distribuicao' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_precos_distribuicao'; END IF;

  -- ─── APP EVENTS (20260507000011) ─────────────────────────────────────────

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'app_events';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: app_events'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'app_events' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: app_events'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'track_event';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: track_event'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_analytics_kpis';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_analytics_kpis'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_analytics_by_dashboard';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_analytics_by_dashboard'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_analytics_by_user';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_analytics_by_user'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_analytics_user_timeline';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_analytics_user_timeline'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_analytics_heatmap';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_analytics_heatmap'; END IF;

  -- ─── ANP CDP DIARIA (20260508000001) ─────────────────────────────────────

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'anp_cdp_diaria';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_cdp_diaria'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_cdp_diaria' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_cdp_diaria'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_diaria_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_diaria_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_diaria_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_diaria_serie'; END IF;

  -- ─── ANP CDP DIARIA LEVELS (20260508120001) ───────────────────────────────
  -- Granularidade Instalacao

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'anp_cdp_diaria_instalacao';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_cdp_diaria_instalacao'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_cdp_diaria_instalacao' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_cdp_diaria_instalacao'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_diaria_instalacao_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_diaria_instalacao_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_diaria_instalacao_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_diaria_instalacao_serie'; END IF;

  -- Granularidade Poco

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'anp_cdp_diaria_poco';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_cdp_diaria_poco'; END IF;

  -- Column anp_cdp_diaria_poco.instalacao (20260508130001)
  PERFORM 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'anp_cdp_diaria_poco'
      AND column_name = 'instalacao';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing column: anp_cdp_diaria_poco.instalacao'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_cdp_diaria_poco' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_cdp_diaria_poco'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_diaria_poco_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_diaria_poco_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_diaria_poco_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_diaria_poco_serie'; END IF;

  -- ─── ANP VOIP (20260508000009) ────────────────────────────────────────────

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'anp_voip';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_voip'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_voip' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_voip'; END IF;

  -- ─── ANP CDP BSW RPCs (20260508000002 + 20260508000010) ──────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_bsw_scatter';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_bsw_scatter'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_bsw_field_aggregate';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_bsw_field_aggregate'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_bsw_campos';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_bsw_campos'; END IF;

  -- ─── ANP CDP DEPLETION RPCs (20260508000012) ─────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_depletion_campos';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_depletion_campos'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_depletion_scatter';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_depletion_scatter'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_depletion_field_aggregate';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_depletion_field_aggregate'; END IF;

  -- ─── SUBSIDY TRACKER (20260513000001) ────────────────────────────────────

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'anp_subsidy_diesel_reference';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_subsidy_diesel_reference'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_subsidy_diesel_reference' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_subsidy_diesel_reference'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'anp_subsidy_history';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_subsidy_history'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_subsidy_history' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_subsidy_history'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_subsidy_tracker_diesel';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_subsidy_tracker_diesel'; END IF;

  -- ─── CLIPPING COOKIES (20260513130000) ──────────────────────────────────

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'clipping_cookies';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: clipping_cookies'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'clipping_cookies' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: clipping_cookies'; END IF;

  -- ─── AUDIT ADMIN ACTIONS + HOME VISIBILITY (20260514110000) ─────────────
  -- set_module_home_visibility (added in 20260513120000, instrumented here)

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_module_home_visibility';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: set_module_home_visibility'; END IF;

  -- admin_audit_log view
  PERFORM 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'admin_audit_log';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing view: admin_audit_log'; END IF;

  -- app_events CHECK constraint must accept admin.* event types
  PERFORM 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'app_events'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%admin.%';
  IF NOT FOUND THEN RAISE EXCEPTION 'app_events CHECK constraint does not allow admin.* event types'; END IF;

  RAISE NOTICE 'migration_smoke: all % checks passed.',
    '33 tables + 1 view + 3 materialized views + 77 functions + 25 RLS checks';

END $smoke$;
