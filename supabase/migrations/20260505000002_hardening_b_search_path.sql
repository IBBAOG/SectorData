-- ============================================================================
-- Hardening B — Fix mutable search_path on all RPCs
--
-- Resolves: function_search_path_mutable for all functions that lack
-- SET search_path = public, pg_temp. Using ALTER FUNCTION ... SET search_path
-- is the minimal-impact approach (no body rewrite, no signature change).
--
-- Note: 4 get_sv_* functions referenced in src/lib/rpc.ts (rpcGetSvSerieFast,
-- rpcGetSvSerieOthers, rpcGetSvOpcoesFiltros, rpcGetSvOthersPlayers) DO NOT
-- exist in the prod database. The /sales-volumes dashboard likely calls
-- get_ms_* equivalents at runtime via the same `paginatedRpc()` helper, or
-- silently fails. Tracked as separate issue — not a hardening concern.
-- ============================================================================

-- ── remote_schema.sql functions ──────────────────────────────────────────────

ALTER FUNCTION public.classificar_agentes() SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_classificar_agente() SET search_path = public, pg_temp;

-- get_metricas — 3 overloads
ALTER FUNCTION public.get_metricas(integer[], integer[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_metricas(integer[], integer[], text[], text[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_metricas(text, text, text[], text[], text[], text[], text[]) SET search_path = public, pg_temp;

ALTER FUNCTION public.get_ms_opcoes_filtros() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_ms_serie(text, text, text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_ms_serie_fast(text, text, text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_ms_serie_others(text, text, text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_opcoes_filtros() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_others_players() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_price_bands_data(text) SET search_path = public, pg_temp;

-- get_qtd_por_* — 4 overloads each (anos+meses 6/8, data_inicio 6/7)
ALTER FUNCTION public.get_qtd_por_agente(integer[], integer[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_agente(integer[], integer[], text[], text[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_agente(text, text, text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_agente(text, text, text[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_ano(integer[], integer[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_ano(integer[], integer[], text[], text[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_ano(text, text, text[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_mes(integer[], integer[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_mes(integer[], integer[], text[], text[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_mes(text, text, text[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_produto(integer[], integer[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_produto(integer[], integer[], text[], text[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_produto(text, text, text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_produto(text, text, text[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_regiao(integer[], integer[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_regiao(integer[], integer[], text[], text[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_regiao(text, text, text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_regiao(text, text, text[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_uf(integer[], integer[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_uf(integer[], integer[], text[], text[], text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_uf(text, text, text[], text[], text[], text[]) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_qtd_por_uf(text, text, text[], text[], text[], text[], text[]) SET search_path = public, pg_temp;

-- ── navios_diesel ────────────────────────────────────────────────────────────
ALTER FUNCTION public.get_nd_ultima_coleta() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_nd_coletas_distintas() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_nd_navios(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_nd_resumo_portos(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_nd_volume_mensal_descarga(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_nd_navios_descarregados(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_nd_resumo_mensal_portos(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_nd_unresolved(timestamptz) SET search_path = public, pg_temp;

-- ── d_g_margins ──────────────────────────────────────────────────────────────
ALTER FUNCTION public.get_dg_margins_data(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_dg_margins_filters() SET search_path = public, pg_temp;

-- ── ais_tracking ─────────────────────────────────────────────────────────────
ALTER FUNCTION public.get_ais_positions_latest(timestamptz) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_ais_arrivals_open() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_port_polygons() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_ais_positions_all_recent(int) SET search_path = public, pg_temp;

-- ── import_candidates / discovery ────────────────────────────────────────────
ALTER FUNCTION public.get_ic_active() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_ic_summary() SET search_path = public, pg_temp;
ALTER FUNCTION public._match_candidate_on_navio_insert() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_candidate_trail(text, int) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_ic_distinct_dates() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_ic_snapshot(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_ic_last_run() SET search_path = public, pg_temp;

-- ── anp_precos.sql ───────────────────────────────────────────────────────────
ALTER FUNCTION public.get_anp_ppi_media_serie(date, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_ppi_locais_serie(text, date, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_ppi_filtros() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_precos_produtores_serie(text, text[], date, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_precos_produtores_filtros() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_glp_serie(text[], text[], smallint, smallint) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_glp_filtros() SET search_path = public, pg_temp;

-- ── anp_fase3.sql ────────────────────────────────────────────────────────────
ALTER FUNCTION public.get_anp_daie_serie(text[], text[], smallint, smallint) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_daie_filtros() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_desembaracos_serie(text[], text[], smallint, smallint) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_desembaracos_filtros() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_desembaracos_top_paises(text, smallint, smallint, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_painel_imp_serie(text[], text[], smallint, smallint) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_painel_imp_filtros() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_painel_imp_top_dist(text, smallint, smallint, integer) SET search_path = public, pg_temp;

-- ── lpc_sindicom.sql ─────────────────────────────────────────────────────────
ALTER FUNCTION public.get_anp_lpc_serie(text[], text[], date, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_lpc_nacional(text[], date, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_lpc_filtros() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_sindicom_serie(text[], text[], text[], smallint, smallint) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_sindicom_filtros() SET search_path = public, pg_temp;

-- ── mdic_comex.sql ───────────────────────────────────────────────────────────
ALTER FUNCTION public.get_mdic_comex_serie(text, text[], integer, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_mdic_comex_top_paises(text, text, integer, integer, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_mdic_comex_filtros() SET search_path = public, pg_temp;
