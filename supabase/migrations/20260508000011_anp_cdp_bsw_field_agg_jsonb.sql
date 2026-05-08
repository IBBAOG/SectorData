-- ============================================================================
-- Bypass PostgREST max_rows=1000: get_anp_cdp_bsw_field_aggregate now returns
-- a single jsonb array. The wrapper in src/lib/rpc.ts deserializes it.
-- This guarantees that selections producing >1000 rows (e.g. 9+ fields) are
-- delivered intact, regardless of PostgREST default Range cap.
--
-- Previous signature: RETURNS TABLE (campo, pct_voip, bsw, n_pocos,
--   volume_total, cumulative_oil_bbl, ref_ano, ref_mes)
-- New signature: RETURNS jsonb  (single row, array of the same objects)
--
-- DROP is required because RETURNS type changes (TABLE → scalar jsonb).
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_anp_cdp_bsw_field_aggregate(text[]) CASCADE;

CREATE FUNCTION public.get_anp_cdp_bsw_field_aggregate(p_campos text[])
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH per_campo_mes AS (
    SELECT
      campo, ano, mes,
      sum(agua_bbl_dia)::float8     AS agua_bbl_dia,
      sum(petroleo_bbl_dia)::float8 AS petroleo_bbl_dia,
      count(DISTINCT poco)::int     AS pocos_ativos,
      sum(petroleo_bbl_dia)::float8 *
        extract(day FROM (date_trunc('month', make_date(ano, mes, 1))
                          + interval '1 month - 1 day'))::int
        AS oil_bbl_mes
    FROM public.anp_cdp_producao
    WHERE campo = ANY(p_campos)
      AND local IN ('PreSal','PosSal')
      AND campo <> poco
      AND campo NOT LIKE '%\_%' ESCAPE '\'
    GROUP BY campo, ano, mes
  ),
  with_t0_cum AS (
    SELECT *,
      min(ano * 12 + mes) FILTER (WHERE petroleo_bbl_dia > 0)
        OVER (PARTITION BY campo) AS t0_campo,
      sum(oil_bbl_mes)
        OVER (PARTITION BY campo ORDER BY ano * 12 + mes
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
        AS cumulative_oil_bbl
    FROM per_campo_mes
  ),
  voip_latest AS (
    SELECT DISTINCT ON (campo) campo, voip_bbl
    FROM public.anp_voip
    WHERE voip_bbl IS NOT NULL AND voip_bbl > 0
    ORDER BY campo, ano_publicacao DESC
  ),
  rows_out AS (
    SELECT
      w.campo,
      (w.cumulative_oil_bbl / NULLIF(v.voip_bbl, 0))::float8 AS pct_voip,
      (w.agua_bbl_dia / NULLIF(w.agua_bbl_dia + w.petroleo_bbl_dia, 0))::float8 AS bsw,
      w.pocos_ativos AS n_pocos,
      (w.agua_bbl_dia + w.petroleo_bbl_dia)::float8 AS volume_total,
      w.cumulative_oil_bbl::float8 AS cumulative_oil_bbl,
      w.ano AS ref_ano,
      w.mes AS ref_mes
    FROM with_t0_cum w
    JOIN voip_latest v ON v.campo = w.campo
    WHERE w.t0_campo IS NOT NULL
      AND (w.ano * 12 + w.mes) >= w.t0_campo
      AND (w.agua_bbl_dia + w.petroleo_bbl_dia) > 0
    ORDER BY w.campo, w.ano * 12 + w.mes
    LIMIT 200000
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'campo',              campo,
        'pct_voip',           pct_voip,
        'bsw',                bsw,
        'n_pocos',            n_pocos,
        'volume_total',       volume_total,
        'cumulative_oil_bbl', cumulative_oil_bbl,
        'ref_ano',            ref_ano,
        'ref_mes',            ref_mes
      )
    ),
    '[]'::jsonb
  )
  FROM rows_out;
$$;

REVOKE ALL ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[]) TO authenticated;
