-- =============================================================================
-- 20260525170000_anp_cdp_restore_grants.sql
--
-- Follow-up to 20260525160000_anp_cdp_drop_condensate_assoc_gas_royalties.sql.
--
-- That prior migration ran DROP FUNCTION ... CASCADE + CREATE FUNCTION on two
-- RPCs to remove 4 dropped metric columns from their RETURNS TABLE:
--   - get_anp_cdp_poco_serie(text[],text[],text[],text[],text[],text[],text[],text[],integer,integer)
--   - get_anp_cdp_aggregated(text[],text[],text[],text[],text[],text[],text[],text[],integer,integer,text[])
--
-- The DROP+CREATE sequence wipes all grants. Unlike CREATE OR REPLACE, the
-- recreated function inherits only the Postgres defaults (EXECUTE TO PUBLIC).
--
-- Audit of the prior migration:
--   - get_anp_cdp_poco_serie: prior migrations (20260504000007 .. 20260514100000)
--     never issued any explicit GRANT or REVOKE. The function always relied on
--     the default PUBLIC grant. Post-DROP+CREATE it still has the default
--     PUBLIC grant -- no functional regression. We add an explicit grant to
--     anon, authenticated anyway, matching the house rule from
--     docs/supabase/PRD.md "Pegadinhas (d)": "sempre que a migration drop-and-
--     recreate uma RPC publica, anexe GRANT EXECUTE ... TO anon, authenticated
--     no final, mesmo que pareca redundante". This makes the ACL explicit and
--     guards against any future REVOKE PUBLIC sweep stripping access silently.
--
--   - get_anp_cdp_aggregated: prior migration 20260507000004 ended with
--     GRANT EXECUTE ... TO authenticated (no anon, no REVOKE). The
--     20260525160000 follow-up re-issues that same GRANT TO authenticated,
--     so authenticated is preserved. anon was implicitly covered by the
--     PUBLIC default both before and after -- still no regression. We make
--     the anon grant explicit for the same reason as poco_serie above.
--
-- This migration is grant-only: no DDL on function bodies, no policy changes,
-- no column work. Safe to re-run (GRANT is idempotent).
-- =============================================================================

BEGIN;

-- get_anp_cdp_poco_serie (10 text[]/integer params)
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_poco_serie(
    text[], text[], text[], text[], text[], text[], text[], text[], integer, integer
) TO anon, authenticated;

-- get_anp_cdp_aggregated (11 params; ends with text[] for p_group_by)
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_aggregated(
    text[], text[], text[], text[], text[], text[], text[], text[], integer, integer, text[]
) TO anon, authenticated;

COMMIT;
