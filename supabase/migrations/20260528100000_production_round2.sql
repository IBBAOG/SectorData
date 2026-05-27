-- ─── Production RPCs — Round 2 (2026-05-28) ──────────────────────────────────
-- Patch 1: fix `get_production_yoy_table` TOTAL row — change
--          `AVG(ytd_avg_kbpd)` to `SUM(ytd_avg_kbpd)` for consistency with the
--          other 3 TOTAL columns (current/prev_month/prev_year all SUM).
--          Previous version underreported TOTAL.ytd_avg_kbpd by ~3x (averaged
--          the 3 ambiente subtotals instead of summing them).
--
-- Patch 2: new `get_production_field_timeseries` — 13-month per-campo time
--          series for /production drill-down modal (Top Fields panel click).
--          Stake-weighted by company; only valid (SUM=100) stakes included.
--
-- Both functions: SECURITY DEFINER + SET search_path = public, pg_temp because
-- source tables (anp_cdp_producao, field_stakes) have RLS scoped to
-- authenticated only. Anon callers would otherwise get empty results
-- (Pegadinha #18 in CLAUDE.md).

------------------------------------------------------------
-- Patch 1: CREATE OR REPLACE get_production_yoy_table
-- (body verbatim from 20260528000000 with one line changed:
--  total_row.ytd_avg_kbpd  AVG -> SUM)
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_production_yoy_table(
  p_empresa text,
  p_date    date
) RETURNS TABLE (
  scope           text,  -- 'TOTAL' or ambiente name
  current_kbpd    numeric,
  prev_month_kbpd numeric,
  prev_year_kbpd  numeric,
  ytd_avg_kbpd    numeric,
  mom_pct         numeric,
  yoy_pct         numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH valid_stakes AS (
    SELECT campo, empresa, stake_pct
      FROM field_stakes
     WHERE campo IN (
       SELECT campo FROM field_stakes
        GROUP BY campo
       HAVING SUM(stake_pct) = 100
     )
       AND empresa = p_empresa
  ),
  series AS (
    SELECT
      p.ano, p.mes, p.local AS ambiente,
      SUM(p.petroleo_bbl_dia * vs.stake_pct / 100) / 1000.0 AS kbpd
    FROM anp_cdp_producao p
    JOIN valid_stakes vs ON vs.campo = p.campo
    WHERE p.ano IN (
      EXTRACT(YEAR FROM p_date)::int,
      EXTRACT(YEAR FROM p_date)::int - 1
    )
    GROUP BY p.ano, p.mes, p.local
  ),
  int_year AS (
    SELECT EXTRACT(YEAR FROM p_date)::int AS y,
           EXTRACT(MONTH FROM p_date)::int AS m
  ),
  per_ambiente AS (
    SELECT
      s.ambiente AS scope,
      MAX(CASE WHEN s.ano = (SELECT y FROM int_year)     AND s.mes = (SELECT m FROM int_year)     THEN s.kbpd END) AS current_kbpd,
      MAX(CASE WHEN s.ano = (SELECT y FROM int_year)     AND s.mes = (SELECT m FROM int_year) - 1 THEN s.kbpd END) AS prev_month_kbpd,
      MAX(CASE WHEN s.ano = (SELECT y FROM int_year) - 1 AND s.mes = (SELECT m FROM int_year)     THEN s.kbpd END) AS prev_year_kbpd,
      AVG(CASE WHEN s.ano = (SELECT y FROM int_year)     AND s.mes <= (SELECT m FROM int_year)    THEN s.kbpd END) AS ytd_avg_kbpd
    FROM series s
    GROUP BY s.ambiente
  ),
  total_row AS (
    SELECT
      'TOTAL'::text         AS scope,
      SUM(current_kbpd)     AS current_kbpd,
      SUM(prev_month_kbpd)  AS prev_month_kbpd,
      SUM(prev_year_kbpd)   AS prev_year_kbpd,
      SUM(ytd_avg_kbpd)     AS ytd_avg_kbpd   -- Round 2 fix: was AVG (~3x under)
    FROM per_ambiente
  )
  SELECT scope,
         current_kbpd,
         prev_month_kbpd,
         prev_year_kbpd,
         ytd_avg_kbpd,
         CASE WHEN prev_month_kbpd IS NULL OR prev_month_kbpd = 0 THEN NULL
              ELSE (current_kbpd / prev_month_kbpd - 1) * 100 END AS mom_pct,
         CASE WHEN prev_year_kbpd IS NULL OR prev_year_kbpd = 0 THEN NULL
              ELSE (current_kbpd / prev_year_kbpd - 1) * 100 END AS yoy_pct
  FROM (
    SELECT * FROM total_row
    UNION ALL
    SELECT scope, current_kbpd, prev_month_kbpd, prev_year_kbpd, ytd_avg_kbpd FROM per_ambiente
  ) u
  ORDER BY CASE WHEN scope = 'TOTAL' THEN 0 ELSE 1 END, scope;
$$;

------------------------------------------------------------
-- Patch 2: get_production_field_timeseries
-- Consumed by /production Top Fields drill-down modal.
-- Returns the 13-month per-campo × empresa stake-weighted series.
------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_production_field_timeseries(
  p_campo      text,
  p_empresa    text,
  p_date_start date,
  p_date_end   date
) RETURNS TABLE (
  ano           int,
  mes           int,
  oil_bbl_dia   numeric,
  gas_mm3_dia   numeric,
  water_bbl_dia numeric,
  hours_rate    numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH valid_stake AS (
    -- Only include if SUM=100 across all empresas for this campo
    SELECT campo, empresa, stake_pct
      FROM field_stakes
     WHERE campo = p_campo
       AND empresa = p_empresa
       AND campo IN (
         SELECT campo FROM field_stakes
          GROUP BY campo HAVING SUM(stake_pct) = 100
       )
  )
  SELECT
    p.ano,
    p.mes,
    SUM(p.petroleo_bbl_dia  * vs.stake_pct / 100)::numeric AS oil_bbl_dia,
    SUM(p.gas_total_mm3_dia * vs.stake_pct / 100)::numeric AS gas_mm3_dia,
    SUM(p.agua_bbl_dia      * vs.stake_pct / 100)::numeric AS water_bbl_dia,
    (AVG(p.tempo_prod_hs_mes) /
      (EXTRACT(DAY FROM (date_trunc('month', make_date(p.ano, p.mes, 1)) + INTERVAL '1 month - 1 day')) * 24)
    )::numeric AS hours_rate
  FROM anp_cdp_producao p
  JOIN valid_stake vs ON vs.campo = p.campo
 WHERE p.campo = p_campo
   AND make_date(p.ano, p.mes, 1) BETWEEN p_date_start AND p_date_end
 GROUP BY p.ano, p.mes
 ORDER BY p.ano, p.mes;
$$;

GRANT EXECUTE ON FUNCTION public.get_production_field_timeseries(text, text, date, date) TO anon, authenticated;
