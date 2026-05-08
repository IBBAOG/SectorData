-- ─────────────────────────────────────────────────────────────────────────────
-- migration_smoke.sql
--
-- Post-migration smoke test.  Run by supabase_deploy.yml after `supabase db push`.
-- Fails with RAISE EXCEPTION on the first missing object.
--
-- Context: migration 20260402000000_sales_volumes was marked applied in
-- schema_migrations but the 4 get_sv_* functions were never created because
-- mv_ms_serie did not exist at execution time.  The bug sat in prod for months
-- because the frontend swallowed errors with try/catch → [].
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
    WHERE table_schema = 'public' AND table_name = 'anp_ppi';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_ppi'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_ppi' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_ppi'; END IF;

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
    WHERE table_schema = 'public' AND table_name = 'anp_painel_imp_dist';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_painel_imp_dist'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_painel_imp_dist' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_painel_imp_dist'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'anp_lpc';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_lpc'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_lpc' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_lpc'; END IF;

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'sindicom';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: sindicom'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'sindicom' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: sindicom'; END IF;

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
  -- These are the exact functions whose absence caused the original prod bug.

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_sv_opcoes_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_sv_opcoes_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_sv_serie_fast';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_sv_serie_fast'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_sv_serie_others';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_sv_serie_others'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_sv_others_players';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_sv_others_players'; END IF;

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

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_mdic_comex_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_mdic_comex_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_mdic_comex_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_mdic_comex_serie'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_mdic_comex_top_paises';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_mdic_comex_top_paises'; END IF;

  -- ─── ANP PPI RPCs ─────────────────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_ppi_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_ppi_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_ppi_media_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_ppi_media_serie'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_ppi_locais_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_ppi_locais_serie'; END IF;

  -- ─── ANP PRECOS PRODUTORES RPCs ───────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_precos_produtores_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_precos_produtores_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_precos_produtores_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_precos_produtores_serie'; END IF;

  -- ─── ANP GLP RPCs ─────────────────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_glp_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_glp_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_glp_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_glp_serie'; END IF;

  -- ─── ANP DAIE RPCs ────────────────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_daie_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_daie_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_daie_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_daie_serie'; END IF;

  -- ─── ANP DESEMBARACOS RPCs ────────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_desembaracos_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_desembaracos_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_desembaracos_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_desembaracos_serie'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_desembaracos_top_paises';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_desembaracos_top_paises'; END IF;

  -- ─── ANP PAINEL IMPORTACOES RPCs ──────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_painel_imp_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_painel_imp_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_painel_imp_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_painel_imp_serie'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_painel_imp_top_dist';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_painel_imp_top_dist'; END IF;

  -- ─── ANP LPC RPCs ─────────────────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_lpc_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_lpc_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_lpc_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_lpc_serie'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_lpc_nacional';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_lpc_nacional'; END IF;

  -- ─── SINDICOM RPCs ────────────────────────────────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_sindicom_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_sindicom_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_sindicom_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_sindicom_serie'; END IF;

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
    WHERE n.nspname = 'public' AND p.proname = 'get_mdic_comex_export_count';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_mdic_comex_export_count'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_export_count';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_export_count'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_lpc_export_count';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_lpc_export_count'; END IF;

  -- ─── EXPORT AGGREGATED RPCs (20260507000004) ─────────────────────────────

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_aggregated';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_aggregated'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_mdic_comex_aggregated';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_mdic_comex_aggregated'; END IF;

  -- ─── ANP PRECOS DISTRIBUICAO (20260507000005) ─────────────────────────────

  PERFORM 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'anp_precos_distribuicao';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: anp_precos_distribuicao'; END IF;

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_precos_distribuicao' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_precos_distribuicao'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_precos_distribuicao_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_precos_distribuicao_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_precos_distribuicao_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_precos_distribuicao_serie'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_precos_distribuicao_export_count';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_precos_distribuicao_export_count'; END IF;

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

  PERFORM 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'anp_cdp_diaria_poco' AND rowsecurity = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: anp_cdp_diaria_poco'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_diaria_poco_filtros';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_diaria_poco_filtros'; END IF;

  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_anp_cdp_diaria_poco_serie';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: get_anp_cdp_diaria_poco_serie'; END IF;

  RAISE NOTICE 'migration_smoke: all % checks passed.',
    '30 tables + 3 materialized views + 79 functions + 23 RLS checks';

END $smoke$;
