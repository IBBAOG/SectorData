-- ============================================================================
-- Populate pct_voip_poco in get_anp_cdp_depletion_scatter so the per-well
-- view can use "% VOIP recovered" as X axis (same scale as field-aggregate).
--
-- Definition: pct_voip_poco = cumulative_oil_FIELD_through_month / VOIP_field.
-- Every well point inherits the field's maturity at that month — well-vs-well
-- comparisons land on the same X coordinate, allowing curve overlay.
--
-- VOIP is a field-level measure (ANP BAR does not publish well-level VOIP).
-- Using field cumulative keeps pct_voip_poco on the same scale as pct_voip
-- returned by get_anp_cdp_depletion_field_aggregate, enabling overlay.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_anp_cdp_depletion_scatter(p_campos text[])
RETURNS TABLE (
  poco           text,
  campo          text,
  ano            int,
  mes            int,
  mes_desde_t0   int,
  np_bbl_mes     float8,
  pct_voip_poco  float8
)
LANGUAGE sql STABLE SECURITY INVOKER
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
  ),
  campo_prod_mes AS (
    -- Field-level monthly real production (sum across all wells of the field).
    -- Uses actual oil (bbl/day * calendar days), not NP, to track true depletion.
    SELECT
      campo,
      ano,
      mes,
      sum(petroleo_bbl_dia * dias_cal)::float8 AS prod_real_mes_bbl
    FROM base
    WHERE petroleo_bbl_dia > 0
    GROUP BY campo, ano, mes
  ),
  campo_cum AS (
    -- Running cumulative actual oil of the FIELD through (ano, mes).
    -- Same computation as in get_anp_cdp_depletion_field_aggregate, so pct_voip
    -- values are consistent between per-well scatter and field aggregate.
    SELECT
      campo,
      ano,
      mes,
      sum(prod_real_mes_bbl) OVER (
        PARTITION BY campo
        ORDER BY ano * 12 + mes
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )::float8 AS cumulative_oil_campo_bbl
    FROM campo_prod_mes
  ),
  voip_latest AS (
    -- Most recent VOIP publication per field (mirrors field_aggregate logic).
    SELECT DISTINCT ON (campo) campo, voip_bbl
    FROM public.anp_voip
    WHERE voip_bbl IS NOT NULL AND voip_bbl > 0
    ORDER BY campo, ano_publicacao DESC
  )
  SELECT
    b.poco,
    b.campo,
    b.ano,
    b.mes,
    (b.ano * 12 + b.mes - b.t0)::int                                AS mes_desde_t0,
    -- NP = uptime-normalized production (well ran full calendar month)
    (b.petroleo_bbl_dia * b.dias_cal * b.dias_cal * 24
      / NULLIF(b.tempo_prod_hs_mes, 0))::float8                     AS np_bbl_mes,
    -- pct_voip_poco = field cumulative oil / field VOIP at this month
    -- All wells in the same field+month share the same X coordinate,
    -- enabling curve overlay without scale distortion.
    (cc.cumulative_oil_campo_bbl / NULLIF(v.voip_bbl, 0))::float8  AS pct_voip_poco
  FROM base b
  LEFT JOIN campo_cum cc
    ON cc.campo = b.campo AND cc.ano = b.ano AND cc.mes = b.mes
  LEFT JOIN voip_latest v
    ON v.campo = b.campo
  WHERE b.t0 IS NOT NULL
    AND (b.ano * 12 + b.mes) >= b.t0
    AND b.petroleo_bbl_dia > 0
    AND b.tempo_prod_hs_mes > 0
  ORDER BY b.campo, b.poco, b.ano * 12 + b.mes
  LIMIT 500000;
$$;

REVOKE ALL ON FUNCTION public.get_anp_cdp_depletion_scatter(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_depletion_scatter(text[]) TO authenticated;
