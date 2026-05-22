-- =============================================================================
-- 20260522000002_anonymous_default_closed.sql
--
-- Phase A follow-up — close the default visibility for anonymous visitors.
--
-- Context:
--   The previous migration (20260522000001_anonymous_access.sql) added the
--   column `module_visibility.is_visible_for_public` with DEFAULT TRUE, which
--   would expose every existing dashboard to anonymous visitors on deploy.
--
--   However, only the `/stocks` and `/news-hunter` dashboards have been
--   adapted to run safely under the anon role (public-portfolio surface and
--   default-keyword flow, respectively). All other dashboards rely on RPCs
--   granted only to the `authenticated` role; anonymous callers would hit
--   "permission denied" silently and see empty pages.
--
-- Decision (per CTO):
--   Admin opt-in per-module via the /admin-panel Permissions tab when each
--   dashboard is verified anon-safe. Default = closed for both new and
--   existing modules.
--
-- Operations:
--   1. ALTER COLUMN default: TRUE -> FALSE. New rows inserted by future
--      `INSERT INTO module_visibility VALUES ('<slug>', true)` onboarding
--      flows will land closed-to-public by default; Admin opens explicitly.
--   2. UPDATE existing rows: every module except `/stocks` and `/news-hunter`
--      is set to is_visible_for_public = FALSE.
--
-- Idempotency:
--   * Step 1 is naturally idempotent (SET DEFAULT to a fixed value).
--   * Step 2 uses `IS DISTINCT FROM FALSE` so re-running is a no-op on rows
--     already set to FALSE.
--
-- No effect on:
--   * `is_visible_for_clients` (Client tier — untouched)
--   * `is_visible_on_home`     (Home gallery axis — untouched)
--   * The CHECK constraint `module_visibility_public_implies_clients_chk`
--     (setting public=FALSE always satisfies "NOT (public AND NOT clients)")
--   * The BEFORE INSERT/UPDATE trigger (only fires when setting public=TRUE
--     while clients=FALSE — n/a here)
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Default for future inserts: FALSE (closed)
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.module_visibility
  ALTER COLUMN is_visible_for_public SET DEFAULT FALSE;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. Close existing rows, except the two adapted dashboards
-- ══════════════════════════════════════════════════════════════════════════════

UPDATE public.module_visibility
SET    is_visible_for_public = FALSE
WHERE  module_slug NOT IN ('stocks', 'news-hunter')
  AND  is_visible_for_public IS DISTINCT FROM FALSE;
