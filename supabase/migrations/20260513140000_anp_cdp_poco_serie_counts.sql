-- ANP CDP: extend get_anp_cdp_poco_serie to include monthly well/field counts
-- Used by the /anp-cdp dashboard to surface partial-month coverage in the chart
-- hover tooltip and as an annotation on the most recent data point.

DROP FUNCTION IF EXISTS get_anp_cdp_poco_serie CASCADE;

CREATE FUNCTION get_anp_cdp_poco_serie(
  p_pocos              text[]  DEFAULT NULL,
  p_campos             text[]  DEFAULT NULL,
  p_bacoes             text[]  DEFAULT NULL,
  p_locais             text[]  DEFAULT NULL,
  p_estados            text[]  DEFAULT NULL,
  p_operadores         text[]  DEFAULT NULL,
  p_instalacoes        text[]  DEFAULT NULL,
  p_tipos_instalacao   text[]  DEFAULT NULL,
  p_ano_inicio         integer DEFAULT NULL,
  p_ano_fim            integer DEFAULT NULL
)
RETURNS TABLE(
  ano                          integer,
  mes                          integer,
  petroleo_bbl_dia             float8,
  oleo_bbl_dia                 float8,
  condensado_bbl_dia           float8,
  gas_total_mm3_dia            float8,
  gas_natural_assoc_mm3_dia    float8,
  gas_natural_n_assoc_mm3_dia  float8,
  gas_royalties                float8,
  agua_bbl_dia                 float8,
  tempo_prod_hs_mes            float8,
  wells_count                  bigint,
  fields_count                 bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ano, mes,
    COALESCE(SUM(petroleo_bbl_dia),             0)::float8,
    COALESCE(SUM(oleo_bbl_dia),                 0)::float8,
    COALESCE(SUM(condensado_bbl_dia),           0)::float8,
    COALESCE(SUM(gas_total_mm3_dia),            0)::float8,
    COALESCE(SUM(gas_natural_assoc_mm3_dia),    0)::float8,
    COALESCE(SUM(gas_natural_n_assoc_mm3_dia),  0)::float8,
    COALESCE(SUM(gas_royalties),                0)::float8,
    COALESCE(SUM(agua_bbl_dia),                 0)::float8,
    COALESCE(SUM(tempo_prod_hs_mes),            0)::float8,
    COUNT(DISTINCT poco)::bigint                    AS wells_count,
    COUNT(DISTINCT campo)::bigint                   AS fields_count
  FROM anp_cdp_producao
  WHERE
    (p_pocos            IS NULL OR poco               = ANY(p_pocos))
    AND (p_campos       IS NULL OR campo              = ANY(p_campos))
    AND (p_bacoes       IS NULL OR bacia              = ANY(p_bacoes))
    AND (p_locais       IS NULL OR local              = ANY(p_locais))
    AND (p_estados      IS NULL OR estado             = ANY(p_estados))
    AND (p_operadores   IS NULL OR operador           = ANY(p_operadores))
    AND (p_instalacoes  IS NULL OR instalacao_destino  = ANY(p_instalacoes))
    AND (p_tipos_instalacao IS NULL OR tipo_instalacao = ANY(p_tipos_instalacao))
    AND (p_ano_inicio   IS NULL OR ano                >= p_ano_inicio)
    AND (p_ano_fim      IS NULL OR ano                <= p_ano_fim)
  GROUP BY ano, mes
  ORDER BY ano, mes;
$$;
