-- ============================================================================
-- ANP CDP BSW — VOIP integration
--
-- A) get_anp_cdp_bsw_campos(): restrict to fields that have a VOIP entry.
--    Fields without VOIP are hidden from the dropdown (no meaningful X axis).
--
-- B) get_anp_cdp_bsw_field_aggregate(): rewrite X axis from mes_desde_t0 to
--    pct_voip = cumulative_oil_bbl / voip_bbl.
--    Monthly oil production = petroleo_bbl_dia * calendar days in month.
--    Signature change requires DROP + CREATE (RETURNS TABLE columns differ).
-- ============================================================================

-- ── A) Restrict campo list to fields with VOIP ────────────────────────────

CREATE OR REPLACE FUNCTION public.get_anp_cdp_bsw_campos()
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

REVOKE ALL ON FUNCTION public.get_anp_cdp_bsw_campos() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_campos() TO authenticated;

-- ── B) Rewrite field aggregate — pct_voip replaces mes_desde_t0 ──────────
-- DROP first because RETURNS TABLE signature changes (columns removed/added).

DROP FUNCTION IF EXISTS public.get_anp_cdp_bsw_field_aggregate(text[]) CASCADE;

CREATE FUNCTION public.get_anp_cdp_bsw_field_aggregate(p_campos text[])
RETURNS TABLE (
  campo              text,
  pct_voip           float8,   -- cumulative_oil_bbl / voip_bbl, fraction 0..N
  bsw                float8,
  n_pocos            int,
  volume_total       float8,
  cumulative_oil_bbl float8,
  ref_ano            int,
  ref_mes            int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH per_campo_mes AS (
    -- Aggregate well-level monthly data to field level.
    -- oil_bbl_mes = bbl/day * calendar days in that month (28/29/30/31).
    SELECT
      campo,
      ano,
      mes,
      sum(agua_bbl_dia)::float8                  AS agua_bbl_dia,
      sum(petroleo_bbl_dia)::float8              AS petroleo_bbl_dia,
      count(DISTINCT poco)::int                  AS pocos_ativos,
      sum(petroleo_bbl_dia)::float8
        * extract(
            day FROM (
              date_trunc('month', make_date(ano, mes, 1))
              + interval '1 month'
              - interval '1 day'
            )
          )::int                                 AS oil_bbl_mes
    FROM public.anp_cdp_producao
    WHERE campo = ANY(p_campos)
      AND local IN ('PreSal', 'PosSal')
      AND campo <> poco
      AND campo NOT LIKE '%\_%' ESCAPE '\'
    GROUP BY campo, ano, mes
  ),
  with_cum AS (
    -- Window: cumulative oil since first month with production > 0.
    SELECT *,
      min(ano * 12 + mes)
        FILTER (WHERE petroleo_bbl_dia > 0)
        OVER (PARTITION BY campo)                AS t0_campo,
      sum(oil_bbl_mes)
        OVER (
          PARTITION BY campo
          ORDER BY ano * 12 + mes
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )                                        AS cumulative_oil_bbl
    FROM per_campo_mes
  ),
  voip_latest AS (
    -- Most recent VOIP publication per field.
    SELECT DISTINCT ON (campo) campo, voip_bbl
    FROM public.anp_voip
    WHERE voip_bbl IS NOT NULL AND voip_bbl > 0
    ORDER BY campo, ano_publicacao DESC
  )
  SELECT
    w.campo,
    (w.cumulative_oil_bbl / NULLIF(v.voip_bbl, 0))::float8  AS pct_voip,
    (w.agua_bbl_dia
      / NULLIF(w.agua_bbl_dia + w.petroleo_bbl_dia, 0))::float8 AS bsw,
    w.pocos_ativos                                           AS n_pocos,
    (w.agua_bbl_dia + w.petroleo_bbl_dia)::float8           AS volume_total,
    w.cumulative_oil_bbl::float8,
    w.ano                                                    AS ref_ano,
    w.mes                                                    AS ref_mes
  FROM with_cum w
  JOIN voip_latest v ON v.campo = w.campo
  WHERE w.t0_campo IS NOT NULL
    AND (w.ano * 12 + w.mes) >= w.t0_campo
    AND (w.agua_bbl_dia + w.petroleo_bbl_dia) > 0
  ORDER BY w.campo, w.ano * 12 + w.mes
  LIMIT 200000;
$$;

REVOKE ALL ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[]) TO authenticated;
