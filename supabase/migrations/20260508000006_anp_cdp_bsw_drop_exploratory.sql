-- ============================================================================
-- Fix: /anp-cdp-bsw campo dropdown includes exploratory well identifiers
--
-- Root cause: in anp_cdp_producao, exploratory (pre-field) wells are ingested
-- with campo = poco (the well identifier fills the campo column because no
-- official campo has been assigned yet). mv_anp_cdp_pocos propagates these
-- via GROUP BY poco, campo, bacia, local.
--
-- Examples of contaminated campo values visible in the dropdown:
--   PA-1BRSA1083SES-SEAL-M-426    (campo = poco)
--   PEO-1BRSA1146RJS_lara_Entorno_CCO  (contains underscore)
--
-- Heuristic (conservative, no false positives on known legitimate campos):
--   1. campo = poco   -- the well ID leaked into campo; strongest signal
--   2. campo LIKE '%\_%' ESCAPE '\'  -- ANP official campo names never contain
--      underscores (TUPI, BÚZIOS, PAPA-TERRA, MARLIM SUL, etc.)
--
-- Applied to all 3 BSW RPCs. Signatures, GRANTs and SECURITY levels unchanged.
-- ============================================================================


-- ── 1. get_anp_cdp_bsw_campos() ─────────────────────────────────────────────
-- SECURITY DEFINER (required: mv_anp_cdp_pocos has REVOKE from authenticated,
-- established in hardening_c migration 20260505000003).
-- Both filters applied to mv_anp_cdp_pocos rows (has poco and campo columns).

CREATE OR REPLACE FUNCTION public.get_anp_cdp_bsw_campos()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    array_agg(DISTINCT campo ORDER BY campo),
    ARRAY[]::text[]
  )
  FROM public.mv_anp_cdp_pocos
  WHERE local IN ('PreSal','PosSal')
    AND campo IS NOT NULL
    AND campo <> poco                              -- exploratory well masquerading as campo
    AND campo NOT LIKE '%\_%' ESCAPE '\'           -- official campo names never contain underscores
$$;

REVOKE ALL ON FUNCTION public.get_anp_cdp_bsw_campos() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_campos() TO authenticated;


-- ── 2. get_anp_cdp_bsw_scatter(p_campos text[]) ──────────────────────────────
-- SECURITY INVOKER: authenticated users read anp_cdp_producao directly
-- (policy "authenticated read" present since 20260504000013).
-- Filters added to the CTE base WHERE clause alongside existing local filter.

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
      AND local IN ('PreSal','PosSal')             -- offshore only
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


-- ── 3. get_anp_cdp_bsw_field_aggregate(p_campos text[]) ──────────────────────
-- SECURITY INVOKER: same rationale as get_anp_cdp_bsw_scatter above.
-- Filters added to the CTE base WHERE clause alongside existing local filter.

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
      AND local IN ('PreSal','PosSal')             -- offshore only
      AND campo <> poco                            -- drop exploratory wells masquerading as campo
      AND campo NOT LIKE '%\_%' ESCAPE '\'         -- official campo names never contain underscores
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

REVOKE ALL ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[]) TO authenticated;
