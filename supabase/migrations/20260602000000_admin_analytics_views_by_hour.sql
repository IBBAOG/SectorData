-- =============================================================================
-- 20260602000000_admin_analytics_views_by_hour.sql
--
-- New RPC for the "Views over time" section of /admin-analytics:
-- aggregates page_view events into hourly buckets over the requested window.
--
-- Mirrors the existing get_analytics_heatmap pattern:
--   - LANGUAGE plpgsql STABLE SECURITY DEFINER
--   - SET search_path = public, auth, pg_temp
--   - Inline Admin guard: RAISE EXCEPTION on non-Admin callers
--   - GRANT EXECUTE TO authenticated; REVOKE FROM anon (defense in depth)
--
-- The bucketing uses date_trunc('hour', created_at) in UTC. The UI renders the
-- timestamp via Plotly's x-axis date formatter, which respects the browser
-- timezone — we keep the storage TZ semantics consistent (already UTC) and
-- let the client handle display.
--
-- Phase A consistency: we include anon events (LEFT JOIN profiles + filter on
-- (p.role IS NULL OR p.role <> 'Admin')) so the chart counts both logged-out
-- visitors and authenticated Clients, matching get_analytics_heatmap.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_analytics_views_by_hour(
  p_period_days int DEFAULT 30
)
RETURNS TABLE(
  hour_bucket timestamptz,
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
    date_trunc('hour', e.created_at)              AS hour_bucket,
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

GRANT EXECUTE ON FUNCTION public.get_admin_analytics_views_by_hour(int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_analytics_views_by_hour(int) FROM anon;

-- =============================================================================
-- End of migration 20260602000000_admin_analytics_views_by_hour.sql
-- =============================================================================
