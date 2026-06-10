-- Single-source, consistent same-month carry-forward import%/production% split
-- in recompute_dg_margins.
--
-- WHY (CEO mandate): the import%/production% split that weights BBA import
-- parity vs Petrobras refinery price in base_fuel must use a SINGLE ANP source
-- per quantity -- no MDIC, no kg/density conversion, no silent 0% fallback.
--
-- BEFORE (20260613200000 body): imp_m3 came from anp_desembaracos
-- (quantidade_kg / NCM-density), with an mdic_comex (volume_kg / density)
-- COALESCE fallback; prod_m3 from anp_producao_derivados carried forward on its
-- own (independent month). The split was then `COALESCE(imp_pct, 0)` inside the
-- base_fuel formula -- so any month with no resolvable imports silently emitted
-- a 0% import weight (all-Petrobras), distorting base_fuel without a trace.
-- This mixed two density-derived kg sources with different month coverage and
-- could carry production from a different month than imports.
--
-- AFTER (this migration): for each (fuel, target month m_year/m_month = the
-- ISO week's Thursday month):
--   * Map fuel -> ANP labels:
--       Gasoline C : daie 'GASOLINA A' (anp_daie.produto), prod 'GASOLINA A'.
--       Diesel B   : daie accented 'ÓLEO DIESEL' (matched via produto ILIKE
--                    '%diesel%'), prod 'OLEO DIESEL' (un-accented).
--   * ref_month = the LATEST month <= make_date(m_year,m_month,1) that exists in
--     BOTH anp_daie (operacao ILIKE 'IMPORTA%', the daie label) AND
--     anp_producao_derivados (the prod label). Both sides come from the SAME
--     month -> a consistent whole-split carry-forward. Both ANP series lag
--     ~2 months together, so recent weeks resolve to the latest common month
--     (e.g. April daie+prod carried into May/June 2026 weeks).
--   * imp_m3  = anp_daie.volume_m3 at (ref_month, daie label, IMPORTAÇÃO)
--               -- NATIVE m^3, NO density conversion.
--   * prod_m3 = anp_producao_derivados.volume_m3 at (ref_month, prod label).
--   * imp_pct = imp_m3 / NULLIF(imp_m3 + prod_m3, 0).
--   * anp_desembaracos, mdic_comex and ncm_densidade_kg_m3 are DROPPED from this
--     calc entirely (those tables are untouched -- they feed /imports-exports).
--   * The `COALESCE(imp_pct, 0)` in base_fuel is REMOVED. If imp_pct is NULL (no
--     common month -- impossible in the computed era given the carry-forward),
--     the row is SKIPPED (added to the existing pump-NULL / ICMS-NULL /
--     biofuel-NULL skip conditions). base_fuel uses a guaranteed non-null
--     imp_pct: (parity*imp_pct + petrobras*(1-imp_pct)) * (1-blend).
--
-- Everything else (biofuel carry-forward, blend scaling, taxes, pump,
-- base_fuel formula shape) is IDENTICAL to the prior body. Only the imp_pct
-- subquery in `computed` and the base_fuel/WHERE in `final` change.
--
-- DROP + CREATE preserves nothing (grants, SECURITY DEFINER, search_path), so
-- all attributes are re-applied explicitly below (CLAUDE.md Pegadinha #18).
-- Signature unchanged: recompute_dg_margins(text, text) RETURNS integer.

BEGIN;

DROP FUNCTION IF EXISTS public.recompute_dg_margins(text, text);

CREATE OR REPLACE FUNCTION public.recompute_dg_margins(
  p_week_start text DEFAULT NULL::text,
  p_week_end   text DEFAULT NULL::text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_date_start DATE := NULL;
  v_date_end   DATE := NULL;
  v_written    INT  := 0;
  r            RECORD;
BEGIN
  IF p_week_start IS NOT NULL AND length(trim(p_week_start)) > 0 THEN
    v_date_start := to_date(split_part(p_week_start, '/', 2) || '-' || split_part(p_week_start, '/', 1), 'IYYY-IW');
  END IF;
  IF p_week_end IS NOT NULL AND length(trim(p_week_end)) > 0 THEN
    v_date_end := to_date(split_part(p_week_end, '/', 2) || '-' || split_part(p_week_end, '/', 1), 'IYYY-IW');
  END IF;

  FOR r IN
    WITH
    weeks AS (
      SELECT DISTINCT date_trunc('week', d)::date AS monday
      FROM (
        SELECT date AS d FROM public.price_bands
        UNION
        SELECT data_fim AS d FROM public.anp_lpc
      ) s
      WHERE (v_date_start IS NULL OR date_trunc('week', d)::date >= v_date_start)
        AND (v_date_end   IS NULL OR date_trunc('week', d)::date <= v_date_end)
    ),
    fuels AS (
      SELECT * FROM (VALUES
        ('Gasoline C', 'Gasoline', 'GASOLINA COMUM', 'GASOLINA A',  745::numeric),
        ('Diesel B',   'Diesel',   'DIESEL S10',     'OLEO DIESEL', 832::numeric)
      ) f(fuel_type, pb_product, lpc_produto, prod_produto, default_density)
    ),
    grid AS (
      SELECT
        w.monday,
        (w.monday + 6)                              AS sunday,
        (w.monday + 3)                              AS thursday,
        (w.monday + 5)                              AS saturday,
        (extract(week    FROM w.monday)::int)       AS iso_week,
        (extract(isoyear FROM w.monday)::int)       AS iso_year,
        (extract(month   FROM (w.monday + 3))::int) AS m_month,
        (extract(year    FROM (w.monday + 3))::int) AS m_year,
        f.fuel_type, f.pb_product, f.lpc_produto, f.prod_produto, f.default_density
      FROM weeks w CROSS JOIN fuels f
    ),
    computed AS (
      SELECT
        g.fuel_type,
        g.iso_week || '/' || g.iso_year AS week_key,
        g.monday, g.sunday,
        ( SELECT SUM(l.preco_medio_venda::numeric * l.n_postos) / NULLIF(SUM(l.n_postos), 0)
            FROM public.anp_lpc l
           WHERE l.produto = g.lpc_produto AND l.data_fim BETWEEN g.monday AND g.sunday
        ) AS pump,
        ( SELECT AVG(pb.bba_import_parity) FROM public.price_bands pb
           WHERE pb.product = g.pb_product AND pb.date BETWEEN g.monday AND g.sunday
        ) AS parity,
        ( SELECT AVG(pb.petrobras_price) FROM public.price_bands pb
           WHERE pb.product = g.pb_product AND pb.date BETWEEN g.monday AND g.sunday
        ) AS petrobras,
        -- SINGLE-SOURCE import%/production% split with CONSISTENT same-month
        -- carry-forward. imp_m3 from anp_daie (NATIVE m^3, IMPORTAÇÃO); prod_m3
        -- from anp_producao_derivados; BOTH read at ref_month = latest month
        -- <= target month present in BOTH tables. No MDIC, no desembaracos,
        -- no density. NULL only if there is no common month at all (-> row
        -- skipped in `final`).
        ( WITH ref AS (
            SELECT MAX(common.m) AS ref_month
            FROM (
              SELECT make_date(d.ano, d.mes, 1) AS m
                FROM public.anp_daie d
               WHERE d.operacao ILIKE 'IMPORTA%'
                 AND make_date(d.ano, d.mes, 1) <= make_date(g.m_year, g.m_month, 1)
                 AND ( CASE WHEN g.fuel_type = 'Gasoline C'
                            THEN d.produto = 'GASOLINA A'
                            ELSE d.produto ILIKE '%diesel%'
                       END )
              INTERSECT
              SELECT make_date(p.ano, p.mes, 1) AS m
                FROM public.anp_producao_derivados p
               WHERE p.produto = g.prod_produto
                 AND make_date(p.ano, p.mes, 1) <= make_date(g.m_year, g.m_month, 1)
            ) common
          ),
          imp AS (
            SELECT SUM(d.volume_m3) AS imp_m3
              FROM public.anp_daie d, ref
             WHERE d.operacao ILIKE 'IMPORTA%'
               AND make_date(d.ano, d.mes, 1) = ref.ref_month
               AND ( CASE WHEN g.fuel_type = 'Gasoline C'
                          THEN d.produto = 'GASOLINA A'
                          ELSE d.produto ILIKE '%diesel%'
                     END )
          ),
          prd AS (
            SELECT SUM(p.volume_m3) AS prod_m3
              FROM public.anp_producao_derivados p, ref
             WHERE p.produto = g.prod_produto
               AND make_date(p.ano, p.mes, 1) = ref.ref_month
          )
          SELECT imp.imp_m3 / NULLIF(imp.imp_m3 + prd.prod_m3, 0)
          FROM imp, prd
        ) AS imp_pct,
        ( SELECT br.blend_pct FROM public.fuel_blend_ratio br
           WHERE br.fuel_type = g.fuel_type AND br.vigente_desde <= g.monday
             AND (br.vigente_ate IS NULL OR br.vigente_ate >= g.monday)
           ORDER BY br.vigente_desde DESC LIMIT 1
        ) AS blend,
        -- Biofuel price with CARRY-FORWARD (latest published <= reference date,
        -- within a 35-day staleness cap; NULL beyond the cap).
        CASE WHEN g.fuel_type = 'Gasoline C' THEN
            -- Ethanol (CEPEA), kept at the existing 1-week LAG: reference date
            -- is the prior week's Saturday (g.saturday - 7). Carry forward the
            -- latest data_semana <= that date and within 35 days.
            ( SELECT ce.preco_rs_litro FROM public.cepea_etanol_anidro ce
               WHERE ce.data_semana <= (g.saturday - 7)
                 AND ce.data_semana >= (g.saturday - 7 - 35)
               ORDER BY ce.data_semana DESC LIMIT 1 )
          ELSE
            -- Biodiesel B-100 (ANP producers): national avg across regioes for
            -- the latest data_inicio <= the week's Saturday and within 35 days.
            ( SELECT AVG(pp.preco::numeric)
                FROM public.anp_precos_produtores pp
               WHERE pp.produto = 'Biodiesel B-100'
                 AND pp.data_inicio = (
                   SELECT MAX(pp2.data_inicio)
                     FROM public.anp_precos_produtores pp2
                    WHERE pp2.produto = 'Biodiesel B-100'
                      AND pp2.data_inicio <= g.saturday
                      AND pp2.data_inicio >= (g.saturday - 35)
                 ) )
        END AS biofuel_price,
        ( SELECT COALESCE(SUM(tr.rate_rs_litro), 0) FROM public.fuel_tax_reference tr
           WHERE tr.fuel_type = g.fuel_type AND tr.tax_type <> 'ICMS'
             AND tr.vigente_desde <= g.monday AND (tr.vigente_ate IS NULL OR tr.vigente_ate >= g.monday)
        ) AS federal_tax,
        ( SELECT tr.rate_rs_litro FROM public.fuel_tax_reference tr
           WHERE tr.fuel_type = g.fuel_type AND tr.tax_type = 'ICMS'
             AND tr.vigente_desde <= g.monday AND (tr.vigente_ate IS NULL OR tr.vigente_ate >= g.monday)
           ORDER BY tr.vigente_desde DESC LIMIT 1
        ) AS state_tax
      FROM grid g
    ),
    final AS (
      SELECT
        c.fuel_type, c.week_key, c.pump,
        ( (COALESCE(c.parity, 0) * c.imp_pct + COALESCE(c.petrobras, 0) * (1 - c.imp_pct)) * (1 - COALESCE(c.blend, 0)) ) AS base_fuel,
        ( COALESCE(c.blend, 0) * COALESCE(c.biofuel_price, 0) ) AS biofuel_component,
        COALESCE(c.federal_tax, 0) AS federal_tax,
        COALESCE(c.state_tax, 0)   AS state_tax
      FROM computed c
      -- SKIP weeks with no pump price (no data), no ad-rem ICMS rate yet
      -- (pre-ad-rem weeks stay as the manual series), no resolvable biofuel
      -- price after carry-forward, OR no resolvable import% (no common ANP
      -- daie+production month -- never happens in the computed era given the
      -- carry-forward). Removing the old `COALESCE(imp_pct, 0)` means a NULL
      -- split can no longer silently collapse to an all-Petrobras (0% import)
      -- base_fuel; instead the row is omitted.
      WHERE c.pump IS NOT NULL
        AND c.state_tax IS NOT NULL
        AND c.biofuel_price IS NOT NULL
        AND c.imp_pct IS NOT NULL
    )
    SELECT
      f.fuel_type, f.week_key,
      round(f.base_fuel::numeric, 6)         AS base_fuel,
      round(f.biofuel_component::numeric, 6) AS biofuel_component,
      round(f.federal_tax::numeric, 6)       AS federal_tax,
      round(f.state_tax::numeric, 6)         AS state_tax,
      round((f.pump - f.base_fuel - f.biofuel_component - f.federal_tax - f.state_tax)::numeric, 6) AS dist_margin,
      round(f.pump::numeric, 6)              AS total
    FROM final f
  LOOP
    INSERT INTO public.d_g_margins
      (fuel_type, week, base_fuel, biofuel_component, federal_tax, state_tax, distribution_and_resale_margin, total)
    VALUES
      (r.fuel_type, r.week_key, r.base_fuel, r.biofuel_component, r.federal_tax, r.state_tax, r.dist_margin, r.total)
    ON CONFLICT (fuel_type, week) DO UPDATE SET
      base_fuel = EXCLUDED.base_fuel,
      biofuel_component = EXCLUDED.biofuel_component,
      federal_tax = EXCLUDED.federal_tax,
      state_tax = EXCLUDED.state_tax,
      distribution_and_resale_margin = EXCLUDED.distribution_and_resale_margin,
      total = EXCLUDED.total;
    v_written := v_written + 1;
  END LOOP;

  RETURN v_written;
END;
$function$;

-- Re-apply attributes wiped by DROP+CREATE (Pegadinha #18) + lock down EXECUTE
-- to service_role only (recompute writes to d_g_margins; never anon/authed).
ALTER FUNCTION public.recompute_dg_margins(text, text) SECURITY DEFINER;
ALTER FUNCTION public.recompute_dg_margins(text, text) SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.recompute_dg_margins(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_dg_margins(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_dg_margins(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_dg_margins(text, text) TO service_role;

COMMIT;
