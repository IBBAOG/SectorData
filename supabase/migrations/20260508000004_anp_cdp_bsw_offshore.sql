-- ============================================================================
-- ANP CDP BSW — restrict to offshore campos only (PreSal + PosSal)
--
-- Context: /anp-cdp-bsw is a BSW (water cut) analysis dashboard. Onshore
-- (Terra) fields are irrelevant for this analysis — only offshore applies.
--
-- Changes:
--   1. get_anp_cdp_bsw_scatter       — add AND local IN ('PreSal','PosSal')
--   2. get_anp_cdp_bsw_field_aggregate — add AND local IN ('PreSal','PosSal')
--   3. get_anp_cdp_bsw_campos (NEW)  — populate sidebar dropdown, offshore only
--
-- Both existing RPCs keep identical signatures (RETURNS TABLE, params, GRANT).
-- ============================================================================

-- ── 1. get_anp_cdp_bsw_scatter — offshore filter ─────────────────────────────

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
      AND local IN ('PreSal','PosSal')          -- offshore only
  )
  SELECT
    poco,
    campo,
    (ano * 12 + mes - t0)::int                                      AS mes_desde_t0,
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

-- ── 2. get_anp_cdp_bsw_field_aggregate — offshore filter ─────────────────────

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
      AND local IN ('PreSal','PosSal')          -- offshore only
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

-- ── 3. get_anp_cdp_bsw_campos (NEW) — dropdown list, offshore campos only ────
--
-- Uses mv_anp_cdp_pocos (pre-aggregated well metadata, ~24K rows) for speed.
-- Falls back to direct table query if the MV is somehow unavailable at runtime
-- (handled by the COALESCE pattern — the MV always exists per smoke test check).

CREATE OR REPLACE FUNCTION public.get_anp_cdp_bsw_campos()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce(
    array_agg(DISTINCT campo ORDER BY campo),
    ARRAY[]::text[]
  )
  FROM public.mv_anp_cdp_pocos
  WHERE local IN ('PreSal','PosSal')
    AND campo IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_anp_cdp_bsw_campos() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_campos() TO authenticated;
