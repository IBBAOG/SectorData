-- 0) Drop the legacy single-series RPC (Exports tab no longer renders a line)
DROP FUNCTION IF EXISTS public.get_imports_exports_exports_serie(text[], int, int);

-- 1) Stacked monthly series by destination country (top-N + Others), from mdic_comex flow='export'
CREATE OR REPLACE FUNCTION public.get_imports_exports_exports_paises_stacked(
  p_unified_product text,
  p_ano_inicio      int,
  p_ano_fim         int,
  p_metric          text DEFAULT 'volume',  -- 'volume' | 'usd'
  p_top_n           int  DEFAULT 10
)
RETURNS TABLE (ano int, mes int, pais text, value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_metric NOT IN ('volume', 'usd') THEN
    RAISE EXCEPTION 'p_metric must be ''volume'' or ''usd''';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT mc.ano::int AS b_ano,
           mc.mes::int AS b_mes,
           mc.pais AS b_pais,
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
      AND mc.ano BETWEEN p_ano_inicio AND p_ano_fim
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

-- 2) YoY table for the same scope (top-N + Others, rolling 12m vs prior 12m)
CREATE OR REPLACE FUNCTION public.get_imports_exports_exports_yoy_table(
  p_unified_product text,
  p_ano_fim         int,
  p_mes_fim         int,
  p_metric          text DEFAULT 'volume',
  p_top_n           int  DEFAULT 10
)
RETURNS TABLE (entity text, last_12m numeric, prev_12m numeric, yoy_pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_end  date := make_date(p_ano_fim, p_mes_fim, 1);
  v_last date := v_end - INTERVAL '12 months';
  v_prev date := v_end - INTERVAL '24 months';
BEGIN
  IF p_metric NOT IN ('volume', 'usd') THEN
    RAISE EXCEPTION 'p_metric must be ''volume'' or ''usd''';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT mc.pais AS b_pais,
           make_date(mc.ano, mc.mes, 1) AS b_dt,
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
      AND make_date(mc.ano, mc.mes, 1) >  v_prev
      AND make_date(mc.ano, mc.mes, 1) <= v_end
  ),
  agg AS (
    SELECT base.b_pais AS a_pais,
           SUM(CASE WHEN base.b_dt >  v_last THEN base.b_v ELSE 0 END) AS a_last_12m,
           SUM(CASE WHEN base.b_dt <= v_last THEN base.b_v ELSE 0 END) AS a_prev_12m
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

GRANT EXECUTE ON FUNCTION public.get_imports_exports_exports_paises_stacked(text, int, int, text, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_imports_exports_exports_yoy_table(text, int, int, text, int) TO anon, authenticated;
