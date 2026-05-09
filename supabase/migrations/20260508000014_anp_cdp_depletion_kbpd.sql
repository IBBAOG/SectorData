-- Migration: 20260508000014_anp_cdp_depletion_kbpd.sql
-- Change: depletion RPCs now return np_kbpd (NP / produced days / 1000)
--         instead of np_bbl_mes. Conversion:
--           per well:  np_kbpd = np_poco_bbl_mes × 24 / (hs_op_poco × 1000)
--           aggregate: np_kbpd = sum(np_poco_bbl_mes) × 24 / (sum(hs_op_poco) × 1000)
-- RETURNS TABLE column renamed → must DROP+CREATE (no CREATE OR REPLACE for sig change).

-- ============================================================
-- A) get_anp_cdp_depletion_scatter
-- ============================================================
DROP FUNCTION IF EXISTS public.get_anp_cdp_depletion_scatter(text[]) CASCADE;

CREATE FUNCTION public.get_anp_cdp_depletion_scatter(p_campos text[])
RETURNS TABLE (
  poco           text,
  campo          text,
  ano            int,
  mes            int,
  mes_desde_t0   int,
  np_kbpd        float8,
  pct_voip_poco  float8
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT poco, campo, ano, mes, petroleo_bbl_dia, tempo_prod_hs_mes,
           extract(day FROM (date_trunc('month', make_date(ano, mes, 1))
                             + interval '1 month - 1 day'))::int AS dias_cal,
           min(ano*12+mes) FILTER (WHERE petroleo_bbl_dia > 0)
             OVER (PARTITION BY poco) AS t0
    FROM public.anp_cdp_producao
    WHERE campo = ANY(p_campos)
      AND local IN ('PreSal','PosSal')
      AND campo <> poco
      AND campo NOT LIKE '%\_%' ESCAPE '\'
  ),
  campo_prod_mes AS (
    SELECT campo, ano, mes,
           sum(petroleo_bbl_dia * dias_cal)::float8 AS prod_total_mes_bbl
    FROM base
    WHERE petroleo_bbl_dia > 0
    GROUP BY campo, ano, mes
  ),
  campo_cum AS (
    SELECT campo, ano, mes,
           sum(prod_total_mes_bbl) OVER (
             PARTITION BY campo
             ORDER BY ano*12+mes
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           )::float8 AS cumulative_oil_campo_bbl
    FROM campo_prod_mes
  ),
  voip_latest AS (
    SELECT DISTINCT ON (campo) campo, voip_bbl
    FROM public.anp_voip
    WHERE voip_bbl IS NOT NULL AND voip_bbl > 0
    ORDER BY campo, ano_publicacao DESC
  )
  SELECT b.poco, b.campo, b.ano, b.mes,
         (b.ano*12+b.mes - b.t0)::int AS mes_desde_t0,
         -- np_kbpd = (petroleo_bbl_dia × dias_cal) / (tempo_prod_hs_mes / 24) / 1000
         --         = petroleo_bbl_dia × dias_cal × 24 / (tempo_prod_hs_mes × 1000)
         (b.petroleo_bbl_dia * b.dias_cal * 24.0
           / NULLIF(b.tempo_prod_hs_mes, 0)
           / 1000.0)::float8 AS np_kbpd,
         (cc.cumulative_oil_campo_bbl / NULLIF(v.voip_bbl, 0))::float8 AS pct_voip_poco
  FROM base b
  LEFT JOIN campo_cum cc
    ON cc.campo = b.campo AND cc.ano = b.ano AND cc.mes = b.mes
  LEFT JOIN voip_latest v ON v.campo = b.campo
  WHERE b.t0 IS NOT NULL
    AND (b.ano*12+b.mes) >= b.t0
    AND b.petroleo_bbl_dia > 0
    AND b.tempo_prod_hs_mes > 0
  ORDER BY b.campo, b.poco, b.ano*12+b.mes
  LIMIT 500000;
$$;

REVOKE ALL ON FUNCTION public.get_anp_cdp_depletion_scatter(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_depletion_scatter(text[]) TO authenticated;

-- ============================================================
-- B) get_anp_cdp_depletion_field_aggregate  (RETURNS jsonb — no DROP needed)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_anp_cdp_depletion_field_aggregate(p_campos text[])
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH per_poco_mes AS (
    SELECT campo, poco, ano, mes, petroleo_bbl_dia, tempo_prod_hs_mes,
           extract(day FROM (date_trunc('month', make_date(ano, mes, 1))
                             + interval '1 month - 1 day'))::int AS dias_cal
    FROM public.anp_cdp_producao
    WHERE campo = ANY(p_campos)
      AND local IN ('PreSal','PosSal')
      AND campo <> poco
      AND campo NOT LIKE '%\_%' ESCAPE '\'
  ),
  per_poco_np AS (
    SELECT *,
      -- np_poco_bbl_mes = normalized production (bbl) for this well in this month
      (petroleo_bbl_dia * dias_cal * 24.0
        / NULLIF(tempo_prod_hs_mes, 0))::float8 AS np_poco_bbl_mes
    FROM per_poco_mes
    WHERE petroleo_bbl_dia > 0 AND tempo_prod_hs_mes > 0
  ),
  per_campo_mes AS (
    SELECT campo, ano, mes,
      -- np_kbpd = sum(NP_poco_bbl_mes) / (sum(hs_op_poco) / 24) / 1000
      (sum(np_poco_bbl_mes) * 24.0
        / NULLIF(sum(tempo_prod_hs_mes), 0)
        / 1000.0)::float8                                      AS np_kbpd,
      sum(petroleo_bbl_dia * dias_cal)::float8                 AS prod_real_bbl,
      count(DISTINCT poco)::int                                AS n_pocos
    FROM per_poco_np
    GROUP BY campo, ano, mes
  ),
  with_cum AS (
    SELECT *,
      sum(prod_real_bbl) OVER (
        PARTITION BY campo
        ORDER BY ano*12+mes
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS cumulative_oil_bbl
    FROM per_campo_mes
  ),
  voip_latest AS (
    SELECT DISTINCT ON (campo) campo, voip_bbl
    FROM public.anp_voip
    WHERE voip_bbl IS NOT NULL AND voip_bbl > 0
    ORDER BY campo, ano_publicacao DESC
  ),
  rows_out AS (
    SELECT w.campo, w.ano, w.mes, w.np_kbpd, w.n_pocos,
           (w.cumulative_oil_bbl / NULLIF(v.voip_bbl, 0))::float8 AS pct_voip,
           w.cumulative_oil_bbl
    FROM with_cum w
    JOIN voip_latest v ON v.campo = w.campo
    WHERE w.np_kbpd IS NOT NULL AND w.np_kbpd > 0
    ORDER BY w.campo, w.ano*12+w.mes
    LIMIT 200000
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'campo', campo, 'ano', ano, 'mes', mes,
    'np_kbpd', np_kbpd, 'n_pocos', n_pocos,
    'pct_voip', pct_voip, 'cumulative_oil_bbl', cumulative_oil_bbl
  )), '[]'::jsonb)
  FROM rows_out;
$$;

REVOKE ALL ON FUNCTION public.get_anp_cdp_depletion_field_aggregate(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_depletion_field_aggregate(text[]) TO authenticated;
