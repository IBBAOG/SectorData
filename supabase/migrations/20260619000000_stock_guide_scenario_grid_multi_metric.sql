-- Multi-metric scenario grid for /stock-guide.
-- v2 of the multi-axis Brent mesh: one (sensitivity, ticker, axis-combo) row can now
-- carry several output metrics (target_price, fcfe, dividends, net_income, ...).
-- Schema-only migration. Example-seed enrichment for sensitivity_id=17 is applied
-- separately via execute_sql (it is data, not schema).

-- 1) New metric column. DEFAULT 'target_price' backfills the existing seed and lets
--    single-metric uploads keep omitting the column. DEFAULT stays permanent.
ALTER TABLE public.stock_guide_scenario_grid
  ADD COLUMN IF NOT EXISTS metric text NOT NULL DEFAULT 'target_price';

-- 2) PK swap: add metric to the natural key so a single (sensitivity, ticker, axis-combo)
--    can hold multiple metrics. Uniqueness otherwise unchanged.
ALTER TABLE public.stock_guide_scenario_grid
  DROP CONSTRAINT IF EXISTS stock_guide_scenario_grid_pkey;

ALTER TABLE public.stock_guide_scenario_grid
  ADD CONSTRAINT stock_guide_scenario_grid_pkey
  PRIMARY KEY (sensitivity_id, ticker, metric, x_value, y_value, z_value);

-- 3) RPC: RETURNS TABLE shape changes (adds metric), so DROP + CREATE.
--    DROP wipes grants + SECURITY DEFINER + search_path (pegadinha #18) -> re-assert all.
DROP FUNCTION IF EXISTS public.get_stock_guide_scenario_grid(bigint);

CREATE FUNCTION public.get_stock_guide_scenario_grid(p_sensitivity_id bigint)
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
     ORDER BY g.ticker, g.metric, g.x_value, g.y_value, g.z_value;
  $function$;

GRANT EXECUTE ON FUNCTION public.get_stock_guide_scenario_grid(bigint) TO anon, authenticated;
