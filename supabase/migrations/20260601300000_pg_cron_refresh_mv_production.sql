-- ────────────────────────────────────────────────────────────────────────────
-- pg_cron schedule for public.refresh_mv_production() + immediate refresh
-- ────────────────────────────────────────────────────────────────────────────
--
-- HISTORY (why pg_cron is the 4th attempt):
--   1) Trigger AFTER STATEMENT on field_stakes calling refresh_mv_production()
--      → PostgREST API gateway timeout (~60-120s); MV refresh takes ~10 min.
--   2) Client-side `client.rpc("refresh_mv_production").execute()` from ETL via
--      supabase-py → same gateway timeout.
--   3) `supabase db query --linked --file ...` inside a GHA workflow → Cloudflare
--      524 in ~128s (the CLI db query path also fronts through Cloudflare).
--
-- The ONLY historically reliable call path is `supabase db push` running this
-- file, which goes through the direct pooler (no Cloudflare, no PostgREST).
-- That's how migration 20260601100000 (since reverted) managed a successful
-- 10-min inline REFRESH. Same path here.
--
-- pg_cron runs jobs inside a Postgres background worker — zero HTTP, zero
-- gateway, zero client-side timeout. Interval of 15 minutes is the trade-off
-- between admin-edit visibility lag (≤15 min) and cost (each refresh ≈10 min,
-- leaving ~5 min of breathing room between ticks).
--
-- If pg_cron is not enabled on this project, this migration fails wholesale —
-- accepted. CTO investigates and enables via Dashboard, then re-runs deploy.
-- ────────────────────────────────────────────────────────────────────────────

-- The final SELECT public.refresh_mv_production() at the bottom takes ~10 min.
-- Lift the per-statement timeout for this transaction only.
SET LOCAL statement_timeout = 0;

-- Supabase ships pg_cron in the `extensions` schema by convention.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- ────────────────────────────────────────────────────────────────────────────
-- Schedule the 15-minute periodic refresh (idempotent).
-- cron.schedule returns the jobid and inserts into cron.job; we guard with
-- NOT EXISTS so re-running the migration is safe.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'refresh_mv_production_periodic'
  ) THEN
    PERFORM cron.schedule(
      'refresh_mv_production_periodic',
      '*/15 * * * *',
      $cron$SELECT public.refresh_mv_production()$cron$
    );
  END IF;
END
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Document the function so future readers understand the call topology.
-- ────────────────────────────────────────────────────────────────────────────
COMMENT ON FUNCTION public.refresh_mv_production() IS
  'Refreshes 5 production MVs (mv_production_monthly, mv_production_installation_monthly, '
  'mv_brazil_monthly, mv_brazil_canonical_monthly, mv_brazil_installation_monthly) '
  'CONCURRENTLY. Total runtime ≈10 min. '
  'PRIMARY CALL SITE: pg_cron job "refresh_mv_production_periodic" every 15 min — '
  'see migration 20260601300000. DO NOT invoke from client-side RPC via PostgREST '
  '(times out at gateway ~60-120s) nor from the supabase CLI `db query` path '
  '(Cloudflare 524 at ~128s). Only callable as service_role; admin edits to '
  'field_stakes become visible after the next cron tick (≤15 min lag).';

-- ────────────────────────────────────────────────────────────────────────────
-- Immediate refresh — resolves current state (e.g. recent Peregrino stake edits)
-- without waiting for the first cron tick.
-- ────────────────────────────────────────────────────────────────────────────
SELECT public.refresh_mv_production();
