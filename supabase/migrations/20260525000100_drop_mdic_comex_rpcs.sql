-- Deprecation cleanup: /mdic-comex dashboard retired.
-- Its function was consolidated into /imports-exports Panel C, which reads
-- the same mdic_comex table via the new get_imports_exports_fob_price_serie RPC.
--
-- Scope:
--   * DROP the 5 RPCs exclusive to the retired dashboard.
--   * DELETE the module_visibility row for module_slug='mdic-comex'.
--
-- Out of scope (intentionally untouched):
--   * mdic_comex table (still populated daily by etl_mdic_comex.yml,
--     consumed by get_imports_exports_fob_price_serie).
--   * imports_product_map source='mdic' rows (used by the FOB RPC).
--   * etl_mdic_comex.yml workflow.
--
-- Signatures below match pg_proc as of pre-flight on project rrrkgynlpqtmvuuqdjpb.

-- Step 1: drop the 5 retired RPCs.

DROP FUNCTION IF EXISTS public.get_mdic_comex_serie(text, text[], integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.get_mdic_comex_top_paises(text, text, integer, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.get_mdic_comex_filtros() CASCADE;
DROP FUNCTION IF EXISTS public.get_mdic_comex_aggregated(text, text[], integer, integer, text[], text[]) CASCADE;
DROP FUNCTION IF EXISTS public.get_mdic_comex_export_count(text, text[], integer, integer) CASCADE;

-- Step 2: remove module_visibility row for the retired dashboard.

DELETE FROM public.module_visibility WHERE module_slug = 'mdic-comex';
