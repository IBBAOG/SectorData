-- Hoist the per-row admin check in get_stock_guide_scenario_grid into a one-shot InitPlan.
-- The visibility filter was `( public.is_admin() OR EXISTS (...) )`, and Postgres evaluated
-- public.is_admin() ONCE PER ROW (194,481 times for sensitivity_id=18) -- each call re-queries
-- profiles via auth.uid(). The worst page (LIMIT 40000 OFFSET 160000) cost ~2.58s even as
-- postgres; for an authenticated PostgREST caller the per-row cost pushed a page past the ~30s
-- authenticator statement timeout (one `canceling statement due to statement timeout` was caught
-- in the logs while the dashboard loaded). Wrapping the call in a scalar subselect --
-- `( (SELECT public.is_admin()) OR EXISTS (...) )` -- forces a single InitPlan evaluation,
-- same remedy as pitfall #8 (per-row auth.uid() in policies). Everything else is unchanged.
--
-- CREATE OR REPLACE (same signature) so GRANTs survive; re-state STABLE + SECURITY DEFINER +
-- search_path explicitly anyway (pitfall #18) and re-assert the GRANT to be safe.

CREATE OR REPLACE FUNCTION public.get_stock_guide_scenario_grid(
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
            (SELECT public.is_admin())
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
