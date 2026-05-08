-- ============================================================================
-- ANP CDP Depletion — Uptime-normalized production (NP) for /anp-cdp-depletion
--
-- Eduardo's interpretation: petroleo_bbl_dia = calendar-day average.
-- Therefore:
--   NP_bbl_mes = petroleo_bbl_dia * dias_cal * dias_cal * 24
--               / NULLIF(tempo_prod_hs_mes, 0)
--
-- Rationale: if a well produced at X bbl/day for an entire month it would have
-- produced X * days_in_month barrels.  Dividing by actual uptime fraction
-- (tempo_prod_hs_mes / (dias_cal * 24)) gives the NP value as if the well ran
-- the full month — months with stoppages show higher NP than actual production.
--
-- A) get_anp_cdp_depletion_campos()   — SECURITY DEFINER (mv_anp_cdp_pocos)
--    Returns text[] of offshore fields (PreSal/PosSal) with a VOIP entry.
--
-- B) get_anp_cdp_depletion_scatter()  — SECURITY INVOKER
--    Per-well NP time-series.  Returns (poco, campo, ano, mes,
--    mes_desde_t0, np_bbl_mes, pct_voip_poco).  pct_voip_poco = NULL (v1).
--
-- C) get_anp_cdp_depletion_field_aggregate() — SECURITY INVOKER, RETURNS jsonb
--    Field-level NP aggregated from well-level rows.  Packed as jsonb (single
--    row) to bypass PostgREST max_rows limit (lesson from BSW).
--    Includes cumulative_oil_bbl and pct_voip from anp_voip (latest publication).
--
-- D) module_visibility seed for 'anp-cdp-depletion'.
-- ============================================================================


-- ── A) Campo list — offshore fields with VOIP ─────────────────────────────

CREATE OR REPLACE FUNCTION public.get_anp_cdp_depletion_campos()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    array_agg(DISTINCT mv.campo ORDER BY mv.campo),
    ARRAY[]::text[]
  )
  FROM public.mv_anp_cdp_pocos mv
  WHERE mv.local IN ('PreSal', 'PosSal')
    AND mv.campo <> mv.poco
    AND mv.campo NOT LIKE '%\_%' ESCAPE '\'
    AND EXISTS (
      SELECT 1
      FROM public.anp_voip v
      WHERE v.campo = mv.campo
        AND v.voip_bbl IS NOT NULL
        AND v.voip_bbl > 0
    );
$$;

REVOKE ALL ON FUNCTION public.get_anp_cdp_depletion_campos() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_depletion_campos() TO authenticated;


-- ── B) Per-well NP scatter ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_anp_cdp_depletion_scatter(p_campos text[])
RETURNS TABLE (
  poco           text,
  campo          text,
  ano            int,
  mes            int,
  mes_desde_t0   int,
  np_bbl_mes     float8,
  pct_voip_poco  float8   -- NULL in v1 (well-level VOIP not available from ANP BAR)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      poco,
      campo,
      ano,
      mes,
      petroleo_bbl_dia,
      tempo_prod_hs_mes,
      -- Calendar days in the month (28/29/30/31)
      extract(day FROM (
        date_trunc('month', make_date(ano, mes, 1))
        + interval '1 month'
        - interval '1 day'
      ))::int AS dias_cal,
      -- t0: first month this well had oil production > 0
      min(ano * 12 + mes)
        FILTER (WHERE petroleo_bbl_dia > 0)
        OVER (PARTITION BY poco) AS t0
    FROM public.anp_cdp_producao
    WHERE campo = ANY(p_campos)
      AND local IN ('PreSal', 'PosSal')
      AND campo <> poco
      AND campo NOT LIKE '%\_%' ESCAPE '\'
  )
  SELECT
    poco,
    campo,
    ano,
    mes,
    (ano * 12 + mes - t0)::int                                   AS mes_desde_t0,
    -- NP = production as if the well ran 24h/day the entire month
    (petroleo_bbl_dia * dias_cal * dias_cal * 24
      / NULLIF(tempo_prod_hs_mes, 0))::float8                    AS np_bbl_mes,
    NULL::float8                                                  AS pct_voip_poco
  FROM base
  WHERE t0 IS NOT NULL
    AND (ano * 12 + mes) >= t0
    AND petroleo_bbl_dia > 0
    AND tempo_prod_hs_mes > 0
  ORDER BY campo, poco, ano * 12 + mes
  LIMIT 500000;
$$;

REVOKE ALL ON FUNCTION public.get_anp_cdp_depletion_scatter(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_depletion_scatter(text[]) TO authenticated;


-- ── C) Field-level NP aggregate — packed as jsonb ─────────────────────────
-- Returns jsonb (single row) to avoid PostgREST max_rows truncation.
-- Fields: campo, ano, mes, np_bbl_mes, n_pocos, pct_voip, cumulative_oil_bbl.

CREATE OR REPLACE FUNCTION public.get_anp_cdp_depletion_field_aggregate(p_campos text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH per_poco_mes AS (
    -- Raw well-month rows with calendar days pre-computed.
    SELECT
      campo,
      poco,
      ano,
      mes,
      petroleo_bbl_dia,
      tempo_prod_hs_mes,
      extract(day FROM (
        date_trunc('month', make_date(ano, mes, 1))
        + interval '1 month'
        - interval '1 day'
      ))::int AS dias_cal
    FROM public.anp_cdp_producao
    WHERE campo = ANY(p_campos)
      AND local IN ('PreSal', 'PosSal')
      AND campo <> poco
      AND campo NOT LIKE '%\_%' ESCAPE '\'
  ),
  per_poco_np AS (
    -- NP per well-month.  Only rows where both oil and uptime are positive.
    SELECT *,
      (petroleo_bbl_dia * dias_cal * dias_cal * 24
        / NULLIF(tempo_prod_hs_mes, 0))::float8 AS np_poco_bbl_mes
    FROM per_poco_mes
    WHERE petroleo_bbl_dia > 0
      AND tempo_prod_hs_mes > 0
  ),
  per_campo_mes AS (
    -- Aggregate wells to field-month: sum NP, sum actual oil, count active wells.
    SELECT
      campo,
      ano,
      mes,
      sum(np_poco_bbl_mes)::float8          AS np_bbl_mes,
      -- Actual production = bbl/day * calendar days (used for cumulative depletion).
      sum(petroleo_bbl_dia * dias_cal)::float8 AS prod_real_bbl,
      count(DISTINCT poco)::int             AS n_pocos
    FROM per_poco_np
    GROUP BY campo, ano, mes
  ),
  with_cum AS (
    -- Running cumulative actual oil (used for depletion fraction against VOIP).
    SELECT *,
      sum(prod_real_bbl)
        OVER (
          PARTITION BY campo
          ORDER BY ano * 12 + mes
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cumulative_oil_bbl
    FROM per_campo_mes
  ),
  voip_latest AS (
    -- Most recent VOIP publication per field (same logic as BSW aggregate).
    SELECT DISTINCT ON (campo) campo, voip_bbl
    FROM public.anp_voip
    WHERE voip_bbl IS NOT NULL
      AND voip_bbl > 0
    ORDER BY campo, ano_publicacao DESC
  ),
  rows_out AS (
    SELECT
      w.campo,
      w.ano,
      w.mes,
      w.np_bbl_mes,
      w.n_pocos,
      (w.cumulative_oil_bbl / NULLIF(v.voip_bbl, 0))::float8 AS pct_voip,
      w.cumulative_oil_bbl
    FROM with_cum w
    JOIN voip_latest v ON v.campo = w.campo
    WHERE w.np_bbl_mes IS NOT NULL
      AND w.np_bbl_mes > 0
    ORDER BY w.campo, w.ano * 12 + w.mes
    LIMIT 200000
  )
  SELECT coalesce(
    jsonb_agg(jsonb_build_object(
      'campo',              campo,
      'ano',                ano,
      'mes',                mes,
      'np_bbl_mes',         np_bbl_mes,
      'n_pocos',            n_pocos,
      'pct_voip',           pct_voip,
      'cumulative_oil_bbl', cumulative_oil_bbl
    )),
    '[]'::jsonb
  )
  FROM rows_out;
$$;

REVOKE ALL ON FUNCTION public.get_anp_cdp_depletion_field_aggregate(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_depletion_field_aggregate(text[]) TO authenticated;


-- ── D) Module visibility seed ─────────────────────────────────────────────

INSERT INTO public.module_visibility (module_slug, is_visible_for_clients)
VALUES ('anp-cdp-depletion', true)
ON CONFLICT (module_slug) DO NOTHING;
