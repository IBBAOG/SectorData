-- 20260527000000_imports_exports_yoy_single_month.sql
--
-- Switch the two YoY tables of /imports-exports from "rolling 12m vs prior 12m"
-- to "single month vs same month of previous year".
--
-- Affected RPCs (signatures UNCHANGED):
--   1. get_imports_exports_yoy_table(p_scope, p_unified_product, p_ano_fim, p_mes_fim, p_top_n)
--   2. get_imports_exports_exports_yoy_table(p_unified_product, p_ano_fim, p_mes_fim, p_metric, p_top_n)
--
-- Return columns (entity, last_12m, prev_12m, yoy_pct) are KEPT verbatim to
-- preserve the payload contract with src/lib/rpc.ts wrappers. The frontend
-- semantics shift: last_12m now means "the selected single month" and
-- prev_12m means "the same month of the previous year".
--
-- Pegadinha #18 (worker_supabase PRD): DROP + CREATE strips SECURITY DEFINER,
-- search_path and GRANTs. Each function is fully re-pinned below.
-- Pegadinha #19 (timestamp collision): chosen slot 20260527000000 is free
-- (previous head: 20260526900000_module_visibility_home_requires_visible.sql).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) get_imports_exports_yoy_table  (paises | importers)
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_imports_exports_yoy_table(text, text, int, int, int);

CREATE FUNCTION public.get_imports_exports_yoy_table(
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
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  -- Current month: (p_ano_fim, p_mes_fim)
  v_curr_ano int := p_ano_fim;
  v_curr_mes int := p_mes_fim;
  -- Same month, previous year
  v_prev_ano int := p_ano_fim - 1;
  v_prev_mes int := p_mes_fim;
BEGIN
  IF p_scope NOT IN ('paises','importers') THEN
    RAISE EXCEPTION 'p_scope must be either ''paises'' or ''importers'' (got %)', p_scope;
  END IF;

  IF p_scope = 'paises' THEN
    RETURN QUERY
    WITH base AS (
      SELECT
        d.pais_origem  AS entity,
        d.ano::int     AS ano,
        d.mes::int     AS mes,
        d.quantidade_kg AS quantidade_kg
      FROM public.anp_desembaracos d
      JOIN public.imports_product_map pm
        ON pm.source = 'desembaracos'
       AND pm.source_key = d.ncm_codigo
      WHERE pm.unified_product = p_unified_product
        AND (
          (d.ano::int = v_curr_ano AND d.mes::int = v_curr_mes)
          OR
          (d.ano::int = v_prev_ano AND d.mes::int = v_prev_mes)
        )
    ),
    by_entity AS (
      SELECT
        b.entity,
        (SUM(CASE WHEN b.ano = v_curr_ano AND b.mes = v_curr_mes THEN b.quantidade_kg ELSE 0 END) / 1e6)::numeric AS last_12m,
        (SUM(CASE WHEN b.ano = v_prev_ano AND b.mes = v_prev_mes THEN b.quantidade_kg ELSE 0 END) / 1e6)::numeric AS prev_12m
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
        d.ano::int             AS ano,
        d.mes::int             AS mes,
        d.quantidade_kg        AS quantidade_kg,
        n.densidade_kg_m3      AS densidade_kg_m3
      FROM public.anp_desembaracos d
      JOIN public.imports_product_map pm
        ON pm.source = 'desembaracos'
       AND pm.source_key = d.ncm_codigo
      JOIN public.ncm_densidade_kg_m3 n
        ON n.ncm_codigo = d.ncm_codigo
      WHERE pm.unified_product = p_unified_product
        AND (
          (d.ano::int = v_curr_ano AND d.mes::int = v_curr_mes)
          OR
          (d.ano::int = v_prev_ano AND d.mes::int = v_prev_mes)
        )
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
        b.ano,
        b.mes,
        (b.quantidade_kg / b.densidade_kg_m3) AS m3
      FROM base b
      LEFT JOIN public.importer_group_map g ON g.cnpj = b.cnpj
    ),
    by_entity AS (
      SELECT
        r.entity,
        (SUM(CASE WHEN r.ano = v_curr_ano AND r.mes = v_curr_mes THEN r.m3 ELSE 0 END) / 1000.0)::numeric AS last_12m,
        (SUM(CASE WHEN r.ano = v_prev_ano AND r.mes = v_prev_mes THEN r.m3 ELSE 0 END) / 1000.0)::numeric AS prev_12m
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

-- Re-pin SECURITY DEFINER + search_path (Pegadinha #18) and re-GRANT (DROP wiped them).
ALTER FUNCTION public.get_imports_exports_yoy_table(text, text, int, int, int)
  SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_yoy_table(text, text, int, int, int)
  SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.get_imports_exports_yoy_table(text, text, int, int, int)
  TO anon, authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) get_imports_exports_exports_yoy_table  (mdic_comex, flow='export')
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_imports_exports_exports_yoy_table(text, int, int, text, int);

CREATE FUNCTION public.get_imports_exports_exports_yoy_table(
  p_unified_product text,
  p_ano_fim         int,
  p_mes_fim         int,
  p_metric          text DEFAULT 'volume',
  p_top_n           int  DEFAULT 10
)
RETURNS TABLE (entity text, last_12m numeric, prev_12m numeric, yoy_pct numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_curr_ano int := p_ano_fim;
  v_curr_mes int := p_mes_fim;
  v_prev_ano int := p_ano_fim - 1;
  v_prev_mes int := p_mes_fim;
BEGIN
  IF p_metric NOT IN ('volume', 'usd') THEN
    RAISE EXCEPTION 'p_metric must be ''volume'' or ''usd''';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT mc.pais AS b_pais,
           mc.ano::int AS b_ano,
           mc.mes::int AS b_mes,
           CASE WHEN p_metric = 'volume'
                THEN mc.volume_kg / d.densidade_kg_m3 / 1000.0
                ELSE mc.valor_fob_usd
           END AS b_v
    FROM public.mdic_comex mc
    JOIN public.imports_product_map ipm
      ON ipm.source = 'mdic'
     AND ipm.source_key = mc.ncm_codigo
     AND ipm.unified_product = p_unified_product
    JOIN public.ncm_densidade_kg_m3 d
      ON d.ncm_codigo = mc.ncm_codigo
    WHERE mc.flow = 'export'
      AND (
        (mc.ano::int = v_curr_ano AND mc.mes::int = v_curr_mes)
        OR
        (mc.ano::int = v_prev_ano AND mc.mes::int = v_prev_mes)
      )
  ),
  agg AS (
    SELECT base.b_pais AS a_pais,
           SUM(CASE WHEN base.b_ano = v_curr_ano AND base.b_mes = v_curr_mes THEN base.b_v ELSE 0 END) AS a_last_12m,
           SUM(CASE WHEN base.b_ano = v_prev_ano AND base.b_mes = v_prev_mes THEN base.b_v ELSE 0 END) AS a_prev_12m
    FROM base
    GROUP BY base.b_pais
  ),
  topn AS (
    SELECT agg.a_pais AS t_pais
    FROM agg
    ORDER BY agg.a_last_12m DESC NULLS LAST
    LIMIT p_top_n
  ),
  labeled AS (
    SELECT CASE WHEN agg.a_pais IN (SELECT topn.t_pais FROM topn)
                THEN agg.a_pais ELSE 'Others' END AS l_entity,
           agg.a_last_12m AS l_last_12m,
           agg.a_prev_12m AS l_prev_12m
    FROM agg
  )
  SELECT labeled.l_entity,
         SUM(labeled.l_last_12m)::numeric,
         SUM(labeled.l_prev_12m)::numeric,
         CASE WHEN SUM(labeled.l_prev_12m) > 0
              THEN (SUM(labeled.l_last_12m) - SUM(labeled.l_prev_12m)) / SUM(labeled.l_prev_12m) * 100.0
              ELSE NULL END :: numeric
  FROM labeled
  GROUP BY labeled.l_entity
  ORDER BY SUM(labeled.l_last_12m) DESC NULLS LAST;
END;
$$;

ALTER FUNCTION public.get_imports_exports_exports_yoy_table(text, int, int, text, int)
  SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_exports_yoy_table(text, int, int, text, int)
  SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.get_imports_exports_exports_yoy_table(text, int, int, text, int)
  TO anon, authenticated;

COMMIT;
