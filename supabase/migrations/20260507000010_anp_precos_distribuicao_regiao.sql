-- ============================================================================
-- ANP Preços de Distribuição — adiciona granularidade 'regiao'
-- Source: combustiveis-liquidos-regioes.xlsx + glp-regioes.xlsx (ANP)
-- Regiões: NORTE, NORDESTE, CENTRO OESTE, SUDESTE, SUL
-- ============================================================================

-- 1. Coluna nova (depois de municipio, antes de preco_medio)
ALTER TABLE public.anp_precos_distribuicao
    ADD COLUMN IF NOT EXISTS regiao TEXT;

-- COMMENT indica semântica (NULL exceto quando granularidade = 'regiao')
COMMENT ON COLUMN public.anp_precos_distribuicao.regiao
    IS 'Nome da região geográfica (NORTE, NORDESTE, CENTRO OESTE, SUDESTE, SUL). NULL exceto quando granularidade = ''regiao''.';

-- 2. CHECK constraint — expandir para incluir 'regiao'
ALTER TABLE public.anp_precos_distribuicao
    DROP CONSTRAINT IF EXISTS anp_precos_distribuicao_granularidade_check;

ALTER TABLE public.anp_precos_distribuicao
    ADD CONSTRAINT anp_precos_distribuicao_granularidade_check
    CHECK (granularidade IN ('brasil', 'uf', 'municipio', 'regiao'));

-- 3. UNIQUE constraint — incluir regiao para evitar duplicatas no ETL
ALTER TABLE public.anp_precos_distribuicao
    DROP CONSTRAINT IF EXISTS uq_anp_precos_distribuicao;

ALTER TABLE public.anp_precos_distribuicao
    ADD CONSTRAINT anp_precos_distribuicao_natural_key
    UNIQUE (data_referencia, produto, granularidade, uf, municipio, regiao);

-- 4. Índice parcial em regiao
CREATE INDEX IF NOT EXISTS idx_anp_precos_distribuicao_regiao
    ON public.anp_precos_distribuicao (regiao)
    WHERE regiao IS NOT NULL;

-- 5a. RPC: filtros — adiciona eixo 'regioes'
CREATE OR REPLACE FUNCTION public.get_anp_precos_distribuicao_filtros()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'produtos', (
            SELECT COALESCE(jsonb_agg(DISTINCT produto ORDER BY produto), '[]'::jsonb)
            FROM public.anp_precos_distribuicao
        ),
        'granularidades', (
            SELECT COALESCE(
                jsonb_agg(g ORDER BY
                    CASE g
                        WHEN 'brasil'    THEN 1
                        WHEN 'uf'        THEN 2
                        WHEN 'municipio' THEN 3
                        WHEN 'regiao'    THEN 4
                        ELSE 5
                    END
                ),
                '[]'::jsonb
            )
            FROM (
                SELECT DISTINCT granularidade AS g
                FROM public.anp_precos_distribuicao
            ) sub
        ),
        'ufs', (
            SELECT COALESCE(jsonb_agg(DISTINCT uf ORDER BY uf), '[]'::jsonb)
            FROM public.anp_precos_distribuicao
            WHERE uf IS NOT NULL
        ),
        'municipios', (
            SELECT COALESCE(jsonb_agg(DISTINCT municipio ORDER BY municipio), '[]'::jsonb)
            FROM public.anp_precos_distribuicao
            WHERE municipio IS NOT NULL
        ),
        'regioes', (
            SELECT COALESCE(jsonb_agg(DISTINCT regiao ORDER BY regiao), '[]'::jsonb)
            FROM public.anp_precos_distribuicao
            WHERE regiao IS NOT NULL
        ),
        'data_min', (SELECT MIN(data_referencia) FROM public.anp_precos_distribuicao),
        'data_max', (SELECT MAX(data_referencia) FROM public.anp_precos_distribuicao)
    );
$$;

-- 5b. RPC: série — suporte ao eixo 'regiao'
CREATE OR REPLACE FUNCTION public.get_anp_precos_distribuicao_serie(
    p_produto       text,
    p_granularidade text,
    p_locais        text[]  DEFAULT NULL,
    p_data_inicio   date    DEFAULT NULL,
    p_data_fim      date    DEFAULT NULL
)
RETURNS TABLE(
    data_referencia date,
    local           text,
    preco_medio     numeric,
    preco_minimo    numeric,
    preco_maximo    numeric,
    unidade         text
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        data_referencia,
        CASE p_granularidade
            WHEN 'brasil'    THEN 'Brasil'
            WHEN 'uf'        THEN uf
            WHEN 'municipio' THEN municipio
            WHEN 'regiao'    THEN regiao
        END AS local,
        preco_medio,
        preco_minimo,
        preco_maximo,
        unidade
    FROM public.anp_precos_distribuicao
    WHERE produto       = p_produto
      AND granularidade = p_granularidade
      AND (p_data_inicio IS NULL OR data_referencia >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_referencia <= p_data_fim)
      AND (
          p_locais IS NULL
          OR (p_granularidade = 'uf'        AND uf        = ANY(p_locais))
          OR (p_granularidade = 'municipio' AND municipio = ANY(p_locais))
          OR (p_granularidade = 'regiao'    AND regiao    = ANY(p_locais))
          OR  p_granularidade = 'brasil'
      )
    ORDER BY data_referencia,
             CASE p_granularidade
                 WHEN 'brasil'    THEN 'Brasil'
                 WHEN 'uf'        THEN uf
                 WHEN 'municipio' THEN municipio
                 WHEN 'regiao'    THEN regiao
             END;
$$;

-- 5c. RPC: export count — incluir regiao no filtro de locais
CREATE OR REPLACE FUNCTION public.get_anp_precos_distribuicao_export_count(
    p_produtos        text[]  DEFAULT NULL,
    p_granularidades  text[]  DEFAULT NULL,
    p_locais          text[]  DEFAULT NULL,
    p_data_inicio     date    DEFAULT NULL,
    p_data_fim        date    DEFAULT NULL
)
RETURNS int
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COUNT(*)::int
    FROM public.anp_precos_distribuicao
    WHERE
        (p_produtos       IS NULL OR produto       = ANY(p_produtos))
        AND (p_granularidades IS NULL OR granularidade = ANY(p_granularidades))
        AND (p_data_inicio IS NULL OR data_referencia >= p_data_inicio)
        AND (p_data_fim    IS NULL OR data_referencia <= p_data_fim)
        AND (
            p_locais IS NULL
            OR uf        = ANY(p_locais)
            OR municipio = ANY(p_locais)
            OR regiao    = ANY(p_locais)
        );
$$;
