-- Guard recompute_dg_margins against statement timeout (incident 2026-06-09).
--
-- INCIDENT: the scheduled etl_dg_margins.yml run (GitHub run 27223589112,
-- 2026-06-09 17:22 UTC) died at the recompute step with
--   postgrest.exceptions.APIError {'code': '57014', 'message':
--   'canceling statement due to statement timeout'}
-- ~31s into the call. Because the recompute step failed, the Client Alerts hook
-- (gated on steps.recompute.conclusion == 'success') was skipped, so subscribers
-- got no alert and /diesel-gasoline-margins went stale.
--
-- ROOT CAUSE: recompute_dg_margins is called over PostgREST with the service-role
-- key. PostgREST connects as the `authenticator` role, whose role config carries
-- `statement_timeout=30s`, then does SET LOCAL ROLE service_role per request.
-- service_role has rolconfig=NULL, so it does NOT override the session-level
-- 30s timeout inherited from `authenticator` -- hence the ~31s death. A full,
-- unbounded recompute (p_week_start/p_week_end = NULL = full ~566-week x 2-fuel
-- timeline) takes longer than 30s because of the many correlated per-grid-row
-- scalar subqueries (notably the imp_pct INTERSECT/MAX ref_month block, evaluated
-- once per (week, fuel) row), so it always tripped the 30s cap.
--
-- FIX, two layers:
--
-- (1) TIMEOUT GUARD -- a FUNCTION-LEVEL `SET statement_timeout = '300s'` clause
--     plus a `SET LOCAL statement_timeout = '300s'` at the top of the body. This
--     protects direct in-database callers (psql, pg_cron, a SECURITY DEFINER
--     caller, a future internal call) whose enclosing statement IS the function
--     call: their timer is armed AFTER the GUC is in effect, so they get 300s.
--
--     IMPORTANT CAVEAT (verified empirically on PG 17.6, see incident notes in
--     the worker report): a function-level SET does NOT re-arm the statement
--     timer of an ALREADY-RUNNING enclosing statement. PostgREST connects as the
--     `authenticator` login role (rolconfig statement_timeout=30s); SET ROLE
--     service_role does NOT apply service_role's rolconfig, so the request runs
--     under the 30s authenticator cap, and the `SELECT recompute_dg_margins()`
--     statement's timer is armed at 30s before the function body executes. The
--     function-level SET therefore canNOT rescue the PostgREST full-timeline
--     call on its own -- the ETL caller must additionally raise the per-request
--     timeout (caller-side `SET LOCAL statement_timeout` / PostgREST pre-request),
--     which the ETL workflow remediation handles separately.
--
-- (2) SET-BASED imp_pct PRECOMPUTE (the optimization that actually brings the
--     full recompute well under any cap) -- the import%/production% split is a
--     pure function of (fuel_type, target month). The old body evaluated that
--     correlated INTERSECT/MAX/SUM block once PER (week, fuel) grid row
--     (2254 rows). It is now computed ONCE per distinct (fuel_type, m_year,
--     m_month) -- 526 combinations, a ~4.3x reduction of the heaviest subquery --
--     in an `imp_pct_by_month` CTE, then JOINed back to the grid. RESULTS ARE
--     IDENTICAL: imp_pct depends only on (fuel_type, m_year, m_month), so
--     deduplicating its evaluation cannot change any value. Every other column
--     (pump, parity, petrobras, blend, biofuel, taxes) and the final arithmetic
--     are byte-for-byte the body live as of 20260613300000.
--
-- NOT CHANGED: signature stays recompute_dg_margins(p_week_start text,
-- p_week_end text) with NULL defaults (full timeline). SECURITY DEFINER,
-- SET search_path = public, pg_temp preserved. p_week_start/p_week_end format is
-- 'IW/IYYY' (e.g. '23/2026' = ISO week 23 of 2026), parsed to that ISO week's
-- Monday. The bounded-window ETL path (recent weeks) runs in ~2s.
--
-- Idempotent: CREATE OR REPLACE + explicit REVOKE/GRANT re-application (a
-- CREATE OR REPLACE keeps grants, but DROP+CREATE would wipe them, so we re-apply
-- defensively per the project's "DROP+CREATE wipes grants/attributes" rule).

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
