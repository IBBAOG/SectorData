-- =============================================================================
-- 20260608400000_imports_exports_paises_from_comexstat.sql
--
-- /imports-exports — source the "By Origin Country" chart and the paises-scope
-- YoY table from ComexStat (mdic_comex) instead of ANP Desembaraços.
--
-- Rationale (CTO decision): anp_desembaracos publishes several weeks later than
-- ComexStat. The user tracks ComexStat (which already released May/2026) and
-- wants the origin-country chart + paises YoY to reflect it. The "By Importer
-- (Brazil)" half MUST keep reading anp_desembaracos — it is the only source with
-- CNPJ / importer identity — so the importers branch of the YoY table and the
-- importers_stacked RPC are intentionally left untouched.
--
-- Affected RPCs (signatures + return columns KEPT VERBATIM):
--   1. get_imports_exports_paises_stacked(text, int, int, int, int, int)
--        RETURNS (ano int, mes int, pais_origem text, total_kg numeric)
--   2. get_imports_exports_yoy_table(text, text, int, int, int)  -- paises branch only
--        RETURNS (entity text, last_12m numeric, prev_12m numeric, yoy_pct numeric)
--
-- ── Country labels (PT → EN) ─────────────────────────────────────────────────
-- The frontend (src/app/(dashboard)/imports-exports/useImportsExportsData.ts)
-- translates origin countries to English via ORIGIN_COUNTRY_PINS_DATA, keyed on
-- canonical Portuguese DB strings:
--   "Rússia" → Russia, "Estados Unidos" → United States,
--   "Emirados Árabes Unidos" → UAE, "Países Baixos (Holanda)" → Netherlands,
--   "Índia" → India, "Arábia Saudita" → Saudi Arabia.
-- Verified that mdic_comex.pais already stores EXACTLY these 6 canonical strings
-- (ComexStat uses the same spelling for all pinned countries — e.g. it stores
-- "Países Baixos (Holanda)", not ANP's UPPERCASE "HOLANDA (PAISES BAIXOS)").
-- Therefore NO SQL normalization is required: we emit mc.pais verbatim as
-- pais_origem and the existing frontend map resolves the English legend.
-- Non-pinned countries fall outside top-N and roll into 'Others' anyway.
--
-- Contract emitted to the frontend: pais_origem = mdic_comex.pais (canonical PT,
-- identical to the ANP canonical PT strings the frontend already translates).
--
-- ── total_kg semantics ───────────────────────────────────────────────────────
-- Both RPCs previously summed anp_desembaracos.quantidade_kg. We now sum
-- mdic_comex.volume_kg (the ComexStat net weight in kg), matching the task spec.
-- The YoY paises branch keeps dividing by 1e6 to express kt, identical to before.
--
-- ── Pegadinha #18 mitigation ─────────────────────────────────────────────────
-- DROP + CREATE strips SECURITY DEFINER, search_path AND grants. Each function
-- is re-pinned (ALTER ... SECURITY DEFINER; ALTER ... SET search_path; GRANT)
-- right after creation, exactly mirroring the prior migrations.
--
-- ── Pegadinha #19 mitigation ─────────────────────────────────────────────────
-- Filename slot 20260608400000. Slot 20260608300000 is already occupied in the
-- remote DB by 'imports_exports_exports_tonnes' (parallel branch
-- claude/stupefied-leavitt-b93b72, not yet merged here), so this migration takes
-- the next free monotonic slot 20260608400000 to avoid a schema_migrations
-- primary-key collision once that branch merges to main.
--
-- Owner: worker_supabase
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. get_imports_exports_paises_stacked — source mdic_comex (flow='import')
--    Signature + return columns are byte-identical to 20260526800000.
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
  total_kg    numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT
      m.ano::int     AS ano,
      m.mes::int     AS mes,
      m.pais         AS pais_origem,   -- canonical PT, matches frontend pin keys
      m.volume_kg    AS volume_kg
    FROM public.mdic_comex m
    JOIN public.imports_product_map pm
      ON pm.source = 'mdic'
     AND pm.source_key = m.ncm_codigo
    WHERE pm.unified_product = p_unified_product
      AND m.flow = 'import'
      AND (m.ano >  p_ano_inicio OR (m.ano = p_ano_inicio AND m.mes >= p_mes_inicio))
      AND (m.ano <  p_ano_fim    OR (m.ano = p_ano_fim    AND m.mes <= p_mes_fim))
  ),
  agg AS (
    SELECT ano, mes, pais_origem, SUM(volume_kg)::numeric AS total_kg
    FROM base
    GROUP BY ano, mes, pais_origem
  ),
  ranked AS (
    -- Window-wide ranking by total kg over the whole [start, end] range
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

ALTER FUNCTION public.get_imports_exports_paises_stacked(text, int, int, int, int, int)
  SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_paises_stacked(text, int, int, int, int, int)
  SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.get_imports_exports_paises_stacked(text, int, int, int, int, int)
  TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2. get_imports_exports_yoy_table — paises branch from mdic_comex.
--    The importers branch is reproduced 100% UNCHANGED from 20260527000000.
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
    -- ── Source: ComexStat (mdic_comex), flow='import' ──────────────────────────
    RETURN QUERY
    WITH base AS (
      SELECT
        m.pais       AS entity,   -- canonical PT, matches frontend pin keys
        m.ano::int   AS ano,
        m.mes::int   AS mes,
        m.volume_kg  AS quantidade_kg
      FROM public.mdic_comex m
      JOIN public.imports_product_map pm
        ON pm.source = 'mdic'
       AND pm.source_key = m.ncm_codigo
      WHERE pm.unified_product = p_unified_product
        AND m.flow = 'import'
        AND (
          (m.ano::int = v_curr_ano AND m.mes::int = v_curr_mes)
          OR
          (m.ano::int = v_prev_ano AND m.mes::int = v_prev_mes)
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
