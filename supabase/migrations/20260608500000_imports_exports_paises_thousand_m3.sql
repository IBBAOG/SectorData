-- =============================================================================
-- 20260608500000_imports_exports_paises_thousand_m3.sql
--
-- /imports-exports — convert the IMPORTS "By Origin Country" chart and the
-- paises-scope YoY table from kt (thousand tonnes) to thousand m³, using the
-- per-NCM density map (ncm_densidade_kg_m3) instead of a fixed factor.
--
-- Rationale (CTO decision): the origin-country chart and paises YoY were summing
-- ComexStat net weight in kg (kt). The user wants volume in thousand m³, which
-- requires dividing each row by its NCM density BEFORE aggregating by country
-- (densities differ: diesel 832, gasoline 745, crude 870 kg/m³). The fixed "1.2"
-- factor only matches diesel; gasoline needs 1.342, crude 1.149 — hence the
-- division must be per-NCM inside the RPC.
--
-- Affected RPCs (signatures KEPT VERBATIM; only return semantics change):
--   1. get_imports_exports_paises_stacked(text, int, int, int, int, int)
--        RETURNS (ano int, mes int, pais_origem text, total_m3 numeric)
--        -- column RENAMED total_kg -> total_m3; value is m³ (frontend /1000 → thousand m³)
--   2. get_imports_exports_yoy_table(text, text, int, int, int) -- paises branch ONLY
--        last_12m/prev_12m now SUM(volume_kg / densidade_kg_m3) / 1000.0 (thousand m³)
--
-- ── EXPORTS / IMPORTERS untouched ────────────────────────────────────────────
-- This migration touches ONLY the two import-by-country RPCs. The exports RPCs
-- are not touched. The importers branch of get_imports_exports_yoy_table is
-- reproduced 100% UNCHANGED (it already expresses thousand m³ via per-NCM
-- density over anp_desembaracos, the only CNPJ-bearing source).
--
-- ── Density join ─────────────────────────────────────────────────────────────
-- JOIN ncm_densidade_kg_m3 n ON n.ncm_codigo = m.ncm_codigo (both text) with a
-- guard n.densidade_kg_m3::numeric > 0. Rows whose NCM has no positive density
-- are dropped (cannot be converted to m³), same posture as the importers branch.
--
-- ── Pegadinha #18 mitigation ─────────────────────────────────────────────────
-- DROP + CREATE strips SECURITY DEFINER, search_path AND grants. Each function
-- is re-pinned (SECURITY DEFINER; SET search_path; GRANT EXECUTE TO anon,
-- authenticated) right after creation.
--
-- ── Pegadinha #19 mitigation ─────────────────────────────────────────────────
-- Highest occupied slot today is 20260608400000; this takes 20260608500000.
--
-- Owner: worker_supabase
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. get_imports_exports_paises_stacked — thousand-m³ via per-NCM density.
--    Per-NCM kg/density division happens in `base`, BEFORE the country group-by.
--    Return column renamed total_kg -> total_m3 (value is m³; frontend /1000).
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_imports_exports_paises_stacked(text, int, int, int, int, int);

CREATE FUNCTION public.get_imports_exports_paises_stacked(
  p_unified_product text,
  p_ano_inicio      int,
  p_mes_inicio      int,
  p_ano_fim         int,
  p_mes_fim         int,
  p_top_n           int DEFAULT 10
)
RETURNS TABLE (
  ano         int,
  mes         int,
  pais_origem text,
  total_m3    numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    -- Per-NCM conversion to m³ happens here, before any aggregation by country.
    SELECT
      m.ano::int                              AS ano,
      m.mes::int                              AS mes,
      m.pais                                  AS pais_origem,   -- canonical PT
      (m.volume_kg / n.densidade_kg_m3::numeric) AS m3
    FROM public.mdic_comex m
    JOIN public.imports_product_map pm
      ON pm.source = 'mdic'
     AND pm.source_key = m.ncm_codigo
    JOIN public.ncm_densidade_kg_m3 n
      ON n.ncm_codigo = m.ncm_codigo
    WHERE pm.unified_product = p_unified_product
      AND m.flow = 'import'
      AND m.volume_kg IS NOT NULL
      AND n.densidade_kg_m3::numeric > 0
      AND (m.ano >  p_ano_inicio OR (m.ano = p_ano_inicio AND m.mes >= p_mes_inicio))
      AND (m.ano <  p_ano_fim    OR (m.ano = p_ano_fim    AND m.mes <= p_mes_fim))
  ),
  agg AS (
    SELECT ano, mes, pais_origem, SUM(m3)::numeric AS total_m3
    FROM base
    GROUP BY ano, mes, pais_origem
  ),
  ranked AS (
    -- Window-wide ranking by total m³ over the whole [start, end] range
    SELECT
      pais_origem,
      SUM(total_m3) AS window_total,
      RANK() OVER (ORDER BY SUM(total_m3) DESC NULLS LAST) AS rk
    FROM agg
    GROUP BY pais_origem
  ),
  labeled AS (
    SELECT
      a.ano,
      a.mes,
      CASE WHEN r.rk <= GREATEST(p_top_n, 1) THEN a.pais_origem ELSE 'Others' END AS pais_origem,
      a.total_m3
    FROM agg a
    JOIN ranked r USING (pais_origem)
  )
  SELECT ano, mes, pais_origem, SUM(total_m3)::numeric AS total_m3
  FROM labeled
  GROUP BY ano, mes, pais_origem
  ORDER BY ano, mes, total_m3 DESC NULLS LAST;
$$;

ALTER FUNCTION public.get_imports_exports_paises_stacked(text, int, int, int, int, int)
  SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_paises_stacked(text, int, int, int, int, int)
  SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.get_imports_exports_paises_stacked(text, int, int, int, int, int)
  TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2. get_imports_exports_yoy_table — paises branch now in thousand m³.
--    The importers branch is reproduced 100% UNCHANGED from 20260608400000.
--    Signature + return columns are byte-identical.
-- -----------------------------------------------------------------------------
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
    -- ── Source: ComexStat (mdic_comex), flow='import', thousand m³ ─────────────
    RETURN QUERY
    WITH base AS (
      SELECT
        m.pais                                  AS entity,   -- canonical PT
        m.ano::int                              AS ano,
        m.mes::int                              AS mes,
        (m.volume_kg / n.densidade_kg_m3::numeric) AS m3
      FROM public.mdic_comex m
      JOIN public.imports_product_map pm
        ON pm.source = 'mdic'
       AND pm.source_key = m.ncm_codigo
      JOIN public.ncm_densidade_kg_m3 n
        ON n.ncm_codigo = m.ncm_codigo
      WHERE pm.unified_product = p_unified_product
        AND m.flow = 'import'
        AND m.volume_kg IS NOT NULL
        AND n.densidade_kg_m3::numeric > 0
        AND (
          (m.ano::int = v_curr_ano AND m.mes::int = v_curr_mes)
          OR
          (m.ano::int = v_prev_ano AND m.mes::int = v_prev_mes)
        )
    ),
    by_entity AS (
      SELECT
        b.entity,
        (SUM(CASE WHEN b.ano = v_curr_ano AND b.mes = v_curr_mes THEN b.m3 ELSE 0 END) / 1000.0)::numeric AS last_12m,
        (SUM(CASE WHEN b.ano = v_prev_ano AND b.mes = v_prev_mes THEN b.m3 ELSE 0 END) / 1000.0)::numeric AS prev_12m
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

  ELSE  -- p_scope = 'importers'  ── UNCHANGED: anp_desembaracos (only source with CNPJ) ──
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

COMMIT;
