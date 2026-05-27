-- ─── Auto-refresh mv_production_* on field_stakes changes ────────────────────
-- Context: /well-by-well dashboard reads from 3 materialized views created in
-- 20260528400000_well_by_well_perf_mv.sql. Two of them (mv_production_monthly,
-- mv_production_installation_monthly) pre-join anp_cdp_producao × field_stakes
-- with stake-weighted math. When the Admin edits stakes via /admin-panel
-- (admin_upsert_field_stakes / admin_delete_field_stakes), the MVs go stale and
-- the dashboard keeps showing the old snapshot until the next CDP ETL run
-- triggers refresh_mv_production().
--
-- Real-world incident: stake for Prio @ Peregrino was changed 40 → 80; dashboard
-- kept showing the old company-aggregated production for hours.
--
-- Fix: STATEMENT-level AFTER trigger on field_stakes that fires
-- refresh_mv_production() once per statement (not once per row). This matters
-- because admin_upsert_field_stakes does a DELETE+INSERT atomic replace of N
-- rows per campo — row-level would fire N times.
--
-- Refresh is synchronous (REFRESH CONCURRENTLY, allows concurrent reads but
-- can take a few seconds for mv_production_monthly which scans ~2M rows of
-- anp_cdp_producao). Acceptable here: admin stake edits are rare, and the
-- admin-panel UX can surface a "saving..." spinner. No pg_notify / async —
-- over-engineering for the access pattern.
--
-- Timeout handling: this migration disables statement_timeout for its own
-- transaction (the in-deploy refresh of ~2M rows blows past the supabase CLI
-- default of 120s), and pins a 15min per-function timeout on the trigger so
-- admin-edit refreshes survive even when the user session has a tight timeout.

-- Supabase CLI default statement_timeout (~120s) cannot cover the in-deploy
-- refresh of mv_production_monthly (~2M rows). Lift it for this transaction
-- only; rolled back automatically at COMMIT.
SET LOCAL statement_timeout = 0;

-- ───── (1) Trigger function ─────────────────────────────────────────────────
-- SECURITY DEFINER so it can call refresh_mv_production() (REVOKE'd from
-- anon/authenticated; only service_role + this function's owner can execute).
-- SET search_path per Pegadinha #18 (otherwise schema injection risk).
-- SET statement_timeout = '15min' per-function so REFRESH CONCURRENTLY has
-- room to finish even when the caller's session timeout is tight (admin RPC
-- calls inherit the API user's session settings). CONCURRENTLY is kept here
-- because at admin-edit time there can be a concurrent reader (the dashboard
-- UI is likely loading while the save fires).
CREATE OR REPLACE FUNCTION public.field_stakes_refresh_mv_trigger()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  SET statement_timeout = '15min'
  AS $$
  BEGIN
    PERFORM public.refresh_mv_production();
    RETURN NULL;  -- STATEMENT-level AFTER triggers ignore the return value
  END;
  $$;

-- Lock down callability — refresh_mv_production() itself is locked down to
-- service_role; this wrapper inherits the same risk surface, so mirror it.
REVOKE ALL ON FUNCTION public.field_stakes_refresh_mv_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_stakes_refresh_mv_trigger() TO service_role;

-- ───── (2) Trigger on field_stakes ──────────────────────────────────────────
-- STATEMENT-level: one refresh per multi-row DML, not per row. The admin RPCs
-- batch-mutate (atomic DELETE+INSERT for upsert of a single campo's full stake
-- set), so this collapses what would be N row triggers into 1 refresh.
DROP TRIGGER IF EXISTS field_stakes_refresh_mv ON public.field_stakes;

CREATE TRIGGER field_stakes_refresh_mv
  AFTER INSERT OR UPDATE OR DELETE ON public.field_stakes
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.field_stakes_refresh_mv_trigger();

-- ───── (3) Immediate one-time refresh during deploy ─────────────────────────
-- Resolves the current Peregrino discrepancy (and any other stale-stake state
-- accumulated since 20260528400000) without requiring manual operator action.
-- This runs as the migration deployer (service_role), so the function's
-- REVOKE on anon/authenticated is irrelevant.
--
-- Use non-CONCURRENT REFRESH here: during deploy there is no reader to
-- protect, and non-CONCURRENT is 2-3x faster than CONCURRENTLY. Trade-off
-- accepted. Runtime refreshes (via the trigger above) still use CONCURRENTLY
-- through refresh_mv_production().
REFRESH MATERIALIZED VIEW public.mv_brazil_monthly;
REFRESH MATERIALIZED VIEW public.mv_production_monthly;
REFRESH MATERIALIZED VIEW public.mv_production_installation_monthly;
