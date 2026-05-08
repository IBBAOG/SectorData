-- ============================================================================
-- ANP CDP BSW — Field aggregate RPC (+ ref_ano / ref_mes)
-- Adds get_anp_cdp_bsw_field_aggregate: one row per (campo, mes_desde_t0),
-- aggregating BSW across all contributing wells.
--
-- ref_ano / ref_mes = calendar (year, month) of the contributor whose
-- (ano * 12 + mes) is maximum — i.e. the most recent real month in that
-- aggregate point.  When n_pocos = 1 this is simply that well's month.
--
-- DROP … CASCADE is required because:
--   1. No prior RETURNS TABLE signature exists to replace in-place.
--   2. Future re-runs on a deployed version with a different signature would
--      fail without the DROP (Postgres rejects CREATE OR REPLACE when the
--      return type changes).
-- Re-grant to authenticated is done after CREATE.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_anp_cdp_bsw_field_aggregate(text[]) CASCADE;

CREATE FUNCTION public.get_anp_cdp_bsw_field_aggregate(p_campos text[])
RETURNS TABLE (
  campo        text,
  mes_desde_t0 int,
  bsw          float8,
  n_pocos      int,
  volume_total float8,
  ref_ano      int,
  ref_mes      int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    -- Compute t0 = first month with oil production per well.
    -- Filter to PreSal / PosSal fields, exclude wells that share the same
    -- name as their field (campo = poco), and exclude composite names
    -- that contain an underscore (internal test entries).
    SELECT
      poco,
      campo,
      ano,
      mes,
      agua_bbl_dia,
      petroleo_bbl_dia,
      min(ano * 12 + mes) FILTER (WHERE petroleo_bbl_dia > 0)
        OVER (PARTITION BY poco) AS t0
    FROM public.anp_cdp_producao
    WHERE campo = ANY(p_campos)
      AND local IN ('PreSal', 'PosSal')
      AND campo <> poco
      AND campo NOT LIKE '%\_%' ESCAPE '\'
  ),
  per_point AS (
    -- One row per (campo, poco, month) on the age axis.
    -- Only include months after first production and where the well produced.
    SELECT
      campo,
      (ano * 12 + mes - t0)::int AS mes_desde_t0,
      poco,
      ano,
      mes,
      agua_bbl_dia,
      petroleo_bbl_dia
    FROM base
    WHERE t0 IS NOT NULL
      AND (ano * 12 + mes) >= t0
      AND (petroleo_bbl_dia + agua_bbl_dia) > 0
  )
  SELECT
    campo,
    mes_desde_t0,
    -- Weighted BSW: total water / total liquid across all wells at this age.
    (sum(agua_bbl_dia) / NULLIF(sum(petroleo_bbl_dia + agua_bbl_dia), 0))::float8 AS bsw,
    count(DISTINCT poco)::int                                                        AS n_pocos,
    sum(petroleo_bbl_dia + agua_bbl_dia)::float8                                    AS volume_total,
    -- argmax(ano*12+mes): year of the most recent contributor.
    (array_agg(ano ORDER BY (ano * 12 + mes) DESC))[1]                              AS ref_ano,
    -- argmax(ano*12+mes): month of the most recent contributor.
    (array_agg(mes ORDER BY (ano * 12 + mes) DESC))[1]                              AS ref_mes
  FROM per_point
  GROUP BY campo, mes_desde_t0
  ORDER BY campo, mes_desde_t0
  LIMIT 200000;
$$;

-- Revoke default public/anon access; only authenticated users may call this RPC.
REVOKE ALL ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[]) TO authenticated;
