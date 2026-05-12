-- ── Migration: extend get_mdic_comex_filtros to return distinct countries ──────
-- Adds `paises` field to the existing JSON response.
-- The function signature (no parameters, returns json) is preserved exactly.
-- A DROP is required before recreation because the return type is unchanged but
-- the body now includes an additional sub-select; CREATE OR REPLACE is sufficient
-- here, but we include DROP IF EXISTS for safety in case of type drift.

DROP FUNCTION IF EXISTS public.get_mdic_comex_filtros();

CREATE OR REPLACE FUNCTION public.get_mdic_comex_filtros()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
    SELECT json_build_object(
        'anos', (
            SELECT COALESCE(
                json_agg(ano ORDER BY ano),
                '[]'::json
            )
            FROM (SELECT DISTINCT ano::int AS ano FROM public.mdic_comex) sub
        ),
        'ncms', (
            SELECT COALESCE(
                json_agg(obj ORDER BY obj->>'ncm_codigo'),
                '[]'::json
            )
            FROM (
                SELECT json_build_object(
                    'ncm_codigo', ncm_codigo,
                    'ncm_nome',   MAX(ncm_nome)
                ) AS obj
                FROM public.mdic_comex
                GROUP BY ncm_codigo
            ) sub
        ),
        'paises', (
            SELECT COALESCE(
                array_to_json(
                    array_agg(pais ORDER BY pais)
                ),
                '[]'::json
            )
            FROM (
                SELECT DISTINCT pais
                FROM public.mdic_comex
                WHERE pais IS NOT NULL AND pais <> ''
            ) sub
        )
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_mdic_comex_filtros() TO authenticated, anon;
