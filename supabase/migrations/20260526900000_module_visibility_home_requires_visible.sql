-- =============================================================================
-- 20260526900000_module_visibility_home_requires_visible.sql
--
-- Adds a second domain invariant to public.module_visibility:
--
--   is_visible_on_home = TRUE  =>  (is_visible_for_public = TRUE
--                                   OR is_visible_for_clients = TRUE)
--
-- Equivalently:
--   (is_visible_for_public = FALSE AND is_visible_for_clients = FALSE)
--     =>  is_visible_on_home := FALSE
--
-- Rationale: the /home gallery card has no audience to render to when both
-- visibility axes are closed. Showing it under those conditions is a UX bug —
-- the card opens to a "not allowed" redirect for every viewer. Enforcing the
-- rule in the schema means the Admin Panel UI cannot drift out of sync with
-- access rules and service-role direct DML is bounded too.
--
-- Pattern mirrors the existing invariant `public => clients` (migration
-- 20260522000001), keeping a single self-healing-trigger style across the
-- table:
--
--   1. Pre-clean any row that already violates the invariant (auto-heal in
--      one DML statement BEFORE the CHECK is added, otherwise the migration
--      would fail on existing data).
--   2. CHECK constraint as defense-in-depth (catches pathological INSERTs
--      that bypass triggers, e.g. via COPY or REPLICA).
--   3. BEFORE INSERT/UPDATE trigger that coerces home := FALSE rather than
--      raising — same UX as the public/clients trigger (silent normalization).
--
-- Idempotency: DROP CONSTRAINT IF EXISTS, DROP TRIGGER IF EXISTS, CREATE OR
-- REPLACE FUNCTION. Safe to re-run.
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. Auto-heal: clear is_visible_on_home for rows currently violating the rule.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Run BEFORE adding the CHECK constraint. Without this, ADD CONSTRAINT would
-- fail on any pre-existing offending row.

UPDATE public.module_visibility
SET is_visible_on_home = FALSE,
    updated_at         = NOW()
WHERE is_visible_on_home
  AND NOT is_visible_for_public
  AND NOT is_visible_for_clients;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. CHECK constraint: home requires at least one audience.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- (NOT home) OR public OR clients
-- ≡  home => (public OR clients)
-- ≡  (NOT public AND NOT clients) => NOT home

DO $constraint$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'module_visibility_home_requires_visible_chk'
      AND conrelid = 'public.module_visibility'::regclass
  ) THEN
    ALTER TABLE public.module_visibility
      DROP CONSTRAINT module_visibility_home_requires_visible_chk;
  END IF;

  ALTER TABLE public.module_visibility
    ADD CONSTRAINT module_visibility_home_requires_visible_chk
    CHECK (
      (NOT is_visible_on_home)
      OR is_visible_for_public
      OR is_visible_for_clients
    );
END
$constraint$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. BEFORE INSERT/UPDATE trigger: coerce home := FALSE when no audience.
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Self-healing semantics mirror the existing public/clients trigger:
-- silently normalize the row rather than raise. The CHECK above is the safety
-- net for any caller that bypasses the trigger (replica, COPY, etc.).
--
-- Ordering note: this trigger runs alongside
-- trg_module_visibility_public_implies_clients. Both are BEFORE row triggers;
-- Postgres fires BEFORE triggers in alphabetical order by trigger name. The
-- public/clients trigger ('trg_module_visibility_public_implies_clients')
-- runs BEFORE this one ('trg_module_visibility_home_requires_visible')
-- because 'h' < 'p' — wait, alphabetically 'home' < 'public', so OUR trigger
-- runs first. That ordering is correct: if a caller writes
-- (public=TRUE, clients=FALSE, home=TRUE) and clients should be coerced
-- before we evaluate the home rule, we'd be reading the un-coerced clients.
-- However, our rule only NEEDS the original values: home=TRUE is allowed
-- because public=TRUE is already TRUE in NEW. So order does not matter for
-- correctness here — both triggers read NEW.is_visible_for_public /
-- NEW.is_visible_for_clients as provided, and our coercion is a one-way
-- forcing of home to FALSE when neither audience is set.

CREATE OR REPLACE FUNCTION public.module_visibility_enforce_home_requires_visible()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_visible_on_home IS TRUE
     AND NEW.is_visible_for_public IS NOT TRUE
     AND NEW.is_visible_for_clients IS NOT TRUE
  THEN
    NEW.is_visible_on_home := FALSE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_module_visibility_home_requires_visible
  ON public.module_visibility;

CREATE TRIGGER trg_module_visibility_home_requires_visible
  BEFORE INSERT OR UPDATE
  ON public.module_visibility
  FOR EACH ROW
  EXECUTE FUNCTION public.module_visibility_enforce_home_requires_visible();


-- =============================================================================
-- End of migration 20260526900000_module_visibility_home_requires_visible.sql
-- =============================================================================
