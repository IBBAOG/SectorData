-- ─────────────────────────────────────────────────────────────────────────────
-- audit_anon_grants.sql
--
-- Pegadinha #18 guard (CLAUDE.md).  Run by supabase_deploy.yml AFTER
-- `supabase db push` to fail the workflow when any public.get_* RPC is
-- missing SECURITY DEFINER and/or EXECUTE grant to anon.
--
-- Why this exists: RPCs LANGUAGE sql/plpgsql STABLE without SECURITY DEFINER
-- run as the caller, so the anon role hits RLS on tables whose policies only
-- allow `authenticated`.  The dashboard sees empty results (try/catch in the
-- frontend swallows the error → []), the loading spinner spins forever, and
-- nobody notices for days.  This pattern has been re-introduced 4 times in
-- 6 weeks (typically via DROP+CREATE FUNCTION that loses grants AND attrs).
--
-- Behaviour:
--   * Lists every violation (function_signature, is_security_definer,
--     has_anon_grant, has_authenticated_grant, violation_type).
--   * RAISE EXCEPTION on count >= 1 → CI turns red.
--
-- Whitelist: RPCs that are intentionally admin-only / authenticated-only.
-- Add a function name here ONLY if it is provably not consumed by anon.
-- The `admin_%` family is excluded by name pattern (admin RPCs MUST require
-- auth).  Keep this list short and reviewed.
--
-- Reference: docs/supabase/PRD.md § "Pre-deploy anon grants audit".
--
-- Created: 2026-05-28
-- ─────────────────────────────────────────────────────────────────────────────

DO $audit$
DECLARE
  v_count   INT;
  v_row     RECORD;
  v_report  TEXT := '';
BEGIN
  CREATE TEMP TABLE _anon_grant_violations ON COMMIT DROP AS
  WITH whitelist(proname) AS (
    VALUES
      ('get_analytics_anon_summary'),
      ('get_analytics_by_dashboard'),
      ('get_analytics_by_user'),
      ('get_analytics_heatmap'),
      ('get_analytics_kpis'),
      ('get_analytics_user_timeline'),
      ('get_candidate_trail'),
      ('get_nd_unresolved')
  )
  SELECT
    p.oid::regprocedure::text AS function_signature,
    p.prosecdef AS is_security_definer,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS has_anon_grant,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS has_authenticated_grant,
    CASE
      WHEN NOT p.prosecdef AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        THEN 'missing_security_definer_and_anon_grant'
      WHEN NOT p.prosecdef
        THEN 'missing_security_definer'
      WHEN NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        THEN 'missing_anon_grant'
    END AS violation_type
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'get\_%' ESCAPE '\'
    AND p.proname NOT LIKE 'admin\_%' ESCAPE '\'
    AND p.proname NOT IN (SELECT proname FROM whitelist)
    AND (
      p.prosecdef = false
      OR NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    )
  ORDER BY p.proname;

  SELECT COUNT(*) INTO v_count FROM _anon_grant_violations;

  IF v_count = 0 THEN
    RAISE NOTICE 'Pegadinha #18 audit: PASS (no public.get_* RPCs missing SECURITY DEFINER / anon grant).';
    RETURN;
  END IF;

  v_report := format(E'\n=== Pegadinha #18 audit: %s violation(s) detected ===\n', v_count);
  FOR v_row IN SELECT * FROM _anon_grant_violations LOOP
    v_report := v_report || format(
      E'  - %s | security_definer=%s | anon_grant=%s | authenticated_grant=%s | %s\n',
      v_row.function_signature,
      v_row.is_security_definer,
      v_row.has_anon_grant,
      v_row.has_authenticated_grant,
      v_row.violation_type
    );
  END LOOP;

  RAISE EXCEPTION E'%\nSee docs/supabase/PRD.md § "Pre-deploy anon grants audit" and CLAUDE.md Pegadinha #18 for fix recipe (re-apply SECURITY DEFINER + SET search_path + GRANT EXECUTE TO anon, authenticated).',
    v_report;
END
$audit$;
