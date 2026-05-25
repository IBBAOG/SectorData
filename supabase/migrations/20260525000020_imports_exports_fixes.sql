-- =============================================================================
-- 20260525000020_imports_exports_fixes.sql
--
-- Post-merge fix wave for the Imports & Exports reform (merge range
-- 17b13f7a..39d444e7). Addresses three findings from worker_revisor-qa:
--
--   1. [BLOCKER] Add anon SELECT policy + GRANT on `anp_daie` and
--      `anp_desembaracos`. The reform set module_visibility.is_visible_for_public
--      = true for the `imports-exports` module, but the underlying tables still
--      restricted RLS to TO authenticated, so anonymous visitors silently saw
--      empty charts (RPCs returned 0 rows under anon role).
--
--      Pattern mirrors `20260522000001_anonymous_access.sql` § 10 (news_articles).
--
--   2. [HIGH] Add CHECK constraint on `importer_group_map.cnpj` enforcing the
--      14-digit, no-formatting invariant that `02_desembaracos_sync.py` already
--      relies on (`str.replace(r"\D", "", regex=True)`). Without this, future
--      hand-seeded rows with formatted CNPJs (e.g. '12.345.678/0001-90') would
--      silently miss the LEFT JOIN against `anp_desembaracos.cnpj`.
--
--      The sentinel value '__legacy__' is allowed for forward compatibility:
--      pre-reform rows in `anp_desembaracos` already carry it, and future
--      debug/audit rows in `importer_group_map` may need to reference it.
--
-- Note: finding #2 of the revisor (smoke-test stale assertion) is handled in
-- the same commit as a direct edit to `supabase/tests/migration_smoke.sql` —
-- it is NOT executed as part of this migration.
--
-- All operations idempotent: DO $$ guards on CREATE POLICY (re-runnable even
-- if a partial state exists from a prior attempt); ADD CONSTRAINT IF NOT EXISTS
-- pattern via pg_constraint lookup.
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. [BLOCKER] anon SELECT policy + GRANT on anp_daie
-- ══════════════════════════════════════════════════════════════════════════════

DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'anp_daie'
      AND policyname = 'anon read anp_daie'
  ) THEN
    CREATE POLICY "anon read anp_daie" ON public.anp_daie
      FOR SELECT TO anon USING (true);
  END IF;
END
$policy$;

GRANT SELECT ON public.anp_daie TO anon;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. [BLOCKER] anon SELECT policy + GRANT on anp_desembaracos
-- ══════════════════════════════════════════════════════════════════════════════

DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'anp_desembaracos'
      AND policyname = 'anon read anp_desembaracos'
  ) THEN
    CREATE POLICY "anon read anp_desembaracos" ON public.anp_desembaracos
      FOR SELECT TO anon USING (true);
  END IF;
END
$policy$;

GRANT SELECT ON public.anp_desembaracos TO anon;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. [HIGH] CNPJ format invariant on importer_group_map
-- ══════════════════════════════════════════════════════════════════════════════
--
-- ETL pipeline `02_desembaracos_sync.py:194` normalizes CNPJ to digits-only.
-- This CHECK constraint mirrors that contract on the lookup-table side so any
-- hand-seeded row with a formatted CNPJ is rejected at write time rather than
-- silently failing the LEFT JOIN at read time.
--
-- '__legacy__' is whitelisted: pre-reform desembaracos rows use it as a
-- sentinel (see README § anp_desembaracos), and audit rows in importer_group_map
-- may legitimately want to map the sentinel.

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname  = 'importer_group_map_cnpj_format'
      AND conrelid = 'public.importer_group_map'::regclass
  ) THEN
    ALTER TABLE public.importer_group_map
      ADD CONSTRAINT importer_group_map_cnpj_format
      CHECK (cnpj ~ '^[0-9]{14}$' OR cnpj = '__legacy__');
  END IF;
END
$constraint$;

COMMENT ON COLUMN public.importer_group_map.cnpj IS
  'CNPJ stored as 14 digits, no formatting. Matches anp_desembaracos.cnpj normalization. Sentinel ''__legacy__'' is allowed for legacy rows.';


-- =============================================================================
-- End of migration 20260525000020_imports_exports_fixes.sql
-- =============================================================================
