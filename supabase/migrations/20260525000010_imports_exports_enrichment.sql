-- =============================================================================
-- Imports & Exports reform: consolidate /anp-daie + /anp-desembaracos +
-- /anp-painel-importacoes into a single /imports-exports dashboard.
--
-- This migration:
--   1. Enriches anp_desembaracos with importador/CNPJ/UF columns (sourced
--      from the ANP XLSX columns previously discarded by the ETL).
--   2. Replaces the PK (ano, mes, ncm_codigo, pais_origem) with one that
--      includes cnpj, so an importer dimension is finally first-class.
--   3. Creates 3 auxiliary tables:
--        - imports_product_map   (DAIE / Desembaracos -> unified product)
--        - importer_group_map    (CNPJ -> unified importer group)
--        - ncm_densidade_kg_m3   (NCM code -> density for kg->m3 conversion)
--   4. Drops the obsolete anp_painel_imp_dist table (the /anp-painel-importacoes
--      dashboard is replaced).
--   5. Drops 8 obsolete RPCs (get_anp_daie_*, get_anp_desembaracos_*,
--      get_anp_painel_imp_*).
--   6. Creates 5 new unified RPCs (get_imports_exports_*).
--   7. Seeds module_visibility for 'imports-exports' and removes the 3 old
--      slugs.
--
-- Companion work (other worktrees):
--   - Worktree B: ETL refactor (extract Importador/CNPJ/UF do CNPJ from XLSX,
--                 upsert into the enriched table).
--   - Worktree C: APP frontend (new /imports-exports route + RPC wrappers).
--
-- Owner: worker_supabase
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Schema enrichment on anp_desembaracos
-- -----------------------------------------------------------------------------
-- Add the 3 columns previously discarded by the ETL. They will be backfilled
-- by Worktree B's revised ETL pipeline (re-running the importer over the same
-- XLSX sources). Until that backfill runs, all existing rows carry a sentinel
-- '__legacy__' in cnpj — required because we want cnpj to be part of the PK
-- (NOT NULL) right away, and the pre-existing 6204 rows need a placeholder.

ALTER TABLE public.anp_desembaracos
  ADD COLUMN IF NOT EXISTS importador text,
  ADD COLUMN IF NOT EXISTS cnpj       text,
  ADD COLUMN IF NOT EXISTS uf_cnpj    text;

-- Backfill the sentinel into any row whose cnpj is still NULL. The choice of
-- '__legacy__' is intentional: it sorts ahead of real CNPJs (digits) and is
-- unambiguous in queries when filtering them out. The Worktree B ETL will
-- DELETE rows with cnpj='__legacy__' and re-INSERT with real CNPJs from XLSX.
UPDATE public.anp_desembaracos
   SET cnpj = '__legacy__'
 WHERE cnpj IS NULL;

-- Drop the old PK and recreate including cnpj. Diagnostic confirmed no
-- duplicates on (ano, mes, ncm_codigo, pais_origem) at migration time, so
-- adding cnpj='__legacy__' uniformly keeps every row distinct.
ALTER TABLE public.anp_desembaracos
  DROP CONSTRAINT IF EXISTS anp_desembaracos_pkey;

ALTER TABLE public.anp_desembaracos
  ALTER COLUMN cnpj SET NOT NULL;

ALTER TABLE public.anp_desembaracos
  ADD CONSTRAINT anp_desembaracos_pkey
    PRIMARY KEY (ano, mes, ncm_codigo, pais_origem, cnpj);

-- Helpful indexes for the new dimension. importador is searched by group_map
-- lookup; uf_cnpj for any geographic breakdowns.
CREATE INDEX IF NOT EXISTS idx_anp_desembaracos_cnpj       ON public.anp_desembaracos (cnpj);
CREATE INDEX IF NOT EXISTS idx_anp_desembaracos_importador ON public.anp_desembaracos (importador);


-- -----------------------------------------------------------------------------
-- 2a. imports_product_map — unifies DAIE product strings and Desembaracos NCMs
--     into the 3 products we care about (Diesel, Gasoline, Crude Oil).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.imports_product_map (
  unified_product text NOT NULL,
  source          text NOT NULL CHECK (source IN ('daie','desembaracos')),
  source_key      text NOT NULL,
  PRIMARY KEY (source, source_key)
);

COMMENT ON TABLE public.imports_product_map IS
  'Maps source-specific product identifiers (anp_daie.produto strings; anp_desembaracos.ncm_codigo NCMs) to a unified product label used by the /imports-exports dashboard.';

INSERT INTO public.imports_product_map (unified_product, source, source_key) VALUES
  ('Diesel',    'daie',         'ÓLEO DIESEL'),
  ('Diesel',    'desembaracos', '27101921'),
  ('Gasoline',  'daie',         'GASOLINA A'),
  ('Gasoline',  'desembaracos', '27101931'),
  ('Crude Oil', 'daie',         'PETRÓLEO'),
  ('Crude Oil', 'desembaracos', '27090010')
ON CONFLICT (source, source_key) DO UPDATE
  SET unified_product = EXCLUDED.unified_product;


-- -----------------------------------------------------------------------------
-- 2b. importer_group_map — collapses CNPJs into corporate-group labels.
--     Seeded empty. CTO will populate via a follow-up DML migration once the
--     real CNPJs are discovered post-backfill (T11 in the plan).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.importer_group_map (
  cnpj              text PRIMARY KEY,
  unified_importer  text NOT NULL,
  razao_social_seed text  -- original importador string captured at seed time, kept for auditing
);

COMMENT ON TABLE public.importer_group_map IS
  'Maps individual CNPJs to a unified importer group label (e.g. all Vibra subsidiaries -> "Vibra Energia"). Intentionally empty at migration time; populated after Worktree B backfills real CNPJs into anp_desembaracos. When no mapping exists, get_imports_exports_importers_stacked() falls back to a cleaned-up importador string.';


-- -----------------------------------------------------------------------------
-- 2c. ncm_densidade_kg_m3 — densities for kg -> m^3 conversion.
--     Values from public petroleum/fuel density references used internally
--     for the 3 priority products. Other NCMs can be added later.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ncm_densidade_kg_m3 (
  ncm_codigo       text PRIMARY KEY,
  densidade_kg_m3  numeric NOT NULL,
  produto_label    text NOT NULL
);

COMMENT ON TABLE public.ncm_densidade_kg_m3 IS
  'Density (kg per m^3) by NCM code. Used to convert anp_desembaracos.quantidade_kg into m^3 in the /imports-exports importers stacked chart.';

INSERT INTO public.ncm_densidade_kg_m3 (ncm_codigo, densidade_kg_m3, produto_label) VALUES
  ('27101921', 840, 'Diesel'),
  ('27101931', 740, 'Gasoline'),
  ('27090010', 850, 'Crude Oil')
ON CONFLICT (ncm_codigo) DO UPDATE
  SET densidade_kg_m3 = EXCLUDED.densidade_kg_m3,
      produto_label   = EXCLUDED.produto_label;


-- -----------------------------------------------------------------------------
-- 3. RLS for the 3 new tables. Read-only to anon/authenticated; only the
--    service role writes (consistent with every other reference table here).
-- -----------------------------------------------------------------------------
ALTER TABLE public.imports_product_map   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.importer_group_map    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ncm_densidade_kg_m3   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "imports_product_map_select" ON public.imports_product_map;
CREATE POLICY "imports_product_map_select"
  ON public.imports_product_map
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "importer_group_map_select" ON public.importer_group_map;
CREATE POLICY "importer_group_map_select"
  ON public.importer_group_map
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "ncm_densidade_kg_m3_select" ON public.ncm_densidade_kg_m3;
CREATE POLICY "ncm_densidade_kg_m3_select"
  ON public.ncm_densidade_kg_m3
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies on purpose — service_role bypasses RLS, so
-- only the pipelines (or DML migrations) can write.


-- -----------------------------------------------------------------------------
-- 4. Drop the obsolete table. CASCADE removes any function/view that still
--    references it (notably the 3 get_anp_painel_imp_* RPCs).
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.anp_painel_imp_dist CASCADE;


-- -----------------------------------------------------------------------------
-- 5. Drop obsolete RPCs explicitly. Idempotent — if CASCADE in step 4 already
--    cleaned them up, IF EXISTS keeps this a no-op. Signatures captured from
--    pg_proc at migration time.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_anp_daie_filtros()                                                              CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_daie_serie(text[], text[], smallint, smallint)                              CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_desembaracos_filtros()                                                      CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_desembaracos_serie(text[], text[], smallint, smallint)                      CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_desembaracos_top_paises(text, smallint, smallint, integer)                  CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_painel_imp_filtros()                                                        CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_painel_imp_serie(text[], text[], smallint, smallint)                        CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_painel_imp_top_dist(text, smallint, smallint, integer)                      CASCADE;


-- -----------------------------------------------------------------------------
-- 6. New RPCs powering /imports-exports
-- -----------------------------------------------------------------------------

-- 6.1 Filtros
CREATE OR REPLACE FUNCTION public.get_imports_exports_filtros()
RETURNS TABLE (
  ano_min  int,
  ano_max  int,
  produtos text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      LEAST(
        COALESCE((SELECT MIN(ano) FROM public.anp_desembaracos), 9999),
        COALESCE((SELECT MIN(ano) FROM public.anp_daie),         9999)
      )::int AS ano_min,
      GREATEST(
        COALESCE((SELECT MAX(ano) FROM public.anp_desembaracos), 0),
        COALESCE((SELECT MAX(ano) FROM public.anp_daie),         0)
      )::int AS ano_max
  )
  SELECT
    ano_min,
    ano_max,
    ARRAY['Diesel','Gasoline','Crude Oil']::text[] AS produtos
  FROM bounds;
$$;

GRANT EXECUTE ON FUNCTION public.get_imports_exports_filtros() TO anon, authenticated;


-- 6.2 Paises stacked (imports by origin country, top-N + Others)
CREATE OR REPLACE FUNCTION public.get_imports_exports_paises_stacked(
  p_unified_product text,
  p_ano_inicio      int,
  p_ano_fim         int,
  p_top_n           int DEFAULT 10
)
RETURNS TABLE (
  ano         int,
  mes         int,
  pais_origem text,
  total_kg    numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      d.ano::int       AS ano,
      d.mes::int       AS mes,
      d.pais_origem    AS pais_origem,
      d.quantidade_kg  AS quantidade_kg
    FROM public.anp_desembaracos d
    JOIN public.imports_product_map pm
      ON pm.source = 'desembaracos'
     AND pm.source_key = d.ncm_codigo
    WHERE pm.unified_product = p_unified_product
      AND d.ano BETWEEN p_ano_inicio AND p_ano_fim
  ),
  agg AS (
    SELECT ano, mes, pais_origem, SUM(quantidade_kg)::numeric AS total_kg
    FROM base
    GROUP BY ano, mes, pais_origem
  ),
  ranked AS (
    -- Window-wide ranking by total kg over the whole [ano_inicio, ano_fim] range
    SELECT
      pais_origem,
      SUM(total_kg) AS window_total,
      RANK() OVER (ORDER BY SUM(total_kg) DESC NULLS LAST) AS rk
    FROM agg
    GROUP BY pais_origem
  ),
  labeled AS (
    SELECT
      a.ano,
      a.mes,
      CASE WHEN r.rk <= GREATEST(p_top_n, 1) THEN a.pais_origem ELSE 'Others' END AS pais_origem,
      a.total_kg
    FROM agg a
    JOIN ranked r USING (pais_origem)
  )
  SELECT ano, mes, pais_origem, SUM(total_kg)::numeric AS total_kg
  FROM labeled
  GROUP BY ano, mes, pais_origem
  ORDER BY ano, mes, total_kg DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_imports_exports_paises_stacked(text, int, int, int) TO anon, authenticated;


-- 6.3 Importers stacked (imports by importer group, top-N + Others, in mil m^3)
CREATE OR REPLACE FUNCTION public.get_imports_exports_importers_stacked(
  p_unified_product text,
  p_ano_inicio      int,
  p_ano_fim         int,
  p_top_n           int DEFAULT 10
)
RETURNS TABLE (
  ano               int,
  mes               int,
  unified_importer  text,
  total_mil_m3      numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      d.ano::int      AS ano,
      d.mes::int      AS mes,
      d.cnpj          AS cnpj,
      d.importador    AS importador,
      d.quantidade_kg AS quantidade_kg,
      n.densidade_kg_m3 AS densidade_kg_m3
    FROM public.anp_desembaracos d
    JOIN public.imports_product_map pm
      ON pm.source = 'desembaracos'
     AND pm.source_key = d.ncm_codigo
    JOIN public.ncm_densidade_kg_m3 n
      ON n.ncm_codigo = d.ncm_codigo
    WHERE pm.unified_product = p_unified_product
      AND d.ano BETWEEN p_ano_inicio AND p_ano_fim
      AND d.cnpj IS NOT NULL
      AND d.cnpj <> '__legacy__'   -- exclude rows pending backfill
      AND d.quantidade_kg IS NOT NULL
      AND n.densidade_kg_m3 > 0
  ),
  resolved AS (
    SELECT
      ano,
      mes,
      COALESCE(
        g.unified_importer,
        NULLIF(
          trim(
            regexp_replace(
              COALESCE(importador, ''),
              '\s+(LTDA|S\.?A\.?|S/A|EIRELI|ME)\.?$',
              '',
              'i'
            )
          ),
          ''
        ),
        importador,
        'Unknown'
      ) AS unified_importer,
      (quantidade_kg / densidade_kg_m3) AS m3
    FROM base
    LEFT JOIN public.importer_group_map g ON g.cnpj = base.cnpj
  ),
  agg AS (
    SELECT
      ano,
      mes,
      unified_importer,
      (SUM(m3) / 1000.0)::numeric AS total_mil_m3
    FROM resolved
    GROUP BY ano, mes, unified_importer
  ),
  ranked AS (
    SELECT
      unified_importer,
      SUM(total_mil_m3) AS window_total,
      RANK() OVER (ORDER BY SUM(total_mil_m3) DESC NULLS LAST) AS rk
    FROM agg
    GROUP BY unified_importer
  ),
  labeled AS (
    SELECT
      a.ano,
      a.mes,
      CASE WHEN r.rk <= GREATEST(p_top_n, 1) THEN a.unified_importer ELSE 'Others' END AS unified_importer,
      a.total_mil_m3
    FROM agg a
    JOIN ranked r USING (unified_importer)
  )
  SELECT ano, mes, unified_importer, SUM(total_mil_m3)::numeric AS total_mil_m3
  FROM labeled
  GROUP BY ano, mes, unified_importer
  ORDER BY ano, mes, total_mil_m3 DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_imports_exports_importers_stacked(text, int, int, int) TO anon, authenticated;


-- 6.4 YoY table for either paises or importers (rolling 12m vs prior 12m)
-- #variable_conflict use_column avoids PL/pgSQL ambiguity between the
-- RETURNS TABLE column names (entity, last_12m, prev_12m, yoy_pct) and
-- identifiers re-used inside the CTEs.
CREATE OR REPLACE FUNCTION public.get_imports_exports_yoy_table(
  p_scope           text,
  p_unified_product text,
  p_ano_fim         int,
  p_mes_fim         int,
  p_top_n           int DEFAULT 10
)
RETURNS TABLE (
  entity     text,
  last_12m   numeric,
  prev_12m   numeric,
  yoy_pct    numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_window_end_excl date := (make_date(p_ano_fim, p_mes_fim, 1) + INTERVAL '1 month')::date;
  v_last_start      date := (v_window_end_excl - INTERVAL '12 months')::date;
  v_prev_start      date := (v_window_end_excl - INTERVAL '24 months')::date;
BEGIN
  IF p_scope NOT IN ('paises','importers') THEN
    RAISE EXCEPTION 'p_scope must be either ''paises'' or ''importers'' (got %)', p_scope;
  END IF;

  IF p_scope = 'paises' THEN
    RETURN QUERY
    WITH base AS (
      SELECT
        d.pais_origem  AS entity,
        make_date(d.ano::int, d.mes::int, 1) AS dt,
        d.quantidade_kg AS quantidade_kg
      FROM public.anp_desembaracos d
      JOIN public.imports_product_map pm
        ON pm.source = 'desembaracos'
       AND pm.source_key = d.ncm_codigo
      WHERE pm.unified_product = p_unified_product
        AND make_date(d.ano::int, d.mes::int, 1) >= v_prev_start
        AND make_date(d.ano::int, d.mes::int, 1) <  v_window_end_excl
    ),
    by_entity AS (
      SELECT
        b.entity,
        (SUM(CASE WHEN b.dt >= v_last_start THEN b.quantidade_kg ELSE 0 END) / 1e6)::numeric AS last_12m,
        (SUM(CASE WHEN b.dt <  v_last_start THEN b.quantidade_kg ELSE 0 END) / 1e6)::numeric AS prev_12m
      FROM base b
      GROUP BY b.entity
    ),
    ranked AS (
      SELECT
        be.entity,
        be.last_12m,
        be.prev_12m,
        RANK() OVER (ORDER BY be.last_12m DESC NULLS LAST) AS rk
      FROM by_entity be
    ),
    labeled AS (
      SELECT
        CASE WHEN r.rk <= GREATEST(p_top_n, 1) THEN r.entity ELSE 'Others' END AS entity,
        r.last_12m,
        r.prev_12m
      FROM ranked r
    ),
    agg AS (
      SELECT
        l.entity,
        SUM(l.last_12m)::numeric AS last_12m,
        SUM(l.prev_12m)::numeric AS prev_12m
      FROM labeled l
      GROUP BY l.entity
    )
    SELECT
      a.entity,
      a.last_12m,
      a.prev_12m,
      ((a.last_12m - a.prev_12m) / NULLIF(a.prev_12m, 0) * 100)::numeric AS yoy_pct
    FROM agg a
    ORDER BY (a.entity = 'Others'), a.last_12m DESC NULLS LAST;

  ELSE  -- p_scope = 'importers'
    RETURN QUERY
    WITH base AS (
      SELECT
        d.cnpj                 AS cnpj,
        d.importador           AS importador,
        make_date(d.ano::int, d.mes::int, 1) AS dt,
        d.quantidade_kg        AS quantidade_kg,
        n.densidade_kg_m3      AS densidade_kg_m3
      FROM public.anp_desembaracos d
      JOIN public.imports_product_map pm
        ON pm.source = 'desembaracos'
       AND pm.source_key = d.ncm_codigo
      JOIN public.ncm_densidade_kg_m3 n
        ON n.ncm_codigo = d.ncm_codigo
      WHERE pm.unified_product = p_unified_product
        AND make_date(d.ano::int, d.mes::int, 1) >= v_prev_start
        AND make_date(d.ano::int, d.mes::int, 1) <  v_window_end_excl
        AND d.cnpj IS NOT NULL
        AND d.cnpj <> '__legacy__'
        AND d.quantidade_kg IS NOT NULL
        AND n.densidade_kg_m3 > 0
    ),
    resolved AS (
      SELECT
        COALESCE(
          g.unified_importer,
          NULLIF(
            trim(
              regexp_replace(
                COALESCE(b.importador, ''),
                '\s+(LTDA|S\.?A\.?|S/A|EIRELI|ME)\.?$',
                '',
                'i'
              )
            ),
            ''
          ),
          b.importador,
          'Unknown'
        ) AS entity,
        b.dt,
        (b.quantidade_kg / b.densidade_kg_m3) AS m3
      FROM base b
      LEFT JOIN public.importer_group_map g ON g.cnpj = b.cnpj
    ),
    by_entity AS (
      SELECT
        r.entity,
        (SUM(CASE WHEN r.dt >= v_last_start THEN r.m3 ELSE 0 END) / 1000.0)::numeric AS last_12m,
        (SUM(CASE WHEN r.dt <  v_last_start THEN r.m3 ELSE 0 END) / 1000.0)::numeric AS prev_12m
      FROM resolved r
      GROUP BY r.entity
    ),
    ranked AS (
      SELECT
        be.entity,
        be.last_12m,
        be.prev_12m,
        RANK() OVER (ORDER BY be.last_12m DESC NULLS LAST) AS rk
      FROM by_entity be
    ),
    labeled AS (
      SELECT
        CASE WHEN rk.rk <= GREATEST(p_top_n, 1) THEN rk.entity ELSE 'Others' END AS entity,
        rk.last_12m,
        rk.prev_12m
      FROM ranked rk
    ),
    agg AS (
      SELECT
        l.entity,
        SUM(l.last_12m)::numeric AS last_12m,
        SUM(l.prev_12m)::numeric AS prev_12m
      FROM labeled l
      GROUP BY l.entity
    )
    SELECT
      a.entity,
      a.last_12m,
      a.prev_12m,
      ((a.last_12m - a.prev_12m) / NULLIF(a.prev_12m, 0) * 100)::numeric AS yoy_pct
    FROM agg a
    ORDER BY (a.entity = 'Others'), a.last_12m DESC NULLS LAST;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_imports_exports_yoy_table(text, text, int, int, int) TO anon, authenticated;


-- 6.5 Exports time series (sourced from anp_daie, operacao = 'EXPORTAÇÃO')
-- Note: the literal value in anp_daie.operacao is uppercase 'EXPORTAÇÃO'
-- (verified via SELECT DISTINCT operacao FROM anp_daie). The plan said
-- "Exportação" but we use the exact stored value.
CREATE OR REPLACE FUNCTION public.get_imports_exports_exports_serie(
  p_unified_products text[],
  p_ano_inicio       int,
  p_ano_fim          int
)
RETURNS TABLE (
  ano        int,
  mes        int,
  produto    text,
  volume_m3  numeric,
  valor_usd  numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    d.ano::int                                    AS ano,
    d.mes::int                                    AS mes,
    pm.unified_product                            AS produto,
    SUM(COALESCE(d.volume_m3, 0))::numeric        AS volume_m3,
    SUM(COALESCE(d.valor_usd, 0))::numeric        AS valor_usd
  FROM public.anp_daie d
  JOIN public.imports_product_map pm
    ON pm.source = 'daie'
   AND pm.source_key = d.produto
  WHERE d.operacao = 'EXPORTAÇÃO'
    AND pm.unified_product = ANY (p_unified_products)
    AND d.ano BETWEEN p_ano_inicio AND p_ano_fim
  GROUP BY d.ano, d.mes, pm.unified_product
  ORDER BY d.ano, d.mes, pm.unified_product;
$$;

GRANT EXECUTE ON FUNCTION public.get_imports_exports_exports_serie(text[], int, int) TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 7. module_visibility — register the new slug and remove the 3 retired ones.
-- -----------------------------------------------------------------------------
INSERT INTO public.module_visibility (
  module_slug,
  is_visible_for_clients,
  is_visible_for_public,
  is_visible_on_home
) VALUES (
  'imports-exports',
  true,
  true,
  true
)
ON CONFLICT (module_slug) DO NOTHING;

DELETE FROM public.module_visibility
 WHERE module_slug IN ('anp-daie','anp-desembaracos','anp-painel-importacoes');

COMMIT;
