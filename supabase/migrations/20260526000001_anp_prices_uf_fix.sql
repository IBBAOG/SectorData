-- =============================================================================
-- ANP Prices consolidation — UF mapping fix.
--
-- Discovered during smoke tests for /anp-prices: anp_precos_distribuicao.uf
-- stores full state names ('SAO PAULO', 'RIO DE JANEIRO') while anon-side
-- filters use 2-letter codes ('SP', 'RJ') sourced from anp_lpc.estado.
-- The previous get_anp_prices_serie matched uf=ANY(p_locais) without
-- translation, so a request for ['SP'] returned 0 distribution rows.
--
-- This migration replaces the function with one that:
--   1. Translates user-provided 2-letter codes -> full UF names for matching
--      against anp_precos_distribuicao.uf.
--   2. Emits 2-letter codes in the output `local` column (consistent with
--      the retail source which already uses 2-letter codes).
--
-- All other logic (Diesel/Gasoline grade fallback, GLP normalization, region
-- normalization, Brasil aggregation) is unchanged.
--
-- Owner: worker_supabase
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_anp_prices_serie(
  p_produto       text,
  p_granularidade text DEFAULT 'brasil',
  p_locais        text[] DEFAULT NULL,
  p_data_inicio   date DEFAULT NULL,
  p_data_fim      date DEFAULT NULL
)
RETURNS TABLE(
  data    date,
  fonte   text,
  local   text,
  preco   numeric,
  unidade text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  -- ───────────────────────────────────────────────────────────────────────────
  -- Producer source
  -- ───────────────────────────────────────────────────────────────────────────
  producer_diesel AS (
    SELECT DISTINCT ON (data_inicio, regiao)
      data_inicio AS data, regiao, preco::numeric AS preco
    FROM public.anp_precos_produtores
    WHERE produto IN ('Óleo Diesel S-10','Óleo Diesel S-500','Óleo Diesel')
      AND (p_data_inicio IS NULL OR data_inicio >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_inicio <= p_data_fim)
    ORDER BY data_inicio, regiao,
      CASE produto
        WHEN 'Óleo Diesel S-10'  THEN 1
        WHEN 'Óleo Diesel S-500' THEN 2
        WHEN 'Óleo Diesel'       THEN 3
        ELSE 9
      END
  ),
  producer_gasoline AS (
    SELECT data_inicio AS data, regiao, preco::numeric AS preco
    FROM public.anp_precos_produtores
    WHERE produto = 'Gasolina A Comum'
      AND (p_data_inicio IS NULL OR data_inicio >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_inicio <= p_data_fim)
  ),
  producer_biodiesel AS (
    SELECT data_inicio AS data, regiao, preco::numeric AS preco
    FROM public.anp_precos_produtores
    WHERE produto = 'Biodiesel B-100'
      AND (p_data_inicio IS NULL OR data_inicio >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_inicio <= p_data_fim)
  ),
  producer_lpg AS (
    SELECT data_inicio AS data, regiao, (preco::numeric * 13)::numeric AS preco
    FROM public.anp_precos_produtores
    WHERE produto = 'Gás Liquefeito de Petróleo - GLP'
      AND (p_data_inicio IS NULL OR data_inicio >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_inicio <= p_data_fim)
  ),
  producer_raw AS (
    SELECT data, regiao, preco FROM producer_diesel    WHERE p_produto = 'Diesel'
    UNION ALL
    SELECT data, regiao, preco FROM producer_gasoline  WHERE p_produto = 'Gasoline'
    UNION ALL
    SELECT data, regiao, preco FROM producer_biodiesel WHERE p_produto = 'Biodiesel'
    UNION ALL
    SELECT data, regiao, preco FROM producer_lpg       WHERE p_produto = 'LPG'
  ),

  -- ───────────────────────────────────────────────────────────────────────────
  -- 2-letter -> full UF translation for distribution.uf matching.
  --
  -- p_locais arrives from the frontend as 2-letter codes (sourced from
  -- anp_lpc.estado). We expand to full names so we can both match against
  -- anp_precos_distribuicao.uf and back-translate the output to codes.
  -- ───────────────────────────────────────────────────────────────────────────
  uf_map(code, full_name) AS (
    VALUES
      ('AC','ACRE'),               ('AL','ALAGOAS'),
      ('AP','AMAPA'),              ('AM','AMAZONAS'),
      ('BA','BAHIA'),              ('CE','CEARA'),
      ('DF','DISTRITO FEDERAL'),   ('ES','ESPIRITO SANTO'),
      ('GO','GOIAS'),              ('MA','MARANHAO'),
      ('MT','MATO GROSSO'),        ('MS','MATO GROSSO DO SUL'),
      ('MG','MINAS GERAIS'),       ('PA','PARA'),
      ('PB','PARAIBA'),            ('PR','PARANA'),
      ('PE','PERNAMBUCO'),         ('PI','PIAUI'),
      ('RJ','RIO DE JANEIRO'),     ('RN','RIO GRANDE DO NORTE'),
      ('RS','RIO GRANDE DO SUL'),  ('RO','RONDONIA'),
      ('RR','RORAIMA'),            ('SC','SANTA CATARINA'),
      ('SP','SAO PAULO'),          ('SE','SERGIPE'),
      ('TO','TOCANTINS')
  ),

  -- ───────────────────────────────────────────────────────────────────────────
  -- Distribution source. Note: uf stores full state names; we join uf_map
  -- (full -> code) for output, and translate p_locais (codes -> full) for
  -- the matching filter.
  -- ───────────────────────────────────────────────────────────────────────────
  distribution_diesel AS (
    SELECT DISTINCT ON (data_referencia, granularidade, uf, municipio, regiao)
      data_referencia AS data, granularidade, uf, municipio, regiao,
      preco_medio::numeric AS preco
    FROM public.anp_precos_distribuicao
    WHERE produto IN ('Diesel S10','Diesel S500')
      AND (p_data_inicio IS NULL OR data_referencia >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_referencia <= p_data_fim)
    ORDER BY data_referencia, granularidade, uf, municipio, regiao,
      CASE produto
        WHEN 'Diesel S10'  THEN 1
        WHEN 'Diesel S500' THEN 2
        ELSE 9
      END
  ),
  distribution_gasoline AS (
    SELECT data_referencia AS data, granularidade, uf, municipio, regiao,
           preco_medio::numeric AS preco
    FROM public.anp_precos_distribuicao
    WHERE produto = 'Gasolina Comum'
      AND (p_data_inicio IS NULL OR data_referencia >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_referencia <= p_data_fim)
  ),
  distribution_ethanol AS (
    SELECT data_referencia AS data, granularidade, uf, municipio, regiao,
           preco_medio::numeric AS preco
    FROM public.anp_precos_distribuicao
    WHERE produto = 'Etanol Hidratado'
      AND (p_data_inicio IS NULL OR data_referencia >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_referencia <= p_data_fim)
  ),
  distribution_lpg AS (
    SELECT data_referencia AS data, granularidade, uf, municipio, regiao,
           preco_medio::numeric AS preco
    FROM public.anp_precos_distribuicao
    WHERE produto = 'GLP P13'
      AND (p_data_inicio IS NULL OR data_referencia >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_referencia <= p_data_fim)
  ),
  distribution_raw AS (
    SELECT data, granularidade, uf, municipio, regiao, preco FROM distribution_diesel   WHERE p_produto = 'Diesel'
    UNION ALL
    SELECT data, granularidade, uf, municipio, regiao, preco FROM distribution_gasoline WHERE p_produto = 'Gasoline'
    UNION ALL
    SELECT data, granularidade, uf, municipio, regiao, preco FROM distribution_ethanol  WHERE p_produto = 'Ethanol'
    UNION ALL
    SELECT data, granularidade, uf, municipio, regiao, preco FROM distribution_lpg      WHERE p_produto = 'LPG'
  ),

  -- ───────────────────────────────────────────────────────────────────────────
  -- LPC source
  -- ───────────────────────────────────────────────────────────────────────────
  lpc_diesel AS (
    SELECT DISTINCT ON (data_fim, estado)
      data_fim AS data, estado, preco_medio_venda::numeric AS preco, n_postos
    FROM public.anp_lpc
    WHERE produto IN ('DIESEL S10','DIESEL S500','DIESEL')
      AND preco_medio_venda IS NOT NULL
      AND (p_data_inicio IS NULL OR data_fim >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_fim <= p_data_fim)
    ORDER BY data_fim, estado,
      CASE produto
        WHEN 'DIESEL S10'  THEN 1
        WHEN 'DIESEL S500' THEN 2
        WHEN 'DIESEL'      THEN 3
        ELSE 9
      END
  ),
  lpc_gasoline AS (
    SELECT DISTINCT ON (data_fim, estado)
      data_fim AS data, estado, preco_medio_venda::numeric AS preco, n_postos
    FROM public.anp_lpc
    WHERE produto IN ('GASOLINA COMUM','GASOLINA')
      AND preco_medio_venda IS NOT NULL
      AND (p_data_inicio IS NULL OR data_fim >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_fim <= p_data_fim)
    ORDER BY data_fim, estado,
      CASE produto
        WHEN 'GASOLINA COMUM' THEN 1
        WHEN 'GASOLINA'       THEN 2
        ELSE 9
      END
  ),
  lpc_ethanol AS (
    SELECT data_fim AS data, estado, preco_medio_venda::numeric AS preco, n_postos
    FROM public.anp_lpc
    WHERE produto = 'ETANOL'
      AND preco_medio_venda IS NOT NULL
      AND (p_data_inicio IS NULL OR data_fim >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_fim <= p_data_fim)
  ),
  lpc_lpg AS (
    SELECT data_fim AS data, estado,
           (preco_medio_venda::numeric * 13)::numeric AS preco, n_postos
    FROM public.anp_lpc
    WHERE produto = 'GLP'
      AND preco_medio_venda IS NOT NULL
      AND (p_data_inicio IS NULL OR data_fim >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_fim <= p_data_fim)
  ),
  lpc_raw AS (
    SELECT data, estado, preco, n_postos FROM lpc_diesel   WHERE p_produto = 'Diesel'
    UNION ALL
    SELECT data, estado, preco, n_postos FROM lpc_gasoline WHERE p_produto = 'Gasoline'
    UNION ALL
    SELECT data, estado, preco, n_postos FROM lpc_ethanol  WHERE p_produto = 'Ethanol'
    UNION ALL
    SELECT data, estado, preco, n_postos FROM lpc_lpg      WHERE p_produto = 'LPG'
  ),
  lpc_with_region AS (
    SELECT
      r.data, r.estado, r.preco, r.n_postos,
      CASE r.estado
        WHEN 'AC' THEN 'Norte'        WHEN 'AM' THEN 'Norte'
        WHEN 'AP' THEN 'Norte'        WHEN 'PA' THEN 'Norte'
        WHEN 'RO' THEN 'Norte'        WHEN 'RR' THEN 'Norte'
        WHEN 'TO' THEN 'Norte'
        WHEN 'AL' THEN 'Nordeste'     WHEN 'BA' THEN 'Nordeste'
        WHEN 'CE' THEN 'Nordeste'     WHEN 'MA' THEN 'Nordeste'
        WHEN 'PB' THEN 'Nordeste'     WHEN 'PE' THEN 'Nordeste'
        WHEN 'PI' THEN 'Nordeste'     WHEN 'RN' THEN 'Nordeste'
        WHEN 'SE' THEN 'Nordeste'
        WHEN 'DF' THEN 'Centro-Oeste' WHEN 'GO' THEN 'Centro-Oeste'
        WHEN 'MS' THEN 'Centro-Oeste' WHEN 'MT' THEN 'Centro-Oeste'
        WHEN 'ES' THEN 'Sudeste'      WHEN 'MG' THEN 'Sudeste'
        WHEN 'RJ' THEN 'Sudeste'      WHEN 'SP' THEN 'Sudeste'
        WHEN 'PR' THEN 'Sul'          WHEN 'RS' THEN 'Sul'
        WHEN 'SC' THEN 'Sul'
        ELSE NULL
      END AS regiao
    FROM lpc_raw r
  ),

  -- ───────────────────────────────────────────────────────────────────────────
  -- Granularity dispatch
  -- ───────────────────────────────────────────────────────────────────────────
  out_producer AS (
    SELECT
      data,
      'producer'::text AS fonte,
      CASE p_granularidade
        WHEN 'brasil' THEN 'Brasil'
        WHEN 'regiao' THEN regiao
        ELSE NULL
      END AS local,
      CASE p_granularidade
        WHEN 'brasil' THEN AVG(preco)
        WHEN 'regiao' THEN MAX(preco)
        ELSE NULL::numeric
      END AS preco
    FROM producer_raw
    WHERE p_granularidade IN ('brasil','regiao')
      AND (
        p_granularidade = 'brasil'
        OR (p_granularidade = 'regiao'
            AND (p_locais IS NULL OR regiao = ANY(p_locais)))
      )
    GROUP BY
      data,
      CASE p_granularidade
        WHEN 'brasil' THEN 'Brasil'
        WHEN 'regiao' THEN regiao
        ELSE NULL
      END
  ),

  out_distribution AS (
    SELECT
      dr.data,
      'distribution'::text AS fonte,
      CASE p_granularidade
        WHEN 'brasil'    THEN 'Brasil'
        WHEN 'regiao'    THEN
          CASE dr.regiao
            WHEN 'NORTE'        THEN 'Norte'
            WHEN 'NORDESTE'     THEN 'Nordeste'
            WHEN 'CENTRO OESTE' THEN 'Centro-Oeste'
            WHEN 'SUDESTE'      THEN 'Sudeste'
            WHEN 'SUL'          THEN 'Sul'
            ELSE dr.regiao
          END
        WHEN 'uf'        THEN um.code  -- emit 2-letter code, not full name
        WHEN 'municipio' THEN dr.municipio
      END AS local,
      dr.preco
    FROM distribution_raw dr
    LEFT JOIN uf_map um ON um.full_name = dr.uf
    WHERE dr.granularidade = p_granularidade
      AND (
        p_granularidade = 'brasil'
        OR (p_granularidade = 'regiao'
            AND (
              p_locais IS NULL
              OR CASE dr.regiao
                   WHEN 'NORTE'        THEN 'Norte'
                   WHEN 'NORDESTE'     THEN 'Nordeste'
                   WHEN 'CENTRO OESTE' THEN 'Centro-Oeste'
                   WHEN 'SUDESTE'      THEN 'Sudeste'
                   WHEN 'SUL'          THEN 'Sul'
                   ELSE dr.regiao
                 END = ANY(p_locais)
            ))
        OR (p_granularidade = 'uf'
            AND (p_locais IS NULL OR um.code = ANY(p_locais)))
        OR (p_granularidade = 'municipio'
            AND (p_locais IS NULL OR dr.municipio = ANY(p_locais)))
      )
  ),

  out_retail AS (
    SELECT
      data,
      'retail'::text AS fonte,
      CASE p_granularidade
        WHEN 'brasil' THEN 'Brasil'
        WHEN 'regiao' THEN regiao
        WHEN 'uf'     THEN estado
        ELSE NULL
      END AS local,
      CASE p_granularidade
        WHEN 'brasil' THEN
          (SUM(preco * n_postos)::numeric / NULLIF(SUM(n_postos), 0))
        WHEN 'regiao' THEN
          (SUM(preco * n_postos)::numeric / NULLIF(SUM(n_postos), 0))
        WHEN 'uf'     THEN MAX(preco)
        ELSE NULL::numeric
      END AS preco
    FROM lpc_with_region
    WHERE p_granularidade IN ('brasil','regiao','uf')
      AND (
        p_granularidade = 'brasil'
        OR (p_granularidade = 'regiao'
            AND (p_locais IS NULL OR regiao = ANY(p_locais)))
        OR (p_granularidade = 'uf'
            AND (p_locais IS NULL OR estado = ANY(p_locais)))
      )
    GROUP BY
      data,
      CASE p_granularidade
        WHEN 'brasil' THEN 'Brasil'
        WHEN 'regiao' THEN regiao
        WHEN 'uf'     THEN estado
        ELSE NULL
      END
  )

  SELECT
    data,
    fonte,
    local,
    preco,
    CASE WHEN p_produto = 'LPG' THEN 'R$/13kg' ELSE 'R$/litro' END::text AS unidade
  FROM (
    SELECT data, fonte, local, preco FROM out_producer
    UNION ALL
    SELECT data, fonte, local, preco FROM out_distribution
    UNION ALL
    SELECT data, fonte, local, preco FROM out_retail
  ) merged
  WHERE local IS NOT NULL
    AND preco IS NOT NULL
  ORDER BY data, fonte, local;
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_prices_serie(text, text, text[], date, date)
  TO anon, authenticated;

COMMIT;
