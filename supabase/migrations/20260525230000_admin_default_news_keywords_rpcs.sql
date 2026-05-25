-- Admin RPCs for CRUD over public.news_hunter_default_keywords
--
-- Context:
--   - news_hunter_default_keywords is the seed list used by anonymous /news-hunter visitors.
--   - Table already has a SELECT policy open to anon + authenticated (read is public).
--   - Writes are exclusively performed by these SECURITY DEFINER RPCs — no INSERT/DELETE policies exist.
--
-- Pattern:
--   - SECURITY DEFINER + SET search_path = public.
--   - Inline admin gate via public.is_admin() (and MFA via public.require_admin_mfa()).
--   - REVOKE ALL FROM PUBLIC, GRANT EXECUTE TO authenticated.
--   - Audit each mutation via direct INSERT into public.app_events.
--     (public.track_event() validates event_type against {login,page_view,export}
--      only; the app_events CHECK constraint additionally allows 'admin.%', so
--      admin RPCs must INSERT directly — same pattern used by the existing
--      admin.set_module_visibility / admin.set_module_public_visibility writers.)

-- =============================================================================
-- LIST
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_list_default_news_keywords()
RETURNS TABLE (
  keyword     TEXT,
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
    SELECT k.keyword, k.created_at
    FROM public.news_hunter_default_keywords k
    ORDER BY k.keyword ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_default_news_keywords() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_default_news_keywords() TO authenticated;

-- =============================================================================
-- ADD
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_add_default_news_keyword(p_keyword TEXT)
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

  INSERT INTO public.news_hunter_default_keywords (keyword)
  VALUES (v_keyword)
  ON CONFLICT (keyword) DO NOTHING;

  INSERT INTO public.app_events (user_id, visitor_id, event_type, route, payload)
  VALUES (
    auth.uid(),
    NULL,
    'admin.add_default_news_keyword',
    '/admin-panel',
    jsonb_build_object('keyword', v_keyword)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_default_news_keyword(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_add_default_news_keyword(TEXT) TO authenticated;

-- =============================================================================
-- REMOVE
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_remove_default_news_keyword(p_keyword TEXT)
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
GRANT EXECUTE ON FUNCTION public.admin_remove_default_news_keyword(TEXT) TO authenticated;
