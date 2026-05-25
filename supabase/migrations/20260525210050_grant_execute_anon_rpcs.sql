-- =============================================================================
-- 20260525210050_grant_execute_anon_rpcs.sql
--
-- Note: timestamp moved from 20260525210000 to 20260525210050 to avoid
-- collision with a parallel worktree's 20260525210000_alert_sources_subscribers.sql.
--
-- Restore GRANT EXECUTE TO anon, authenticated on RPCs that lost grants after
-- recent DROP/CREATE waves on the CDP BSW + Depletion families.
--
-- Context: smoke test of /anp-cdp-bsw returned 42501 "permission denied for
-- function get_anp_cdp_bsw_campos" (and siblings). Audit via pg_proc +
-- has_function_privilege identified exactly 6 RPCs missing the anon grant.
-- The functions exist and execute fine for service_role / authenticated --
-- only the anon role (used by the browser supabase-js client) was stripped.
--
-- Root cause hypothesis: a prior migration ran DROP FUNCTION ... CASCADE
-- followed by CREATE FUNCTION. Unlike CREATE OR REPLACE, the DROP+CREATE
-- sequence does NOT preserve grants -- they need to be reapplied explicitly.
-- (See docs/supabase/PRD.md "Pegadinhas" for the recurring pattern.)
--
-- This migration is grant-only: no DDL on function bodies, no policy changes.
-- Safe to re-run (GRANT is idempotent).
-- =============================================================================

BEGIN;

-- BSW family (/anp-cdp-bsw)
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_campos() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_scatter(text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[]) TO anon, authenticated;

-- Depletion family (/anp-cdp-depletion)
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_depletion_campos() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_depletion_scatter(text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_depletion_field_aggregate(text[]) TO anon, authenticated;

COMMIT;
