-- =============================================================================
-- Imports & Exports — Unit price by country RPCs
--
-- Adds two new RPCs:
--
--   1. get_imports_exports_imports_unit_price(p_unified_product, p_ano_inicio,
--        p_ano_fim, p_top_n DEFAULT 8)
--      Source: mdic_comex (flow='import').
--      Returns monthly USD/m³ for the top-N origin countries by total import
--      volume in the selected period. Countries outside top-N are NOT collapsed
--      into "Others" — each country gets its own line. The series starts from
--      the first month where the country has volume > 0.
--
--      "Gulf of Mexico ≈ United States (proxy)": ANP registers cargo origin
--      as the country of loading port. US Gulf Coast cargoes appear as
--      pais_origem = 'Estados Unidos' (in anp_desembaracos) and as the
--      equivalent pais in mdic_comex. This is documented in the sub-PRD.
--
--   2. get_imports_exports_exports_unit_price(p_unified_product, p_ano_inicio,
--        p_ano_fim, p_top_n DEFAULT 8)
--      Source: mdic_comex (flow='export').
--      Returns monthly USD/m³ for top-N destination countries.
--
-- Unit math (server-side):
--   volume_m3 = volume_kg / densidade_kg_m3
--   usd_per_m3 = sum(valor_fob_usd) / sum(volume_m3)  per (ano, mes, pais)
--
-- NULL is returned for (pais, month) rows where volume = 0 — the UI uses
-- y=null + connectgaps to skip those months in the hover tooltip without
-- breaking the line visually.
--
-- Security: SECURITY DEFINER + SET search_path (pegadinha #18 — without this,
-- anon callers get empty results because anp_desembaracos/mdic_comex have
-- RLS policies restricted to authenticated only, and INVOKER RPCs run as
-- caller).
--
-- Owner: worker_supabase
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- RPC 1 — Imports unit price by origin country (from mdic_comex flow='import')
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_imports_exports_imports_unit_price(
  p_unified_product text,
  p_ano_inicio      int,
  p_ano_fim         int,
  p_top_n           int  DEFAULT 8
)
RETURNS TABLE (ano int, mes int, pais text, usd_per_m3 numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
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
      AND mc.ano BETWEEN p_ano_inicio AND p_ano_fim
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
    CASE WHEN m.vol_m3 > 0 THEN m.fob_usd / m.vol_m3 ELSE NULL END :: numeric
  FROM monthly m
  ORDER BY m.b_ano, m.b_mes, m.b_pais;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_imports_exports_imports_unit_price(text, int, int, int)
  TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- RPC 2 — Exports unit price by destination country (mdic_comex flow='export')
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_imports_exports_exports_unit_price(
  p_unified_product text,
  p_ano_inicio      int,
  p_ano_fim         int,
  p_top_n           int  DEFAULT 8
)
RETURNS TABLE (ano int, mes int, pais text, usd_per_m3 numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
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
      AND mc.ano BETWEEN p_ano_inicio AND p_ano_fim
      AND mc.volume_kg     IS NOT NULL
      AND mc.valor_fob_usd IS NOT NULL
      AND mc.volume_kg > 0
  ),
  -- Rank destination countries by total volume
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
    CASE WHEN m.vol_m3 > 0 THEN m.fob_usd / m.vol_m3 ELSE NULL END :: numeric
  FROM monthly m
  ORDER BY m.b_ano, m.b_mes, m.b_pais;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_imports_exports_exports_unit_price(text, int, int, int)
  TO anon, authenticated;

COMMIT;
