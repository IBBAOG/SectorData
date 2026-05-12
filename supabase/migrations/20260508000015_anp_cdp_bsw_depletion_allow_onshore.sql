-- ============================================================================
-- Allow ALL campos (Mar + Terra) in BSW and Depletion dashboards.
-- Previously these RPCs filtered local IN ('PreSal','PosSal') (offshore only);
-- Eduardo decided to include onshore fields for completeness.
-- All other filters (campo<>poco, no-underscore, EXISTS anp_voip) preserved.
-- ============================================================================
--
-- Base versions used for each CREATE OR REPLACE:
--   get_anp_cdp_bsw_campos()            → 20260508000010_anp_cdp_bsw_voip.sql
--   get_anp_cdp_bsw_scatter(text[])     → 20260508000006_anp_cdp_bsw_drop_exploratory.sql
--   get_anp_cdp_bsw_field_aggregate()   → 20260508000011_anp_cdp_bsw_field_agg_jsonb.sql
--   get_anp_cdp_depletion_campos()      → 20260508000012_anp_cdp_depletion.sql
--   get_anp_cdp_depletion_scatter()     → 20260508000014_anp_cdp_depletion_kbpd.sql
--   get_anp_cdp_depletion_field_agg()  → 20260508000014_anp_cdp_depletion_kbpd.sql
-- ============================================================================


-- ── 1. get_anp_cdp_bsw_campos() ──────────────────────────────────────────────
-- SECURITY DEFINER: mv_anp_cdp_pocos has SELECT revoked from authenticated
-- (hardening_c migration 20260505000003). Removed: local IN ('PreSal','PosSal').
-- Retained: campo<>poco, no-underscore, EXISTS anp_voip check.

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
  WHERE mv.campo <> mv.poco
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


-- ── 2. get_anp_cdp_bsw_scatter(text[]) ───────────────────────────────────────
-- SECURITY INVOKER. Removed: local IN ('PreSal','PosSal') from base CTE.
-- Retained: campo<>poco, no-underscore, t0 window, bsw formula, LIMIT 500000.

CREATE OR REPLACE FUNCTION public.get_anp_cdp_bsw_scatter(p_campos text[])
RETURNS TABLE (
  poco          text,
  campo         text,
  mes_desde_t0  int,
  bsw           float8,
  ano           int,
  mes           int
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
      agua_bbl_dia,
      petroleo_bbl_dia,
      min(ano * 12 + mes) FILTER (WHERE petroleo_bbl_dia > 0)
        OVER (PARTITION BY poco) AS t0
    FROM public.anp_cdp_producao
    WHERE campo = ANY(p_campos)
      AND campo <> poco                            -- drop exploratory wells masquerading as campo
      AND campo NOT LIKE '%\_%' ESCAPE '\'         -- official campo names never contain underscores
  )
  SELECT
    poco,
    campo,
    (ano * 12 + mes - t0)::int                                        AS mes_desde_t0,
    (agua_bbl_dia / NULLIF(petroleo_bbl_dia + agua_bbl_dia, 0))::float8 AS bsw,
    ano,
    mes
  FROM base
  WHERE t0 IS NOT NULL
    AND (ano * 12 + mes) >= t0
    AND (petroleo_bbl_dia + agua_bbl_dia) > 0
  ORDER BY campo, poco, mes_desde_t0
  LIMIT 500000;
$$;

REVOKE ALL ON FUNCTION public.get_anp_cdp_bsw_scatter(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_scatter(text[]) TO authenticated;


-- ── 3. get_anp_cdp_bsw_field_aggregate(text[]) ───────────────────────────────
-- SECURITY INVOKER. RETURNS jsonb (bypasses PostgREST max_rows).
-- Removed: local IN ('PreSal','PosSal') from per_campo_mes CTE.
-- Retained: pct_voip formula, bsw formula, cumulative_oil_bbl, LIMIT 200000.

CREATE OR REPLACE FUNCTION public.get_anp_cdp_bsw_field_aggregate(p_campos text[])
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


-- ── 4. get_anp_cdp_depletion_campos() ────────────────────────────────────────
-- SECURITY DEFINER: mv_anp_cdp_pocos has SELECT revoked from authenticated.
-- Removed: mv.local IN ('PreSal','PosSal').
-- Retained: campo<>poco, no-underscore, EXISTS anp_voip check.

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
  WHERE mv.campo <> mv.poco
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


-- ── 5. get_anp_cdp_depletion_scatter(text[]) ─────────────────────────────────
-- SECURITY INVOKER. Returns np_kbpd (from 20260508000014).
-- Removed: local IN ('PreSal','PosSal') from base CTE.
-- Retained: campo<>poco, no-underscore, campo_cum + voip_latest joins,
--           np_kbpd formula, pct_voip_poco, LIMIT 500000.
-- NOTE: This function was last DROP+CREATE'd in 20260508000014 (sig change).
--       We use CREATE OR REPLACE here (signature is unchanged vs 000014).

CREATE OR REPLACE FUNCTION public.get_anp_cdp_depletion_scatter(p_campos text[])
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


-- ── 6. get_anp_cdp_depletion_field_aggregate(text[]) ─────────────────────────
-- SECURITY INVOKER. RETURNS jsonb (from 20260508000014).
-- Removed: local IN ('PreSal','PosSal') from per_poco_mes CTE.
-- Retained: np_kbpd formula, pct_voip, cumulative_oil_bbl, n_pocos, LIMIT 200000.

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
