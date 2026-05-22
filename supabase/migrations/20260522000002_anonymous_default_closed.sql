-- =============================================================================
-- 20260522000002_anonymous_default_closed.sql
--
-- Phase A follow-up — seed the two anon-safe dashboards as public, and harden
-- the default-closed semantics for module_visibility.is_visible_for_public.
--
-- Context:
--   Migration 20260522000001 adds `module_visibility.is_visible_for_public`
--   with DEFAULT FALSE (closed). That choice keeps the CHECK invariant
--   "public ⇒ clients" trivially satisfied on existing rows and matches the
--   product decision below.
--
--   Only the `/stocks` and `/news-hunter` dashboards have been adapted to run
--   safely under the anon role (public-portfolio surface and default-keyword
--   flow, respectively). All other dashboards rely on RPCs granted only to
--   the `authenticated` role; anonymous callers would hit "permission denied"
--   silently and see empty pages, so they must remain closed until verified.
--
-- Decision (per CTO):
--   Admin opt-in per-module via the /admin-panel Permissions tab when each
--   dashboard is verified anon-safe. Default = closed for both new and
--   existing modules; only `/stocks` and `/news-hunter` ship open in this
--   wave.
--
-- Operations:
--   1. ALTER COLUMN default: re-affirm FALSE (idempotent — already FALSE from
--      000001, kept here as belt-and-suspenders so this file is a complete
--      statement of the desired state).
--   2. UPDATE existing rows: every module except `/stocks` and `/news-hunter`
--      is set to is_visible_for_public = FALSE. After 000001's DEFAULT FALSE
--      this is a no-op on a fresh apply, but stays for any environment that
--      already has rows flipped on.
--   3. UPDATE seed: open `/stocks` and `/news-hunter` to anonymous visitors.
--
-- Idempotency:
--   * Step 1 is naturally idempotent (SET DEFAULT to a fixed value).
--   * Steps 2 and 3 use `IS DISTINCT FROM` so re-running is a no-op on rows
--     already at the target value.
--
-- No effect on:
--   * `is_visible_for_clients` (Client tier — untouched)
--   * `is_visible_on_home`     (Home gallery axis — untouched)
--   * The CHECK constraint `module_visibility_public_implies_clients_chk`
--     (setting public=FALSE always satisfies "NOT (public AND NOT clients)";
--     the seed in step 3 is safe because both `/stocks` and `/news-hunter`
--     have is_visible_for_clients=TRUE, and the BEFORE trigger coerces it
--     anyway if not.)
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


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. Seed: open /stocks and /news-hunter to anonymous visitors
-- ══════════════════════════════════════════════════════════════════════════════
-- Seed: open /stocks and /news-hunter to anonymous visitors (only dashboards
-- adapted in this wave to render safely under the anon role). Other modules
-- stay closed; Admin opens them selectively via /admin-panel Permissions tab.
UPDATE public.module_visibility
SET is_visible_for_public = TRUE
WHERE module_slug IN ('stocks', 'news-hunter')
  AND is_visible_for_public IS DISTINCT FROM TRUE;
