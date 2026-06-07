-- Authoritative tax re-seed for the /diesel-gasoline-margins automation.
--
-- The prior migration 20260611100000_dg_margins_full_tax_blend_timeline.sql
-- seeded fuel_tax_reference by BACK-SOLVING (federal_tax, state_tax) from the
-- manual d_g_margins sheet. That was WRONG: the manual taxes were partly
-- deliberately incorrect, so the back-solved values inherited those errors.
--
-- This migration REPLACES fuel_tax_reference with the AUTHORITATIVE composition
-- cross-checked against:
--   * the ANP "Sintese de Precos" official price-composition tables, and
--   * CONFAZ convenios (the ad-rem / fixed-per-litre ICMS regime).
--
-- Conventions used here (must match how recompute_dg_margins reads the table):
--   * Federal is stored PRE-BLENDED at the final-fuel level as a SINGLE
--     FEDERAL_TOTAL row per period. recompute sums every non-ICMS row as
--     federal_tax (SUM(rate_rs_litro) WHERE tax_type <> 'ICMS'), so one
--     FEDERAL_TOTAL row resolves directly to that value.
--   * ICMS is the ad-rem (fixed BRL/L) CONFAZ rate. There are NO ICMS rows
--     before the ad-rem era (gasoline 2023-06-01, diesel 2023-05-01). For
--     weeks before that, the ICMS lookup returns NULL and recompute SKIPS the
--     (fuel, week) -- those weeks stay as the manual series (see part 2).
--   * vigente_desde = period start; vigente_ate = next period start - 1 day;
--     the latest (open) period has vigente_ate = NULL so future weeks resolve.
--   * recompute matches a week by the Monday of its ISO week:
--       vigente_desde <= monday AND (vigente_ate IS NULL OR vigente_ate >= monday)
--
-- The fuel_blend_ratio table from 20260611100000 is CORRECT and is NOT touched
-- here.

BEGIN;

-- =========================================================================
-- (1) fuel_tax_reference -- replace the back-solved seed with authoritative
--     ANP Sintese (federal) + CONFAZ ad-rem (ICMS) values.
-- =========================================================================

-- The federal line is now a single pre-blended 'FEDERAL_TOTAL' row per period
-- (instead of the previous CIDE/PIS_PASEP/COFINS split). Widen the tax_type
-- CHECK to allow it; keep the legacy component types for back-compat.
ALTER TABLE public.fuel_tax_reference
  DROP CONSTRAINT IF EXISTS fuel_tax_reference_tax_type_check;
ALTER TABLE public.fuel_tax_reference
  ADD CONSTRAINT fuel_tax_reference_tax_type_check
  CHECK (tax_type = ANY (ARRAY['CIDE','PIS_PASEP','COFINS','FEDERAL_TOTAL','ICMS']));

DELETE FROM public.fuel_tax_reference;

INSERT INTO public.fuel_tax_reference
  (vigente_desde, vigente_ate, fuel_type, tax_type, rate_rs_litro, fonte)
VALUES
  -- ---------------------------------------------------------------------
  -- GASOLINE C -- FEDERAL_TOTAL (pre-blended at final-fuel level)
  -- ---------------------------------------------------------------------
  ('2021-01-01', '2022-06-22', 'Gasoline C', 'FEDERAL_TOTAL', 0.70, 'ANP composition (full, E27)'),
  ('2022-06-23', '2023-02-28', 'Gasoline C', 'FEDERAL_TOTAL', 0.00, 'LC 194/2022 desoneracao'),
  ('2023-03-01', '2023-06-28', 'Gasoline C', 'FEDERAL_TOTAL', 0.33, 'MP 1.163/2023 partial, blended'),
  ('2023-06-29', '2025-07-31', 'Gasoline C', 'FEDERAL_TOTAL', 0.70, 'ANP composition (full, E27)'),
  ('2025-08-01', NULL,         'Gasoline C', 'FEDERAL_TOTAL', 0.68, 'ANP Sintese (full, E30)'),

  -- ---------------------------------------------------------------------
  -- GASOLINE C -- ICMS (CONFAZ ad-rem; no rows before 2023-06-01)
  -- ---------------------------------------------------------------------
  ('2023-06-01', '2024-01-31', 'Gasoline C', 'ICMS', 1.22,   'CONFAZ Conv. 15/2023'),
  ('2024-02-01', '2025-01-31', 'Gasoline C', 'ICMS', 1.3721, 'CONFAZ Conv. 173/2023'),
  ('2025-02-01', '2025-12-31', 'Gasoline C', 'ICMS', 1.47,   'CONFAZ Conv. 127/2024'),
  ('2026-01-01', NULL,         'Gasoline C', 'ICMS', 1.57,   'CONFAZ Conv. 112/2025'),

  -- ---------------------------------------------------------------------
  -- DIESEL B -- FEDERAL_TOTAL (pre-blended at final-fuel level)
  -- ---------------------------------------------------------------------
  ('2021-01-01', '2022-03-10', 'Diesel B', 'FEDERAL_TOTAL', 0.32, 'ANP composition (full)'),
  ('2022-03-11', '2023-12-31', 'Diesel B', 'FEDERAL_TOTAL', 0.00, 'LC 192/2022 desoneracao'),
  ('2024-01-01', '2026-03-11', 'Diesel B', 'FEDERAL_TOTAL', 0.32, 'ANP Sintese (full)'),
  ('2026-03-12', NULL,         'Diesel B', 'FEDERAL_TOTAL', 0.00, 'MP 1.340/2026 + Decreto 12.878/2026'),

  -- ---------------------------------------------------------------------
  -- DIESEL B -- ICMS (CONFAZ ad-rem; no rows before 2023-05-01)
  -- ---------------------------------------------------------------------
  ('2023-05-01', '2024-01-31', 'Diesel B', 'ICMS', 0.9456, 'CONFAZ Conv. 199/2022 (initial)'),
  ('2024-02-01', '2025-01-31', 'Diesel B', 'ICMS', 1.0635, 'CONFAZ Conv. 172/2023'),
  ('2025-02-01', '2025-12-31', 'Diesel B', 'ICMS', 1.12,   'CONFAZ Conv. 126/2024'),
  ('2026-01-01', NULL,         'Diesel B', 'ICMS', 1.17,   'CONFAZ Conv. 113/2025');

-- =========================================================================
-- (2) recompute_dg_margins -- add a SKIP guard for NULL ICMS.
--     Identical to the current body except the final CTE now also requires
--     c.state_tax IS NOT NULL: weeks before the ad-rem ICMS era (where the
--     ICMS lookup returns NULL) are NOT recomputed and keep the manual values.
--
--     DROP + CREATE preserves nothing (grants, SECURITY DEFINER, search_path),
--     so all attributes are re-applied explicitly below (CLAUDE.md Pegadinha
--     #18). Signature and every other line are unchanged.
-- =========================================================================
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
        CASE WHEN g.fuel_type = 'Gasoline C' THEN
            ( SELECT ce.preco_rs_litro FROM public.cepea_etanol_anidro ce
               WHERE ce.data_semana BETWEEN (g.monday - 7) AND (g.sunday - 7)
               ORDER BY ce.data_semana DESC LIMIT 1 )
          ELSE
            ( SELECT AVG(pp.preco::numeric) FROM public.anp_precos_produtores pp
               WHERE pp.produto = 'Biodiesel B-100' AND pp.data_inicio BETWEEN g.monday AND g.sunday )
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
      -- SKIP weeks with no pump price (no data) OR no ad-rem ICMS rate yet
      -- (pre-ad-rem weeks stay as the manual series).
      WHERE c.pump IS NOT NULL
        AND c.state_tax IS NOT NULL
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

-- Re-apply attributes wiped by DROP+CREATE (Pegadinha #18).
ALTER FUNCTION public.recompute_dg_margins(text, text) SECURITY DEFINER;
ALTER FUNCTION public.recompute_dg_margins(text, text) SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.recompute_dg_margins(text, text) TO service_role;

COMMIT;
