-- ============================================================================
-- Sales Volumes RPCs
-- Analogous to the Market Share get_ms_* functions, but return raw absolute
-- volume (SUM of quantidade_produto in mil m³) instead of percentages.
-- Percentage calculation for Market Share happens client-side; these RPCs
-- simply expose the same aggregated quantities under the get_sv_* namespace
-- so that the Sales Volumes module has its own independent RPC surface.
-- ============================================================================

-- Function: get_sv_opcoes_filtros
CREATE OR REPLACE FUNCTION public.get_sv_opcoes_filtros()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT json_build_object(
    'datas',   (SELECT json_agg(d ORDER BY d)
                FROM (SELECT DISTINCT date AS d FROM mv_ms_serie) t),
    'regioes', (SELECT json_agg(DISTINCT regiao_destinatario ORDER BY regiao_destinatario)
                FROM vendas WHERE regiao_destinatario IS NOT NULL),
    'ufs',     (SELECT json_agg(DISTINCT uf_destino ORDER BY uf_destino)
                FROM vendas WHERE uf_destino IS NOT NULL),
    'mercados',(SELECT json_agg(DISTINCT mercado_destinatario ORDER BY mercado_destinatario)
                FROM vendas WHERE mercado_destinatario IS NOT NULL)
  );
$function$;

-- Function: get_sv_serie_fast
-- Returns volume aggregated by classificacao (pre-aggregated, fast path).
-- Identical data shape to get_ms_serie_fast — client uses it directly for
-- Individual and Big-3 view modes.
CREATE OR REPLACE FUNCTION public.get_sv_serie_fast(
  p_data_inicio text DEFAULT NULL::text,
  p_data_fim    text DEFAULT NULL::text,
  p_regioes     text[] DEFAULT NULL::text[],
  p_ufs         text[] DEFAULT NULL::text[],
  p_mercados    text[] DEFAULT NULL::text[]
)
 RETURNS TABLE(
   date         text,
   nome_produto text,
   segmento     text,
   classificacao text,
   quantidade   double precision
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF p_regioes IS NULL AND p_ufs IS NULL AND p_mercados IS NULL THEN
    RETURN QUERY
    SELECT m.date, m.nome_produto, m.segmento, m.classificacao,
           SUM(m.quantidade) AS quantidade
    FROM mv_ms_serie m
    WHERE (p_data_inicio IS NULL OR m.date >= p_data_inicio)
      AND (p_data_fim    IS NULL OR m.date <= p_data_fim)
    GROUP BY m.date, m.nome_produto, m.segmento, m.classificacao;
  ELSE
    RETURN QUERY
    SELECT
      to_char(date_trunc('month', v.date), 'YYYY-MM-DD') AS date,
      v.nome_produto,
      CASE WHEN v.segmento = 'Outros' THEN 'Retail' ELSE v.segmento END,
      v.classificacao,
      SUM(v.quantidade_produto)
    FROM vendas v
    WHERE (p_data_inicio IS NULL OR v.date >= p_data_inicio::date)
      AND (p_data_fim    IS NULL OR v.date <= p_data_fim::date)
      AND (p_regioes  IS NULL OR v.regiao_destinatario = ANY(p_regioes))
      AND (p_ufs      IS NULL OR v.uf_destino          = ANY(p_ufs))
      AND (p_mercados IS NULL OR v.mercado_destinatario = ANY(p_mercados))
    GROUP BY date_trunc('month', v.date), v.nome_produto, v.segmento,
             v.classificacao;
  END IF;
END;
$function$;

-- Function: get_sv_serie_others
-- Returns volume for non-Big3 agents (Others drilldown) broken down by
-- agente_regulado. Used in Others view mode.
CREATE OR REPLACE FUNCTION public.get_sv_serie_others(
  p_data_inicio text DEFAULT NULL::text,
  p_data_fim    text DEFAULT NULL::text,
  p_regioes     text[] DEFAULT NULL::text[],
  p_ufs         text[] DEFAULT NULL::text[],
  p_mercados    text[] DEFAULT NULL::text[]
)
 RETURNS TABLE(
   date           text,
   nome_produto   text,
   segmento       text,
   classificacao  text,
   agente_regulado text,
   quantidade     double precision
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF p_regioes IS NULL AND p_ufs IS NULL AND p_mercados IS NULL THEN
    RETURN QUERY
    SELECT m.date, m.nome_produto, m.segmento, m.classificacao,
           m.agente_regulado, m.quantidade
    FROM mv_ms_serie m
    WHERE (p_data_inicio IS NULL OR m.date >= p_data_inicio)
      AND (p_data_fim    IS NULL OR m.date <= p_data_fim)
      AND m.classificacao NOT IN ('Vibra', 'Ipiranga', 'Raizen');
  ELSE
    RETURN QUERY
    SELECT
      to_char(date_trunc('month', v.date), 'YYYY-MM-DD') AS date,
      v.nome_produto,
      CASE WHEN v.segmento = 'Outros' THEN 'Retail' ELSE v.segmento END,
      v.classificacao,
      v.agente_regulado,
      SUM(v.quantidade_produto)
    FROM vendas v
    WHERE (p_data_inicio IS NULL OR v.date >= p_data_inicio::date)
      AND (p_data_fim    IS NULL OR v.date <= p_data_fim::date)
      AND (p_regioes  IS NULL OR v.regiao_destinatario = ANY(p_regioes))
      AND (p_ufs      IS NULL OR v.uf_destino          = ANY(p_ufs))
      AND (p_mercados IS NULL OR v.mercado_destinatario = ANY(p_mercados))
      AND v.classificacao NOT IN ('Vibra', 'Ipiranga', 'Raizen')
    GROUP BY date_trunc('month', v.date), v.nome_produto, v.segmento,
             v.classificacao, v.agente_regulado;
  END IF;
END;
$function$;

-- Function: get_sv_others_players
-- Returns distinct agente_regulado names for non-Big3 agents.
-- Used to populate the Others competitor dropdown (~50 rows, lightweight).
CREATE OR REPLACE FUNCTION public.get_sv_others_players()
 RETURNS TABLE(agente_regulado text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
AS $function$
  SELECT DISTINCT agente_regulado
  FROM mv_ms_serie
  WHERE classificacao NOT IN ('Vibra', 'Ipiranga', 'Raizen')
    AND agente_regulado IS NOT NULL
  ORDER BY agente_regulado;
$function$;
