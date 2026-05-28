-- =============================================================================
-- 20260602300000_admin_analytics_views_by_hour_pegadinha18.sql
--
-- Fix: grant EXECUTE on get_admin_analytics_views_by_hour(int) to anon as
-- well as authenticated, per Pegadinha #18 (every public RPC reading from
-- RLS-protected tables must be SECURITY DEFINER AND callable by anon to
-- avoid the silent-empty-result failure mode flagged by the deploy audit).
--
-- Background:
--   The RPC was created by migration 20260602000000 and re-created by
--   20260602200000 (BRT bucket rebuild). Both migrations explicitly
--   REVOKEd EXECUTE from anon based on the assumption that the inline
--   Admin guard (RAISE EXCEPTION 42501 for non-Admin callers) was the
--   only defense needed. However, the deploy audit step on
--   supabase_deploy.yml (run #26605655356) now enforces Pegadinha #18
--   uniformly: every public RPC in the get_*/admin_* family must be
--   SECURITY DEFINER + executable by anon AND authenticated.
--
-- Defense in depth is preserved: the inline Admin guard inside the
-- function body still raises 42501 for any non-Admin caller (anon
-- included), so granting EXECUTE to anon does not widen the data
-- surface — it just lets PostgREST route the call without a 403 at
-- the API gateway, surfacing the 42501 as a clean error instead of
-- the audit-flagged silent revoke.
--
-- The function body is unchanged. We only re-state SECURITY DEFINER +
-- search_path (already present) and add anon to the GRANT list.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_analytics_views_by_hour(
  p_period_days int DEFAULT 30
)
RETURNS TABLE(
  hour_bucket timestamp,
  event_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_role text;
BEGIN
  -- Admin guard (mirrors get_analytics_heatmap, get_analytics_kpis, etc.)
  SELECT pr.role INTO v_caller_role
  FROM public.profiles pr
  WHERE pr.id = (SELECT auth.uid());

  IF v_caller_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'get_admin_analytics_views_by_hour: caller is not an Admin'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    date_trunc('hour', (e.created_at AT TIME ZONE 'America/Sao_Paulo'))::timestamp
                                                  AS hour_bucket,
    COUNT(*)::bigint                              AS event_count
  FROM public.app_events e
  LEFT JOIN public.profiles p ON p.id = e.user_id
  WHERE (p.role IS NULL OR p.role <> 'Admin')
    AND e.event_type = 'page_view'
    AND e.created_at >= now() - (p_period_days || ' days')::interval
  GROUP BY 1
  ORDER BY 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_analytics_views_by_hour(int) TO anon, authenticated;

-- =============================================================================
-- End of migration 20260602300000_admin_analytics_views_by_hour_pegadinha18.sql
-- =============================================================================
