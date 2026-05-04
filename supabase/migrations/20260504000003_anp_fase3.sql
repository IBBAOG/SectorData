-- ============================================================================
-- ANP Dados Abertos IE, Desembaraços, Painel Importações — tables + RPCs
-- ============================================================================

-- ── ANP Dados Abertos IE ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.anp_daie (
    ano        smallint NOT NULL,
    mes        smallint NOT NULL,
    produto    text     NOT NULL,
    operacao   text     NOT NULL,
    volume_m3  float8,
    valor_usd  float8,
    CONSTRAINT anp_daie_pkey PRIMARY KEY (ano, mes, produto, operacao)
);

CREATE INDEX IF NOT EXISTS idx_anp_daie_periodo  ON public.anp_daie (ano, mes);
CREATE INDEX IF NOT EXISTS idx_anp_daie_produto  ON public.anp_daie (produto);
CREATE INDEX IF NOT EXISTS idx_anp_daie_operacao ON public.anp_daie (operacao);

ALTER TABLE public.anp_daie ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acesso autenticado" ON public.anp_daie
    FOR SELECT TO authenticated USING (true);

INSERT INTO public.module_visibility (module_slug, is_visible_for_clients)
VALUES ('anp-daie', true)
ON CONFLICT (module_slug) DO NOTHING;

-- RPC: time series
CREATE OR REPLACE FUNCTION public.get_anp_daie_serie(
    p_operacoes  text[]   DEFAULT NULL,
    p_produtos   text[]   DEFAULT NULL,
    p_ano_inicio smallint DEFAULT NULL,
    p_ano_fim    smallint DEFAULT NULL
)
RETURNS TABLE(
    ano        smallint,
    mes        smallint,
    produto    text,
    operacao   text,
    volume_m3  float8,
    valor_usd  float8
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT ano, mes, produto, operacao, volume_m3, valor_usd
    FROM public.anp_daie
    WHERE
        (p_operacoes IS NULL OR operacao = ANY(p_operacoes))
        AND (p_produtos  IS NULL OR produto  = ANY(p_produtos))
        AND (p_ano_inicio IS NULL OR ano    >= p_ano_inicio)
        AND (p_ano_fim    IS NULL OR ano    <= p_ano_fim)
    ORDER BY ano, mes, produto, operacao;
$$;

-- RPC: filter options
CREATE OR REPLACE FUNCTION public.get_anp_daie_filtros()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
    SELECT json_build_object(
        'produtos',  (SELECT COALESCE(json_agg(DISTINCT produto  ORDER BY produto),  '[]'::json) FROM public.anp_daie),
        'operacoes', (SELECT COALESCE(json_agg(DISTINCT operacao ORDER BY operacao), '[]'::json) FROM public.anp_daie),
        'ano_min', (SELECT MIN(ano) FROM public.anp_daie),
        'ano_max', (SELECT MAX(ano) FROM public.anp_daie)
    );
$$;


-- ── ANP Desembaraços ──────────────────────────────────────────────────────────
-- Aggregated by (ano, mes, ncm_codigo, pais_origem) — SUM(quantidade_kg)

CREATE TABLE IF NOT EXISTS public.anp_desembaracos (
    ano           smallint NOT NULL,
    mes           smallint NOT NULL,
    ncm_codigo    text     NOT NULL,
    ncm_nome      text,
    pais_origem   text     NOT NULL,
    quantidade_kg float8,
    CONSTRAINT anp_desembaracos_pkey PRIMARY KEY (ano, mes, ncm_codigo, pais_origem)
);

CREATE INDEX IF NOT EXISTS idx_anp_desemb_periodo ON public.anp_desembaracos (ano, mes);
CREATE INDEX IF NOT EXISTS idx_anp_desemb_ncm     ON public.anp_desembaracos (ncm_codigo);
CREATE INDEX IF NOT EXISTS idx_anp_desemb_pais    ON public.anp_desembaracos (pais_origem);

ALTER TABLE public.anp_desembaracos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acesso autenticado" ON public.anp_desembaracos
    FOR SELECT TO authenticated USING (true);

INSERT INTO public.module_visibility (module_slug, is_visible_for_clients)
VALUES ('anp-desembaracos', true)
ON CONFLICT (module_slug) DO NOTHING;

-- RPC: time series
CREATE OR REPLACE FUNCTION public.get_anp_desembaracos_serie(
    p_ncms       text[]   DEFAULT NULL,
    p_paises     text[]   DEFAULT NULL,
    p_ano_inicio smallint DEFAULT NULL,
    p_ano_fim    smallint DEFAULT NULL
)
RETURNS TABLE(
    ano           smallint,
    mes           smallint,
    ncm_codigo    text,
    ncm_nome      text,
    pais_origem   text,
    quantidade_kg float8
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT ano, mes, ncm_codigo, ncm_nome, pais_origem, quantidade_kg
    FROM public.anp_desembaracos
    WHERE
        (p_ncms   IS NULL OR ncm_codigo  = ANY(p_ncms))
        AND (p_paises IS NULL OR pais_origem = ANY(p_paises))
        AND (p_ano_inicio IS NULL OR ano >= p_ano_inicio)
        AND (p_ano_fim    IS NULL OR ano <= p_ano_fim)
    ORDER BY ano, mes, ncm_codigo, pais_origem;
$$;

-- RPC: top origin countries for a given NCM and period
CREATE OR REPLACE FUNCTION public.get_anp_desembaracos_top_paises(
    p_ncm_codigo text,
    p_ano_inicio smallint DEFAULT NULL,
    p_ano_fim    smallint DEFAULT NULL,
    p_limit      int      DEFAULT 15
)
RETURNS TABLE(
    pais_origem   text,
    total_kg      float8
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT pais_origem, SUM(quantidade_kg)::float8 AS total_kg
    FROM public.anp_desembaracos
    WHERE ncm_codigo = p_ncm_codigo
      AND (p_ano_inicio IS NULL OR ano >= p_ano_inicio)
      AND (p_ano_fim    IS NULL OR ano <= p_ano_fim)
    GROUP BY pais_origem
    ORDER BY total_kg DESC NULLS LAST
    LIMIT p_limit;
$$;

-- RPC: filter options
CREATE OR REPLACE FUNCTION public.get_anp_desembaracos_filtros()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
    SELECT json_build_object(
        'ncms', (
            SELECT COALESCE(
                json_agg(sub ORDER BY (sub->>'ncm_codigo')),
                '[]'::json
            )
            FROM (
                SELECT DISTINCT
                    json_build_object('ncm_codigo', ncm_codigo, 'ncm_nome', MAX(ncm_nome)) AS sub
                FROM public.anp_desembaracos
                GROUP BY ncm_codigo
            ) t
        ),
        'paises',  (SELECT COALESCE(json_agg(DISTINCT pais_origem ORDER BY pais_origem), '[]'::json) FROM public.anp_desembaracos),
        'ano_min', (SELECT MIN(ano) FROM public.anp_desembaracos),
        'ano_max', (SELECT MAX(ano) FROM public.anp_desembaracos)
    );
$$;


-- ── ANP Painel — Importações de Distribuidores ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.anp_painel_imp_dist (
    ano           smallint NOT NULL,
    mes           smallint NOT NULL,
    distribuidor  text     NOT NULL,
    uf            text     NOT NULL,
    nome_produto  text     NOT NULL,
    volume_m3     float8,
    CONSTRAINT anp_painel_imp_dist_pkey PRIMARY KEY (ano, mes, distribuidor, uf, nome_produto)
);

CREATE INDEX IF NOT EXISTS idx_anp_pimp_periodo ON public.anp_painel_imp_dist (ano, mes);
CREATE INDEX IF NOT EXISTS idx_anp_pimp_produto ON public.anp_painel_imp_dist (nome_produto);
CREATE INDEX IF NOT EXISTS idx_anp_pimp_dist    ON public.anp_painel_imp_dist (distribuidor);

ALTER TABLE public.anp_painel_imp_dist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acesso autenticado" ON public.anp_painel_imp_dist
    FOR SELECT TO authenticated USING (true);

INSERT INTO public.module_visibility (module_slug, is_visible_for_clients)
VALUES ('anp-painel-importacoes', true)
ON CONFLICT (module_slug) DO NOTHING;

-- RPC: aggregated monthly series by product (sum across distributors/UFs)
CREATE OR REPLACE FUNCTION public.get_anp_painel_imp_serie(
    p_produtos   text[]   DEFAULT NULL,
    p_ufs        text[]   DEFAULT NULL,
    p_ano_inicio smallint DEFAULT NULL,
    p_ano_fim    smallint DEFAULT NULL
)
RETURNS TABLE(
    ano          smallint,
    mes          smallint,
    nome_produto text,
    volume_m3    float8
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT ano, mes, nome_produto, SUM(volume_m3)::float8 AS volume_m3
    FROM public.anp_painel_imp_dist
    WHERE
        (p_produtos IS NULL OR nome_produto = ANY(p_produtos))
        AND (p_ufs  IS NULL OR uf           = ANY(p_ufs))
        AND (p_ano_inicio IS NULL OR ano    >= p_ano_inicio)
        AND (p_ano_fim    IS NULL OR ano    <= p_ano_fim)
    GROUP BY ano, mes, nome_produto
    ORDER BY ano, mes, nome_produto;
$$;

-- RPC: top distributors for a given product and period
CREATE OR REPLACE FUNCTION public.get_anp_painel_imp_top_dist(
    p_produto    text,
    p_ano_inicio smallint DEFAULT NULL,
    p_ano_fim    smallint DEFAULT NULL,
    p_limit      int      DEFAULT 15
)
RETURNS TABLE(
    distribuidor text,
    total_m3     float8
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT distribuidor, SUM(volume_m3)::float8 AS total_m3
    FROM public.anp_painel_imp_dist
    WHERE nome_produto = p_produto
      AND (p_ano_inicio IS NULL OR ano >= p_ano_inicio)
      AND (p_ano_fim    IS NULL OR ano <= p_ano_fim)
    GROUP BY distribuidor
    ORDER BY total_m3 DESC NULLS LAST
    LIMIT p_limit;
$$;

-- RPC: filter options
CREATE OR REPLACE FUNCTION public.get_anp_painel_imp_filtros()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
    SELECT json_build_object(
        'produtos',      (SELECT COALESCE(json_agg(DISTINCT nome_produto ORDER BY nome_produto), '[]'::json) FROM public.anp_painel_imp_dist),
        'ufs',           (SELECT COALESCE(json_agg(DISTINCT uf           ORDER BY uf),           '[]'::json) FROM public.anp_painel_imp_dist),
        'distribuidores',(SELECT COALESCE(json_agg(DISTINCT distribuidor  ORDER BY distribuidor),  '[]'::json) FROM public.anp_painel_imp_dist),
        'ano_min', (SELECT MIN(ano) FROM public.anp_painel_imp_dist),
        'ano_max', (SELECT MAX(ano) FROM public.anp_painel_imp_dist)
    );
$$;
