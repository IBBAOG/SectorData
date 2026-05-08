-- ============================================================================
-- ANP CDP BSW — field-aggregate RPC
-- Returns one row per (campo, mes_desde_t0) with volume-weighted BSW.
-- Companion to get_anp_cdp_bsw_scatter (per-well version).
--
-- X-axis: mes_desde_t0 calculated PER WELL (first production month of the well,
-- not of the field). This preserves the aging curve: "when wells in field X are
-- N months old, what is the volume-weighted BSW?"
--
-- BSW formula: sum(agua_bbl_dia) / sum(agua_bbl_dia + petroleo_bbl_dia)
-- This is physically correct volume weighting — avoids bias from low-volume wells.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_anp_cdp_bsw_field_aggregate(p_campos text[])
RETURNS TABLE (
  campo         text,
  mes_desde_t0  int,
  bsw           float8,
  n_pocos       int,
  volume_total  float8   -- sum of (petroleo + agua) bbl/dia, useful for sizing markers
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      poco, campo, ano, mes, agua_bbl_dia, petroleo_bbl_dia,
      min(ano * 12 + mes) FILTER (WHERE petroleo_bbl_dia > 0)
        OVER (PARTITION BY poco) AS t0
    FROM public.anp_cdp_producao
    WHERE campo = ANY(p_campos)
  ),
  per_point AS (
    SELECT
      campo,
      (ano * 12 + mes - t0)::int AS mes_desde_t0,
      poco,
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
    (sum(agua_bbl_dia) / NULLIF(sum(petroleo_bbl_dia + agua_bbl_dia), 0))::float8 AS bsw,
    count(DISTINCT poco)::int AS n_pocos,
    sum(petroleo_bbl_dia + agua_bbl_dia)::float8 AS volume_total
  FROM per_point
  GROUP BY campo, mes_desde_t0
  ORDER BY campo, mes_desde_t0
  LIMIT 200000;
$$;

-- Revoke default public/anon access; only authenticated users may call this RPC.
REVOKE ALL ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[]) TO authenticated;
