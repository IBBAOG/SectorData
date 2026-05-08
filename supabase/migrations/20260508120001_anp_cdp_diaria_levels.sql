-- ============================================================================
-- ANP CDP Diaria — granularidades Instalacao e Poco
-- Source: Painel Dinamico de Producao Diaria ANP (Power BI)
--         Aba "v_instalacoes_final" (instalacoes) e
--         aba "v_poco_instalacao_sigep_ultimo" (pocos)
-- Relacao com anp_cdp_diaria: mesma fonte, mesma frequencia (3x/dia).
--   anp_cdp_diaria       → granularidade Campo (bacia disponivel)
--   anp_cdp_diaria_instalacao → granularidade Instalacao (SEM bacia — fonte nao fornece)
--   anp_cdp_diaria_poco  → granularidade Poco (bacia disponivel via entidade poco)
-- ETL: worker_etl-pipelines via GHA, upsert por PK composta.
-- ============================================================================

-- ── Tabela: anp_cdp_diaria_instalacao ────────────────────────────────────────
-- 1 linha = 1 instalacao x 1 dia.
-- Volume estimado: ~150-200 instalacoes x ~165 dias = ~30k linhas iniciais;
-- cresce ~150-200 linhas/dia.
-- Nota: bacia NAO esta presente nesta tabela — a entidade v_instalacoes_final
-- do Power BI ANP nao expoe campo Bacia. Frontend pode JOIN com anp_cdp_diaria
-- via campo para obter bacia quando necessario.

CREATE TABLE IF NOT EXISTS public.anp_cdp_diaria_instalacao (
    data              DATE  NOT NULL,
    campo             TEXT  NOT NULL,
    instalacao        TEXT  NOT NULL,
    petroleo_bbl_dia  REAL,             -- bbl/dia (FLOAT4; valores da fonte ANP)
    gas_mm3_dia       REAL,             -- Mm3/dia
    PRIMARY KEY (data, instalacao)      -- 1 instalacao aparece 1x/dia na fonte
);

COMMENT ON TABLE public.anp_cdp_diaria_instalacao IS
    'Producao diaria de petroleo e gas por instalacao (fonte: ANP Painel Dinamico, '
    'entidade v_instalacoes_final). Granularidade: 1 linha = 1 instalacao x 1 dia. '
    'Bacia nao disponivel nesta granularidade — JOIN com anp_cdp_diaria(campo) se necessario. '
    'Mesma fonte e frequencia ETL que anp_cdp_diaria (campo level).';

-- ── Indices: anp_cdp_diaria_instalacao ───────────────────────────────────────

-- Range queries no period slider
CREATE INDEX IF NOT EXISTS anp_cdp_diaria_instalacao_data_idx
    ON public.anp_cdp_diaria_instalacao (data DESC);

-- Filtro por campo (dropdown frontend)
CREATE INDEX IF NOT EXISTS anp_cdp_diaria_instalacao_campo_idx
    ON public.anp_cdp_diaria_instalacao (campo);

-- Filtro por instalacao (dropdown frontend)
CREATE INDEX IF NOT EXISTS anp_cdp_diaria_instalacao_inst_idx
    ON public.anp_cdp_diaria_instalacao (instalacao);

-- ── RLS: anp_cdp_diaria_instalacao ───────────────────────────────────────────

ALTER TABLE public.anp_cdp_diaria_instalacao ENABLE ROW LEVEL SECURITY;

-- Usuarios autenticados leem tudo (padrao Fase 3 — dados ANP publicos)
CREATE POLICY "anp_cdp_diaria_instalacao_authenticated_read"
    ON public.anp_cdp_diaria_instalacao
    FOR SELECT TO authenticated USING (true);

-- Sem policy de INSERT/UPDATE/DELETE para anon/authenticated:
-- apenas service_role (pipelines) escreve via SUPABASE_SERVICE_ROLE_KEY.

-- ── Tabela: anp_cdp_diaria_poco ───────────────────────────────────────────────
-- 1 linha = 1 poco x 1 dia (entidade "ultimo" da fonte — ja deduplica por dia).
-- Volume estimado: ~700-900 pocos x ~165 dias = ~115k-150k linhas iniciais;
-- cresce ~700-900 linhas/dia.
-- campo pode ser NULL se o mapeamento poco→campo estiver incompleto na fonte.

CREATE TABLE IF NOT EXISTS public.anp_cdp_diaria_poco (
    data              DATE  NOT NULL,
    campo             TEXT,             -- pode ser NULL se mapping incompleto
    bacia             TEXT,             -- disponivel via v_poco_instalacao_sigep_ultimo
    poco              TEXT  NOT NULL,   -- NOME POCO ANP (pode incluir parenteses/designacoes)
    petroleo_bbl_dia  REAL,             -- bbl/dia (FLOAT4)
    gas_mm3_dia       REAL,             -- Mm3/dia
    PRIMARY KEY (data, poco)            -- 1 poco aparece 1x/dia (entidade "ultimo")
);

COMMENT ON TABLE public.anp_cdp_diaria_poco IS
    'Producao diaria de petroleo e gas por poco (fonte: ANP Painel Dinamico, '
    'entidade v_poco_instalacao_sigep_ultimo). Granularidade: 1 linha = 1 poco x 1 dia. '
    'Bacia disponivel (ao contrario da granularidade instalacao). '
    'campo pode ser NULL para pocos sem mapeamento completo na fonte. '
    'Mesma fonte e frequencia ETL que anp_cdp_diaria (campo level).';

-- ── Indices: anp_cdp_diaria_poco ─────────────────────────────────────────────

-- Range queries no period slider
CREATE INDEX IF NOT EXISTS anp_cdp_diaria_poco_data_idx
    ON public.anp_cdp_diaria_poco (data DESC);

-- Filtro por campo (dropdown frontend)
CREATE INDEX IF NOT EXISTS anp_cdp_diaria_poco_campo_idx
    ON public.anp_cdp_diaria_poco (campo);

-- Filtro por bacia (dropdown frontend)
CREATE INDEX IF NOT EXISTS anp_cdp_diaria_poco_bacia_idx
    ON public.anp_cdp_diaria_poco (bacia);

-- Nota: poco esta na PK (data, poco) — indice automatico pelo Postgres.

-- ── RLS: anp_cdp_diaria_poco ─────────────────────────────────────────────────

ALTER TABLE public.anp_cdp_diaria_poco ENABLE ROW LEVEL SECURITY;

-- Usuarios autenticados leem tudo (padrao Fase 3 — dados ANP publicos)
CREATE POLICY "anp_cdp_diaria_poco_authenticated_read"
    ON public.anp_cdp_diaria_poco
    FOR SELECT TO authenticated USING (true);

-- Sem policy de INSERT/UPDATE/DELETE para anon/authenticated.

-- ── RPC: get_anp_cdp_diaria_instalacao_filtros ───────────────────────────────
-- Retorna dimensoes disponiveis para popular dropdowns do frontend.
-- Padrao identico a get_anp_cdp_diaria_filtros.
-- Sem bacia — entidade v_instalacoes_final nao tem esse campo.

CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_instalacao_filtros()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'campos', (
            SELECT COALESCE(jsonb_agg(DISTINCT campo ORDER BY campo), '[]'::jsonb)
            FROM public.anp_cdp_diaria_instalacao
        ),
        'instalacoes', (
            SELECT COALESCE(jsonb_agg(DISTINCT instalacao ORDER BY instalacao), '[]'::jsonb)
            FROM public.anp_cdp_diaria_instalacao
        ),
        'data_min', (SELECT MIN(data) FROM public.anp_cdp_diaria_instalacao),
        'data_max', (SELECT MAX(data) FROM public.anp_cdp_diaria_instalacao)
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_instalacao_filtros()
    TO anon, authenticated;

-- ── RPC: get_anp_cdp_diaria_instalacao_serie ─────────────────────────────────
-- Retorna rows filtradas sem agregacao — frontend agrega dinamicamente.
-- NULL nos arrays de filtro = sem filtro (todos os valores).
-- Padrao identico ao get_anp_cdp_diaria_serie e outros dashboards Fase 3.

CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_instalacao_serie(
    p_campos       text[]  DEFAULT NULL,
    p_instalacoes  text[]  DEFAULT NULL,
    p_data_inicio  date    DEFAULT NULL,
    p_data_fim     date    DEFAULT NULL
)
RETURNS TABLE(
    data              DATE,
    campo             TEXT,
    instalacao        TEXT,
    petroleo_bbl_dia  REAL,
    gas_mm3_dia       REAL
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        data,
        campo,
        instalacao,
        petroleo_bbl_dia,
        gas_mm3_dia
    FROM public.anp_cdp_diaria_instalacao
    WHERE
        (p_campos      IS NULL OR campo      = ANY(p_campos))
        AND (p_instalacoes IS NULL OR instalacao = ANY(p_instalacoes))
        AND (p_data_inicio IS NULL OR data       >= p_data_inicio)
        AND (p_data_fim    IS NULL OR data        <= p_data_fim)
    ORDER BY data ASC, instalacao ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_instalacao_serie(text[], text[], date, date)
    TO anon, authenticated;

-- ── RPC: get_anp_cdp_diaria_poco_filtros ─────────────────────────────────────
-- Retorna dimensoes disponiveis para popular dropdowns do frontend.
-- pocos pode ser grande (~700-900 entradas) — retorna tudo sem paginacao
-- (volume aceitavel para jsonb; frontend usa SearchableMultiSelect).

CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_poco_filtros()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'campos', (
            SELECT COALESCE(jsonb_agg(DISTINCT campo ORDER BY campo), '[]'::jsonb)
            FROM public.anp_cdp_diaria_poco
            WHERE campo IS NOT NULL
        ),
        'bacias', (
            SELECT COALESCE(jsonb_agg(DISTINCT bacia ORDER BY bacia), '[]'::jsonb)
            FROM public.anp_cdp_diaria_poco
            WHERE bacia IS NOT NULL
        ),
        'pocos', (
            SELECT COALESCE(jsonb_agg(DISTINCT poco ORDER BY poco), '[]'::jsonb)
            FROM public.anp_cdp_diaria_poco
        ),
        'data_min', (SELECT MIN(data) FROM public.anp_cdp_diaria_poco),
        'data_max', (SELECT MAX(data) FROM public.anp_cdp_diaria_poco)
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_poco_filtros()
    TO anon, authenticated;

-- ── RPC: get_anp_cdp_diaria_poco_serie ───────────────────────────────────────
-- Retorna rows filtradas sem agregacao — frontend agrega dinamicamente.
-- NULL nos arrays de filtro = sem filtro (todos os valores).

CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_poco_serie(
    p_campos       text[]  DEFAULT NULL,
    p_bacias       text[]  DEFAULT NULL,
    p_pocos        text[]  DEFAULT NULL,
    p_data_inicio  date    DEFAULT NULL,
    p_data_fim     date    DEFAULT NULL
)
RETURNS TABLE(
    data              DATE,
    campo             TEXT,
    bacia             TEXT,
    poco              TEXT,
    petroleo_bbl_dia  REAL,
    gas_mm3_dia       REAL
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        data,
        campo,
        bacia,
        poco,
        petroleo_bbl_dia,
        gas_mm3_dia
    FROM public.anp_cdp_diaria_poco
    WHERE
        (p_campos      IS NULL OR campo = ANY(p_campos))
        AND (p_bacias  IS NULL OR bacia = ANY(p_bacias))
        AND (p_pocos   IS NULL OR poco  = ANY(p_pocos))
        AND (p_data_inicio IS NULL OR data >= p_data_inicio)
        AND (p_data_fim    IS NULL OR data <= p_data_fim)
    ORDER BY data ASC, poco ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_poco_serie(text[], text[], text[], date, date)
    TO anon, authenticated;
