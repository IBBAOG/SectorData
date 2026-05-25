-- =============================================================================
-- Imports & Exports — FOB price time series RPC (sourced from mdic_comex)
--
-- Adds the 'mdic' source mapping in `imports_product_map` and creates
-- `get_imports_exports_fob_price_serie`, which returns monthly FOB price for
-- the 3 unified products (Diesel / Gasoline / Crude Oil) using MDIC Comex
-- import data (USD per ton / per m3 / per bbl).
--
-- Why a new source on imports_product_map (instead of reusing 'desembaracos')?
-- ANP Desembaraços does NOT publish FOB values — only volumes. The FOB chart
-- has to be sourced from MDIC, which means we need a separate (source, key)
-- triple for MDIC NCMs:
--   Diesel    -> 27101921
--   Gasoline  -> 27101259 (bulk gasoline; the only NCM MDIC publishes for
--                          motor gasoline imports)
--   Crude Oil -> 27090010
--
-- All 3 NCMs are already present in ncm_densidade_kg_m3 with ANP-standard
-- densities (832 / 745 / 870) after migration 20260525000060.
--
-- Unit math:
--   mdic_comex.volume_kg is in kilograms.
--   ton  = volume_kg / 1000
--   m3   = volume_kg / densidade_kg_m3
--   bbl  = m3 * 6.28981   (1 m3 of crude/refined product ~= 6.28981 barrels)
--
-- Owner: worker_supabase
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Step 1 — Extend the source CHECK constraint to allow 'mdic'.
-- The original CHECK was declared inline in CREATE TABLE (migration
-- 20260525000010), and Postgres named it `imports_product_map_source_check`.
-- An earlier revision of this file used a defensive DO block that looked up
-- the constraint via `pg_get_constraintdef(oid) ILIKE '%source%IN%'`. That
-- pattern does NOT match the stored form, which Postgres rewrites to
-- `CHECK ((source = ANY (ARRAY['daie'::text, 'desembaracos'::text])))`.
-- The DO block silently skipped the drop, and the subsequent ADD CONSTRAINT
-- failed with `42710` (constraint already exists). Direct DROP IF EXISTS by
-- the known name is both correct and idempotent.
-- -----------------------------------------------------------------------------
ALTER TABLE public.imports_product_map
  DROP CONSTRAINT IF EXISTS imports_product_map_source_check;

ALTER TABLE public.imports_product_map
  ADD CONSTRAINT imports_product_map_source_check
    CHECK (source IN ('daie','desembaracos','mdic'));

-- -----------------------------------------------------------------------------
-- Step 2 — Seed the MDIC source mapping (3 rows).
-- ON CONFLICT DO NOTHING keeps this migration safe to re-apply, and avoids
-- clobbering any future tweak to unified_product done out-of-band.
-- -----------------------------------------------------------------------------
INSERT INTO public.imports_product_map (unified_product, source, source_key) VALUES
  ('Diesel',    'mdic', '27101921'),
  ('Gasoline',  'mdic', '27101259'),
  ('Crude Oil', 'mdic', '27090010')
ON CONFLICT (source, source_key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Step 3 — RPC: get_imports_exports_fob_price_serie
-- Returns one row per (ano, mes) for the requested unified_product, with the
-- monthly aggregate volumes (kg and m3), total FOB USD, and the three derived
-- unit prices (USD/ton, USD/m3, USD/bbl).
--
-- Imports only (flow='import' in mdic_comex). Joined with imports_product_map
-- under source='mdic' so multiple NCMs can roll up to one unified_product if
-- ever needed (today it is 1:1 per product).
--
-- LANGUAGE sql STABLE + SECURITY INVOKER + SET search_path = public — same
-- profile as the rest of the get_imports_exports_* family (per Hardening B).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_imports_exports_fob_price_serie(
  p_unified_product text,
  p_ano_inicio      int,
  p_ano_fim         int
)
RETURNS TABLE (
  ano              int,
  mes              int,
  total_volume_kg  numeric,
  total_volume_m3  numeric,
  total_fob_usd    numeric,
  fob_per_ton      numeric,
  fob_per_m3       numeric,
  fob_per_bbl      numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH src AS (
    SELECT
      m.ano::int                                          AS ano,
      m.mes::int                                          AS mes,
      SUM(m.volume_kg)::numeric                           AS total_volume_kg,
      SUM(m.volume_kg / d.densidade_kg_m3)::numeric       AS total_volume_m3,
      SUM(m.valor_fob_usd)::numeric                       AS total_fob_usd
    FROM public.mdic_comex m
    JOIN public.imports_product_map p
      ON p.source = 'mdic' AND p.source_key = m.ncm_codigo
    JOIN public.ncm_densidade_kg_m3 d
      ON d.ncm_codigo = m.ncm_codigo
    WHERE m.flow = 'import'
      AND p.unified_product = p_unified_product
      AND m.ano BETWEEN p_ano_inicio AND p_ano_fim
      AND m.volume_kg     IS NOT NULL
      AND m.valor_fob_usd IS NOT NULL
    GROUP BY m.ano, m.mes
  )
  SELECT
    ano,
    mes,
    total_volume_kg,
    total_volume_m3,
    total_fob_usd,
    -- Guard against zero/negative denominators; NULL on miss is preferable
    -- to a division-by-zero error or a misleading huge number.
    CASE WHEN total_volume_kg > 0
      THEN total_fob_usd / (total_volume_kg / 1000.0)
      ELSE NULL END                                       AS fob_per_ton,
    CASE WHEN total_volume_m3 > 0
      THEN total_fob_usd / total_volume_m3
      ELSE NULL END                                       AS fob_per_m3,
    CASE WHEN total_volume_m3 > 0
      THEN total_fob_usd / (total_volume_m3 * 6.28981)
      ELSE NULL END                                       AS fob_per_bbl
  FROM src
  ORDER BY ano, mes;
$$;

GRANT EXECUTE ON FUNCTION public.get_imports_exports_fob_price_serie(text, int, int)
  TO anon, authenticated;

COMMIT;
