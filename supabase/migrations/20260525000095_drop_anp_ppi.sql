-- Drop ANP PPI dashboard backend (table + RPCs + module visibility row)
-- See plan: deletion of /anp-ppi dashboard + feeding ETL + alertas subsystem
-- Verified zero blast radius: subsidy-tracker uses price_bands.bba_import_parity (not anp_ppi),
-- and no view/MV/FK/trigger/other RPC depends on anp_ppi.

BEGIN;

DROP FUNCTION IF EXISTS public.get_anp_ppi_media_serie(date, date);
DROP FUNCTION IF EXISTS public.get_anp_ppi_locais_serie(text, date, date);
DROP FUNCTION IF EXISTS public.get_anp_ppi_filtros();

DROP TABLE IF EXISTS public.anp_ppi CASCADE;

DELETE FROM public.module_visibility WHERE module_slug = 'anp-ppi';

COMMIT;
