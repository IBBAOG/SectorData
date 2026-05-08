-- ============================================================================
-- ANP CDP Diaria — tabela, indices, RLS, RPCs
-- Source: Painel Dinamico de Producao Diaria ANP (aba "Campos")
--         https://www.anp.gov.br/producao-de-petroleo-e-gas-natural/painel-dinamico-de-producao-diaria
-- Granularidade: 1 linha = 1 campo x 1 dia
-- Volume: ~16.5k linhas iniciais (94 campos x ~165 dias), cresce ~94 lin/dia.
-- Range: dados a partir de 2025-11-30 (limite da fonte ANP).
-- ETL: worker_etl-pipelines via GHA, 3x/dia, upsert por PK composta.
-- ============================================================================

-- ── Tabela ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.anp_cdp_diaria (
    data             DATE  NOT NULL,
    campo            TEXT  NOT NULL,
    bacia            TEXT  NOT NULL,
    petroleo_bbl_dia REAL,                        -- bbl/dia (FLOAT4; valores simples da fonte ANP)
    gas_mm3_dia      REAL,                        -- Mm3/dia
    PRIMARY KEY (data, campo, bacia)              -- PK composta: idempotencia do upsert 3x/dia
);

COMMENT ON TABLE public.anp_cdp_diaria IS
    'Producao diaria de petroleo e gas por campo (fonte: ANP Painel Dinamico, aba Campos). '
    'Granularidade: 1 linha = 1 campo x 1 dia. PK composta permite UPSERT idempotente. '
    'Dataset comeca em 2025-11-30. Nao confundir com anp_cdp_producao (mensal x poco).';

-- ── Indices ───────────────────────────────────────────────────────────────────

-- Range queries no period slider (data DESC para busca de periodo mais recente)
CREATE INDEX IF NOT EXISTS anp_cdp_diaria_data_idx
    ON public.anp_cdp_diaria (data DESC);

-- Filtro por campo (dropdown frontend)
CREATE INDEX IF NOT EXISTS anp_cdp_diaria_campo_idx
    ON public.anp_cdp_diaria (campo);

-- Filtro por bacia (dropdown frontend)
CREATE INDEX IF NOT EXISTS anp_cdp_diaria_bacia_idx
    ON public.anp_cdp_diaria (bacia);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.anp_cdp_diaria ENABLE ROW LEVEL SECURITY;

-- Usuarios autenticados leem tudo (padrao Fase 3 — dados ANP publicos)
CREATE POLICY "anp_cdp_diaria_authenticated_read"
    ON public.anp_cdp_diaria
    FOR SELECT TO authenticated USING (true);

-- Sem policy de INSERT/UPDATE/DELETE para anon/authenticated:
-- apenas service_role (pipelines) escreve via SUPABASE_SERVICE_ROLE_KEY.

-- ── module_visibility ─────────────────────────────────────────────────────────

INSERT INTO public.module_visibility (module_slug, is_visible_for_clients)
VALUES ('anp-cdp-diaria', true)
ON CONFLICT (module_slug) DO NOTHING;

-- ── RPC: filtros ──────────────────────────────────────────────────────────────
-- Retorna dimensoes disponiveis para popular dropdowns do frontend.
-- Padrao dos outros dashboards (get_anp_glp_filtros, get_anp_lpc_filtros, etc.).

CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_filtros()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'campos', (
            SELECT COALESCE(jsonb_agg(DISTINCT campo ORDER BY campo), '[]'::jsonb)
            FROM public.anp_cdp_diaria
        ),
        'bacias', (
            SELECT COALESCE(jsonb_agg(DISTINCT bacia ORDER BY bacia), '[]'::jsonb)
            FROM public.anp_cdp_diaria
        ),
        'data_min', (SELECT MIN(data) FROM public.anp_cdp_diaria),
        'data_max', (SELECT MAX(data) FROM public.anp_cdp_diaria)
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_filtros()
    TO anon, authenticated;

-- ── RPC: serie temporal ───────────────────────────────────────────────────────
-- Retorna rows filtradas sem agregacao — o frontend agrega dinamicamente.
-- NULL nos arrays de filtro = sem filtro (todos os valores).
-- Padrao identico ao get_anp_glp_serie e outros dashboards Fase 3.

CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_serie(
    p_campos       text[]  DEFAULT NULL,
    p_bacias       text[]  DEFAULT NULL,
    p_data_inicio  date    DEFAULT NULL,
    p_data_fim     date    DEFAULT NULL
)
RETURNS TABLE(
    data             DATE,
    campo            TEXT,
    bacia            TEXT,
    petroleo_bbl_dia REAL,
    gas_mm3_dia      REAL
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        data,
        campo,
        bacia,
        petroleo_bbl_dia,
        gas_mm3_dia
    FROM public.anp_cdp_diaria
    WHERE
        (p_campos      IS NULL OR campo = ANY(p_campos))
        AND (p_bacias  IS NULL OR bacia = ANY(p_bacias))
        AND (p_data_inicio IS NULL OR data >= p_data_inicio)
        AND (p_data_fim    IS NULL OR data <= p_data_fim)
    ORDER BY data ASC, campo ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_serie(text[], text[], date, date)
    TO anon, authenticated;
