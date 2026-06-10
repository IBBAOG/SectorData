-- Carry-forward the biofuel price in recompute_dg_margins + skip rows whose
-- biofuel component cannot be resolved.
--
-- BUG (live, Diesel B week 22/2026): the diesel biofuel component was computed
-- as `biodiesel_blend x (national-avg Biodiesel B-100 price for the SAME ISO
-- week)`. anp_precos_produtores lags ~1 week (it stopped at week 21/2026 while
-- anp_lpc pump exists through week 22), so the exact-week lookup returned NULL,
-- biofuel collapsed to `blend x COALESCE(NULL, 0) = 0`, and because
--   distribution_and_resale_margin = pump - base_fuel - biofuel - federal - icms,
-- the missing ~R$0.70 of biodiesel cost leaked straight into the residual
-- margin (wk22 showed biofuel=0.0000, margin=2.6121; should be ~0.70 / ~1.91).
-- The same risk exists for gasoline (CEPEA ethanol, used at a week-1 lag),
-- though CEPEA is usually published ahead.
--
-- FIX (CTO-approved = carry-forward):
--   (1) Instead of requiring the price for the EXACT target ISO week, use the
--       price from the MOST RECENT available week whose reference date is
--       <= the week's Saturday, within a staleness cap of 35 days (~5 weeks).
--       Beyond the cap -> treat as missing (NULL).
--         - DIESEL biofuel: reference date = the week's Saturday (monday+5);
--           carry forward the national-avg anp_precos_produtores 'Biodiesel
--           B-100' price (avg across regioes) from the latest data_inicio
--           <= that Saturday and within 35 days.
--         - GASOLINE biofuel: keep the existing 1-week LAG (CEPEA of the prior
--           ISO week); apply the same carry-forward -> latest
--           cepea_etanol_anidro.data_semana <= (Saturday - 7) and within 35 days.
--   (2) SKIP the row when biofuel is STILL NULL after carry-forward (price never
--       existed or > 35 days stale -- e.g. pre-2022 diesel). Added to the
--       existing skip conditions (pump NULL, ICMS/state_tax NULL). This
--       GUARANTEES the residual margin can never again absorb a missing biofuel
--       component -- no row is ever emitted with a spurious biofuel=0.
--
-- Blend scaling, taxes, pump and base_fuel logic are IDENTICAL to the prior
-- body (20260612100000). Only the biofuel_price expression in the `computed`
-- CTE and the WHERE in the `final` CTE change.
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
        ( WITH imp AS (
            SELECT COALESCE(
              ( SELECT SUM(de.quantidade_kg / COALESCE((SELECT nd.densidade_kg_m3 FROM public.ncm_densidade_kg_m3 nd WHERE nd.ncm_codigo = de.ncm_codigo), g.default_density))
                  FROM public.anp_desembaracos de
                 WHERE de.ano = g.m_year AND de.mes = g.m_month AND de.cnpj <> '__legacy__'
                   AND de.ncm_codigo = ANY(CASE WHEN g.fuel_type = 'Gasoline C' THEN ARRAY['27101259','27101931','27101932'] ELSE ARRAY['27101921'] END)
              ),
              ( SELECT SUM(mc.volume_kg / COALESCE((SELECT nd.densidade_kg_m3 FROM public.ncm_densidade_kg_m3 nd WHERE nd.ncm_codigo = mc.ncm_codigo), g.default_density))
                  FROM public.mdic_comex mc
                 WHERE mc.flow = 'import' AND mc.ano = g.m_year AND mc.mes = g.m_month
                   AND mc.ncm_codigo = ANY(CASE WHEN g.fuel_type = 'Gasoline C' THEN ARRAY['27101259','27101931','27101932'] ELSE ARRAY['27101921'] END)
              )
            ) AS imp_m3
          ),
          prd AS (
            SELECT ( SELECT pr.volume_m3 FROM public.anp_producao_derivados pr
                      WHERE pr.produto = g.prod_produto AND make_date(pr.ano, pr.mes, 1) <= make_date(g.m_year, g.m_month, 1)
                      ORDER BY pr.ano DESC, pr.mes DESC LIMIT 1 ) AS prod_m3
          )
          SELECT CASE WHEN imp.imp_m3 IS NULL OR prd.prod_m3 IS NULL OR (imp.imp_m3 + prd.prod_m3) = 0
                      THEN NULL ELSE imp.imp_m3 / (imp.imp_m3 + prd.prod_m3) END
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
        ( (COALESCE(c.parity, 0) * COALESCE(c.imp_pct, 0) + COALESCE(c.petrobras, 0) * (1 - COALESCE(c.imp_pct, 0))) * (1 - COALESCE(c.blend, 0)) ) AS base_fuel,
        ( COALESCE(c.blend, 0) * COALESCE(c.biofuel_price, 0) ) AS biofuel_component,
        COALESCE(c.federal_tax, 0) AS federal_tax,
        COALESCE(c.state_tax, 0)   AS state_tax
      FROM computed c
      -- SKIP weeks with no pump price (no data), no ad-rem ICMS rate yet
      -- (pre-ad-rem weeks stay as the manual series), OR no resolvable biofuel
      -- price after carry-forward (guarantees no spurious biofuel=0 leaking
      -- into the residual margin).
      WHERE c.pump IS NOT NULL
        AND c.state_tax IS NOT NULL
        AND c.biofuel_price IS NOT NULL
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
