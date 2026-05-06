-- ============================================================================
-- Hardening D — Revoke EXECUTE on internal-only functions
--
-- These functions are not in src/lib/rpc.ts (not called by the frontend).
-- They exist for pipeline use (service_role) or as trigger bodies.
-- Revoking EXECUTE from anon/authenticated removes them from PostgREST's
-- callable surface without breaking anything.
--
-- NOTE: Trigger functions (fn_classificar_agente, _match_candidate_on_navio_insert)
-- are already unreachable via PostgREST RPC (they return TRIGGER, not a
-- compatible type). Included here for completeness per SECURITY DEFINER audit.
--
-- Functions NOT revoked (verified in src/lib/rpc.ts as frontend-callable):
--   - All get_ms_*, get_sv_*, get_nd_*, get_ic_*, get_dg_*, get_anp_*,
--     get_mdic_*, get_sindicom_*, get_opcoes_filtros, get_metricas,
--     get_qtd_por_*, get_others_players, get_port_polygons, etc.
--   - classificar_agentes: called by vendas upload pipeline BUT also
--     potentially exposed — revoking from public; pipeline uses service_role
--     which bypasses GRANT/REVOKE (always has execute on all functions).
-- ============================================================================

-- Pipeline-only: refresh trigger for sales classification
REVOKE EXECUTE ON FUNCTION public.classificar_agentes() FROM anon, authenticated;

-- Not in rpc.ts: internal navios helper (used only by old dashboard version)
REVOKE EXECUTE ON FUNCTION public.get_nd_unresolved(timestamptz) FROM anon, authenticated;

-- Trigger function: not callable via RPC anyway, but remove from anon surface
REVOKE EXECUTE ON FUNCTION public.fn_classificar_agente() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._match_candidate_on_navio_insert() FROM anon, authenticated;

-- get_candidate_trail: not in rpc.ts (future route viz, not yet exposed to frontend)
REVOKE EXECUTE ON FUNCTION public.get_candidate_trail(text, int) FROM anon, authenticated;

-- Legacy overloads of get_metricas / get_qtd_por_* with old 8-param signatures
-- (regiao_origem/uf_origem params removed in later refactor; no longer called)
REVOKE EXECUTE ON FUNCTION public.get_metricas(integer[], integer[], text[], text[], text[], text[], text[], text[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_qtd_por_agente(integer[], integer[], text[], text[], text[], text[], text[], text[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_qtd_por_ano(integer[], integer[], text[], text[], text[], text[], text[], text[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_qtd_por_mes(integer[], integer[], text[], text[], text[], text[], text[], text[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_qtd_por_produto(integer[], integer[], text[], text[], text[], text[], text[], text[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_qtd_por_regiao(integer[], integer[], text[], text[], text[], text[], text[], text[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_qtd_por_uf(integer[], integer[], text[], text[], text[], text[], text[], text[]) FROM anon, authenticated;
