-- =====================================================================
-- 20260529200000_align_match_type_with_eduardo.sql
-- =====================================================================
-- Purpose
--   Align match_type of replicated news_hunter_keywords rows with
--   Eduardo's personal configuration. Two prior backfills used
--   ON CONFLICT DO NOTHING, so rows that already existed kept their
--   stale match_type. This DML one-shot UPDATE syncs them.
--
-- Behaviour
--   For every (user_id, keyword) row in news_hunter_keywords where:
--     - keyword is present in Eduardo's personal list, and
--     - match_type differs from Eduardo's match_type for that keyword,
--     - user_id <> Eduardo's id
--   set match_type to Eduardo's value.
--
--   Keywords that a user added but that are NOT in Eduardo's list stay
--   untouched (user customisation preserved on that axis).
--
-- Source of truth
--   Eduardo's row in public.news_hunter_keywords at apply time. No
--   hardcoded keyword/match_type pairs — the DO block reads dynamically
--   so the migration reflects Eduardo's most current state.
--
-- Idempotency
--   Re-running with the database already aligned affects 0 rows.
--
-- Pre-validation (dry-run) showed 134 rows across 5 keywords / 38 users
-- (ANP, gas, gás, oil -> exact for 24 users each; Vibra -> exact for 38).
-- =====================================================================

DO $$
DECLARE
  v_eduardo_id uuid;
  v_rows_updated int;
BEGIN
  SELECT id INTO v_eduardo_id
  FROM auth.users
  WHERE email = 'eduardo.mendes@itaubba.com';

  IF v_eduardo_id IS NULL THEN
    RAISE EXCEPTION 'Eduardo user (eduardo.mendes@itaubba.com) not found in auth.users';
  END IF;

  WITH ed_kw AS (
    SELECT keyword, match_type AS ed_match_type
    FROM public.news_hunter_keywords
    WHERE user_id = v_eduardo_id
  )
  UPDATE public.news_hunter_keywords k
  SET match_type = e.ed_match_type
  FROM ed_kw e
  WHERE k.keyword = e.keyword
    AND k.match_type <> e.ed_match_type
    AND k.user_id <> v_eduardo_id;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RAISE NOTICE 'news_hunter_keywords match_type alignment: % rows updated', v_rows_updated;
END $$;
