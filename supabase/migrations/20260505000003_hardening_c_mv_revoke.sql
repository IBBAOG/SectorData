-- ============================================================================
-- Hardening C — Revoke direct PostgREST access to materialized views
--
-- mv_ms_serie, mv_ms_serie_fast, mv_anp_cdp_pocos are read exclusively via
-- SECURITY DEFINER RPCs (get_ms_serie_fast, get_sv_serie_fast,
-- get_anp_cdp_pocos_json, etc.). No frontend code does
-- from("mv_ms_serie_fast").select() directly.
-- Revoking SELECT on anon/authenticated forces all access through the RPCs,
-- eliminating the exposed_materialized_view advisor warnings and reducing
-- PostgREST's public API surface.
-- ============================================================================

REVOKE SELECT ON public.mv_ms_serie        FROM anon, authenticated;
REVOKE SELECT ON public.mv_ms_serie_fast   FROM anon, authenticated;
REVOKE SELECT ON public.mv_anp_cdp_pocos   FROM anon, authenticated;
