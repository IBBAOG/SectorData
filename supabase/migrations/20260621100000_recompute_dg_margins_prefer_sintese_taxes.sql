-- recompute_dg_margins — prefer ANP Síntese published federal + ICMS taxes
-- (public.anp_sintese_taxes), fall back to the curated fuel_tax_reference on weeks
-- where the Síntese has no published line.
--
-- WHY: the ANP "Síntese de Preços" weekly edition publishes a per-litre price
-- composition that includes two tax lines per fuel — "Tributos Federais"
-- (CIDE + PIS/PASEP + COFINS, already summed by ANP) and "ICMS" (state tax). Those
-- are now captured week-by-week in public.anp_sintese_taxes(data_fim, fuel_type,
-- federal_rs_litro, icms_rs_litro) by the weekly Síntese scraper. By preferring that
-- table, /diesel-gasoline-margins AUTO-UPDATES its federal + ICMS taxes the moment
-- ANP changes them: the scraper captures the new published value and the next
-- recompute picks it up — no manual fuel_tax_reference edit required.
--
-- fuel_tax_reference stays as the curated HISTORICAL / GAP fallback (time-versioned
-- vigente_desde..vigente_ate rows). recompute_dg_margins prefers a matching
-- anp_sintese_taxes row for the week and falls back to fuel_tax_reference when the
-- Síntese edition published no line for that ISO week.
--
-- NO VALUE SHIFT NOW: the 6 anp_sintese_taxes rows currently published (wks ending
-- 2026-04-11, 2026-05-30, 2026-06-06; Gasoline C 0.68 federal / 1.57 ICMS, Diesel B
-- 0.00 federal / 1.17 ICMS) EQUAL the seeded fuel_tax_reference values, so this
-- change produces no value movement today. It is purely structural — it wires the
-- auto-update path for future ANP tax changes.
--
-- CHANGE (the ONLY behavioural change vs 20260617100000) — two columns in the
-- `computed` CTE:
--   federal_tax(fuel, week) = COALESCE(
--     -- (1) ANP Síntese published "Tributos Federais" for the SAME ISO
--     --     (week, isoyear) of the grid's monday, matched to the fuel_type
--     --     ('Gasoline C' / 'Diesel B' already match anp_sintese_taxes.fuel_type):
--     anp_sintese_taxes.federal_rs_litro,   -- ORDER BY data_fim DESC LIMIT 1 (defensive)
--     -- (2) fallback ONLY on weeks with no Síntese row — byte-for-byte the existing
--     --     fuel_tax_reference SUM of non-ICMS active rows (unchanged):
--     SUM(fuel_tax_reference.rate_rs_litro WHERE tax_type <> 'ICMS' AND active on monday)
--   )
--   state_tax(fuel, week) = COALESCE(
--     -- (1) ANP Síntese published "ICMS" for the same ISO (week, isoyear):
--     anp_sintese_taxes.icms_rs_litro,      -- ORDER BY data_fim DESC LIMIT 1 (defensive)
--     -- (2) fallback ONLY on weeks with no Síntese row — byte-for-byte the existing
--     --     fuel_tax_reference ICMS lookup (unchanged):
--     fuel_tax_reference.rate_rs_litro WHERE tax_type = 'ICMS' AND active on monday
--   )
--
-- The match key is the ISO (week, isoyear) computed from anp_sintese_taxes.data_fim
-- — the SAME key the function uses to key d_g_margins and to join anp_lpc_brasil.
-- ORDER BY data_fim DESC LIMIT 1 picks the latest row defensively in the (not
-- observed; PK is (data_fim, fuel_type)) case of two Síntese rows landing in one ISO
-- week for the same fuel.
--
-- The skip-if-state_tax-NULL guard is preserved: state_tax now COALESCEs Síntese then
-- the reference, so it still resolves to a value wherever it did before (and skips a
-- week only when BOTH sources are absent — unchanged behaviour, since Síntese only
-- ever ADDS coverage). distribution_and_resale_margin stays the residual
--   total − base_fuel − biofuel − federal − ICMS,
-- so when (as today) Síntese == reference, total and the residual margin are
-- byte-for-byte unchanged on covered weeks.
--
-- NOT CHANGED: everything else is byte-for-byte the body live as of 20260617100000 —
-- the set-based imp_pct_by_month precompute, base_fuel (single-source import% from
-- anp_daie INTERSECT anp_producao_derivados), biofuel carry-forward (CEPEA for
-- gasoline, ANP Biodiesel B-100 for diesel), pump = anp_lpc_brasil national value
-- with the station-weighted anp_lpc fallback, blend, the skip-if-NULL guard, the
-- INSERT ... ON CONFLICT, and the function's signature, SECURITY DEFINER,
-- SET search_path = public, pg_temp, SET statement_timeout = '300s', plus the
-- service-role-only grants.
--
-- Idempotent: CREATE OR REPLACE + explicit REVOKE/GRANT re-application (Pegadinha
-- #18 — DROP+CREATE would wipe grants/attributes; we use CREATE OR REPLACE and
-- re-apply the lockdown defensively).

CREATE OR REPLACE FUNCTION public.recompute_dg_margins(
  p_week_start text DEFAULT NULL::text,
  p_week_end   text DEFAULT NULL::text
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  SET statement_timeout = '300s'
AS $function$
DECLARE
  v_date_start DATE := NULL;
  v_date_end   DATE := NULL;
  v_written    INT  := 0;
  r            RECORD;
BEGIN
  -- Belt-and-suspenders: also lift the timeout for this transaction, in case the
  -- function-level SET is bypassed (e.g. a direct in-session SELECT call).
  SET LOCAL statement_timeout = '300s';

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
    -- Set-based precompute of the import%/production% split, ONCE per distinct
    -- (fuel_type, target month). imp_pct depends only on (fuel_type, m_year,
    -- m_month) -- it is week-independent -- so evaluating it per distinct month
    -- and joining back yields the SAME value the old per-grid-row correlated
    -- subquery produced, at ~4.3x fewer evaluations (526 vs 2254). The ref_month,
    -- INTERSECT, ILIKE and SUM logic are reproduced verbatim from 20260613300000.
    grid_months AS (
      SELECT DISTINCT g.fuel_type, g.prod_produto, g.m_year, g.m_month
      FROM grid g
    ),
    imp_pct_by_month AS (
      SELECT
        gm.fuel_type, gm.m_year, gm.m_month,
        ( WITH ref AS (
            SELECT MAX(common.m) AS ref_month
            FROM (
              SELECT make_date(d.ano, d.mes, 1) AS m
                FROM public.anp_daie d
               WHERE d.operacao ILIKE 'IMPORTA%'
                 AND make_date(d.ano, d.mes, 1) <= make_date(gm.m_year, gm.m_month, 1)
                 AND ( CASE WHEN gm.fuel_type = 'Gasoline C'
                            THEN d.produto = 'GASOLINA A'
                            ELSE d.produto ILIKE '%diesel%'
                       END )
              INTERSECT
              SELECT make_date(p.ano, p.mes, 1) AS m
                FROM public.anp_producao_derivados p
               WHERE p.produto = gm.prod_produto
                 AND make_date(p.ano, p.mes, 1) <= make_date(gm.m_year, gm.m_month, 1)
            ) common
          ),
          imp AS (
            SELECT SUM(d.volume_m3) AS imp_m3
              FROM public.anp_daie d, ref
             WHERE d.operacao ILIKE 'IMPORTA%'
               AND make_date(d.ano, d.mes, 1) = ref.ref_month
               AND ( CASE WHEN gm.fuel_type = 'Gasoline C'
                          THEN d.produto = 'GASOLINA A'
                          ELSE d.produto ILIKE '%diesel%'
                     END )
          ),
          prd AS (
            SELECT SUM(p.volume_m3) AS prod_m3
              FROM public.anp_producao_derivados p, ref
             WHERE p.produto = gm.prod_produto
               AND make_date(p.ano, p.mes, 1) = ref.ref_month
          )
          SELECT imp.imp_m3 / NULLIF(imp.imp_m3 + prd.prod_m3, 0)
          FROM imp, prd
        ) AS imp_pct
      FROM grid_months gm
    ),
    computed AS (
      SELECT
        g.fuel_type,
        g.iso_week || '/' || g.iso_year AS week_key,
        g.monday, g.sunday,
        -- PUMP = ANP-published national "Brasil" resale price for this ISO
        -- (week, isoyear), falling back to the station-weighted anp_lpc average
        -- only when ANP published no national row for the week (gap weeks).
        COALESCE(
          ( SELECT b.preco_revenda
              FROM public.anp_lpc_brasil b
             WHERE b.produto = g.lpc_produto
               AND extract(week    FROM b.data_fim)::int = g.iso_week
               AND extract(isoyear FROM b.data_fim)::int = g.iso_year
             ORDER BY b.data_fim DESC
             LIMIT 1
          ),
          ( SELECT SUM(l.preco_medio_venda::numeric * l.n_postos) / NULLIF(SUM(l.n_postos), 0)
              FROM public.anp_lpc l
             WHERE l.produto = g.lpc_produto AND l.data_fim BETWEEN g.monday AND g.sunday
          )
        ) AS pump,
        ( SELECT AVG(pb.bba_import_parity) FROM public.price_bands pb
           WHERE pb.product = g.pb_product AND pb.date BETWEEN g.monday AND g.sunday
        ) AS parity,
        ( SELECT AVG(pb.petrobras_price) FROM public.price_bands pb
           WHERE pb.product = g.pb_product AND pb.date BETWEEN g.monday AND g.sunday
        ) AS petrobras,
        ipm.imp_pct AS imp_pct,
        ( SELECT br.blend_pct FROM public.fuel_blend_ratio br
           WHERE br.fuel_type = g.fuel_type AND br.vigente_desde <= g.monday
             AND (br.vigente_ate IS NULL OR br.vigente_ate >= g.monday)
           ORDER BY br.vigente_desde DESC LIMIT 1
        ) AS blend,
        CASE WHEN g.fuel_type = 'Gasoline C' THEN
            ( SELECT ce.preco_rs_litro FROM public.cepea_etanol_anidro ce
               WHERE ce.data_semana <= (g.saturday - 7)
                 AND ce.data_semana >= (g.saturday - 7 - 35)
               ORDER BY ce.data_semana DESC LIMIT 1 )
          ELSE
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
        -- FEDERAL TAX = ANP Síntese published "Tributos Federais" for this ISO
        -- (week, isoyear), falling back to the curated fuel_tax_reference SUM of
        -- active non-ICMS rows only on weeks where the Síntese has no row.
        COALESCE(
          ( SELECT s.federal_rs_litro FROM public.anp_sintese_taxes s
             WHERE s.fuel_type = g.fuel_type
               AND extract(week    FROM s.data_fim)::int = g.iso_week
               AND extract(isoyear FROM s.data_fim)::int = g.iso_year
             ORDER BY s.data_fim DESC
             LIMIT 1
          ),
          ( SELECT COALESCE(SUM(tr.rate_rs_litro), 0) FROM public.fuel_tax_reference tr
             WHERE tr.fuel_type = g.fuel_type AND tr.tax_type <> 'ICMS'
               AND tr.vigente_desde <= g.monday AND (tr.vigente_ate IS NULL OR tr.vigente_ate >= g.monday)
          )
        ) AS federal_tax,
        -- STATE TAX (ICMS) = ANP Síntese published "ICMS" for this ISO
        -- (week, isoyear), falling back to the curated fuel_tax_reference ICMS row
        -- only on weeks where the Síntese has no row.
        COALESCE(
          ( SELECT s.icms_rs_litro FROM public.anp_sintese_taxes s
             WHERE s.fuel_type = g.fuel_type
               AND extract(week    FROM s.data_fim)::int = g.iso_week
               AND extract(isoyear FROM s.data_fim)::int = g.iso_year
             ORDER BY s.data_fim DESC
             LIMIT 1
          ),
          ( SELECT tr.rate_rs_litro FROM public.fuel_tax_reference tr
             WHERE tr.fuel_type = g.fuel_type AND tr.tax_type = 'ICMS'
               AND tr.vigente_desde <= g.monday AND (tr.vigente_ate IS NULL OR tr.vigente_ate >= g.monday)
             ORDER BY tr.vigente_desde DESC LIMIT 1
          )
        ) AS state_tax
      FROM grid g
      LEFT JOIN imp_pct_by_month ipm
        ON ipm.fuel_type = g.fuel_type
       AND ipm.m_year    = g.m_year
       AND ipm.m_month   = g.m_month
    ),
    final AS (
      SELECT
        c.fuel_type, c.week_key, c.pump,
        ( (COALESCE(c.parity, 0) * c.imp_pct + COALESCE(c.petrobras, 0) * (1 - c.imp_pct)) * (1 - COALESCE(c.blend, 0)) ) AS base_fuel,
        ( COALESCE(c.blend, 0) * COALESCE(c.biofuel_price, 0) ) AS biofuel_component,
        COALESCE(c.federal_tax, 0) AS federal_tax,
        COALESCE(c.state_tax, 0)   AS state_tax
      FROM computed c
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

-- Re-apply the service-role-only lockdown (defensive; CREATE OR REPLACE keeps
-- grants, but a future DROP+CREATE would wipe them). recompute_dg_margins is
-- SECURITY DEFINER and WRITES to d_g_margins, so it must never be anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.recompute_dg_margins(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_dg_margins(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_dg_margins(text, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.recompute_dg_margins(text, text) TO service_role;
