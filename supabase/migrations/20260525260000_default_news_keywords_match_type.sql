-- News Hunter — add `match_type` column to default (seed) keywords list.
--
-- Migration slot note: originally drafted as 20260525240000, then renamed to
-- 20260525250000 to dodge a clash with `harden_alerts_trigger_search_path`.
-- After mergeback, slot 250000 was found to also collide with the file
-- `20260525250000_alerts_module_visibility.sql` produced by a parallel session.
-- Renamed once more to 20260525260000 (next free slot above 250000) to keep
-- both migrations coexisting without violating the PK on
-- supabase_migrations.schema_migrations. The migration body itself was already
-- applied to the cloud DB under the prior version; this rename only fixes the
-- filename + schema_migrations.version pairing (Regra E).
--
-- Motivation:
--   Per-user `news_hunter_keywords` already carries `match_type` (substring|exact)
--   since 20260520000001. The system-wide seed list (`news_hunter_default_keywords`,
--   surfaced to anonymous /news-hunter visitors and used to bootstrap new users)
--   was inconsistent — it stored only the keyword text. This migration brings the
--   default list to parity so admins can flip individual seed keywords to
--   whole-word matching, and the scanner repo can route matching per-keyword
--   regardless of whether the keyword originated from a user or the default set.
--
-- Schema:
--   text enum, mirroring news_hunter_keywords:
--     'substring' (default, current behaviour)
--     'exact'     (whole word, word-boundary \b{keyword}\b case-insensitive)
--
-- Backward-compat contract:
--   - get_default_news_keywords() RETURNS text[] is UNCHANGED. The frontend
--     (NewsHunterContext.tsx) consumes that signature and any change there
--     would be a breaking contract.
--   - A new get_default_news_keywords_with_flags() returns (keyword, match_type)
--     so the scanner repo and future consumers can opt into the richer payload.
--
-- RPC changes:
--   - admin_list_default_news_keywords()       -> returns (keyword, match_type, created_at)
--   - admin_add_default_news_keyword(...)      -> adds optional p_match_type, default 'substring'
--   - admin_set_default_news_keyword_match_type(...)  -> NEW, admin-only flip
--   - admin_remove_default_news_keyword(...)   -> unchanged signature, dropped+recreated for idempotency
--   - get_default_news_keywords()              -> UNCHANGED (preserved)
--   - get_default_news_keywords_with_flags()   -> NEW, anon + authenticated access

-- =============================================================================
-- 1. Column + CHECK constraint
-- =============================================================================

ALTER TABLE public.news_hunter_default_keywords
  ADD COLUMN IF NOT EXISTS match_type TEXT NOT NULL DEFAULT 'substring';

ALTER TABLE public.news_hunter_default_keywords
  DROP CONSTRAINT IF EXISTS news_hunter_default_keywords_match_type_check;

ALTER TABLE public.news_hunter_default_keywords
  ADD CONSTRAINT news_hunter_default_keywords_match_type_check
  CHECK (match_type IN ('substring', 'exact'));

COMMENT ON COLUMN public.news_hunter_default_keywords.match_type IS
  'How the keyword should match article text. ''substring'' (default): case-insensitive substring match. ''exact'': case-insensitive word-boundary match (\b{keyword}\b).';

-- =============================================================================
-- 2. admin_list_default_news_keywords() — return match_type too
-- =============================================================================
-- DROP first because the return signature changes (cannot CREATE OR REPLACE
-- across return type changes).

DROP FUNCTION IF EXISTS public.admin_list_default_news_keywords();

CREATE FUNCTION public.admin_list_default_news_keywords()
RETURNS TABLE (
  keyword     TEXT,
  match_type  TEXT,
  created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM public.require_admin_mfa();

  RETURN QUERY
    SELECT k.keyword, k.match_type, k.created_at
    FROM public.news_hunter_default_keywords k
    ORDER BY k.keyword ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_default_news_keywords() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_default_news_keywords() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_default_news_keywords() TO authenticated;

-- =============================================================================
-- 3. admin_add_default_news_keyword(p_keyword, p_match_type)
-- =============================================================================
-- DROP first because parameter list changes.

DROP FUNCTION IF EXISTS public.admin_add_default_news_keyword(TEXT);

CREATE FUNCTION public.admin_add_default_news_keyword(
  p_keyword     TEXT,
  p_match_type  TEXT DEFAULT 'substring'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keyword     TEXT;
  v_match_type  TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM public.require_admin_mfa();

  v_keyword := trim(COALESCE(p_keyword, ''));
  IF v_keyword = '' THEN
    RAISE EXCEPTION 'keyword must not be empty'
      USING ERRCODE = '22023';
  END IF;

  v_match_type := COALESCE(p_match_type, 'substring');
  IF v_match_type NOT IN ('substring', 'exact') THEN
    RAISE EXCEPTION 'match_type must be one of (substring, exact), got %', v_match_type
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.news_hunter_default_keywords (keyword, match_type)
  VALUES (v_keyword, v_match_type)
  ON CONFLICT (keyword) DO NOTHING;

  INSERT INTO public.app_events (user_id, visitor_id, event_type, route, payload)
  VALUES (
    auth.uid(),
    NULL,
    'admin.add_default_news_keyword',
    '/admin-panel',
    jsonb_build_object('keyword', v_keyword, 'match_type', v_match_type)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_default_news_keyword(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_add_default_news_keyword(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_add_default_news_keyword(TEXT, TEXT) TO authenticated;

-- =============================================================================
-- 4. admin_set_default_news_keyword_match_type(p_keyword, p_match_type)  -- NEW
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_set_default_news_keyword_match_type(
  p_keyword     TEXT,
  p_match_type  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keyword     TEXT;
  v_match_type  TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM public.require_admin_mfa();

  v_keyword := trim(COALESCE(p_keyword, ''));
  IF v_keyword = '' THEN
    RAISE EXCEPTION 'keyword must not be empty'
      USING ERRCODE = '22023';
  END IF;

  v_match_type := COALESCE(p_match_type, '');
  IF v_match_type NOT IN ('substring', 'exact') THEN
    RAISE EXCEPTION 'match_type must be one of (substring, exact), got %', v_match_type
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.news_hunter_default_keywords
  SET match_type = v_match_type
  WHERE keyword = v_keyword;

  INSERT INTO public.app_events (user_id, visitor_id, event_type, route, payload)
  VALUES (
    auth.uid(),
    NULL,
    'admin.set_default_news_keyword_match_type',
    '/admin-panel',
    jsonb_build_object('keyword', v_keyword, 'match_type', v_match_type)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_default_news_keyword_match_type(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_default_news_keyword_match_type(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_default_news_keyword_match_type(TEXT, TEXT) TO authenticated;

-- =============================================================================
-- 5. admin_remove_default_news_keyword(p_keyword) -- unchanged signature
-- =============================================================================
-- Re-declared here only because the original migration is in the chain; we
-- DROP+CREATE for idempotency and explicit ownership. Behaviour identical.

DROP FUNCTION IF EXISTS public.admin_remove_default_news_keyword(TEXT);

CREATE FUNCTION public.admin_remove_default_news_keyword(p_keyword TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keyword TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  PERFORM public.require_admin_mfa();

  v_keyword := trim(COALESCE(p_keyword, ''));
  IF v_keyword = '' THEN
    RAISE EXCEPTION 'keyword must not be empty'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.news_hunter_default_keywords
  WHERE keyword = v_keyword;

  INSERT INTO public.app_events (user_id, visitor_id, event_type, route, payload)
  VALUES (
    auth.uid(),
    NULL,
    'admin.remove_default_news_keyword',
    '/admin-panel',
    jsonb_build_object('keyword', v_keyword)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_remove_default_news_keyword(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_remove_default_news_keyword(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_default_news_keyword(TEXT) TO authenticated;

-- =============================================================================
-- 6. get_default_news_keywords_with_flags() -- NEW, anon + authenticated
-- =============================================================================
-- get_default_news_keywords() RETURNS text[] is intentionally UNCHANGED.
-- This richer companion exposes match_type for the scanner repo and any
-- future consumer that needs per-keyword matching semantics.

CREATE OR REPLACE FUNCTION public.get_default_news_keywords_with_flags()
RETURNS TABLE (
  keyword     TEXT,
  match_type  TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT keyword, match_type
  FROM public.news_hunter_default_keywords
  ORDER BY keyword ASC;
$$;

REVOKE ALL ON FUNCTION public.get_default_news_keywords_with_flags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_default_news_keywords_with_flags() TO anon, authenticated;
