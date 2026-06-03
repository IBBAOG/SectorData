-- Exports — By Destination Country: report VOLUME in thousand tonnes (mil t)
-- using ComexStat net weight (volume_kg) directly, instead of thousand m3
-- (which divided kg by ANP density).
--
-- Scope: ONLY the two exports-by-country RPCs. The p_metric='usd' branch is
-- unchanged. The JOIN to ncm_densidade_kg_m3 is preserved (acts as an NCM
-- filter so the row set stays identical) even though volume no longer uses it.
--
-- volume conversion: kg -> t is /1000, t -> thousand t is /1000  =>  kg / 1e6.
-- CREATE OR REPLACE preserves SECURITY DEFINER, search_path and grants (Pegadinha #18).

CREATE OR REPLACE FUNCTION public.get_imports_exports_exports_paises_stacked(p_unified_product text, p_ano_inicio integer, p_mes_inicio integer, p_ano_fim integer, p_mes_fim integer, p_metric text DEFAULT 'volume'::text, p_top_n integer DEFAULT 10)
 RETURNS TABLE(ano integer, mes integer, pais text, value numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                THEN mc.volume_kg / 1000000.0   -- thousand tonnes (kg -> t /1000, t -> thousand t /1000)
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
$function$;

CREATE OR REPLACE FUNCTION public.get_imports_exports_exports_yoy_table(p_unified_product text, p_ano_fim integer, p_mes_fim integer, p_metric text DEFAULT 'volume'::text, p_top_n integer DEFAULT 10)
 RETURNS TABLE(entity text, last_12m numeric, prev_12m numeric, yoy_pct numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                THEN mc.volume_kg / 1000000.0   -- thousand tonnes (kg -> t /1000, t -> thousand t /1000)
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
$function$;

GRANT EXECUTE ON FUNCTION public.get_imports_exports_exports_paises_stacked(text, integer, integer, integer, integer, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_imports_exports_exports_yoy_table(text, integer, integer, text, integer) TO anon, authenticated;
