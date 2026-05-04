-- ============================================================================
-- ANP LPC (preços semanais por revenda) + SINDICOM (vendas mensais)
-- ============================================================================

-- ── ANP LPC ───────────────────────────────────────────────────────────────────
-- Weekly average retail price per product/state (aggregated from revenda level)

CREATE TABLE IF NOT EXISTS public.anp_lpc (
    data_fim           date    NOT NULL,   -- week-end date from filename
    produto            text    NOT NULL,
    estado             text    NOT NULL,   -- 2-char UF code
    preco_medio_venda  float4,
    preco_medio_compra float4,
    n_postos           integer,
    CONSTRAINT anp_lpc_pkey PRIMARY KEY (data_fim, produto, estado)
);

CREATE INDEX IF NOT EXISTS idx_anp_lpc_data    ON public.anp_lpc (data_fim);
CREATE INDEX IF NOT EXISTS idx_anp_lpc_produto ON public.anp_lpc (produto);
CREATE INDEX IF NOT EXISTS idx_anp_lpc_estado  ON public.anp_lpc (estado);

ALTER TABLE public.anp_lpc ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acesso autenticado" ON public.anp_lpc
    FOR SELECT TO authenticated USING (true);

INSERT INTO public.module_visibility (module_slug, is_visible_for_clients)
VALUES ('anp-lpc', true)
ON CONFLICT (module_slug) DO NOTHING;

-- RPC: time series (national average or filtered by states)
CREATE OR REPLACE FUNCTION public.get_anp_lpc_serie(
    p_produtos    text[]  DEFAULT NULL,
    p_estados     text[]  DEFAULT NULL,
    p_data_inicio date    DEFAULT NULL,
    p_data_fim    date    DEFAULT NULL
)
RETURNS TABLE(
    data_fim           date,
    produto            text,
    estado             text,
    preco_medio_venda  float4,
    preco_medio_compra float4,
    n_postos           integer
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT data_fim, produto, estado, preco_medio_venda, preco_medio_compra, n_postos
    FROM public.anp_lpc
    WHERE
        (p_produtos IS NULL OR produto = ANY(p_produtos))
        AND (p_estados IS NULL OR estado  = ANY(p_estados))
        AND (p_data_inicio IS NULL OR data_fim >= p_data_inicio)
        AND (p_data_fim    IS NULL OR data_fim <= p_data_fim)
    ORDER BY data_fim, produto, estado;
$$;

-- RPC: national weekly average (avg across all states, weighted by n_postos)
CREATE OR REPLACE FUNCTION public.get_anp_lpc_nacional(
    p_produtos    text[]  DEFAULT NULL,
    p_data_inicio date    DEFAULT NULL,
    p_data_fim    date    DEFAULT NULL
)
RETURNS TABLE(
    data_fim           date,
    produto            text,
    preco_medio_venda  float4,
    total_postos       bigint
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT
        data_fim,
        produto,
        (SUM(preco_medio_venda::float8 * n_postos) / NULLIF(SUM(n_postos), 0))::float4 AS preco_medio_venda,
        SUM(n_postos)::bigint AS total_postos
    FROM public.anp_lpc
    WHERE
        preco_medio_venda IS NOT NULL
        AND (p_produtos IS NULL OR produto = ANY(p_produtos))
        AND (p_data_inicio IS NULL OR data_fim >= p_data_inicio)
        AND (p_data_fim    IS NULL OR data_fim <= p_data_fim)
    GROUP BY data_fim, produto
    ORDER BY data_fim, produto;
$$;

-- RPC: filter options
CREATE OR REPLACE FUNCTION public.get_anp_lpc_filtros()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
    SELECT json_build_object(
        'produtos',   (SELECT COALESCE(json_agg(DISTINCT produto ORDER BY produto), '[]'::json) FROM public.anp_lpc),
        'estados',    (SELECT COALESCE(json_agg(DISTINCT estado  ORDER BY estado),  '[]'::json) FROM public.anp_lpc),
        'data_min', (SELECT MIN(data_fim) FROM public.anp_lpc),
        'data_max', (SELECT MAX(data_fim) FROM public.anp_lpc)
    );
$$;


-- ── SINDICOM ──────────────────────────────────────────────────────────────────
-- Monthly fuel distribution data from SINDICOM (sector association)

CREATE TABLE IF NOT EXISTS public.sindicom (
    ano           smallint NOT NULL,
    mes           smallint NOT NULL,
    empresa       text     NOT NULL,
    nome_produto  text     NOT NULL,
    segmento      text     NOT NULL DEFAULT '',
    uf            text     NOT NULL DEFAULT 'BR',
    tipo          text,
    tipo_produto  text,
    regiao        text,
    volume        float8,
    CONSTRAINT sindicom_pkey PRIMARY KEY (ano, mes, empresa, nome_produto, segmento, uf)
);

CREATE INDEX IF NOT EXISTS idx_sindicom_periodo  ON public.sindicom (ano, mes);
CREATE INDEX IF NOT EXISTS idx_sindicom_empresa  ON public.sindicom (empresa);
CREATE INDEX IF NOT EXISTS idx_sindicom_produto  ON public.sindicom (nome_produto);

ALTER TABLE public.sindicom ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acesso autenticado" ON public.sindicom
    FOR SELECT TO authenticated USING (true);

INSERT INTO public.module_visibility (module_slug, is_visible_for_clients)
VALUES ('sindicom', true)
ON CONFLICT (module_slug) DO NOTHING;

-- RPC: national monthly volume by company+product (sum across UFs)
CREATE OR REPLACE FUNCTION public.get_sindicom_serie(
    p_empresas    text[]   DEFAULT NULL,
    p_produtos    text[]   DEFAULT NULL,
    p_segmentos   text[]   DEFAULT NULL,
    p_ano_inicio  smallint DEFAULT NULL,
    p_ano_fim     smallint DEFAULT NULL
)
RETURNS TABLE(
    ano          smallint,
    mes          smallint,
    empresa      text,
    nome_produto text,
    segmento     text,
    volume       float8
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT ano, mes, empresa, nome_produto, segmento, SUM(volume)::float8 AS volume
    FROM public.sindicom
    WHERE
        (p_empresas  IS NULL OR empresa      = ANY(p_empresas))
        AND (p_produtos  IS NULL OR nome_produto = ANY(p_produtos))
        AND (p_segmentos IS NULL OR segmento     = ANY(p_segmentos))
        AND (p_ano_inicio IS NULL OR ano >= p_ano_inicio)
        AND (p_ano_fim    IS NULL OR ano <= p_ano_fim)
    GROUP BY ano, mes, empresa, nome_produto, segmento
    ORDER BY ano, mes, empresa, nome_produto;
$$;

-- RPC: filter options
CREATE OR REPLACE FUNCTION public.get_sindicom_filtros()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
    SELECT json_build_object(
        'empresas',  (SELECT COALESCE(json_agg(DISTINCT empresa      ORDER BY empresa),      '[]'::json) FROM public.sindicom),
        'produtos',  (SELECT COALESCE(json_agg(DISTINCT nome_produto ORDER BY nome_produto), '[]'::json) FROM public.sindicom),
        'segmentos', (SELECT COALESCE(json_agg(DISTINCT segmento     ORDER BY segmento),     '[]'::json) FROM public.sindicom WHERE segmento <> ''),
        'ano_min', (SELECT MIN(ano) FROM public.sindicom),
        'ano_max', (SELECT MAX(ano) FROM public.sindicom)
    );
$$;
