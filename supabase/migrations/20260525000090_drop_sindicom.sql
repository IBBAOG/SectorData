-- Drop the SINDICOM dashboard (decommissioned 2026-05-25)
-- Originally created in 20260504000004_lpc_sindicom.sql (alongside anp_lpc, which remains)
DROP FUNCTION IF EXISTS public.get_sindicom_serie(text[], text[], text[], smallint, smallint) CASCADE;
DROP FUNCTION IF EXISTS public.get_sindicom_filtros() CASCADE;
DROP TABLE IF EXISTS public.sindicom CASCADE;
DELETE FROM public.module_visibility WHERE module_slug = 'sindicom';
