-- ─── Production dashboard RPCs ────────────────────────────────────────────────
-- Stake-weighted production attribution per company × month, derived from
-- anp_cdp_producao × field_stakes (joined server-side on `campo`).
-- Consumed by /production dashboard. Only campos with SUM(stake_pct)=100 are
-- included in company aggregates — incomplete campos are silently filtered
-- (Admin sees the incomplete state in /admin-panel "Field Stakes").
--
-- All RPCs are SECURITY DEFINER SET search_path = public, pg_temp because the
-- source tables (anp_cdp_producao, field_stakes) have RLS scoped to
-- authenticated only. Anon callers would otherwise get empty results
-- (Pegadinha #18 in CLAUDE.md).

------------------------------------------------------------
-- RPC 1: Brazil aggregate (no stake math, just sum production by ambiente)
------------------------------------------------------------
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
    p.ano,
    p.mes,
    p.local AS ambiente,
    SUM(p.petroleo_bbl_dia)::numeric  AS oil_bbl_dia,
    SUM(p.gas_total_mm3_dia)::numeric AS gas_mm3_dia,
    SUM(p.agua_bbl_dia)::numeric      AS water_bbl_dia,
    -- hours_rate per month = AVG hours / (days_in_month * 24)
    -- (each row in anp_cdp_producao is a (poco, campo, ...) tuple — average across them is fine)
    (AVG(p.tempo_prod_hs_mes) /
     (EXTRACT(DAY FROM (make_date(p.ano, p.mes, 1) + INTERVAL '1 month - 1 day')) * 24))::numeric AS hours_rate
  FROM anp_cdp_producao p
  WHERE make_date(p.ano, p.mes, 1) BETWEEN p_date_start AND p_date_end
    AND (p_ambientes IS NULL OR p.local = ANY(p_ambientes))
  GROUP BY p.ano, p.mes, p.local
  ORDER BY p.ano, p.mes, p.local;
$$;

------------------------------------------------------------
-- RPC 2: Company aggregate (stake-weighted, valid stakes only)
------------------------------------------------------------
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
  WITH valid_stakes AS (
    SELECT campo, empresa, stake_pct
      FROM field_stakes
     WHERE campo IN (
       SELECT campo FROM field_stakes
        GROUP BY campo
       HAVING SUM(stake_pct) = 100
     )
       AND empresa = p_empresa
  )
  SELECT
    p.ano,
    p.mes,
    p.local AS ambiente,
    SUM(p.petroleo_bbl_dia  * vs.stake_pct / 100)::numeric AS oil_bbl_dia,
    SUM(p.gas_total_mm3_dia * vs.stake_pct / 100)::numeric AS gas_mm3_dia,
    SUM(p.agua_bbl_dia      * vs.stake_pct / 100)::numeric AS water_bbl_dia
  FROM anp_cdp_producao p
  JOIN valid_stakes vs ON vs.campo = p.campo
  WHERE make_date(p.ano, p.mes, 1) BETWEEN p_date_start AND p_date_end
    AND (p_ambientes IS NULL OR p.local = ANY(p_ambientes))
  GROUP BY p.ano, p.mes, p.local
  ORDER BY p.ano, p.mes, p.local;
$$;

------------------------------------------------------------
-- RPC 3: Top-N campos by company in a single month
------------------------------------------------------------
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
  month_data AS (
    SELECT
      p.campo,
      SUM(p.petroleo_bbl_dia * vs.stake_pct / 100)::numeric AS oil_company,
      SUM(p.agua_bbl_dia     * vs.stake_pct / 100)::numeric AS water_company,
      (AVG(p.tempo_prod_hs_mes) /
       (EXTRACT(DAY FROM (date_trunc('month', p_date) + INTERVAL '1 month - 1 day')) * 24))::numeric AS hours_rate,
      MAX(vs.stake_pct) AS stake_pct  -- one row per (campo,empresa) so MAX = the value
    FROM anp_cdp_producao p
    JOIN valid_stakes vs ON vs.campo = p.campo
    WHERE p.ano = EXTRACT(YEAR  FROM p_date)::int
      AND p.mes = EXTRACT(MONTH FROM p_date)::int
    GROUP BY p.campo
  )
  SELECT campo,
         oil_company   AS oil_bbl_dia,
         water_company AS water_bbl_dia,
         hours_rate,
         stake_pct
  FROM month_data
  ORDER BY oil_company DESC NULLS LAST
  LIMIT p_top_n;
$$;

------------------------------------------------------------
-- RPC 4: By installation (FPSO/UEP) for a company in one month
------------------------------------------------------------
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
  WITH valid_stakes AS (
    SELECT campo, empresa, stake_pct
      FROM field_stakes
     WHERE campo IN (
       SELECT campo FROM field_stakes
        GROUP BY campo
       HAVING SUM(stake_pct) = 100
     )
       AND empresa = p_empresa
  )
  SELECT
    COALESCE(p.instalacao_destino, '— sem instalação —') AS instalacao,
    SUM(p.petroleo_bbl_dia  * vs.stake_pct / 100)::numeric AS oil_bbl_dia,
    SUM(p.gas_total_mm3_dia * vs.stake_pct / 100)::numeric AS gas_mm3_dia,
    (AVG(p.tempo_prod_hs_mes) /
     (EXTRACT(DAY FROM (date_trunc('month', p_date) + INTERVAL '1 month - 1 day')) * 24))::numeric AS hours_rate
  FROM anp_cdp_producao p
  JOIN valid_stakes vs ON vs.campo = p.campo
  WHERE p.ano = EXTRACT(YEAR  FROM p_date)::int
    AND p.mes = EXTRACT(MONTH FROM p_date)::int
  GROUP BY p.instalacao_destino
  ORDER BY oil_bbl_dia DESC NULLS LAST;
$$;

------------------------------------------------------------
-- RPC 5: YoY/MoM/YTD summary table (1 row total + 1 per ambiente)
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
      AVG(ytd_avg_kbpd)     AS ytd_avg_kbpd
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
-- Grants
------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.get_production_brazil_aggregate(date, date, text[])         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_company_aggregate(text, date, date, text[])  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_top_fields(text, date, int)                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_by_installation(text, date)                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_yoy_table(text, date)                        TO anon, authenticated;

------------------------------------------------------------
-- Module visibility seed
------------------------------------------------------------
INSERT INTO public.module_visibility (module_slug, is_visible_for_clients, is_visible_on_home, is_visible_for_public)
VALUES ('production', true, true, false)
ON CONFLICT (module_slug) DO NOTHING;
