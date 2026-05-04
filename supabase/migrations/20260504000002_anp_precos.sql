-- ============================================================================
-- ANP PPI, Preços Produtores, GLP — tables, indexes, RLS, RPC functions
-- ============================================================================

-- ── ANP PPI ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.anp_ppi (
    data_fim      date  NOT NULL,
    data_inicio   date  NOT NULL,
    produto       text  NOT NULL,
    local         text  NOT NULL,
    preco         float4,
    variacao_pct  float4,
    unidade       text,
    CONSTRAINT anp_ppi_pkey PRIMARY KEY (data_fim, produto, local)
);

CREATE INDEX IF NOT EXISTS idx_anp_ppi_periodo  ON public.anp_ppi (data_fim);
CREATE INDEX IF NOT EXISTS idx_anp_ppi_produto  ON public.anp_ppi (produto);

ALTER TABLE public.anp_ppi ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acesso autenticado" ON public.anp_ppi
    FOR SELECT TO authenticated USING (true);

INSERT INTO public.module_visibility (module_slug, is_visible_for_clients)
VALUES ('anp-ppi', true)
ON CONFLICT (module_slug) DO NOTHING;

-- RPC: national average time series (default view — 4 products × N weeks)
CREATE OR REPLACE FUNCTION public.get_anp_ppi_media_serie(
    p_data_inicio date DEFAULT NULL,
    p_data_fim    date DEFAULT NULL
)
RETURNS TABLE(
    data_inicio   date,
    data_fim      date,
    produto       text,
    preco_medio   float4,
    unidade       text
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT
        MIN(data_inicio) AS data_inicio,
        data_fim,
        produto,
        AVG(preco)::float4 AS preco_medio,
        MAX(unidade) AS unidade
    FROM public.anp_ppi
    WHERE
        (p_data_inicio IS NULL OR data_fim >= p_data_inicio)
        AND (p_data_fim IS NULL OR data_fim <= p_data_fim)
    GROUP BY data_fim, produto
    ORDER BY data_fim, produto;
$$;

-- RPC: detail series by local (for selected produto)
CREATE OR REPLACE FUNCTION public.get_anp_ppi_locais_serie(
    p_produto     text,
    p_data_inicio date DEFAULT NULL,
    p_data_fim    date DEFAULT NULL
)
RETURNS TABLE(
    data_inicio   date,
    data_fim      date,
    local         text,
    preco         float4,
    variacao_pct  float4
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT data_inicio, data_fim, local, preco, variacao_pct
    FROM public.anp_ppi
    WHERE produto = p_produto
      AND (p_data_inicio IS NULL OR data_fim >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_fim <= p_data_fim)
    ORDER BY data_fim, local;
$$;

-- RPC: filter options
CREATE OR REPLACE FUNCTION public.get_anp_ppi_filtros()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
    SELECT json_build_object(
        'produtos', (
            SELECT COALESCE(json_agg(DISTINCT produto ORDER BY produto), '[]'::json)
            FROM public.anp_ppi
        ),
        'locais', (
            SELECT COALESCE(json_agg(DISTINCT local ORDER BY local), '[]'::json)
            FROM public.anp_ppi
        ),
        'data_min', (SELECT MIN(data_fim) FROM public.anp_ppi),
        'data_max', (SELECT MAX(data_fim) FROM public.anp_ppi)
    );
$$;


-- ── ANP Preços Produtores e Importadores ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.anp_precos_produtores (
    data_inicio   date  NOT NULL,
    data_fim      date  NOT NULL,
    produto       text  NOT NULL,
    unidade       text,
    regiao        text  NOT NULL,
    preco         float4,
    CONSTRAINT anp_precos_produtores_pkey PRIMARY KEY (data_inicio, produto, regiao)
);

CREATE INDEX IF NOT EXISTS idx_anp_pp_periodo ON public.anp_precos_produtores (data_inicio);
CREATE INDEX IF NOT EXISTS idx_anp_pp_produto ON public.anp_precos_produtores (produto);

ALTER TABLE public.anp_precos_produtores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acesso autenticado" ON public.anp_precos_produtores
    FOR SELECT TO authenticated USING (true);

INSERT INTO public.module_visibility (module_slug, is_visible_for_clients)
VALUES ('anp-precos-produtores', true)
ON CONFLICT (module_slug) DO NOTHING;

-- RPC: time series filterable by produto + regioes
CREATE OR REPLACE FUNCTION public.get_anp_precos_produtores_serie(
    p_produto     text   DEFAULT NULL,
    p_regioes     text[] DEFAULT NULL,
    p_data_inicio date   DEFAULT NULL,
    p_data_fim    date   DEFAULT NULL
)
RETURNS TABLE(
    data_inicio   date,
    data_fim      date,
    produto       text,
    unidade       text,
    regiao        text,
    preco         float4
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT data_inicio, data_fim, produto, unidade, regiao, preco
    FROM public.anp_precos_produtores
    WHERE
        (p_produto    IS NULL OR produto  = p_produto)
        AND (p_regioes IS NULL OR regiao  = ANY(p_regioes))
        AND (p_data_inicio IS NULL OR data_inicio >= p_data_inicio)
        AND (p_data_fim    IS NULL OR data_inicio <= p_data_fim)
    ORDER BY data_inicio, produto, regiao;
$$;

-- RPC: filter options
CREATE OR REPLACE FUNCTION public.get_anp_precos_produtores_filtros()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
    SELECT json_build_object(
        'produtos', (
            SELECT COALESCE(json_agg(DISTINCT produto ORDER BY produto), '[]'::json)
            FROM public.anp_precos_produtores
        ),
        'regioes', (
            SELECT COALESCE(json_agg(DISTINCT regiao ORDER BY regiao), '[]'::json)
            FROM public.anp_precos_produtores
        ),
        'data_min', (SELECT MIN(data_inicio) FROM public.anp_precos_produtores),
        'data_max', (SELECT MAX(data_inicio) FROM public.anp_precos_produtores)
    );
$$;


-- ── ANP GLP ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.anp_glp (
    ano           smallint NOT NULL,
    mes           smallint NOT NULL,
    distribuidora text     NOT NULL,
    categoria     text     NOT NULL,
    vendas_kg     float8,
    CONSTRAINT anp_glp_pkey PRIMARY KEY (ano, mes, distribuidora, categoria)
);

CREATE INDEX IF NOT EXISTS idx_anp_glp_periodo       ON public.anp_glp (ano, mes);
CREATE INDEX IF NOT EXISTS idx_anp_glp_distribuidora ON public.anp_glp (distribuidora);

ALTER TABLE public.anp_glp ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acesso autenticado" ON public.anp_glp
    FOR SELECT TO authenticated USING (true);

INSERT INTO public.module_visibility (module_slug, is_visible_for_clients)
VALUES ('anp-glp', true)
ON CONFLICT (module_slug) DO NOTHING;

-- RPC: time series filterable
CREATE OR REPLACE FUNCTION public.get_anp_glp_serie(
    p_distribuidoras text[]   DEFAULT NULL,
    p_categorias     text[]   DEFAULT NULL,
    p_ano_inicio     smallint DEFAULT NULL,
    p_ano_fim        smallint DEFAULT NULL
)
RETURNS TABLE(
    ano           smallint,
    mes           smallint,
    distribuidora text,
    categoria     text,
    vendas_kg     float8
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT ano, mes, distribuidora, categoria, vendas_kg
    FROM public.anp_glp
    WHERE
        (p_distribuidoras IS NULL OR distribuidora = ANY(p_distribuidoras))
        AND (p_categorias  IS NULL OR categoria    = ANY(p_categorias))
        AND (p_ano_inicio  IS NULL OR ano          >= p_ano_inicio)
        AND (p_ano_fim     IS NULL OR ano          <= p_ano_fim)
    ORDER BY ano, mes, distribuidora, categoria;
$$;

-- RPC: filter options
CREATE OR REPLACE FUNCTION public.get_anp_glp_filtros()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
    SELECT json_build_object(
        'distribuidoras', (
            SELECT COALESCE(json_agg(DISTINCT distribuidora ORDER BY distribuidora), '[]'::json)
            FROM public.anp_glp
        ),
        'categorias', (
            SELECT COALESCE(json_agg(DISTINCT categoria ORDER BY categoria), '[]'::json)
            FROM public.anp_glp
        ),
        'ano_min', (SELECT MIN(ano) FROM public.anp_glp),
        'ano_max', (SELECT MAX(ano) FROM public.anp_glp)
    );
$$;
