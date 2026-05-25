-- =============================================================================
-- 20260526100000_restore_security_definer_cdp_rpcs.sql
--
-- Filename slot 20260526000001 was taken in remote schema_migrations by a
-- parallel worktree (anp_prices_uf_fix); this migration uses 20260526100000
-- to avoid collision.
--
-- Restore SECURITY DEFINER on RPCs that lost it during recent DROP+CREATE waves.
--
-- ── Context ──────────────────────────────────────────────────────────────────
-- Smoke test 2026-05-25: /anp-cdp-bsw and /anp-cdp-depletion render empty for
-- anon callers. Filter dropdowns populate (the `_campos()` RPCs are still
-- SECURITY DEFINER), but scatter + field_aggregate charts come back as `[]`.
-- No 42501 surfaced (GRANT EXECUTE was restored in 20260525210050), the call
-- silently returned an empty payload.
--
-- Root cause: the 4 CDP BSW/Depletion data RPCs lost SECURITY DEFINER during
-- a prior DROP+CREATE wave. Without it, SQL functions execute with the
-- caller's privileges, so RLS on anp_cdp_producao + anp_voip applies. Those
-- two tables grant SELECT only to `authenticated`, never `anon`. Anon hits
-- RLS and the function returns zero rows -- no error, just an empty set.
--
-- ── Validation done before this migration (anon role) ────────────────────────
--   SET LOCAL ROLE anon;
--   SELECT jsonb_array_length(get_anp_cdp_bsw_field_aggregate(ARRAY['MARLIM']))
--     -> 0  (broken)
--   SELECT count(*) FROM get_anp_cdp_bsw_scatter(ARRAY['MARLIM','RONCADOR'])
--     -> 0  (broken)
--   SELECT jsonb_array_length(get_anp_cdp_depletion_field_aggregate(ARRAY['MARLIM']))
--     -> 0  (broken)
--   SELECT count(*) FROM get_anp_cdp_depletion_scatter(ARRAY['MARLIM'])
--     -> 0  (broken)
-- All 4 return non-zero when called as postgres / service_role -- the data
-- exists, it is RLS blocking the anon caller from seeing it.
--
-- ── Scope expansion ──────────────────────────────────────────────────────────
-- An audit of `pg_proc` surfaced 13 public `get_*` RPCs with `prosecdef=false`:
--
--   Broken for anon (RLS authenticated-only):
--     - get_anp_cdp_bsw_field_aggregate(text[])         <- core fix (CTO)
--     - get_anp_cdp_bsw_scatter(text[])                 <- core fix (CTO)
--     - get_anp_cdp_depletion_field_aggregate(text[])   <- core fix (CTO)
--     - get_anp_cdp_depletion_scatter(text[])           <- core fix (CTO)
--     - get_anp_cdp_aggregated(...)                     <- breaks /anp-cdp panels
--     - get_anp_cdp_export_count(...)                   <- breaks /anp-cdp export size estimate
--     - get_ms_export_count(...)                        <- breaks /market-share export estimate (vendas RLS authed-only)
--
--   Working today but only by luck (anon read policies on the underlying
--   tables; if those policies ever tighten, the RPCs break silently again).
--   Converted defensively to SECURITY DEFINER for consistency:
--     - get_imports_exports_filtros()
--     - get_imports_exports_paises_stacked(text, int, int, int)
--     - get_imports_exports_importers_stacked(text, int, int, int)
--     - get_imports_exports_fob_price_serie(text, int, int)
--     - get_imports_exports_yoy_table(text, text, int, int, int)
--
--   Excluded intentionally:
--     - get_anp_prices_export_count(...) -- already delegates to a SECURITY
--       DEFINER RPC (get_anp_prices_serie), so it inherits the definer
--       privileges transitively. Not strictly required, but converted as
--       well below for the same consistency reason.
--
-- ── Defense in depth ─────────────────────────────────────────────────────────
-- ALTER FUNCTION ... SET search_path = public, pg_temp is reapplied to each
-- target. SECURITY DEFINER functions are especially vulnerable to search-path
-- hijack (a malicious caller can plant a function in their own schema and
-- shadow ours). Pinning search_path closes that hole.
--
-- ── Migration shape ──────────────────────────────────────────────────────────
-- Grant-and-attribute-only: no DDL on function bodies, no policy changes, no
-- column work. Safe to re-run (ALTER FUNCTION ... SECURITY DEFINER and
-- SET search_path are idempotent).
-- =============================================================================

BEGIN;

-- ── A. Core CDP BSW + Depletion data RPCs (confirmed broken via SET ROLE) ──

ALTER FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[])         SECURITY DEFINER;
ALTER FUNCTION public.get_anp_cdp_bsw_scatter(text[])                 SECURITY DEFINER;
ALTER FUNCTION public.get_anp_cdp_depletion_field_aggregate(text[])   SECURITY DEFINER;
ALTER FUNCTION public.get_anp_cdp_depletion_scatter(text[])           SECURITY DEFINER;

ALTER FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[])
  SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_cdp_bsw_scatter(text[])
  SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_cdp_depletion_field_aggregate(text[])
  SET search_path = public, pg_temp;
ALTER FUNCTION public.get_anp_cdp_depletion_scatter(text[])
  SET search_path = public, pg_temp;


-- ── B. Other CDP RPCs that read from anp_cdp_producao (RLS authed-only) ────

ALTER FUNCTION public.get_anp_cdp_aggregated(
    text[], text[], text[], text[], text[], text[], text[], text[], integer, integer, text[]
) SECURITY DEFINER;
ALTER FUNCTION public.get_anp_cdp_aggregated(
    text[], text[], text[], text[], text[], text[], text[], text[], integer, integer, text[]
) SET search_path = public, pg_temp;

ALTER FUNCTION public.get_anp_cdp_export_count(
    text[], text[], text[], text[], text[], text[], text[], text[], integer, integer
) SECURITY DEFINER;
ALTER FUNCTION public.get_anp_cdp_export_count(
    text[], text[], text[], text[], text[], text[], text[], text[], integer, integer
) SET search_path = public, pg_temp;


-- ── C. get_ms_export_count -- reads `vendas` (authed-only RLS) ─────────────

ALTER FUNCTION public.get_ms_export_count(text, text, text[], text[], text[])
  SECURITY DEFINER;
ALTER FUNCTION public.get_ms_export_count(text, text, text[], text[], text[])
  SET search_path = public, pg_temp;


-- ── D. ANP prices export count (works today but transitively; harden anyway) ─

ALTER FUNCTION public.get_anp_prices_export_count(text[], text[], text[], date, date)
  SECURITY DEFINER;
ALTER FUNCTION public.get_anp_prices_export_count(text[], text[], text[], date, date)
  SET search_path = public, pg_temp;


-- ── E. /imports-exports SQL RPCs (work today by anon policy; harden) ───────

ALTER FUNCTION public.get_imports_exports_filtros() SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_filtros() SET search_path = public, pg_temp;

ALTER FUNCTION public.get_imports_exports_paises_stacked(text, integer, integer, integer)
  SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_paises_stacked(text, integer, integer, integer)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.get_imports_exports_importers_stacked(text, integer, integer, integer)
  SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_importers_stacked(text, integer, integer, integer)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.get_imports_exports_fob_price_serie(text, integer, integer)
  SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_fob_price_serie(text, integer, integer)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.get_imports_exports_yoy_table(text, text, integer, integer, integer)
  SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_yoy_table(text, text, integer, integer, integer)
  SET search_path = public, pg_temp;

COMMIT;
