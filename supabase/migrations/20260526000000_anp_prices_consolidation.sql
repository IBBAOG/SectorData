-- =============================================================================
-- ANP Prices consolidation: merge /anp-precos-produtores +
-- /anp-precos-distribuicao + /anp-lpc into a single /anp-prices dashboard.
--
-- This migration:
--   1. Drops 10 legacy RPCs (5 producer + 4 lpc + 1 distribution top hits).
--      (NOTE: get_anp_precos_distribuicao_top_distribuidoras does not exist
--      in this schema; included as a DROP IF EXISTS for completeness only.)
--   2. Creates 3 new unified RPCs:
--        - get_anp_prices_filtros()             (jsonb constants + DISTINCT)
--        - get_anp_prices_serie(...)            (UNION ALL of 3 sources)
--        - get_anp_prices_export_count(...)     (Tier 2 modal counter)
--   3. Inserts module_visibility row for 'anp-prices' and deletes the 3
--      retired slugs.
--
-- Source tables remain untouched (anp_precos_produtores,
-- anp_precos_distribuicao, anp_lpc) — ETL pipelines keep running, only the
-- frontend consumer changes.
--
-- Companion work (other worktrees):
--   - APP frontend: new /anp-prices route + RPC wrappers + NavBar update.
--   - Docs: sub-PRD docs/app/anp-prices.md, archive 3 legacy sub-PRDs.
--
-- Owner: worker_supabase
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Drop legacy RPCs. CASCADE is intentional in case any view/trigger silently
--    references them; idempotent thanks to IF EXISTS.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_anp_precos_produtores_serie(text, text[], date, date)                                CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_precos_produtores_filtros()                                                      CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_precos_distribuicao_serie(text, text, text[], date, date)                        CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_precos_distribuicao_filtros()                                                    CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_precos_distribuicao_top_distribuidoras(text, date, date, int)                    CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_precos_distribuicao_export_count(text[], text[], text[], date, date)             CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_lpc_nacional(text[], date, date)                                                 CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_lpc_serie(text[], text[], date, date)                                            CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_lpc_filtros()                                                                    CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_lpc_export_count(text[], text[], date, date)                                     CASCADE;


-- -----------------------------------------------------------------------------
-- 2. get_anp_prices_filtros() — filter options for the new dashboard.
--    Returns jsonb with constants (products, granularities, regions) plus
--    DISTINCT values for ufs/municipios sourced from anp_lpc and
--    anp_precos_distribuicao respectively, and the common date window.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_anp_prices_filtros()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'produtos',       jsonb_build_array('Gasoline','Diesel','Ethanol','Biodiesel','LPG'),
    'granularidades', jsonb_build_array('brasil','regiao','uf','municipio'),
    'regioes',        jsonb_build_array('Norte','Nordeste','Centro-Oeste','Sudeste','Sul'),
    'ufs', (
      SELECT COALESCE(jsonb_agg(estado ORDER BY estado), '[]'::jsonb)
      FROM (SELECT DISTINCT estado FROM public.anp_lpc) u
    ),
    'municipios', (
      SELECT COALESCE(jsonb_agg(municipio ORDER BY municipio), '[]'::jsonb)
      FROM (
        SELECT DISTINCT municipio
        FROM public.anp_precos_distribuicao
        WHERE municipio IS NOT NULL
      ) m
    ),
    'data_min', '2020-08-01'::date,
    'data_max', GREATEST(
      (SELECT MAX(data_inicio)    FROM public.anp_precos_produtores),
      (SELECT MAX(data_referencia) FROM public.anp_precos_distribuicao),
      (SELECT MAX(data_fim)       FROM public.anp_lpc)
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_prices_filtros() TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3. get_anp_prices_serie(...) — main time-series RPC.
--
-- Returns (data, fonte, local, preco, unidade) — one row per supply-chain link
-- per geography per period.
--
-- p_produto: 'Gasoline' | 'Diesel' | 'Ethanol' | 'Biodiesel' | 'LPG'
-- p_granularidade: 'brasil' (default) | 'regiao' | 'uf' | 'municipio'
-- p_locais: nullable text[] — applicable for regiao/uf/municipio
-- p_data_inicio / p_data_fim: optional date filters
--
-- Output:
--   - fonte values: 'producer' | 'distribution' | 'retail'
--   - unidade values: 'R$/litro' (Gasoline/Diesel/Ethanol/Biodiesel) or 'R$/13kg' (LPG)
--   - local: 'Brasil' / <Title-Cased Region> / <UF code> / <Município name>
--
-- Key normalization rules (vs. raw source rows):
--   * Region names: anp_precos_distribuicao.regiao comes in UPPERCASE with a
--     space ('CENTRO OESTE'); we normalize to title-case with hyphen
--     ('Centro-Oeste'). Producer regions are already title-case in the source.
--   * LPC has no region column; we derive it from estado via static UF→Region
--     map (see CASE in lpc_priced CTE).
--   * Diesel: prefer S-10, fallback S-500, fallback legacy 'Óleo Diesel'.
--     LPC: prefer 'DIESEL S10', fallback 'DIESEL S500', fallback legacy 'DIESEL'.
--     Distribuição: prefer 'Diesel S10', fallback 'Diesel S500'.
--   * Gasoline LPC: prefer 'GASOLINA COMUM', fallback legacy 'GASOLINA'.
--   * GLP normalization to R$/13kg:
--       Producer (R$/kg)      -> preco * 13
--       Distribution (R$/13kg) -> passes through
--       LPC (R$/kg)            -> preco_medio_venda * 13
--   * Brasil aggregation:
--       Producer: simple AVG across the 5 regions per (data, produto).
--       Distribution: native granularidade='brasil' rows.
--       LPC: SUM(price * n_postos) / NULLIF(SUM(n_postos), 0) — weighted by
--            number of surveyed stations per UF.
-- -----------------------------------------------------------------------------
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
  -- Producer source: anp_precos_produtores
  -- Schema: data_inicio date, produto text, regiao text (already title-case),
  --         preco real, unidade text.
  -- Diesel fallback uses DISTINCT ON (data, regiao) by priority.
  -- ───────────────────────────────────────────────────────────────────────────
  producer_diesel AS (
    SELECT DISTINCT ON (data_inicio, regiao)
      data_inicio AS data,
      regiao,
      preco::numeric AS preco
    FROM public.anp_precos_produtores
    WHERE produto IN ('Óleo Diesel S-10','Óleo Diesel S-500','Óleo Diesel')
      AND (p_data_inicio IS NULL OR data_inicio >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_inicio <= p_data_fim)
    ORDER BY
      data_inicio,
      regiao,
      CASE produto
        WHEN 'Óleo Diesel S-10'  THEN 1
        WHEN 'Óleo Diesel S-500' THEN 2
        WHEN 'Óleo Diesel'       THEN 3
        ELSE 9
      END
  ),
  producer_gasoline AS (
    SELECT
      data_inicio AS data,
      regiao,
      preco::numeric AS preco
    FROM public.anp_precos_produtores
    WHERE produto = 'Gasolina A Comum'
      AND (p_data_inicio IS NULL OR data_inicio >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_inicio <= p_data_fim)
  ),
  producer_biodiesel AS (
    SELECT
      data_inicio AS data,
      regiao,
      preco::numeric AS preco
    FROM public.anp_precos_produtores
    WHERE produto = 'Biodiesel B-100'
      AND (p_data_inicio IS NULL OR data_inicio >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_inicio <= p_data_fim)
  ),
  producer_lpg AS (
    -- GLP arrives in R$/kg; multiply by 13 to expose R$/13kg
    SELECT
      data_inicio AS data,
      regiao,
      (preco::numeric * 13)::numeric AS preco
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
    -- Ethanol: producer absent by design
  ),

  -- ───────────────────────────────────────────────────────────────────────────
  -- Distribution source: anp_precos_distribuicao
  -- Schema: data_referencia date, produto text, granularidade text,
  --         uf text, municipio text, regiao text (UPPERCASE w/ space),
  --         preco_medio numeric, unidade text.
  -- Diesel fallback uses DISTINCT ON over (date, granularidade, uf, mun, regiao).
  -- ───────────────────────────────────────────────────────────────────────────
  distribution_diesel AS (
    SELECT DISTINCT ON (data_referencia, granularidade, uf, municipio, regiao)
      data_referencia AS data,
      granularidade,
      uf,
      municipio,
      regiao,
      preco_medio::numeric AS preco
    FROM public.anp_precos_distribuicao
    WHERE produto IN ('Diesel S10','Diesel S500')
      AND (p_data_inicio IS NULL OR data_referencia >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_referencia <= p_data_fim)
    ORDER BY
      data_referencia, granularidade, uf, municipio, regiao,
      CASE produto
        WHEN 'Diesel S10'  THEN 1
        WHEN 'Diesel S500' THEN 2
        ELSE 9
      END
  ),
  distribution_gasoline AS (
    SELECT
      data_referencia AS data,
      granularidade,
      uf,
      municipio,
      regiao,
      preco_medio::numeric AS preco
    FROM public.anp_precos_distribuicao
    WHERE produto = 'Gasolina Comum'
      AND (p_data_inicio IS NULL OR data_referencia >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_referencia <= p_data_fim)
  ),
  distribution_ethanol AS (
    SELECT
      data_referencia AS data,
      granularidade,
      uf,
      municipio,
      regiao,
      preco_medio::numeric AS preco
    FROM public.anp_precos_distribuicao
    WHERE produto = 'Etanol Hidratado'
      AND (p_data_inicio IS NULL OR data_referencia >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_referencia <= p_data_fim)
  ),
  distribution_lpg AS (
    -- GLP P13 in distribution is already R$/13kg — pass through
    SELECT
      data_referencia AS data,
      granularidade,
      uf,
      municipio,
      regiao,
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
    -- Biodiesel: distribution absent by design
  ),

  -- ───────────────────────────────────────────────────────────────────────────
  -- Retail (LPC) source: anp_lpc
  -- Schema: data_fim date, produto text (UPPERCASE), estado text (UF code),
  --         preco_medio_venda real, n_postos int.
  -- Region is derived server-side from estado via static UF→Region map.
  -- Diesel/Gasoline use DISTINCT ON for grade fallback.
  -- ───────────────────────────────────────────────────────────────────────────
  lpc_diesel AS (
    SELECT DISTINCT ON (data_fim, estado)
      data_fim AS data,
      estado,
      preco_medio_venda::numeric AS preco,
      n_postos
    FROM public.anp_lpc
    WHERE produto IN ('DIESEL S10','DIESEL S500','DIESEL')
      AND preco_medio_venda IS NOT NULL
      AND (p_data_inicio IS NULL OR data_fim >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_fim <= p_data_fim)
    ORDER BY
      data_fim, estado,
      CASE produto
        WHEN 'DIESEL S10'  THEN 1
        WHEN 'DIESEL S500' THEN 2
        WHEN 'DIESEL'      THEN 3
        ELSE 9
      END
  ),
  lpc_gasoline AS (
    SELECT DISTINCT ON (data_fim, estado)
      data_fim AS data,
      estado,
      preco_medio_venda::numeric AS preco,
      n_postos
    FROM public.anp_lpc
    WHERE produto IN ('GASOLINA COMUM','GASOLINA')
      AND preco_medio_venda IS NOT NULL
      AND (p_data_inicio IS NULL OR data_fim >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_fim <= p_data_fim)
    ORDER BY
      data_fim, estado,
      CASE produto
        WHEN 'GASOLINA COMUM' THEN 1
        WHEN 'GASOLINA'       THEN 2
        ELSE 9
      END
  ),
  lpc_ethanol AS (
    SELECT
      data_fim AS data,
      estado,
      preco_medio_venda::numeric AS preco,
      n_postos
    FROM public.anp_lpc
    WHERE produto = 'ETANOL'
      AND preco_medio_venda IS NOT NULL
      AND (p_data_inicio IS NULL OR data_fim >= p_data_inicio)
      AND (p_data_fim    IS NULL OR data_fim <= p_data_fim)
  ),
  lpc_lpg AS (
    -- LPC GLP arrives in R$/kg; multiply by 13 to expose R$/13kg
    SELECT
      data_fim AS data,
      estado,
      (preco_medio_venda::numeric * 13)::numeric AS preco,
      n_postos
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
    -- Biodiesel: retail absent by design
  ),
  lpc_with_region AS (
    SELECT
      r.data,
      r.estado,
      r.preco,
      r.n_postos,
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
  -- Granularity dispatch — emit (data, fonte, local, preco) per source.
  -- ───────────────────────────────────────────────────────────────────────────
  out_producer AS (
    SELECT
      data,
      'producer'::text AS fonte,
      CASE p_granularidade
        WHEN 'brasil' THEN 'Brasil'
        WHEN 'regiao' THEN regiao
        ELSE NULL  -- producer only exists at region level
      END AS local,
      -- For Brasil: simple mean across regions per date.
      -- For regiao: pass-through preco filtered by p_locais.
      CASE p_granularidade
        WHEN 'brasil' THEN AVG(preco)
        WHEN 'regiao' THEN MAX(preco)  -- 1 row per (data, regiao); MAX/AVG/MIN equivalent
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
    -- Distribution dispatches by granularidade match against the source's
    -- own granularidade column (already segmented by ETL).
    SELECT
      data,
      'distribution'::text AS fonte,
      CASE p_granularidade
        WHEN 'brasil'    THEN 'Brasil'
        WHEN 'regiao'    THEN -- normalize UPPERCASE w/ space to title-case-hyphen
          CASE regiao
            WHEN 'NORTE'        THEN 'Norte'
            WHEN 'NORDESTE'     THEN 'Nordeste'
            WHEN 'CENTRO OESTE' THEN 'Centro-Oeste'
            WHEN 'SUDESTE'      THEN 'Sudeste'
            WHEN 'SUL'          THEN 'Sul'
            ELSE regiao
          END
        WHEN 'uf'        THEN uf
        WHEN 'municipio' THEN municipio
      END AS local,
      preco
    FROM distribution_raw
    WHERE granularidade = p_granularidade
      AND (
        p_granularidade = 'brasil'
        OR (p_granularidade = 'regiao'
            AND (
              p_locais IS NULL
              OR CASE regiao
                   WHEN 'NORTE'        THEN 'Norte'
                   WHEN 'NORDESTE'     THEN 'Nordeste'
                   WHEN 'CENTRO OESTE' THEN 'Centro-Oeste'
                   WHEN 'SUDESTE'      THEN 'Sudeste'
                   WHEN 'SUL'          THEN 'Sul'
                   ELSE regiao
                 END = ANY(p_locais)
            ))
        OR (p_granularidade = 'uf'
            AND (p_locais IS NULL OR uf = ANY(p_locais)))
        OR (p_granularidade = 'municipio'
            AND (p_locais IS NULL OR municipio = ANY(p_locais)))
      )
  ),

  out_retail AS (
    -- LPC: only brasil / regiao / uf — no município level.
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
        WHEN 'uf'     THEN MAX(preco)  -- 1 row per (data, estado)
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


-- -----------------------------------------------------------------------------
-- 4. get_anp_prices_export_count(...) — Tier 2 modal counter.
--
-- Accepts arrays of products and granularities (the export modal can sweep
-- multiple combinations). NULL arrays mean "all". Returns total row count
-- across the 3 source tables matching the filter combination.
--
-- SECURITY INVOKER (per spec) — relies on the 3 source tables' RLS allowing
-- anon/authenticated SELECT.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_anp_prices_export_count(
  p_produtos        text[]  DEFAULT NULL,
  p_granularidades  text[]  DEFAULT NULL,
  p_locais          text[]  DEFAULT NULL,
  p_data_inicio     date    DEFAULT NULL,
  p_data_fim        date    DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  selected_products AS (
    SELECT unnest(COALESCE(p_produtos, ARRAY['Gasoline','Diesel','Ethanol','Biodiesel','LPG'])) AS p
  ),
  selected_grans AS (
    SELECT unnest(COALESCE(p_granularidades, ARRAY['brasil','regiao','uf','municipio'])) AS g
  ),
  combos AS (
    SELECT p, g FROM selected_products CROSS JOIN selected_grans
  ),
  counts AS (
    SELECT (
      SELECT COUNT(*)
      FROM public.get_anp_prices_serie(c.p, c.g, p_locais, p_data_inicio, p_data_fim)
    ) AS n
    FROM combos c
  )
  SELECT COALESCE(SUM(n), 0)::bigint FROM counts;
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_prices_export_count(text[], text[], text[], date, date)
  TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 5. module_visibility — register the new slug and remove the 3 retired ones.
-- -----------------------------------------------------------------------------
INSERT INTO public.module_visibility (
  module_slug,
  is_visible_for_clients,
  is_visible_for_public,
  is_visible_on_home
) VALUES (
  'anp-prices',
  true,
  true,
  true
)
ON CONFLICT (module_slug) DO NOTHING;

DELETE FROM public.module_visibility
 WHERE module_slug IN ('anp-precos-produtores','anp-precos-distribuicao','anp-lpc');

COMMIT;
