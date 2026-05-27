-- ─── Round 5 — /well-by-well performance: pre-aggregated materialized views ──
--
-- ⚠ Orphan recovery (2026-05-27)
-- This migration was originally applied via MCP `apply_migration` on 2026-05-27
-- and registered in supabase_migrations.schema_migrations with version
-- 20260527133039 (the MCP timestamp-at-apply, Pegadinha #1), but no local file
-- existed. A later iteration of the same migration was committed as
-- 20260528400000_well_by_well_perf_mv.sql and pushed through the CLI chain,
-- which redefined the same MVs/RPCs with refined comments + locked-down MV
-- grants (REVOKE on MVs from anon/authenticated) + explicit non-concurrent
-- REFRESH at the end.
--
-- This file restores the LOCAL representation of the original MCP-applied
-- statement (recovered verbatim from schema_migrations.statements) so the
-- deploy chain (`supabase db push`) stops failing with "Remote migration
-- versions not found in local migrations directory". The DB state is already
-- consistent with 20260528400000; this file is a backfill of the local mirror.
--
-- DO NOT edit — modifications go in a NEW timestamped migration. If you need
-- to evolve the MVs/RPCs, follow the chain after 20260528400000.

-- ─── Round 5 — /well-by-well performance: pre-aggregated materialized views ──

-- ───── (1) MV: Brazil aggregate (no stake math) ─────────────────────────────
CREATE MATERIALIZED VIEW public.mv_brazil_monthly AS
SELECT
  p.ano,
  p.mes,
  p.local AS ambiente,
  SUM(p.petroleo_bbl_dia)::numeric  AS oil_bbl_dia,
  SUM(p.gas_total_mm3_dia)::numeric AS gas_mm3_dia,
  SUM(p.agua_bbl_dia)::numeric      AS water_bbl_dia,
  (AVG(p.tempo_prod_hs_mes) /
   (EXTRACT(DAY FROM (make_date(p.ano, p.mes, 1) + INTERVAL '1 month - 1 day')) * 24)
  )::numeric AS hours_rate
FROM anp_cdp_producao p
GROUP BY p.ano, p.mes, p.local;

CREATE UNIQUE INDEX mv_brazil_monthly_pk
  ON public.mv_brazil_monthly (ano, mes, ambiente);

CREATE INDEX mv_brazil_monthly_date_idx
  ON public.mv_brazil_monthly (make_date(ano, mes, 1));

-- ───── (2) MV: Company × Canonical × Ambiente × Month (stake-weighted) ──────
CREATE MATERIALIZED VIEW public.mv_production_monthly AS
WITH valid_stakes AS (
  SELECT campo, empresa, stake_pct
    FROM field_stakes
   WHERE campo IN (
     SELECT campo FROM field_stakes
      GROUP BY campo HAVING SUM(stake_pct) = 100
   )
)
SELECT
  canonical_field_name(p.campo) AS canonical,
  vs.empresa,
  p.ano,
  p.mes,
  p.local AS ambiente,
  SUM(p.petroleo_bbl_dia  * vs.stake_pct / 100.0)::numeric AS oil_bbl_dia,
  SUM(p.gas_total_mm3_dia * vs.stake_pct / 100.0)::numeric AS gas_mm3_dia,
  SUM(p.agua_bbl_dia      * vs.stake_pct / 100.0)::numeric AS water_bbl_dia,
  (AVG(p.tempo_prod_hs_mes) /
   (EXTRACT(DAY FROM (date_trunc('month', make_date(p.ano, p.mes, 1)) + INTERVAL '1 month - 1 day')) * 24)
  )::numeric AS hours_rate,
  COALESCE(
    SUM(p.petroleo_bbl_dia * vs.stake_pct) / NULLIF(SUM(p.petroleo_bbl_dia), 0),
    AVG(vs.stake_pct)
  )::numeric AS stake_pct_weighted
FROM anp_cdp_producao p
JOIN valid_stakes vs ON vs.campo = p.campo
GROUP BY canonical_field_name(p.campo), vs.empresa, p.ano, p.mes, p.local;

CREATE UNIQUE INDEX mv_production_monthly_pk
  ON public.mv_production_monthly (canonical, empresa, ano, mes, ambiente);

CREATE INDEX mv_production_monthly_empresa_year_month_idx
  ON public.mv_production_monthly (empresa, ano, mes);

CREATE INDEX mv_production_monthly_empresa_date_idx
  ON public.mv_production_monthly (empresa, make_date(ano, mes, 1));

CREATE INDEX mv_production_monthly_canonical_empresa_idx
  ON public.mv_production_monthly (canonical, empresa);

-- ───── (3) MV: Company × Installation × Month (stake-weighted) ──────────────
CREATE MATERIALIZED VIEW public.mv_production_installation_monthly AS
WITH valid_stakes AS (
  SELECT campo, empresa, stake_pct
    FROM field_stakes
   WHERE campo IN (
     SELECT campo FROM field_stakes
      GROUP BY campo HAVING SUM(stake_pct) = 100
   )
)
SELECT
  COALESCE(p.instalacao_destino, '— sem instalação —') AS instalacao,
  vs.empresa,
  p.ano,
  p.mes,
  SUM(p.petroleo_bbl_dia  * vs.stake_pct / 100.0)::numeric AS oil_bbl_dia,
  SUM(p.gas_total_mm3_dia * vs.stake_pct / 100.0)::numeric AS gas_mm3_dia,
  SUM(p.agua_bbl_dia      * vs.stake_pct / 100.0)::numeric AS water_bbl_dia,
  (AVG(p.tempo_prod_hs_mes) /
   (EXTRACT(DAY FROM (date_trunc('month', make_date(p.ano, p.mes, 1)) + INTERVAL '1 month - 1 day')) * 24)
  )::numeric AS hours_rate
FROM anp_cdp_producao p
JOIN valid_stakes vs ON vs.campo = p.campo
GROUP BY COALESCE(p.instalacao_destino, '— sem instalação —'), vs.empresa, p.ano, p.mes;

CREATE UNIQUE INDEX mv_production_installation_monthly_pk
  ON public.mv_production_installation_monthly (instalacao, empresa, ano, mes);

CREATE INDEX mv_production_installation_monthly_empresa_year_month_idx
  ON public.mv_production_installation_monthly (empresa, ano, mes);

CREATE INDEX mv_production_installation_monthly_empresa_date_idx
  ON public.mv_production_installation_monthly (empresa, make_date(ano, mes, 1));

-- ───── (4) Refresh function ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_mv_production()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_brazil_monthly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_production_monthly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_production_installation_monthly;
  END;
  $$;

GRANT EXECUTE ON FUNCTION public.refresh_mv_production() TO service_role;

-- ───── (5a) Brazil aggregate ─ read mv_brazil_monthly ──────────────────────
CREATE OR REPLACE FUNCTION public.get_production_brazil_aggregate(
  p_date_start date,
  p_date_end   date,
  p_ambientes  text[] DEFAULT NULL
) RETURNS TABLE (
  ano           int,
  mes           int,
  ambiente      text,
  oil_bbl_dia   numeric,
  gas_mm3_dia   numeric,
  water_bbl_dia numeric,
  hours_rate    numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    ano, mes, ambiente, oil_bbl_dia, gas_mm3_dia, water_bbl_dia, hours_rate
  FROM mv_brazil_monthly
  WHERE make_date(ano, mes, 1) BETWEEN p_date_start AND p_date_end
    AND (p_ambientes IS NULL OR ambiente = ANY(p_ambientes))
  ORDER BY ano, mes, ambiente;
$$;

-- (5b) Company aggregate ─ read mv_production_monthly
CREATE OR REPLACE FUNCTION public.get_production_company_aggregate(
  p_empresa    text,
  p_date_start date,
  p_date_end   date,
  p_ambientes  text[] DEFAULT NULL
) RETURNS TABLE (
  ano           int,
  mes           int,
  ambiente      text,
  oil_bbl_dia   numeric,
  gas_mm3_dia   numeric,
  water_bbl_dia numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    ano, mes, ambiente,
    SUM(oil_bbl_dia)::numeric   AS oil_bbl_dia,
    SUM(gas_mm3_dia)::numeric   AS gas_mm3_dia,
    SUM(water_bbl_dia)::numeric AS water_bbl_dia
  FROM mv_production_monthly
  WHERE empresa = p_empresa
    AND make_date(ano, mes, 1) BETWEEN p_date_start AND p_date_end
    AND (p_ambientes IS NULL OR ambiente = ANY(p_ambientes))
  GROUP BY ano, mes, ambiente
  ORDER BY ano, mes, ambiente;
$$;

-- (5c) Top fields ─ read mv_production_monthly
CREATE OR REPLACE FUNCTION public.get_production_top_fields(
  p_empresa text,
  p_date    date,
  p_top_n   int DEFAULT 10
) RETURNS TABLE (
  campo         text,
  oil_bbl_dia   numeric,
  water_bbl_dia numeric,
  hours_rate    numeric,
  stake_pct     numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH agg AS (
    SELECT
      canonical,
      SUM(oil_bbl_dia)::numeric   AS oil_bbl_dia,
      SUM(water_bbl_dia)::numeric AS water_bbl_dia,
      AVG(hours_rate)::numeric    AS hours_rate,
      COALESCE(
        SUM(stake_pct_weighted * oil_bbl_dia) / NULLIF(SUM(oil_bbl_dia), 0),
        AVG(stake_pct_weighted)
      )::numeric AS stake_pct
    FROM mv_production_monthly
    WHERE empresa = p_empresa
      AND ano = EXTRACT(YEAR  FROM p_date)::int
      AND mes = EXTRACT(MONTH FROM p_date)::int
    GROUP BY canonical
  )
  SELECT canonical AS campo, oil_bbl_dia, water_bbl_dia, hours_rate, stake_pct
    FROM agg
   ORDER BY oil_bbl_dia DESC NULLS LAST
   LIMIT p_top_n;
$$;

-- (5d) By installation ─ read mv_production_installation_monthly
CREATE OR REPLACE FUNCTION public.get_production_by_installation(
  p_empresa text,
  p_date    date
) RETURNS TABLE (
  instalacao   text,
  oil_bbl_dia  numeric,
  gas_mm3_dia  numeric,
  hours_rate   numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    instalacao, oil_bbl_dia, gas_mm3_dia, hours_rate
  FROM mv_production_installation_monthly
  WHERE empresa = p_empresa
    AND ano = EXTRACT(YEAR  FROM p_date)::int
    AND mes = EXTRACT(MONTH FROM p_date)::int
  ORDER BY oil_bbl_dia DESC NULLS LAST;
$$;

-- (5e) Installation timeseries
CREATE OR REPLACE FUNCTION public.get_production_installation_timeseries(
  p_instalacao text,
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
  SELECT
    ano, mes, oil_bbl_dia, gas_mm3_dia, water_bbl_dia, hours_rate
  FROM mv_production_installation_monthly
  WHERE instalacao = p_instalacao
    AND empresa = p_empresa
    AND make_date(ano, mes, 1) BETWEEN p_date_start AND p_date_end
  ORDER BY ano, mes;
$$;

-- (5f) Field timeseries ─ read mv_production_monthly (canonical match)
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
  SELECT
    ano, mes,
    SUM(oil_bbl_dia)::numeric   AS oil_bbl_dia,
    SUM(gas_mm3_dia)::numeric   AS gas_mm3_dia,
    SUM(water_bbl_dia)::numeric AS water_bbl_dia,
    AVG(hours_rate)::numeric    AS hours_rate
  FROM mv_production_monthly
  WHERE canonical = p_campo
    AND empresa = p_empresa
    AND make_date(ano, mes, 1) BETWEEN p_date_start AND p_date_end
  GROUP BY ano, mes
  ORDER BY ano, mes;
$$;

-- (5g) YoY/MoM/YTD table ─ read mv_production_monthly
CREATE OR REPLACE FUNCTION public.get_production_yoy_table(
  p_empresa text,
  p_date    date
) RETURNS TABLE (
  scope           text,
  current_kbpd    numeric,
  prev_month_kbpd numeric,
  prev_year_kbpd  numeric,
  ytd_avg_kbpd    numeric,
  mom_pct         numeric,
  yoy_pct         numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH series AS (
    SELECT
      ano, mes, ambiente,
      SUM(oil_bbl_dia) / 1000.0 AS kbpd
    FROM mv_production_monthly
    WHERE empresa = p_empresa
      AND ano IN (
        EXTRACT(YEAR FROM p_date)::int,
        EXTRACT(YEAR FROM p_date)::int - 1
      )
    GROUP BY ano, mes, ambiente
  ),
  int_year AS (
    SELECT EXTRACT(YEAR  FROM p_date)::int AS y,
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
      SUM(ytd_avg_kbpd)     AS ytd_avg_kbpd
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

-- ───── (6) GRANTs ──────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_production_brazil_aggregate(date, date, text[])           TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_company_aggregate(text, date, date, text[])    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_top_fields(text, date, int)                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_by_installation(text, date)                    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_installation_timeseries(text, text, date, date) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_field_timeseries(text, text, date, date)       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_yoy_table(text, date)                          TO anon, authenticated;

GRANT SELECT ON public.mv_brazil_monthly                    TO anon, authenticated;
GRANT SELECT ON public.mv_production_monthly                TO anon, authenticated;
GRANT SELECT ON public.mv_production_installation_monthly   TO anon, authenticated;

-- ───── (8) Initial population ──────────────────────────────────────────────
-- MVs are already populated on CREATE (default WITH DATA). Skipping explicit REFRESH.

-- ───── (9) ANALYZE ─────────────────────────────────────────────────────────
ANALYZE public.mv_brazil_monthly;
ANALYZE public.mv_production_monthly;
ANALYZE public.mv_production_installation_monthly;
