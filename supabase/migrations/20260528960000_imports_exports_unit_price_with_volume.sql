-- =============================================================================
-- 20260528960000_imports_exports_unit_price_with_volume.sql
--
-- Extends the two unit-price RPCs to expose vol_m3 in the return tuple so
-- callers can compute weighted averages client-side (needed for the "Others"
-- summary row in the upcoming Imports / Exports summary tables).
--
-- Changes:
--   1. DROP get_imports_exports_fob_price_serie  — Panel C ("Import Price USD/bbl")
--      is being removed from /imports-exports; orphaned function.
--   2. RECREATE get_imports_exports_imports_unit_price with additional column
--      vol_m3 numeric appended to the RETURNS TABLE tuple.
--   3. RECREATE get_imports_exports_exports_unit_price with the same addition.
--
-- Pegadinha #18 mitigation: DROP FUNCTION + CREATE FUNCTION loses SECURITY
-- DEFINER, SET search_path, and GRANT. All three are re-applied explicitly
-- after each CREATE via ALTER + GRANT (pattern from 20260526800000).
--
-- Pegadinha #19 mitigation: slot 20260528960000 chosen after confirming the
-- highest existing May-28 slot is 20260528950000_subsidy_synthetic_pr_march.
--
-- Owner: worker_supabase
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Drop orphaned fob_price_serie (Panel C removal)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_imports_exports_fob_price_serie(text, int, int, int, int);


-- -----------------------------------------------------------------------------
-- 2. get_imports_exports_imports_unit_price
--    Adds vol_m3 numeric to the return tuple (was: ano, mes, pais, usd_per_m3)
--    now: ano, mes, pais, usd_per_m3, vol_m3
--    vol_m3 is the monthly aggregated volume in m³ for the country — used as
--    the weight denominator when computing a weighted-average USD/m3 for the
--    "Others" row or any collapsed group client-side.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_imports_exports_imports_unit_price(text, int, int, int, int, int);

CREATE FUNCTION public.get_imports_exports_imports_unit_price(
  p_unified_product text,
  p_ano_inicio      int,
  p_mes_inicio      int,
  p_ano_fim         int,
  p_mes_fim         int,
  p_top_n           int  DEFAULT 8
)
RETURNS TABLE (ano int, mes int, pais text, usd_per_m3 numeric, vol_m3 numeric)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      mc.ano::int          AS b_ano,
      mc.mes::int          AS b_mes,
      mc.pais              AS b_pais,
      mc.volume_kg         AS b_kg,
      mc.valor_fob_usd     AS b_usd,
      d.densidade_kg_m3    AS b_den
    FROM public.mdic_comex mc
    JOIN public.imports_product_map ipm
      ON ipm.source = 'mdic'
     AND ipm.source_key = mc.ncm_codigo
     AND ipm.unified_product = p_unified_product
    JOIN public.ncm_densidade_kg_m3 d
      ON d.ncm_codigo = mc.ncm_codigo
    WHERE mc.flow = 'import'
      AND (mc.ano >  p_ano_inicio OR (mc.ano = p_ano_inicio AND mc.mes >= p_mes_inicio))
      AND (mc.ano <  p_ano_fim    OR (mc.ano = p_ano_fim    AND mc.mes <= p_mes_fim))
      AND mc.volume_kg     IS NOT NULL
      AND mc.valor_fob_usd IS NOT NULL
      AND mc.volume_kg > 0
  ),
  -- Rank countries by total volume in the period, keep top-N
  ranked AS (
    SELECT b_pais AS r_pais,
           SUM(b_kg / b_den) AS total_m3
    FROM base
    GROUP BY b_pais
    ORDER BY total_m3 DESC NULLS LAST
    LIMIT p_top_n
  ),
  -- Monthly aggregates per country (only top-N)
  monthly AS (
    SELECT b_ano, b_mes, b_pais,
           SUM(b_kg / b_den)  AS vol_m3,
           SUM(b_usd)         AS fob_usd
    FROM base
    WHERE b_pais IN (SELECT r_pais FROM ranked)
    GROUP BY b_ano, b_mes, b_pais
  )
  SELECT
    m.b_ano,
    m.b_mes,
    m.b_pais,
    CASE WHEN m.vol_m3 > 0 THEN m.fob_usd / m.vol_m3 ELSE NULL END :: numeric,
    m.vol_m3 :: numeric
  FROM monthly m
  ORDER BY m.b_ano, m.b_mes, m.b_pais;
END;
$$;

ALTER FUNCTION public.get_imports_exports_imports_unit_price(text, int, int, int, int, int)
  SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_imports_unit_price(text, int, int, int, int, int)
  SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.get_imports_exports_imports_unit_price(text, int, int, int, int, int)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_imports_exports_imports_unit_price(text, int, int, int, int, int) IS
  'Returns monthly FOB unit price (USD/m3) per top-N import origin country.
   vol_m3 is the monthly aggregated import volume in m3 for the country;
   use it as the weight denominator to compute weighted-average USD/m3 for
   collapsed groups (e.g. "Others" row) client-side.';


-- -----------------------------------------------------------------------------
-- 3. get_imports_exports_exports_unit_price
--    Adds vol_m3 numeric to the return tuple (was: ano, mes, pais, usd_per_m3)
--    now: ano, mes, pais, usd_per_m3, vol_m3
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_imports_exports_exports_unit_price(text, int, int, int, int, int);

CREATE FUNCTION public.get_imports_exports_exports_unit_price(
  p_unified_product text,
  p_ano_inicio      int,
  p_mes_inicio      int,
  p_ano_fim         int,
  p_mes_fim         int,
  p_top_n           int  DEFAULT 8
)
RETURNS TABLE (ano int, mes int, pais text, usd_per_m3 numeric, vol_m3 numeric)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      mc.ano::int          AS b_ano,
      mc.mes::int          AS b_mes,
      mc.pais              AS b_pais,
      mc.volume_kg         AS b_kg,
      mc.valor_fob_usd     AS b_usd,
      d.densidade_kg_m3    AS b_den
    FROM public.mdic_comex mc
    JOIN public.imports_product_map ipm
      ON ipm.source = 'mdic'
     AND ipm.source_key = mc.ncm_codigo
     AND ipm.unified_product = p_unified_product
    JOIN public.ncm_densidade_kg_m3 d
      ON d.ncm_codigo = mc.ncm_codigo
    WHERE mc.flow = 'export'
      AND (mc.ano >  p_ano_inicio OR (mc.ano = p_ano_inicio AND mc.mes >= p_mes_inicio))
      AND (mc.ano <  p_ano_fim    OR (mc.ano = p_ano_fim    AND mc.mes <= p_mes_fim))
      AND mc.volume_kg     IS NOT NULL
      AND mc.valor_fob_usd IS NOT NULL
      AND mc.volume_kg > 0
  ),
  ranked AS (
    SELECT b_pais AS r_pais,
           SUM(b_kg / b_den) AS total_m3
    FROM base
    GROUP BY b_pais
    ORDER BY total_m3 DESC NULLS LAST
    LIMIT p_top_n
  ),
  monthly AS (
    SELECT b_ano, b_mes, b_pais,
           SUM(b_kg / b_den)  AS vol_m3,
           SUM(b_usd)         AS fob_usd
    FROM base
    WHERE b_pais IN (SELECT r_pais FROM ranked)
    GROUP BY b_ano, b_mes, b_pais
  )
  SELECT
    m.b_ano,
    m.b_mes,
    m.b_pais,
    CASE WHEN m.vol_m3 > 0 THEN m.fob_usd / m.vol_m3 ELSE NULL END :: numeric,
    m.vol_m3 :: numeric
  FROM monthly m
  ORDER BY m.b_ano, m.b_mes, m.b_pais;
END;
$$;

ALTER FUNCTION public.get_imports_exports_exports_unit_price(text, int, int, int, int, int)
  SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_exports_unit_price(text, int, int, int, int, int)
  SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.get_imports_exports_exports_unit_price(text, int, int, int, int, int)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_imports_exports_exports_unit_price(text, int, int, int, int, int) IS
  'Returns monthly FOB unit price (USD/m3) per top-N export destination country.
   vol_m3 is the monthly aggregated export volume in m3 for the country;
   use it as the weight denominator to compute weighted-average USD/m3 for
   collapsed groups client-side.';


COMMIT;
