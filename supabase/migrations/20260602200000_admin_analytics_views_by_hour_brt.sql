-- =============================================================================
-- 20260602200000_admin_analytics_views_by_hour_brt.sql
--
-- Rebucket get_admin_analytics_views_by_hour in America/Sao_Paulo timezone.
-- Returns `timestamp` (without time zone) so Plotly renders the BRT wall
-- clock verbatim instead of re-shifting it to the browser local TZ.
--
-- Why: the previous version (migration 20260602000000) bucketed on UTC
-- `created_at` and returned `timestamptz`. The /admin-analytics chart showed
-- the UTC hour (e.g. 19h) while admins reading the chart are in Brazil and
-- expected the BRT wall clock (16h, UTC-3). All admin viewers live in
-- Brazil, so hardcoding `America/Sao_Paulo` is acceptable.
--
-- Mechanics:
--   `(created_at AT TIME ZONE 'America/Sao_Paulo')` converts the timestamptz
--   to a `timestamp without time zone` representing BRT wall clock. Truncating
--   that to hour and casting to `timestamp` keeps the TZ stripped, so when
--   PostgREST serializes it the JSON string carries no `+00:00` suffix.
--   Plotly receives e.g. "2026-05-28T16:00:00", parses it as UTC literally,
--   and renders the same "16h" because no timezone shift is applied a
--   second time.
--
-- Return type changes (`timestamptz` -> `timestamp`), so DROP+CREATE is
-- required. Per Pegadinha #d, DROP wipes grants and SECURITY DEFINER must
-- be re-stated explicitly. This migration re-applies both.
--
-- Phase A consistency preserved: the LEFT JOIN profiles filter still
-- excludes Admin events so the chart counts both anon visitors and
-- authenticated Clients but never Admins (matching get_analytics_heatmap).
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_admin_analytics_views_by_hour(int);

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

REVOKE ALL ON FUNCTION public.get_admin_analytics_views_by_hour(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics_views_by_hour(int) TO authenticated;

-- =============================================================================
-- End of migration 20260602200000_admin_analytics_views_by_hour_brt.sql
-- =============================================================================
