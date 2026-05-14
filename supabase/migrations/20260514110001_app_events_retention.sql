-- ─────────────────────────────────────────────────────────────────────────────
-- 20260514110001_app_events_retention.sql
--
-- F3.2: Retention policy for app_events (LGPD compliance).
--
-- Retention rules:
--   - Non-admin events (login, page_view, export): 12 months
--   - Admin audit events (admin.*):                5 years
--
-- Implementation: pg_cron weekly job (Sunday 03:00 UTC).
--
-- Notes:
--   - pg_cron must be enabled on the Supabase project (Pro plan).
--     The extension lives in the 'extensions' schema on Supabase hosted.
--     CREATE EXTENSION IF NOT EXISTS is idempotent.
--   - cron.schedule() is idempotent-ish: it raises if a job with the same
--     name already exists. We use cron.unschedule() first to make this
--     migration re-runnable.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Enable pg_cron (no-op if already installed) ─────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- ─── Remove previous job with same name (idempotency) ────────────────────────
SELECT cron.unschedule('app_events_cleanup')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'app_events_cleanup'
);

-- ─── Schedule weekly cleanup (Sunday 03:00 UTC) ──────────────────────────────
SELECT cron.schedule(
  'app_events_cleanup',
  '0 3 * * 0',
  $$
    DELETE FROM public.app_events
    WHERE
      (event_type NOT LIKE 'admin.%' AND created_at < now() - interval '12 months')
      OR
      (event_type LIKE 'admin.%' AND created_at < now() - interval '5 years');
  $$
);
