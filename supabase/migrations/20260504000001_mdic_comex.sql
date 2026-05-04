-- ============================================================================
-- MDIC Comex Stat — table, indexes, RLS, RPC functions
-- ============================================================================

-- ── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mdic_comex (
    ano           smallint  NOT NULL,
    mes           smallint  NOT NULL,
    flow          text      NOT NULL,   -- 'import' | 'export'
    ncm_codigo    text      NOT NULL,
    ncm_nome      text,
    pais          text      NOT NULL,
    volume_kg     float8,
    valor_fob_usd float8,
    CONSTRAINT mdic_comex_pkey PRIMARY KEY (ano, mes, flow, ncm_codigo, pais)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mdic_comex_periodo
    ON public.mdic_comex (ano, mes);
CREATE INDEX IF NOT EXISTS idx_mdic_comex_ncm
    ON public.mdic_comex (ncm_codigo);
CREATE INDEX IF NOT EXISTS idx_mdic_comex_flow
    ON public.mdic_comex (flow);

-- ── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE public.mdic_comex ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acesso autenticado" ON public.mdic_comex
    FOR SELECT TO authenticated USING (true);

-- ── Module visibility ────────────────────────────────────────────────────────
INSERT INTO public.module_visibility (module_slug, is_visible_for_clients)
VALUES ('mdic-comex', true)
ON CONFLICT (module_slug) DO NOTHING;

-- ── RPC 1: Monthly time series aggregated by NCM (no country breakdown) ──────
-- Returns at most ~2 100 rows for full history (3 NCMs × 2 flows × 350 months)
CREATE OR REPLACE FUNCTION public.get_mdic_comex_serie(
    p_flow        text     DEFAULT NULL,
    p_ncms        text[]   DEFAULT NULL,
    p_ano_inicio  int      DEFAULT NULL,
    p_ano_fim     int      DEFAULT NULL
)
RETURNS TABLE(
    ano           smallint,
    mes           smallint,
    flow          text,
    ncm_codigo    text,
    ncm_nome      text,
    volume_kg     float8,
    valor_fob_usd float8
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT
        ano,
        mes,
        flow,
        ncm_codigo,
        MAX(ncm_nome)        AS ncm_nome,
        SUM(volume_kg)       AS volume_kg,
        SUM(valor_fob_usd)   AS valor_fob_usd
    FROM public.mdic_comex
    WHERE
        (p_flow       IS NULL OR flow       = p_flow)
        AND (p_ncms   IS NULL OR ncm_codigo = ANY(p_ncms))
        AND (p_ano_inicio IS NULL OR ano    >= p_ano_inicio)
        AND (p_ano_fim    IS NULL OR ano    <= p_ano_fim)
    GROUP BY ano, mes, flow, ncm_codigo
    ORDER BY ano, mes, flow, ncm_codigo;
$$;

-- ── RPC 2: Top countries for a given product/period ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_mdic_comex_top_paises(
    p_flow        text    DEFAULT NULL,
    p_ncm_codigo  text    DEFAULT NULL,
    p_ano_inicio  int     DEFAULT NULL,
    p_ano_fim     int     DEFAULT NULL,
    p_limit       int     DEFAULT 15
)
RETURNS TABLE(
    pais          text,
    ncm_codigo    text,
    volume_kg     float8,
    valor_fob_usd float8
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT
        pais,
        ncm_codigo,
        SUM(volume_kg)     AS volume_kg,
        SUM(valor_fob_usd) AS valor_fob_usd
    FROM public.mdic_comex
    WHERE
        (p_flow        IS NULL OR flow        = p_flow)
        AND (p_ncm_codigo IS NULL OR ncm_codigo = p_ncm_codigo)
        AND (p_ano_inicio  IS NULL OR ano        >= p_ano_inicio)
        AND (p_ano_fim     IS NULL OR ano        <= p_ano_fim)
    GROUP BY pais, ncm_codigo
    ORDER BY SUM(volume_kg) DESC NULLS LAST
    LIMIT p_limit;
$$;

-- ── RPC 3: Filter options (anos + NCMs) for the UI ────────────────────────────
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
        )
    );
$$;
