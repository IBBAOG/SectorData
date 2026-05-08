-- ============================================================================
-- Fix: get_anp_cdp_bsw_field_aggregate previously aggregated by
--   (campo, mes_desde_t0_do_poço), which mixed wells from different absolute
--   calendar months into the same data point — physically meaningless.
--
-- Correct model: treat the field as a single super-well. For each
--   (campo, ano, mes), sum agua/petroleo across all wells, compute BSW from
--   those totals, and use t0_campo (the field's first producing month) to
--   derive mes_desde_t0. Each point now corresponds to one real calendar
--   month, with unambiguous ref_ano/ref_mes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_anp_cdp_bsw_field_aggregate(p_campos text[])
RETURNS TABLE (
  campo         text,
  mes_desde_t0  int,
  bsw           float8,
  n_pocos       int,
  volume_total  float8,
  ref_ano       int,
  ref_mes       int
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH per_campo_mes AS (
    -- Sum production of ALL wells in the field per calendar month.
    -- This treats the field as a single super-well.
    SELECT
      campo,
      ano,
      mes,
      sum(agua_bbl_dia)::float8     AS agua,
      sum(petroleo_bbl_dia)::float8 AS petroleo,
      count(DISTINCT poco)::int     AS pocos_ativos
    FROM public.anp_cdp_producao
    WHERE campo = ANY(p_campos)
      AND local IN ('PreSal','PosSal')
      AND campo <> poco
      AND campo NOT LIKE '%\_%' ESCAPE '\'
    GROUP BY campo, ano, mes
  ),
  with_t0 AS (
    -- t0_campo = earliest month where the field (summed) had petroleo > 0.
    SELECT
      campo, ano, mes, agua, petroleo, pocos_ativos,
      min(ano * 12 + mes) FILTER (WHERE petroleo > 0)
        OVER (PARTITION BY campo) AS t0_campo
    FROM per_campo_mes
  )
  SELECT
    campo,
    (ano * 12 + mes - t0_campo)::int AS mes_desde_t0,
    (agua / NULLIF(agua + petroleo, 0))::float8 AS bsw,
    pocos_ativos AS n_pocos,
    (agua + petroleo)::float8 AS volume_total,
    ano AS ref_ano,
    mes AS ref_mes
  FROM with_t0
  WHERE t0_campo IS NOT NULL
    AND (ano * 12 + mes) >= t0_campo
    AND (agua + petroleo) > 0
  ORDER BY campo, mes_desde_t0
  LIMIT 200000;
$$;

REVOKE ALL ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[]) TO authenticated;
