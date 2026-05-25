-- News Hunter — propagate `match_type` when seeding a new user's keyword list.
--
-- Context:
--   `news_hunter_default_keywords` carries `match_type` since 20260525260000
--   (renamed from 20260525250000 to dodge a slot collision). `news_hunter_keywords`
--   itself has carried `match_type` since 20260520000001. The seed function
--   `seed_my_news_hunter_keywords()` (last touched in 20260522000001 ~line 768)
--   still copies only `keyword` from the default set, so new users start with
--   every seed flagged as 'substring' regardless of the admin's configuration.
--
-- Fix:
--   Drop and recreate the function so the INSERT propagates `d.match_type`.
--   Signature, return type, security context, search_path and grant surface
--   are preserved verbatim.
--
-- Idempotency:
--   DROP FUNCTION IF EXISTS is used because we keep CREATE OR REPLACE-safe
--   shape but want a guaranteed clean state in case past migrations left a
--   variant signature behind. The grant is re-issued at the bottom.

DROP FUNCTION IF EXISTS public.seed_my_news_hunter_keywords();

CREATE FUNCTION public.seed_my_news_hunter_keywords()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.news_hunter_keywords (user_id, keyword, match_type)
  SELECT uid, d.keyword, d.match_type
  FROM public.news_hunter_default_keywords d
  ON CONFLICT (user_id, keyword) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_my_news_hunter_keywords() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seed_my_news_hunter_keywords() FROM anon;
GRANT EXECUTE ON FUNCTION public.seed_my_news_hunter_keywords() TO authenticated;

-- =============================================================================
-- End of migration 20260525270000_seed_propagates_match_type.sql
-- =============================================================================
