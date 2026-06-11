-- Paginate get_stock_guide_scenario_grid for /stock-guide.
-- The scenario-grid mesh for sensitivity_id=18 holds 194,481 rows (7 metrics x 27,783
-- points). As a SETOF RPC called via PostgREST, responses are capped at the project's
-- PostgREST max-rows (50,000), so the frontend only ever receives 50,000 of the points
-- and interpolation silently runs on a truncated mesh. Fix: add LIMIT/OFFSET so the
-- frontend can page through the full mesh.
--
-- Signature change (adds p_limit/p_offset), so DROP + CREATE -- not CREATE OR REPLACE.
-- A CREATE OR REPLACE with extra defaulted params would create a SECOND overload, and
-- named-arg calls passing only p_sensitivity_id would become ambiguous ("function is not
-- unique"). DROP the single-arg version explicitly first.
--
-- Pegadinha #18: DROP wipes grants + SECURITY DEFINER + search_path -> re-assert all
-- (STABLE SECURITY DEFINER, SET search_path, GRANT EXECUTE to anon + authenticated).
-- ORDER BY is unchanged and deterministic -- pagination correctness depends on it.

DROP FUNCTION IF EXISTS public.get_stock_guide_scenario_grid(bigint);

CREATE FUNCTION public.get_stock_guide_scenario_grid(
    p_sensitivity_id bigint,
    p_limit          integer DEFAULT NULL,
    p_offset         integer DEFAULT 0
  )
  RETURNS TABLE(
    ticker        text,
    metric        text,
    x_value       numeric,
    y_value       numeric,
    z_value       numeric,
    primary_value numeric
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $function$
    SELECT g.ticker, g.metric, g.x_value, g.y_value, g.z_value, g.primary_value
      FROM public.stock_guide_scenario_grid g
     WHERE g.sensitivity_id = p_sensitivity_id
       AND (
            public.is_admin()
         OR EXISTS (
              SELECT 1
                FROM public.stock_guide_companies c
               WHERE c.ticker = g.ticker
                 AND c.is_visible
            )
       )
     ORDER BY g.ticker, g.metric, g.x_value, g.y_value, g.z_value
     LIMIT p_limit OFFSET p_offset;
  $function$;

GRANT EXECUTE ON FUNCTION public.get_stock_guide_scenario_grid(bigint, integer, integer) TO anon, authenticated;
