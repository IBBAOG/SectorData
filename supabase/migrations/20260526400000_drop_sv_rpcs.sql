-- Sales Volumes consolidation into Market Share (2026-05-26)
-- The /sales-volumes dashboard was retired; /market-share now serves both
-- "% Share" and "thousand m3" via a top-level unit toggle.
-- The get_sv_* family is dropped because get_ms_serie_fast already returns
-- absolute quantities; market-share normalizes client-side per unitMode.

DROP FUNCTION IF EXISTS public.get_sv_opcoes_filtros();
DROP FUNCTION IF EXISTS public.get_sv_serie_fast(text, text, text[], text[], text[]);
DROP FUNCTION IF EXISTS public.get_sv_serie_others(text, text, text[], text[], text[]);
DROP FUNCTION IF EXISTS public.get_sv_others_players();

DELETE FROM public.module_visibility WHERE module_slug = 'sales-volumes';
