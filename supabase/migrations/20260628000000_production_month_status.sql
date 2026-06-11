-- get_production_month_status(): single-row, zero-arg completeness probe for the
-- latest month in anp_cdp_producao, used by /well-by-well to show a "Partial data"
-- banner while the ANP CDP monthly publication is still being filled incrementally.
--
-- Mirrors the production-validated heuristic in scripts/cdp_roster_canary.py
-- (pick_reference_month): a month is "complete" when its producing-well count
-- (petroleo_bbl_dia > 0) is >= 70% of the previous month's count; n_prev = 0
-- counts as complete (fail open). Walk-back of up to 3 steps finds the most recent
-- complete month, with the step-3 month as the final fallback.
--
-- Reads anp_cdp_producao directly (NOT the mv_brazil_monthly MVs) because the
-- producing-well count needs well-level rows; counts filter by the (ano, mes)
-- PK prefix, so each count is a cheap index range scan.
-- SECURITY DEFINER + pinned search_path: anp_cdp_producao RLS only grants SELECT to
-- authenticated, so a definer context lets anon read the aggregate (Pegadinha #18).

CREATE OR REPLACE FUNCTION public.get_production_month_status()
RETURNS TABLE (
  latest_ano             int,
  latest_mes             int,
  latest_producing_wells int,
  prev_producing_wells   int,
  completeness_ratio     numeric,   -- NULL when prev month has 0 producing wells
  is_complete            boolean,   -- ratio >= 0.70, or prev count = 0 (fail open)
  last_complete_ano      int,       -- most recent complete month (canary walk-back)
  last_complete_mes      int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH latest AS (
    SELECT ano, mes FROM anp_cdp_producao ORDER BY ano DESC, mes DESC LIMIT 1
  ),
  months AS (   -- calendar months at steps 0..3 back from the latest month
    SELECT s.step,
           EXTRACT(YEAR  FROM d.anchor)::int AS ano,
           EXTRACT(MONTH FROM d.anchor)::int AS mes
    FROM latest l
    CROSS JOIN generate_series(0, 3) AS s(step)
    CROSS JOIN LATERAL (
      SELECT (make_date(l.ano, l.mes, 1) - make_interval(months => s.step))::date AS anchor
    ) d
  ),
  counts AS (
    SELECT m.step, m.ano, m.mes,
           (SELECT count(*)::int FROM anp_cdp_producao p
             WHERE p.ano = m.ano AND p.mes = m.mes AND p.petroleo_bbl_dia > 0) AS n
    FROM months m
  ),
  evaluated AS (  -- candidates: steps 0..2 (MAX_MONTH_STEPS = 3 in the canary)
    SELECT c.step, c.ano, c.mes, c.n AS n_cur, p.n AS n_prev,
           (p.n = 0 OR c.n::numeric >= 0.70 * p.n::numeric) AS complete
    FROM counts c JOIN counts p ON p.step = c.step + 1
    WHERE c.step <= 2
  ),
  first_complete AS (SELECT ano, mes FROM evaluated WHERE complete ORDER BY step LIMIT 1),
  fallback AS (SELECT ano, mes FROM counts WHERE step = 3)
  SELECT e.ano, e.mes, e.n_cur, e.n_prev,
         CASE WHEN e.n_prev = 0 THEN NULL
              ELSE round(e.n_cur::numeric / e.n_prev::numeric, 4) END,
         e.complete,
         COALESCE(fc.ano, fb.ano), COALESCE(fc.mes, fb.mes)
  FROM evaluated e
  LEFT JOIN first_complete fc ON TRUE
  LEFT JOIN fallback fb ON TRUE
  WHERE e.step = 0;
$$;

GRANT EXECUTE ON FUNCTION public.get_production_month_status() TO anon, authenticated;
