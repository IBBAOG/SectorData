-- Diesel & Gasoline margin automation — Wave 1: recompute_dg_margins() + RLS lock.
--
-- recompute_dg_margins(p_week_start, p_week_end) recomputes both fuels for the given
-- ISO-week range (NULL = all weeks present in price_bands / anp_lpc) and UPSERTs into
-- d_g_margins on (fuel_type, week). The composition formula (R$/L) was verified by the
-- paper back-test against the manual series.
--
-- Week key format MUST match d_g_margins: unpadded
--   extract(week from date)::int || '/' || extract(isoyear from date)::int
-- "Month of a week" (for the monthly import% split) = the ISO week's THURSDAY -> its month/year.
--
-- Per-fuel mapping:
--   Gasoline C -> price_bands.product='Gasoline', anp_lpc.produto='GASOLINA COMUM',
--                 production 'GASOLINA A', gasoline NCMs, density 745;
--                 biofuel = blend * CEPEA anhydrous ethanol of the PRIOR ISO week (LAG 1 WEEK).
--   Diesel B   -> price_bands.product='Diesel', anp_lpc.produto='DIESEL S10',
--                 production 'OLEO DIESEL', diesel NCM '27101921', density 832;
--                 biofuel = blend * national avg of anp_precos_produtores('Biodiesel B-100')
--                 across regioes for the SAME ISO week (data_inicio), NO lag.
--
-- SECURITY DEFINER + SET search_path because it reads RLS-scoped statistical tables
-- (price_bands, anp_lpc, anp_precos_produtores, anp_desembaracos) and writes d_g_margins
-- (which is locked to service_role + this function below). Pegadinha #18.

CREATE OR REPLACE FUNCTION public.recompute_dg_margins(
  p_week_start TEXT DEFAULT NULL,
  p_week_end   TEXT DEFAULT NULL
)
RETURNS INT                                              -- number of (fuel,week) rows written
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_date_start DATE := NULL;                             -- ISO-week Monday derived from p_week_start
  v_date_end   DATE := NULL;                             -- ISO-week Monday derived from p_week_end
  v_written    INT  := 0;
  r            RECORD;
BEGIN
  -- Parse the unpadded "W/YYYY" range bounds into ISO-week Monday dates (inclusive).
  IF p_week_start IS NOT NULL AND length(trim(p_week_start)) > 0 THEN
    v_date_start := to_date(split_part(p_week_start, '/', 2) || '-' || split_part(p_week_start, '/', 1), 'IYYY-IW');
  END IF;
  IF p_week_end IS NOT NULL AND length(trim(p_week_end)) > 0 THEN
    v_date_end := to_date(split_part(p_week_end, '/', 2) || '-' || split_part(p_week_end, '/', 1), 'IYYY-IW');
  END IF;

  FOR r IN
    WITH
    -- Candidate ISO-week Mondays present in either source, optionally range-filtered.
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
    -- Each fuel paired with its source-key mapping.
    fuels AS (
      SELECT * FROM (VALUES
        ('Gasoline C', 'Gasoline', 'GASOLINA COMUM', 'GASOLINA A',  745::numeric),
        ('Diesel B',   'Diesel',   'DIESEL S10',     'OLEO DIESEL', 832::numeric)
      ) f(fuel_type, pb_product, lpc_produto, prod_produto, default_density)
    ),
    grid AS (
      SELECT
        w.monday,
        (w.monday + 6)                                            AS sunday,        -- ISO week Sunday
        (w.monday + 3)                                            AS thursday,      -- month attribution
        (extract(week    FROM w.monday)::int)                     AS iso_week,
        (extract(isoyear FROM w.monday)::int)                     AS iso_year,
        (extract(month   FROM (w.monday + 3))::int)               AS m_month,
        (extract(year    FROM (w.monday + 3))::int)               AS m_year,
        f.fuel_type, f.pb_product, f.lpc_produto, f.prod_produto, f.default_density
      FROM weeks w CROSS JOIN fuels f
    ),
    computed AS (
      SELECT
        g.fuel_type,
        g.iso_week || '/' || g.iso_year                           AS week_key,
        g.monday, g.sunday,

        -- Station-weighted national pump price (R$/L) over the ISO week (data_fim).
        ( SELECT SUM(l.preco_medio_venda::numeric * l.n_postos)
                 / NULLIF(SUM(l.n_postos), 0)
            FROM public.anp_lpc l
           WHERE l.produto = g.lpc_produto
             AND l.data_fim BETWEEN g.monday AND g.sunday
        )                                                         AS pump,

        -- BBA import parity, weekly average (R$/L).
        ( SELECT AVG(pb.bba_import_parity)
            FROM public.price_bands pb
           WHERE pb.product = g.pb_product
             AND pb.date BETWEEN g.monday AND g.sunday
        )                                                         AS parity,

        -- Petrobras price, weekly average (R$/L).
        ( SELECT AVG(pb.petrobras_price)
            FROM public.price_bands pb
           WHERE pb.product = g.pb_product
             AND pb.date BETWEEN g.monday AND g.sunday
        )                                                         AS petrobras,

        -- Import share for the week's month, carrying forward the most recent
        -- available production month when the current one is not yet published.
        ( WITH imp AS (
            -- Imported m3: prefer anp_desembaracos for the week's month; fall back to mdic_comex.
            SELECT COALESCE(
              ( SELECT SUM(de.quantidade_kg
                          / COALESCE((SELECT nd.densidade_kg_m3 FROM public.ncm_densidade_kg_m3 nd
                                       WHERE nd.ncm_codigo = de.ncm_codigo), g.default_density))
                  FROM public.anp_desembaracos de
                 WHERE de.ano = g.m_year AND de.mes = g.m_month
                   AND de.cnpj <> '__legacy__'
                   AND de.ncm_codigo = ANY(
                     CASE WHEN g.fuel_type = 'Gasoline C'
                          THEN ARRAY['27101259','27101931','27101932']
                          ELSE ARRAY['27101921'] END
                   )
              ),
              ( SELECT SUM(mc.volume_kg
                          / COALESCE((SELECT nd.densidade_kg_m3 FROM public.ncm_densidade_kg_m3 nd
                                       WHERE nd.ncm_codigo = mc.ncm_codigo), g.default_density))
                  FROM public.mdic_comex mc
                 WHERE mc.flow = 'import' AND mc.ano = g.m_year AND mc.mes = g.m_month
                   AND mc.ncm_codigo = ANY(
                     CASE WHEN g.fuel_type = 'Gasoline C'
                          THEN ARRAY['27101259','27101931','27101932']
                          ELSE ARRAY['27101921'] END
                   )
              )
            ) AS imp_m3
          ),
          prd AS (
            -- Production m3 for the week's month, else carry forward the latest <= that month.
            SELECT (
              SELECT pr.volume_m3
                FROM public.anp_producao_derivados pr
               WHERE pr.produto = g.prod_produto
                 AND make_date(pr.ano, pr.mes, 1) <= make_date(g.m_year, g.m_month, 1)
               ORDER BY pr.ano DESC, pr.mes DESC
               LIMIT 1
            ) AS prod_m3
          )
          SELECT CASE
                   WHEN imp.imp_m3 IS NULL OR prd.prod_m3 IS NULL
                        OR (imp.imp_m3 + prd.prod_m3) = 0
                   THEN NULL
                   ELSE imp.imp_m3 / (imp.imp_m3 + prd.prod_m3)
                 END
          FROM imp, prd
        )                                                         AS imp_pct,

        -- Active mandatory blend fraction on the week's date.
        ( SELECT br.blend_pct
            FROM public.fuel_blend_ratio br
           WHERE br.fuel_type = g.fuel_type
             AND br.vigente_desde <= g.monday
             AND (br.vigente_ate IS NULL OR br.vigente_ate >= g.monday)
           ORDER BY br.vigente_desde DESC
           LIMIT 1
        )                                                         AS blend,

        -- Biofuel reference price (R$/L).
        CASE
          WHEN g.fuel_type = 'Gasoline C' THEN
            -- CEPEA anhydrous ethanol of the PRIOR ISO week (LAG 1 WEEK).
            ( SELECT ce.preco_rs_litro
                FROM public.cepea_etanol_anidro ce
               WHERE ce.data_semana BETWEEN (g.monday - 7) AND (g.sunday - 7)
               ORDER BY ce.data_semana DESC
               LIMIT 1 )
          ELSE
            -- National avg of Biodiesel B-100 across regioes for the SAME ISO week (no lag).
            ( SELECT AVG(pp.preco::numeric)
                FROM public.anp_precos_produtores pp
               WHERE pp.produto = 'Biodiesel B-100'
                 AND pp.data_inicio BETWEEN g.monday AND g.sunday )
        END                                                       AS biofuel_price,

        -- federal_tax = SUM of non-ICMS rates active on the week date.
        ( SELECT COALESCE(SUM(tr.rate_rs_litro), 0)
            FROM public.fuel_tax_reference tr
           WHERE tr.fuel_type = g.fuel_type
             AND tr.tax_type <> 'ICMS'
             AND tr.vigente_desde <= g.monday
             AND (tr.vigente_ate IS NULL OR tr.vigente_ate >= g.monday)
        )                                                         AS federal_tax,

        -- state_tax = ICMS rate active on the week date.
        ( SELECT tr.rate_rs_litro
            FROM public.fuel_tax_reference tr
           WHERE tr.fuel_type = g.fuel_type
             AND tr.tax_type = 'ICMS'
             AND tr.vigente_desde <= g.monday
             AND (tr.vigente_ate IS NULL OR tr.vigente_ate >= g.monday)
           ORDER BY tr.vigente_desde DESC
           LIMIT 1
        )                                                         AS state_tax

      FROM grid g
    ),
    final AS (
      SELECT
        c.fuel_type,
        c.week_key,
        c.pump,
        -- base_fuel = (parity*impPct + petrobras*(1-impPct)) * (1 - blend)
        ( (COALESCE(c.parity, 0) * COALESCE(c.imp_pct, 0)
           + COALESCE(c.petrobras, 0) * (1 - COALESCE(c.imp_pct, 0)))
          * (1 - COALESCE(c.blend, 0)) )                          AS base_fuel,
        -- biofuel_component = blend * biofuel reference price
        ( COALESCE(c.blend, 0) * COALESCE(c.biofuel_price, 0) )   AS biofuel_component,
        COALESCE(c.federal_tax, 0)                                AS federal_tax,
        COALESCE(c.state_tax, 0)                                  AS state_tax
      FROM computed c
      WHERE c.pump IS NOT NULL                                    -- skip weeks with no LPC data
    )
    SELECT
      f.fuel_type,
      f.week_key,
      -- Cast to numeric before round(): imp_pct comes from double-precision kg/density
      -- columns, so base_fuel would otherwise be double precision (no round(double,int)).
      round(f.base_fuel::numeric, 6)                                                       AS base_fuel,
      round(f.biofuel_component::numeric, 6)                                               AS biofuel_component,
      round(f.federal_tax::numeric, 6)                                                     AS federal_tax,
      round(f.state_tax::numeric, 6)                                                       AS state_tax,
      round((f.pump - f.base_fuel - f.biofuel_component - f.federal_tax - f.state_tax)::numeric, 6) AS dist_margin,
      round(f.pump::numeric, 6)                                                            AS total
    FROM final f
  LOOP
    INSERT INTO public.d_g_margins
      (fuel_type, week, base_fuel, biofuel_component, federal_tax, state_tax,
       distribution_and_resale_margin, total)
    VALUES
      (r.fuel_type, r.week_key, r.base_fuel, r.biofuel_component, r.federal_tax, r.state_tax,
       r.dist_margin, r.total)
    ON CONFLICT (fuel_type, week) DO UPDATE SET
      base_fuel                      = EXCLUDED.base_fuel,
      biofuel_component              = EXCLUDED.biofuel_component,
      federal_tax                    = EXCLUDED.federal_tax,
      state_tax                      = EXCLUDED.state_tax,
      distribution_and_resale_margin = EXCLUDED.distribution_and_resale_margin,
      total                          = EXCLUDED.total;
    v_written := v_written + 1;
  END LOOP;

  RETURN v_written;
END;
$$;

-- recompute is a maintenance/ETL entry point — only service_role may invoke it.
REVOKE ALL ON FUNCTION public.recompute_dg_margins(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_dg_margins(TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- Lock d_g_margins composition writes.
-- The manual composition form can no longer write (Wave 3 removes the UI). Only
-- service_role (RLS bypass) and recompute_dg_margins() (SECURITY DEFINER) write now.
-- Keep the SELECT policy for authenticated. get_dg_margins_data / get_dg_margins_filters
-- (dashboard contract) are untouched.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS d_g_margins_admin_write ON public.d_g_margins;
