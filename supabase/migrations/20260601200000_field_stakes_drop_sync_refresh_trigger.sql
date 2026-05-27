-- =====================================================================
-- 20260601200000_field_stakes_drop_sync_refresh_trigger.sql
-- =====================================================================
-- Reverts the synchronous refresh trigger installed by
-- 20260601100000_field_stakes_auto_refresh.sql.
--
-- Reason: the AFTER STATEMENT trigger on public.field_stakes invoked
-- refresh_mv_production() (REFRESH MATERIALIZED VIEW CONCURRENTLY on a
-- ~2M-row MV) inside the user-save transaction. Real-world refresh time
-- of 60-120s exceeded the Supabase API gateway cutoff, so the Admin
-- save in /admin-panel -> Field Stakes failed with
-- "canceling statement due to statement timeout" and the transaction
-- was rolled back. Setting statement_timeout inside the trigger did
-- not help because the gateway timeout is external to Postgres.
--
-- Refresh will be wired asynchronously into
-- scripts/pipelines/anp/cdp/02_upload.py instead -- that is the
-- originally-documented call site referenced by
-- 20260528400000 (well-by-well production MV scaffolding).
-- =====================================================================

SET LOCAL statement_timeout = 0;

DROP TRIGGER IF EXISTS field_stakes_refresh_mv ON public.field_stakes;

DROP FUNCTION IF EXISTS public.field_stakes_refresh_mv_trigger();
