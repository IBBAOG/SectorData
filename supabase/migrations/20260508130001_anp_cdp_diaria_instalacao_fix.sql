-- ============================================================================
-- Fix: filtro Campo no nivel Installation
-- ============================================================================
-- O entity Power BI v_instalacoes_final.Campo so preenche para instalacoes onshore.
-- 94% das instalacoes (FPSOs offshore) ficam com campo='' apos extract.
-- Solucao: derivar Campo via JOIN com anp_cdp_diaria_poco.
-- ============================================================================

-- 1. Adicionar instalacao em anp_cdp_diaria_poco
ALTER TABLE public.anp_cdp_diaria_poco
    ADD COLUMN IF NOT EXISTS instalacao TEXT;

CREATE INDEX IF NOT EXISTS anp_cdp_diaria_poco_instalacao_idx
    ON public.anp_cdp_diaria_poco (instalacao);

-- 2. Atualizar RPC get_anp_cdp_diaria_instalacao_filtros
--    campos agora vem de anp_cdp_diaria_poco (mapping completo poco<->instalacao<->campo)
CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_instalacao_filtros()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'campos', (
            -- Campos derivados de anp_cdp_diaria_poco (mapping completo poco<->instalacao<->campo)
            SELECT COALESCE(jsonb_agg(DISTINCT campo ORDER BY campo), '[]'::jsonb)
            FROM public.anp_cdp_diaria_poco
            WHERE campo IS NOT NULL
              AND campo <> ''
              AND instalacao IS NOT NULL
              AND instalacao <> ''
        ),
        'instalacoes', (
            SELECT COALESCE(jsonb_agg(DISTINCT instalacao ORDER BY instalacao), '[]'::jsonb)
            FROM public.anp_cdp_diaria_instalacao
        ),
        'data_min', (SELECT MIN(data) FROM public.anp_cdp_diaria_instalacao),
        'data_max', (SELECT MAX(data) FROM public.anp_cdp_diaria_instalacao)
    );
$$;

-- 3. Atualizar RPC get_anp_cdp_diaria_instalacao_serie
--    filtro p_campos agora e via subquery em anp_cdp_diaria_poco
CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_instalacao_serie(
    p_campos       text[]  DEFAULT NULL,
    p_instalacoes  text[]  DEFAULT NULL,
    p_data_inicio  date    DEFAULT NULL,
    p_data_fim     date    DEFAULT NULL
)
RETURNS TABLE(
    data             DATE,
    campo            TEXT,
    instalacao       TEXT,
    petroleo_bbl_dia REAL,
    gas_mm3_dia      REAL
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        i.data,
        i.campo,
        i.instalacao,
        i.petroleo_bbl_dia,
        i.gas_mm3_dia
    FROM public.anp_cdp_diaria_instalacao i
    WHERE
        -- Filtro de campo via mapping derivado da tabela poco
        (p_campos IS NULL OR i.instalacao IN (
            SELECT DISTINCT instalacao
            FROM public.anp_cdp_diaria_poco
            WHERE campo = ANY(p_campos)
              AND instalacao IS NOT NULL
              AND instalacao <> ''
        ))
        AND (p_instalacoes IS NULL OR i.instalacao = ANY(p_instalacoes))
        AND (p_data_inicio  IS NULL OR i.data >= p_data_inicio)
        AND (p_data_fim     IS NULL OR i.data <= p_data_fim)
    ORDER BY i.data ASC, i.instalacao ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_instalacao_filtros()
    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_instalacao_serie(text[], text[], date, date)
    TO anon, authenticated;
