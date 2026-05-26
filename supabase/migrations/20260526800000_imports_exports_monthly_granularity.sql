-- =============================================================================
-- 20260526800000_imports_exports_monthly_granularity.sql
--
-- /imports-exports temporal filter granularity: year -> month.
--
-- Replaces the year-only bounds (p_ano_inicio, p_ano_fim) in the 7 active RPCs
-- below with 4-int monthly bounds (p_ano_inicio, p_mes_inicio, p_ano_fim,
-- p_mes_fim). Server-side gating uses the lexicographic compare:
--
--   WHERE (ano > p_ano_inicio OR (ano = p_ano_inicio AND mes >= p_mes_inicio))
--     AND (ano < p_ano_fim    OR (ano = p_ano_fim    AND mes <= p_mes_fim))
--
-- which preserves the existing (ano, mes) index usage and supports single-month
-- views (set both bounds to the same year/month).
--
-- get_imports_exports_filtros() now also returns mes_min / mes_max — the
-- earliest month at the minimum year, and the latest month at the maximum year.
-- The frontend derives the month-array client-side.
--
-- Payload columns (ano int + mes int) are preserved — frontend builds Date
-- on the client.
--
-- The 2 YoY RPCs are NOT touched here — they already take (p_ano_fim, p_mes_fim).
--
-- ── Pegadinha #18 mitigation ─────────────────────────────────────────────────
-- DROP FUNCTION + CREATE FUNCTION loses SECURITY DEFINER, search_path, AND
-- grants. Each new function below is followed by:
--   ALTER FUNCTION ... SECURITY DEFINER;
--   ALTER FUNCTION ... SET search_path = public, pg_temp;
--   GRANT EXECUTE ... TO anon, authenticated;
--
-- ── Pegadinha #19 mitigation ─────────────────────────────────────────────────
-- Filename slot chosen: 20260526800000 (after the latest 20260526700000
-- subsidy_tracker_dual_agent migration). git ls-files supabase/migrations/
-- shows no other 20260526T0800* in either main or this worktree.
--
-- Owner: worker_supabase
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Drop existing signatures explicitly (Pegadinha #18: clean slate).
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_imports_exports_filtros();
DROP FUNCTION IF EXISTS public.get_imports_exports_paises_stacked(text, int, int, int);
DROP FUNCTION IF EXISTS public.get_imports_exports_importers_stacked(text, int, int, int);
DROP FUNCTION IF EXISTS public.get_imports_exports_exports_paises_stacked(text, int, int, text, int);
DROP FUNCTION IF EXISTS public.get_imports_exports_fob_price_serie(text, int, int);
DROP FUNCTION IF EXISTS public.get_imports_exports_imports_unit_price(text, int, int, int);
DROP FUNCTION IF EXISTS public.get_imports_exports_exports_unit_price(text, int, int, int);


-- -----------------------------------------------------------------------------
-- 2. get_imports_exports_filtros — extended with mes_min / mes_max
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_imports_exports_filtros()
RETURNS TABLE (
  ano_min  int,
  mes_min  int,
  ano_max  int,
  mes_max  int,
  produtos text[]
)
LANGUAGE sql
STABLE
AS $$
  WITH union_src AS (
    SELECT ano::int AS ano, mes::int AS mes FROM public.anp_desembaracos
    UNION ALL
    SELECT ano::int AS ano, mes::int AS mes FROM public.anp_daie
    UNION ALL
    SELECT ano::int AS ano, mes::int AS mes FROM public.mdic_comex
  ),
  bounds AS (
    SELECT
      MIN(ano)::int AS ano_min,
      MAX(ano)::int AS ano_max
    FROM union_src
  )
  SELECT
    b.ano_min,
    (SELECT MIN(u.mes)::int FROM union_src u WHERE u.ano = b.ano_min) AS mes_min,
    b.ano_max,
    (SELECT MAX(u.mes)::int FROM union_src u WHERE u.ano = b.ano_max) AS mes_max,
    ARRAY['Diesel','Gasoline','Crude Oil']::text[] AS produtos
  FROM bounds b;
$$;

ALTER FUNCTION public.get_imports_exports_filtros() SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_filtros() SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.get_imports_exports_filtros() TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3. get_imports_exports_paises_stacked — monthly bounds
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_imports_exports_paises_stacked(
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
      d.ano::int       AS ano,
      d.mes::int       AS mes,
      d.pais_origem    AS pais_origem,
      d.quantidade_kg  AS quantidade_kg
    FROM public.anp_desembaracos d
    JOIN public.imports_product_map pm
      ON pm.source = 'desembaracos'
     AND pm.source_key = d.ncm_codigo
    WHERE pm.unified_product = p_unified_product
      AND (d.ano >  p_ano_inicio OR (d.ano = p_ano_inicio AND d.mes >= p_mes_inicio))
      AND (d.ano <  p_ano_fim    OR (d.ano = p_ano_fim    AND d.mes <= p_mes_fim))
  ),
  agg AS (
    SELECT ano, mes, pais_origem, SUM(quantidade_kg)::numeric AS total_kg
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
-- 4. get_imports_exports_importers_stacked — monthly bounds
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_imports_exports_importers_stacked(
  p_unified_product text,
  p_ano_inicio      int,
  p_mes_inicio      int,
  p_ano_fim         int,
  p_mes_fim         int,
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
      AND (d.ano >  p_ano_inicio OR (d.ano = p_ano_inicio AND d.mes >= p_mes_inicio))
      AND (d.ano <  p_ano_fim    OR (d.ano = p_ano_fim    AND d.mes <= p_mes_fim))
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

ALTER FUNCTION public.get_imports_exports_importers_stacked(text, int, int, int, int, int)
  SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_importers_stacked(text, int, int, int, int, int)
  SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.get_imports_exports_importers_stacked(text, int, int, int, int, int)
  TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 5. get_imports_exports_exports_paises_stacked — monthly bounds
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_imports_exports_exports_paises_stacked(
  p_unified_product text,
  p_ano_inicio      int,
  p_mes_inicio      int,
  p_ano_fim         int,
  p_mes_fim         int,
  p_metric          text DEFAULT 'volume',  -- 'volume' | 'usd'
  p_top_n           int  DEFAULT 10
)
RETURNS TABLE (ano int, mes int, pais text, value numeric)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF p_metric NOT IN ('volume', 'usd') THEN
    RAISE EXCEPTION 'p_metric must be ''volume'' or ''usd''';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT mc.ano::int AS b_ano,
           mc.mes::int AS b_mes,
           mc.pais     AS b_pais,
           CASE WHEN p_metric = 'volume'
                THEN mc.volume_kg / d.densidade_kg_m3 / 1000.0
                ELSE mc.valor_fob_usd
           END AS v
    FROM public.mdic_comex mc
    JOIN public.imports_product_map ipm
      ON ipm.source = 'mdic'
     AND ipm.source_key = mc.ncm_codigo
     AND ipm.unified_product = p_unified_product
    JOIN public.ncm_densidade_kg_m3 d
      ON d.ncm_codigo = mc.ncm_codigo
    WHERE mc.flow = 'export'
      AND (mc.ano >  p_ano_inicio OR (mc.ano = p_ano_inicio AND mc.mes >= p_mes_inicio))
      AND (mc.ano <  p_ano_fim    OR (mc.ano = p_ano_fim    AND mc.mes <= p_mes_fim))
  ),
  ranked AS (
    SELECT base.b_pais AS r_pais, SUM(base.v) AS total_v
    FROM base
    GROUP BY base.b_pais
    ORDER BY total_v DESC NULLS LAST
    LIMIT p_top_n
  ),
  labeled AS (
    SELECT base.b_ano AS l_ano,
           base.b_mes AS l_mes,
           CASE WHEN base.b_pais IN (SELECT ranked.r_pais FROM ranked)
                THEN base.b_pais ELSE 'Others' END AS l_pais,
           base.v AS l_v
    FROM base
  )
  SELECT labeled.l_ano,
         labeled.l_mes,
         labeled.l_pais,
         SUM(labeled.l_v)::numeric
  FROM labeled
  GROUP BY labeled.l_ano, labeled.l_mes, labeled.l_pais
  ORDER BY labeled.l_ano, labeled.l_mes, labeled.l_pais;
END;
$$;

ALTER FUNCTION public.get_imports_exports_exports_paises_stacked(text, int, int, int, int, text, int)
  SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_exports_paises_stacked(text, int, int, int, int, text, int)
  SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.get_imports_exports_exports_paises_stacked(text, int, int, int, int, text, int)
  TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 6. get_imports_exports_fob_price_serie — monthly bounds
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_imports_exports_fob_price_serie(
  p_unified_product text,
  p_ano_inicio      int,
  p_mes_inicio      int,
  p_ano_fim         int,
  p_mes_fim         int
)
RETURNS TABLE (
  ano              int,
  mes              int,
  total_volume_kg  numeric,
  total_volume_m3  numeric,
  total_fob_usd    numeric,
  fob_per_ton      numeric,
  fob_per_m3       numeric,
  fob_per_bbl      numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH src AS (
    SELECT
      m.ano::int                                          AS ano,
      m.mes::int                                          AS mes,
      SUM(m.volume_kg)::numeric                           AS total_volume_kg,
      SUM(m.volume_kg / d.densidade_kg_m3)::numeric       AS total_volume_m3,
      SUM(m.valor_fob_usd)::numeric                       AS total_fob_usd
    FROM public.mdic_comex m
    JOIN public.imports_product_map p
      ON p.source = 'mdic' AND p.source_key = m.ncm_codigo
    JOIN public.ncm_densidade_kg_m3 d
      ON d.ncm_codigo = m.ncm_codigo
    WHERE m.flow = 'import'
      AND p.unified_product = p_unified_product
      AND (m.ano >  p_ano_inicio OR (m.ano = p_ano_inicio AND m.mes >= p_mes_inicio))
      AND (m.ano <  p_ano_fim    OR (m.ano = p_ano_fim    AND m.mes <= p_mes_fim))
      AND m.volume_kg     IS NOT NULL
      AND m.valor_fob_usd IS NOT NULL
    GROUP BY m.ano, m.mes
  )
  SELECT
    ano,
    mes,
    total_volume_kg,
    total_volume_m3,
    total_fob_usd,
    -- Guard against zero/negative denominators; NULL on miss is preferable
    -- to a division-by-zero error or a misleading huge number.
    CASE WHEN total_volume_kg > 0
      THEN total_fob_usd / (total_volume_kg / 1000.0)
      ELSE NULL END                                       AS fob_per_ton,
    CASE WHEN total_volume_m3 > 0
      THEN total_fob_usd / total_volume_m3
      ELSE NULL END                                       AS fob_per_m3,
    CASE WHEN total_volume_m3 > 0
      THEN total_fob_usd / (total_volume_m3 * 6.28981)
      ELSE NULL END                                       AS fob_per_bbl
  FROM src
  ORDER BY ano, mes;
$$;

ALTER FUNCTION public.get_imports_exports_fob_price_serie(text, int, int, int, int)
  SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_fob_price_serie(text, int, int, int, int)
  SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.get_imports_exports_fob_price_serie(text, int, int, int, int)
  TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 7. get_imports_exports_imports_unit_price — monthly bounds
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_imports_exports_imports_unit_price(
  p_unified_product text,
  p_ano_inicio      int,
  p_mes_inicio      int,
  p_ano_fim         int,
  p_mes_fim         int,
  p_top_n           int  DEFAULT 8
)
RETURNS TABLE (ano int, mes int, pais text, usd_per_m3 numeric)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      mc.ano::int          AS b_ano,
      mc.mes::int          AS b_mes,
      mc.pais              AS b_pais,
      mc.volume_kg         AS b_kg,
      mc.valor_fob_usd     AS b_usd,
      d.densidade_kg_m3    AS b_den
    FROM public.mdic_comex mc
    JOIN public.imports_product_map ipm
      ON ipm.source = 'mdic'
     AND ipm.source_key = mc.ncm_codigo
     AND ipm.unified_product = p_unified_product
    JOIN public.ncm_densidade_kg_m3 d
      ON d.ncm_codigo = mc.ncm_codigo
    WHERE mc.flow = 'import'
      AND (mc.ano >  p_ano_inicio OR (mc.ano = p_ano_inicio AND mc.mes >= p_mes_inicio))
      AND (mc.ano <  p_ano_fim    OR (mc.ano = p_ano_fim    AND mc.mes <= p_mes_fim))
      AND mc.volume_kg     IS NOT NULL
      AND mc.valor_fob_usd IS NOT NULL
      AND mc.volume_kg > 0
  ),
  -- Rank countries by total volume in the period, keep top-N
  ranked AS (
    SELECT b_pais AS r_pais,
           SUM(b_kg / b_den) AS total_m3
    FROM base
    GROUP BY b_pais
    ORDER BY total_m3 DESC NULLS LAST
    LIMIT p_top_n
  ),
  -- Monthly aggregates per country (only top-N)
  monthly AS (
    SELECT b_ano, b_mes, b_pais,
           SUM(b_kg / b_den)  AS vol_m3,
           SUM(b_usd)         AS fob_usd
    FROM base
    WHERE b_pais IN (SELECT r_pais FROM ranked)
    GROUP BY b_ano, b_mes, b_pais
  )
  SELECT
    m.b_ano,
    m.b_mes,
    m.b_pais,
    CASE WHEN m.vol_m3 > 0 THEN m.fob_usd / m.vol_m3 ELSE NULL END :: numeric
  FROM monthly m
  ORDER BY m.b_ano, m.b_mes, m.b_pais;
END;
$$;

ALTER FUNCTION public.get_imports_exports_imports_unit_price(text, int, int, int, int, int)
  SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_imports_unit_price(text, int, int, int, int, int)
  SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.get_imports_exports_imports_unit_price(text, int, int, int, int, int)
  TO anon, authenticated;


-- -----------------------------------------------------------------------------
-- 8. get_imports_exports_exports_unit_price — monthly bounds
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_imports_exports_exports_unit_price(
  p_unified_product text,
  p_ano_inicio      int,
  p_mes_inicio      int,
  p_ano_fim         int,
  p_mes_fim         int,
  p_top_n           int  DEFAULT 8
)
RETURNS TABLE (ano int, mes int, pais text, usd_per_m3 numeric)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      mc.ano::int          AS b_ano,
      mc.mes::int          AS b_mes,
      mc.pais              AS b_pais,
      mc.volume_kg         AS b_kg,
      mc.valor_fob_usd     AS b_usd,
      d.densidade_kg_m3    AS b_den
    FROM public.mdic_comex mc
    JOIN public.imports_product_map ipm
      ON ipm.source = 'mdic'
     AND ipm.source_key = mc.ncm_codigo
     AND ipm.unified_product = p_unified_product
    JOIN public.ncm_densidade_kg_m3 d
      ON d.ncm_codigo = mc.ncm_codigo
    WHERE mc.flow = 'export'
      AND (mc.ano >  p_ano_inicio OR (mc.ano = p_ano_inicio AND mc.mes >= p_mes_inicio))
      AND (mc.ano <  p_ano_fim    OR (mc.ano = p_ano_fim    AND mc.mes <= p_mes_fim))
      AND mc.volume_kg     IS NOT NULL
      AND mc.valor_fob_usd IS NOT NULL
      AND mc.volume_kg > 0
  ),
  ranked AS (
    SELECT b_pais AS r_pais,
           SUM(b_kg / b_den) AS total_m3
    FROM base
    GROUP BY b_pais
    ORDER BY total_m3 DESC NULLS LAST
    LIMIT p_top_n
  ),
  monthly AS (
    SELECT b_ano, b_mes, b_pais,
           SUM(b_kg / b_den)  AS vol_m3,
           SUM(b_usd)         AS fob_usd
    FROM base
    WHERE b_pais IN (SELECT r_pais FROM ranked)
    GROUP BY b_ano, b_mes, b_pais
  )
  SELECT
    m.b_ano,
    m.b_mes,
    m.b_pais,
    CASE WHEN m.vol_m3 > 0 THEN m.fob_usd / m.vol_m3 ELSE NULL END :: numeric
  FROM monthly m
  ORDER BY m.b_ano, m.b_mes, m.b_pais;
END;
$$;

ALTER FUNCTION public.get_imports_exports_exports_unit_price(text, int, int, int, int, int)
  SECURITY DEFINER;
ALTER FUNCTION public.get_imports_exports_exports_unit_price(text, int, int, int, int, int)
  SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION public.get_imports_exports_exports_unit_price(text, int, int, int, int, int)
  TO anon, authenticated;


COMMIT;
