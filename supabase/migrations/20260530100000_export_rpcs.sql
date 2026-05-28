-- =============================================================================
-- 20260530100000_export_rpcs.sql
--
-- Backend RPCs for the unified export library at src/lib/export/.
-- Contract: docs/app/export-library-contract.md § "Backend RPCs needed".
--
-- Creates 7 new RPCs:
--   1. get_production_well_full_history(p_empresa)
--   2. get_production_brazil_well_full_history()
--   3. get_anp_cdp_diaria_export_count(p_nivel, p_filtros)
--   4. get_anp_prices_export_counts(p_filtros)
--   5. get_imports_exports_raw_imports(p_filtros)
--   6. get_imports_exports_raw_exports(p_filtros)
--   7. get_imports_exports_export_count(p_filtros)
--
-- All functions are LANGUAGE sql STABLE SECURITY DEFINER
--   SET search_path = public, pg_temp (Pegadinha #18 — without this, anon
--   callers get empty results because the source tables have RLS scoped to
--   `authenticated` only, and INVOKER RPCs run as the caller).
-- All functions are GRANTed EXECUTE to anon, authenticated.
--
-- Schema notes (relevant to authoring the queries):
--   - mdic_comex columns: ano, mes, flow ('import'|'export'), ncm_codigo,
--       ncm_nome, pais, volume_kg, valor_fob_usd. There is no
--       pais_origem / pais_destino — flow discriminates direction.
--   - anp_desembaracos columns: ano, mes, ncm_codigo, pais_origem,
--       quantidade_kg, importador, cnpj, uf_cnpj (cnpj part of PK; legacy
--       rows carry sentinel cnpj = '__legacy__' which we exclude here).
--   - anp_cdp_producao columns include: ano, mes, poco, campo, bacia, local,
--       estado, operador, instalacao_destino, petroleo_bbl_dia,
--       gas_total_mm3_dia, agua_bbl_dia, tempo_prod_hs_mes.
--   - field_stakes: (campo, empresa, stake_pct). Stake-weighting in well 1
--       follows the SUM(stake_pct) = 100 predicate used by
--       get_production_company_aggregate.
--   - imports_product_map uses source IN ('daie', 'desembaracos', 'mdic')
--       — the 'mdic' source key was added in 20260526300000.
--
-- Pegadinha #19 mitigation: slot 20260530100000 chosen after confirming the
--   highest existing slot is 20260530000000_cdp_rpcs_canonical_expansion.
--   Note: the contract suggested 20260528600000 as the filename, but that
--   slot is already occupied by well_by_well_brazil_rpcs.sql. Picked the
--   next free hourly slot past the latest migration.
--
-- Owner: worker_supabase
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. get_production_well_full_history(p_empresa)
--    Stake-weighted production at well-level for one company. Joins
--    anp_cdp_producao x field_stakes on canonical_field_name(campo) so
--    variant well names (Búzios vs AnC_Búzios) collapse to one canonical
--    field consistent with /well-by-well. Only campos with SUM(stake_pct) = 100
--    are included (silent exclusion of incomplete campos, same predicate as
--    get_production_company_aggregate).
--    oil, gas, water are stake-weighted; uptime preserved as-is.
--    Full history, ordered by ano, mes, campo, poco.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_production_well_full_history(
  p_empresa text
) RETURNS TABLE (
  ano           int,
  mes           int,
  bacia         text,
  estado        text,
  ambiente      text,
  campo         text,
  poco          text,
  operador      text,
  instalacao    text,
  oil_bbl_dia   numeric,
  gas_mm3_dia   numeric,
  water_bbl_dia numeric,
  uptime_hs_mes numeric,
  stake_pct     numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH valid_stakes AS (
    -- Only campos whose stakes sum to 100, restricted to p_empresa.
    SELECT campo, stake_pct
      FROM field_stakes
     WHERE empresa = p_empresa
       AND campo IN (
         SELECT campo FROM field_stakes
          GROUP BY campo
         HAVING SUM(stake_pct) = 100
       )
  )
  SELECT
    p.ano,
    p.mes,
    p.bacia,
    p.estado,
    p.local                                            AS ambiente,
    canonical_field_name(p.campo)                      AS campo,
    p.poco,
    p.operador,
    p.instalacao_destino                               AS instalacao,
    (p.petroleo_bbl_dia  * vs.stake_pct / 100)::numeric AS oil_bbl_dia,
    (p.gas_total_mm3_dia * vs.stake_pct / 100)::numeric AS gas_mm3_dia,
    (p.agua_bbl_dia      * vs.stake_pct / 100)::numeric AS water_bbl_dia,
    p.tempo_prod_hs_mes::numeric                        AS uptime_hs_mes,
    vs.stake_pct::numeric                               AS stake_pct
  FROM anp_cdp_producao p
  JOIN valid_stakes vs ON vs.campo = p.campo
  ORDER BY p.ano, p.mes, canonical_field_name(p.campo), p.poco;
$$;

GRANT EXECUTE ON FUNCTION public.get_production_well_full_history(text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_production_well_full_history(text) IS
  'Stake-weighted well-level production history for one company. JOINs anp_cdp_producao x field_stakes, filtered to campos with SUM(stake_pct)=100. Returns oil/gas/water multiplied by stake_pct/100; uptime as-is; stake_pct exposed so analysts can audit. Full history — no date filter.';


-- =============================================================================
-- 2. get_production_brazil_well_full_history()
--    Same as #1 but Brazil-wide, 100% WI. No stake join, no SUM=100 filter.
--    Just raw rows from anp_cdp_producao with the selected columns.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_production_brazil_well_full_history()
RETURNS TABLE (
  ano           int,
  mes           int,
  bacia         text,
  estado        text,
  ambiente      text,
  campo         text,
  poco          text,
  operador      text,
  instalacao    text,
  oil_bbl_dia   numeric,
  gas_mm3_dia   numeric,
  water_bbl_dia numeric,
  uptime_hs_mes numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    p.ano,
    p.mes,
    p.bacia,
    p.estado,
    p.local                       AS ambiente,
    canonical_field_name(p.campo) AS campo,
    p.poco,
    p.operador,
    p.instalacao_destino          AS instalacao,
    p.petroleo_bbl_dia::numeric   AS oil_bbl_dia,
    p.gas_total_mm3_dia::numeric  AS gas_mm3_dia,
    p.agua_bbl_dia::numeric       AS water_bbl_dia,
    p.tempo_prod_hs_mes::numeric  AS uptime_hs_mes
  FROM anp_cdp_producao p
  ORDER BY p.ano, p.mes, canonical_field_name(p.campo), p.poco;
$$;

GRANT EXECUTE ON FUNCTION public.get_production_brazil_well_full_history()
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_production_brazil_well_full_history() IS
  'Brazil-wide raw well-level production history (100% WI, no stake math). Full history.';


-- =============================================================================
-- 3. get_anp_cdp_diaria_export_count(p_nivel, p_filtros)
--    Returns COUNT(*) from the appropriate diaria table based on p_nivel
--    ('campo' | 'instalacao' | 'poco'), after applying the filters carried
--    in p_filtros jsonb.
--    Filter keys: date_start, date_end, campo[], bacia[], instalacao[],
--    poco[]. Filters that don't apply to the chosen table are ignored.
--    Defaults: date_start = current_date - 30 days, date_end = current_date.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_export_count(
  p_nivel   text,
  p_filtros jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT
      COALESCE(
        NULLIF(p_filtros ->> 'date_start', '')::date,
        (current_date - INTERVAL '30 days')::date
      ) AS date_start,
      COALESCE(
        NULLIF(p_filtros ->> 'date_end', '')::date,
        current_date
      ) AS date_end,
      CASE WHEN p_filtros ? 'campo'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'campo'))
           ELSE NULL END AS campos,
      CASE WHEN p_filtros ? 'bacia'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'bacia'))
           ELSE NULL END AS bacias,
      CASE WHEN p_filtros ? 'instalacao'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'instalacao'))
           ELSE NULL END AS instalacoes,
      CASE WHEN p_filtros ? 'poco'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'poco'))
           ELSE NULL END AS pocos
  )
  SELECT
    CASE p_nivel
      WHEN 'campo' THEN (
        SELECT COUNT(*)::bigint
          FROM public.anp_cdp_diaria d, params q
         WHERE d.data BETWEEN q.date_start AND q.date_end
           AND (q.campos IS NULL OR d.campo = ANY(q.campos))
           AND (q.bacias IS NULL OR d.bacia = ANY(q.bacias))
      )
      WHEN 'instalacao' THEN (
        SELECT COUNT(*)::bigint
          FROM public.anp_cdp_diaria_instalacao d, params q
         WHERE d.data BETWEEN q.date_start AND q.date_end
           AND (q.campos      IS NULL OR d.campo      = ANY(q.campos))
           AND (q.instalacoes IS NULL OR d.instalacao = ANY(q.instalacoes))
      )
      WHEN 'poco' THEN (
        SELECT COUNT(*)::bigint
          FROM public.anp_cdp_diaria_poco d, params q
         WHERE d.data BETWEEN q.date_start AND q.date_end
           AND (q.campos IS NULL OR d.campo = ANY(q.campos))
           AND (q.bacias IS NULL OR d.bacia = ANY(q.bacias))
           AND (q.pocos  IS NULL OR d.poco  = ANY(q.pocos))
      )
      ELSE 0::bigint
    END;
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_export_count(text, jsonb)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_anp_cdp_diaria_export_count(text, jsonb) IS
  'Row-count estimator for /anp-cdp-diaria export modal. p_nivel selects table (campo/instalacao/poco); p_filtros carries date_start/date_end (defaults last 30 days) and optional campo[]/bacia[]/instalacao[]/poco[] arrays.';


-- =============================================================================
-- 4. get_anp_prices_export_counts(p_filtros)
--    Returns 3 rows: source='producer'/'distribution'/'retail' with the
--    COUNT(*) from each underlying table after applying matching filters.
--    Filter keys: date_start, date_end, produto[], uf[], regiao[].
--    Filters that don't apply to a given source are ignored for that source:
--      - producer: uses produto + regiao (no uf)
--      - distribution: uses produto + uf (no regiao)
--      - retail (lpc): uses produto + estado (mapped from uf; no regiao)
--    Date columns differ per table:
--      - producer    → data_inicio
--      - distribution → data_referencia
--      - retail (lpc) → data_fim
--    Defaults: date_start = current_date - 180 days, date_end = current_date.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_anp_prices_export_counts(
  p_filtros jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE (
  source text,
  n      bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT
      COALESCE(
        NULLIF(p_filtros ->> 'date_start', '')::date,
        (current_date - INTERVAL '180 days')::date
      ) AS date_start,
      COALESCE(
        NULLIF(p_filtros ->> 'date_end', '')::date,
        current_date
      ) AS date_end,
      CASE WHEN p_filtros ? 'produto'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'produto'))
           ELSE NULL END AS produtos,
      CASE WHEN p_filtros ? 'uf'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'uf'))
           ELSE NULL END AS ufs,
      CASE WHEN p_filtros ? 'regiao'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'regiao'))
           ELSE NULL END AS regioes
  )
  SELECT 'producer'::text AS source,
         (SELECT COUNT(*)::bigint
            FROM public.anp_precos_produtores t, params q
           WHERE t.data_inicio BETWEEN q.date_start AND q.date_end
             AND (q.produtos IS NULL OR t.produto = ANY(q.produtos))
             AND (q.regioes  IS NULL OR t.regiao  = ANY(q.regioes))) AS n
  UNION ALL
  SELECT 'distribution'::text AS source,
         (SELECT COUNT(*)::bigint
            FROM public.anp_precos_distribuicao t, params q
           WHERE t.data_referencia BETWEEN q.date_start AND q.date_end
             AND (q.produtos IS NULL OR t.produto = ANY(q.produtos))
             AND (q.ufs      IS NULL OR t.uf      = ANY(q.ufs))) AS n
  UNION ALL
  SELECT 'retail'::text AS source,
         (SELECT COUNT(*)::bigint
            FROM public.anp_lpc t, params q
           WHERE t.data_fim BETWEEN q.date_start AND q.date_end
             AND (q.produtos IS NULL OR t.produto = ANY(q.produtos))
             AND (q.ufs      IS NULL OR t.estado  = ANY(q.ufs))) AS n;
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_prices_export_counts(jsonb)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_anp_prices_export_counts(jsonb) IS
  'Row-count estimator for /anp-prices export modal. Returns 3 rows (producer/distribution/retail). p_filtros: date_start/date_end (default last 180 days), produto[], uf[] (mapped to estado for retail), regiao[] (only applies to producer).';


-- =============================================================================
-- 5. get_imports_exports_raw_imports(p_filtros)
--    Raw rows from anp_desembaracos joined with imports_product_map and
--    ncm_densidade_kg_m3 for the m3 conversion. Excludes legacy sentinel
--    rows (cnpj = '__legacy__').
--    Filter keys: ano_inicio, ano_fim, unified_product[], pais_origem[],
--    cnpj[].
--    unit_price_usd_ton = valor_usd / (quantidade_kg / 1000), null-safe.
--    Defaults: ano_inicio = (current year - 2), ano_fim = current year.
--    Note: the column expected by the contract is `descricao_ncm`; the
--    underlying table doesn't store it. We surface `ncm_codigo` as the
--    label here (the dashboard usually doesn't carry a long description).
--    Note: anp_desembaracos doesn't carry valor_usd either — only
--    quantidade_kg. The contract therefore won't have a meaningful
--    unit_price; we return NULL for unit_price_usd_ton, but keep valor_usd
--    in the return tuple as 0 so the caller schema is stable. (This RPC
--    is a "raw rows" feed for the export sheet; the IE dashboard separately
--    queries mdic_comex for USD figures.)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_imports_exports_raw_imports(
  p_filtros jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE (
  ano                  int,
  mes                  int,
  pais_origem          text,
  importador           text,
  cnpj                 text,
  uf_cnpj              text,
  ncm_codigo           text,
  descricao_ncm        text,
  unified_product      text,
  quantidade_kg        numeric,
  volume_m3            numeric,
  valor_usd            numeric,
  unit_price_usd_ton   numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT
      COALESCE(
        NULLIF(p_filtros ->> 'ano_inicio', '')::int,
        EXTRACT(YEAR FROM current_date)::int - 2
      ) AS ano_inicio,
      COALESCE(
        NULLIF(p_filtros ->> 'ano_fim', '')::int,
        EXTRACT(YEAR FROM current_date)::int
      ) AS ano_fim,
      CASE WHEN p_filtros ? 'unified_product'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'unified_product'))
           ELSE NULL END AS unified_products,
      CASE WHEN p_filtros ? 'pais_origem'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'pais_origem'))
           ELSE NULL END AS paises,
      CASE WHEN p_filtros ? 'cnpj'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'cnpj'))
           ELSE NULL END AS cnpjs
  )
  SELECT
    d.ano::int                                              AS ano,
    d.mes::int                                              AS mes,
    d.pais_origem,
    d.importador,
    d.cnpj,
    d.uf_cnpj,
    d.ncm_codigo,
    n.produto_label                                         AS descricao_ncm,
    pm.unified_product,
    d.quantidade_kg::numeric                                AS quantidade_kg,
    CASE WHEN n.densidade_kg_m3 > 0
         THEN (d.quantidade_kg / n.densidade_kg_m3)::numeric
         ELSE NULL END                                      AS volume_m3,
    0::numeric                                              AS valor_usd,
    -- anp_desembaracos has no valor_usd column — unit price is undefined.
    NULL::numeric                                           AS unit_price_usd_ton
  FROM public.anp_desembaracos d
  JOIN public.imports_product_map pm
    ON pm.source = 'desembaracos'
   AND pm.source_key = d.ncm_codigo
  LEFT JOIN public.ncm_densidade_kg_m3 n
    ON n.ncm_codigo = d.ncm_codigo
  CROSS JOIN params q
  WHERE d.ano BETWEEN q.ano_inicio AND q.ano_fim
    AND d.cnpj <> '__legacy__'
    AND (q.unified_products IS NULL OR pm.unified_product = ANY(q.unified_products))
    AND (q.paises           IS NULL OR d.pais_origem      = ANY(q.paises))
    AND (q.cnpjs            IS NULL OR d.cnpj             = ANY(q.cnpjs))
  ORDER BY d.ano, d.mes, d.pais_origem, d.importador, d.ncm_codigo;
$$;

GRANT EXECUTE ON FUNCTION public.get_imports_exports_raw_imports(jsonb)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_imports_exports_raw_imports(jsonb) IS
  'Raw rows from anp_desembaracos for /imports-exports export modal. Excludes legacy sentinel cnpj rows. Returns one row per (ano, mes, pais_origem, importador, cnpj, ncm). valor_usd is 0 and unit_price_usd_ton is NULL because anp_desembaracos does not carry FOB values (use the mdic_comex-backed RPCs for USD figures).';


-- =============================================================================
-- 6. get_imports_exports_raw_exports(p_filtros)
--    Raw rows from mdic_comex WHERE flow='export', joined with the
--    unified_product map (source='mdic') and density table.
--    Filter keys: ano_inicio, ano_fim, unified_product[], pais_destino[].
--    unit_price_usd_bbl = valor_fob_usd / (volume_m3 * 6.2898), null-safe.
--    The m3 -> bbl factor is the standard barrel definition (158.987 L = 1/6.2898 m3).
--    Defaults: ano_inicio = (current year - 2), ano_fim = current year.
--    Note: mdic_comex column is `pais` (no origem/destino split — flow
--    discriminates); the contract asks for `pais_destino`, we surface the
--    same `pais` value under that alias.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_imports_exports_raw_exports(
  p_filtros jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE (
  ano                  int,
  mes                  int,
  pais_destino         text,
  ncm_codigo           text,
  descricao_ncm        text,
  unified_product      text,
  quantidade_kg        numeric,
  volume_m3            numeric,
  valor_usd            numeric,
  unit_price_usd_bbl   numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT
      COALESCE(
        NULLIF(p_filtros ->> 'ano_inicio', '')::int,
        EXTRACT(YEAR FROM current_date)::int - 2
      ) AS ano_inicio,
      COALESCE(
        NULLIF(p_filtros ->> 'ano_fim', '')::int,
        EXTRACT(YEAR FROM current_date)::int
      ) AS ano_fim,
      CASE WHEN p_filtros ? 'unified_product'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'unified_product'))
           ELSE NULL END AS unified_products,
      CASE WHEN p_filtros ? 'pais_destino'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'pais_destino'))
           ELSE NULL END AS paises
  ),
  base AS (
    SELECT
      mc.ano::int                                         AS ano,
      mc.mes::int                                         AS mes,
      mc.pais                                             AS pais_destino,
      mc.ncm_codigo                                       AS ncm_codigo,
      mc.ncm_nome                                         AS descricao_ncm,
      pm.unified_product                                  AS unified_product,
      mc.volume_kg::numeric                               AS quantidade_kg,
      CASE WHEN n.densidade_kg_m3 > 0
           THEN (mc.volume_kg / n.densidade_kg_m3)::numeric
           ELSE NULL END                                  AS volume_m3,
      mc.valor_fob_usd::numeric                           AS valor_usd
    FROM public.mdic_comex mc
    JOIN public.imports_product_map pm
      ON pm.source = 'mdic'
     AND pm.source_key = mc.ncm_codigo
    LEFT JOIN public.ncm_densidade_kg_m3 n
      ON n.ncm_codigo = mc.ncm_codigo
    CROSS JOIN params q
    WHERE mc.flow = 'export'
      AND mc.ano BETWEEN q.ano_inicio AND q.ano_fim
      AND (q.unified_products IS NULL OR pm.unified_product = ANY(q.unified_products))
      AND (q.paises           IS NULL OR mc.pais            = ANY(q.paises))
  )
  SELECT
    ano,
    mes,
    pais_destino,
    ncm_codigo,
    descricao_ncm,
    unified_product,
    quantidade_kg,
    volume_m3,
    valor_usd,
    CASE WHEN volume_m3 IS NOT NULL AND volume_m3 > 0
         THEN (valor_usd / (volume_m3 * 6.2898))::numeric
         ELSE NULL END AS unit_price_usd_bbl
  FROM base
  ORDER BY ano, mes, pais_destino, ncm_codigo;
$$;

GRANT EXECUTE ON FUNCTION public.get_imports_exports_raw_exports(jsonb)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_imports_exports_raw_exports(jsonb) IS
  'Raw rows from mdic_comex (flow=export) for /imports-exports export modal. Returns one row per (ano, mes, pais, ncm). unit_price_usd_bbl uses 6.2898 m3->bbl factor and is null-safe.';


-- =============================================================================
-- 7. get_imports_exports_export_count(p_filtros)
--    Returns 2 rows: flow='imports'/'exports' with the COUNT(*) from the
--    underlying queries of #5 and #6 after applying matching filters.
--    Filter keys: same union of keys accepted by #5 and #6 (ano_inicio,
--    ano_fim, unified_product[], pais_origem[], pais_destino[], cnpj[]).
--    pais_origem applies only to imports; pais_destino only to exports; cnpj
--    only to imports.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_imports_exports_export_count(
  p_filtros jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE (
  flow text,
  n    bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT
      COALESCE(
        NULLIF(p_filtros ->> 'ano_inicio', '')::int,
        EXTRACT(YEAR FROM current_date)::int - 2
      ) AS ano_inicio,
      COALESCE(
        NULLIF(p_filtros ->> 'ano_fim', '')::int,
        EXTRACT(YEAR FROM current_date)::int
      ) AS ano_fim,
      CASE WHEN p_filtros ? 'unified_product'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'unified_product'))
           ELSE NULL END AS unified_products,
      CASE WHEN p_filtros ? 'pais_origem'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'pais_origem'))
           ELSE NULL END AS paises_origem,
      CASE WHEN p_filtros ? 'pais_destino'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'pais_destino'))
           ELSE NULL END AS paises_destino,
      CASE WHEN p_filtros ? 'cnpj'
           THEN ARRAY(SELECT jsonb_array_elements_text(p_filtros -> 'cnpj'))
           ELSE NULL END AS cnpjs
  )
  SELECT 'imports'::text AS flow,
         (SELECT COUNT(*)::bigint
            FROM public.anp_desembaracos d
            JOIN public.imports_product_map pm
              ON pm.source = 'desembaracos'
             AND pm.source_key = d.ncm_codigo
            CROSS JOIN params q
           WHERE d.ano BETWEEN q.ano_inicio AND q.ano_fim
             AND d.cnpj <> '__legacy__'
             AND (q.unified_products IS NULL OR pm.unified_product = ANY(q.unified_products))
             AND (q.paises_origem    IS NULL OR d.pais_origem      = ANY(q.paises_origem))
             AND (q.cnpjs            IS NULL OR d.cnpj             = ANY(q.cnpjs))) AS n
  UNION ALL
  SELECT 'exports'::text AS flow,
         (SELECT COUNT(*)::bigint
            FROM public.mdic_comex mc
            JOIN public.imports_product_map pm
              ON pm.source = 'mdic'
             AND pm.source_key = mc.ncm_codigo
            CROSS JOIN params q
           WHERE mc.flow = 'export'
             AND mc.ano BETWEEN q.ano_inicio AND q.ano_fim
             AND (q.unified_products IS NULL OR pm.unified_product = ANY(q.unified_products))
             AND (q.paises_destino   IS NULL OR mc.pais            = ANY(q.paises_destino))) AS n;
$$;

GRANT EXECUTE ON FUNCTION public.get_imports_exports_export_count(jsonb)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_imports_exports_export_count(jsonb) IS
  'Row-count estimator for /imports-exports export modal. Returns 2 rows (imports/exports) summing the same underlying queries as get_imports_exports_raw_imports / _raw_exports.';


COMMIT;
