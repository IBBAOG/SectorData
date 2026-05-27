-- ─── Round 9 — /well-by-well "Visão Brasil" pill: 100% WI RPCs (no stake math) ─
-- When the user picks "Brasil" instead of an empresa on the dashboard, we expose
-- raw 100% working-interest numbers straight from `anp_cdp_producao` — no JOIN
-- with `field_stakes`. This mirrors how PDF reports show Brazil aggregates
-- (Tupi 917, Búzios 910, Mero 721 ... — country-level, not operator share).
--
-- Why two new MVs (instead of extending mv_brazil_monthly):
--   • mv_brazil_monthly grain is (ano, mes, ambiente) — no canonical, no
--     installation. Adding either dimension would explode the grain and break
--     the existing get_production_brazil_aggregate RPC contract.
--   • mv_brazil_canonical_monthly      — (canonical, ano, mes, ambiente)
--   • mv_brazil_installation_monthly   — (instalacao, ano, mes)
--
-- All RPCs SECURITY DEFINER + SET search_path = public, pg_temp (Pegadinha #18).
-- MVs themselves are NOT granted to anon/authenticated (Round 5 advisor pattern):
-- only the RPCs are the public surface; MVs stay private to the function definer.

-- ───── (1) MV: Brazil canonical-field-level monthly (100% WI, all fields) ────
CREATE MATERIALIZED VIEW public.mv_brazil_canonical_monthly AS
SELECT
  canonical_field_name(p.campo) AS canonical,
  p.ano,
  p.mes,
  p.local AS ambiente,
  SUM(p.petroleo_bbl_dia)::numeric  AS oil_bbl_dia,
  SUM(p.gas_total_mm3_dia)::numeric AS gas_mm3_dia,
  SUM(p.agua_bbl_dia)::numeric      AS water_bbl_dia,
  (AVG(p.tempo_prod_hs_mes) /
   (EXTRACT(DAY FROM (date_trunc('month', make_date(p.ano, p.mes, 1)) + INTERVAL '1 month - 1 day')) * 24)
  )::numeric AS hours_rate
FROM anp_cdp_producao p
WHERE p.campo IS NOT NULL
GROUP BY canonical_field_name(p.campo), p.ano, p.mes, p.local;

CREATE UNIQUE INDEX mv_brazil_canonical_monthly_pk
  ON public.mv_brazil_canonical_monthly (canonical, ano, mes, ambiente);

CREATE INDEX mv_brazil_canonical_monthly_year_month_idx
  ON public.mv_brazil_canonical_monthly (ano, mes);

-- ───── (2) MV: Brazil installation-level monthly (100% WI, all installations) ─
CREATE MATERIALIZED VIEW public.mv_brazil_installation_monthly AS
SELECT
  COALESCE(p.instalacao_destino, '— sem instalação —') AS instalacao,
  p.ano,
  p.mes,
  SUM(p.petroleo_bbl_dia)::numeric  AS oil_bbl_dia,
  SUM(p.gas_total_mm3_dia)::numeric AS gas_mm3_dia,
  SUM(p.agua_bbl_dia)::numeric      AS water_bbl_dia,
  (AVG(p.tempo_prod_hs_mes) /
   (EXTRACT(DAY FROM (date_trunc('month', make_date(p.ano, p.mes, 1)) + INTERVAL '1 month - 1 day')) * 24)
  )::numeric AS hours_rate
FROM anp_cdp_producao p
GROUP BY COALESCE(p.instalacao_destino, '— sem instalação —'), p.ano, p.mes;

CREATE UNIQUE INDEX mv_brazil_installation_monthly_pk
  ON public.mv_brazil_installation_monthly (instalacao, ano, mes);

CREATE INDEX mv_brazil_installation_monthly_year_month_idx
  ON public.mv_brazil_installation_monthly (ano, mes);

-- ───── (3) Refresh function — extend to cover the 2 new MVs ─────────────────
-- Keeps REVOKE/GRANT pattern from Round 5 (service_role only — DoS guard
-- on REFRESH CONCURRENTLY EXCLUSIVE locks).
CREATE OR REPLACE FUNCTION public.refresh_mv_production()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_production_monthly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_production_installation_monthly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_brazil_monthly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_brazil_canonical_monthly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_brazil_installation_monthly;
  END;
  $$;

-- Re-apply REVOKE/GRANT defensively (CREATE OR REPLACE preserves but explicit
-- is safer per Pegadinha #18 doctrine).
REVOKE ALL ON FUNCTION public.refresh_mv_production() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_mv_production() TO service_role;

-- ───── (4) Four new RPCs — Brazil 100% WI variants ──────────────────────────
-- All SECURITY DEFINER + SET search_path (Pegadinha #18). All GRANT EXECUTE to
-- anon, authenticated.

-- (4a) Top N canonical fields by oil production in p_date month (100% WI)
CREATE OR REPLACE FUNCTION public.get_production_brazil_top_fields(
  p_date  date,
  p_top_n int DEFAULT 10
) RETURNS TABLE (
  campo         text,
  oil_bbl_dia   numeric,
  water_bbl_dia numeric,
  hours_rate    numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT canonical AS campo,
         SUM(oil_bbl_dia)::numeric   AS oil_bbl_dia,
         SUM(water_bbl_dia)::numeric AS water_bbl_dia,
         AVG(hours_rate)::numeric    AS hours_rate
    FROM mv_brazil_canonical_monthly
   WHERE ano = EXTRACT(YEAR  FROM p_date)::int
     AND mes = EXTRACT(MONTH FROM p_date)::int
   GROUP BY canonical
   ORDER BY 2 DESC NULLS LAST
   LIMIT p_top_n;
$$;

-- (4b) Installations table for p_date month (100% WI)
CREATE OR REPLACE FUNCTION public.get_production_brazil_installation(
  p_date date
) RETURNS TABLE (
  instalacao  text,
  oil_bbl_dia numeric,
  gas_mm3_dia numeric,
  hours_rate  numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT instalacao,
         SUM(oil_bbl_dia)::numeric AS oil_bbl_dia,
         SUM(gas_mm3_dia)::numeric AS gas_mm3_dia,
         AVG(hours_rate)::numeric  AS hours_rate
    FROM mv_brazil_installation_monthly
   WHERE ano = EXTRACT(YEAR  FROM p_date)::int
     AND mes = EXTRACT(MONTH FROM p_date)::int
   GROUP BY instalacao
   ORDER BY 2 DESC NULLS LAST;
$$;

-- (4c) Field timeseries for canonical p_campo across [p_date_start, p_date_end] (100% WI)
CREATE OR REPLACE FUNCTION public.get_production_brazil_field_timeseries(
  p_campo      text,
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
  SELECT ano, mes,
         SUM(oil_bbl_dia)::numeric   AS oil_bbl_dia,
         SUM(gas_mm3_dia)::numeric   AS gas_mm3_dia,
         SUM(water_bbl_dia)::numeric AS water_bbl_dia,
         AVG(hours_rate)::numeric    AS hours_rate
    FROM mv_brazil_canonical_monthly
   WHERE canonical = p_campo
     AND make_date(ano, mes, 1) BETWEEN p_date_start AND p_date_end
   GROUP BY ano, mes
   ORDER BY ano, mes;
$$;

-- (4d) Installation timeseries for p_instalacao across [p_date_start, p_date_end] (100% WI)
CREATE OR REPLACE FUNCTION public.get_production_brazil_installation_timeseries(
  p_instalacao text,
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
  SELECT ano, mes,
         SUM(oil_bbl_dia)::numeric   AS oil_bbl_dia,
         SUM(gas_mm3_dia)::numeric   AS gas_mm3_dia,
         SUM(water_bbl_dia)::numeric AS water_bbl_dia,
         AVG(hours_rate)::numeric    AS hours_rate
    FROM mv_brazil_installation_monthly
   WHERE instalacao = p_instalacao
     AND make_date(ano, mes, 1) BETWEEN p_date_start AND p_date_end
   GROUP BY ano, mes
   ORDER BY ano, mes;
$$;

-- ───── (5) Grants — public surface is the 4 RPCs (Pegadinha #18) ────────────
GRANT EXECUTE ON FUNCTION public.get_production_brazil_top_fields(date, int)                          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_brazil_installation(date)                             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_brazil_field_timeseries(text, date, date)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_brazil_installation_timeseries(text, date, date)      TO anon, authenticated;

-- ───── (6) MV permissions — locked down ─────────────────────────────────────
-- Do NOT grant SELECT on the MVs to anon/authenticated (Round 5 advisor
-- `materialized_view_in_api`). The 4 RPCs above are the sole public access
-- path; MVs stay private to the function definer's privileges.

-- ───── (7) Initial population (non-concurrent — MVs were empty on CREATE) ───
REFRESH MATERIALIZED VIEW public.mv_brazil_canonical_monthly;
REFRESH MATERIALIZED VIEW public.mv_brazil_installation_monthly;

-- ───── (8) ANALYZE so planner has stats on day 1 ────────────────────────────
ANALYZE public.mv_brazil_canonical_monthly;
ANALYZE public.mv_brazil_installation_monthly;
