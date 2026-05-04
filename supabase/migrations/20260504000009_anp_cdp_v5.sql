-- ANP CDP v5: expose all parquet columns (estado, operador, oleo, condensado, gas breakdown, royalties, tipo_instalacao, tempo_prod)

ALTER TABLE anp_cdp_producao
  ADD COLUMN IF NOT EXISTS estado                      text,
  ADD COLUMN IF NOT EXISTS nome_poco_operador          text,
  ADD COLUMN IF NOT EXISTS operador                    text,
  ADD COLUMN IF NOT EXISTS num_contrato                text,
  ADD COLUMN IF NOT EXISTS oleo_bbl_dia                float4,
  ADD COLUMN IF NOT EXISTS condensado_bbl_dia          float4,
  ADD COLUMN IF NOT EXISTS gas_natural_assoc_mm3_dia   float4,
  ADD COLUMN IF NOT EXISTS gas_natural_n_assoc_mm3_dia float4,
  ADD COLUMN IF NOT EXISTS gas_royalties               float4,
  ADD COLUMN IF NOT EXISTS tipo_instalacao             text,
  ADD COLUMN IF NOT EXISTS tempo_prod_hs_mes           float4;

CREATE INDEX IF NOT EXISTS anp_cdp_v5_operador_idx ON anp_cdp_producao (operador);
CREATE INDEX IF NOT EXISTS anp_cdp_v5_estado_idx   ON anp_cdp_producao (estado);

-- ── Serie RPC: all metrics + new filter params ──────────────────────────────
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
  tempo_prod_hs_mes            float8
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
    COALESCE(SUM(tempo_prod_hs_mes),            0)::float8
  FROM anp_cdp_producao
  WHERE
    (p_pocos            IS NULL OR poco              = ANY(p_pocos))
    AND (p_campos       IS NULL OR campo             = ANY(p_campos))
    AND (p_bacoes       IS NULL OR bacia             = ANY(p_bacoes))
    AND (p_locais       IS NULL OR local             = ANY(p_locais))
    AND (p_estados      IS NULL OR estado            = ANY(p_estados))
    AND (p_operadores   IS NULL OR operador          = ANY(p_operadores))
    AND (p_instalacoes  IS NULL OR instalacao_destino = ANY(p_instalacoes))
    AND (p_tipos_instalacao IS NULL OR tipo_instalacao = ANY(p_tipos_instalacao))
    AND (p_ano_inicio   IS NULL OR ano               >= p_ano_inicio)
    AND (p_ano_fim      IS NULL OR ano               <= p_ano_fim)
  GROUP BY ano, mes
  ORDER BY ano, mes;
$$;

-- ── Pocos list: all metadata ─────────────────────────────────────────────────
DROP FUNCTION IF EXISTS get_anp_cdp_pocos_list CASCADE;
CREATE FUNCTION get_anp_cdp_pocos_list()
RETURNS TABLE(
  poco                text,
  campo               text,
  bacia               text,
  local               text,
  estado              text,
  operador            text,
  nome_poco_operador  text,
  num_contrato        text,
  instalacao_destino  text,
  tipo_instalacao     text,
  petroleo_total      float8
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    poco, campo, bacia, local,
    MAX(estado)             AS estado,
    MAX(operador)           AS operador,
    MAX(nome_poco_operador) AS nome_poco_operador,
    MAX(num_contrato)       AS num_contrato,
    MAX(instalacao_destino) AS instalacao_destino,
    MAX(tipo_instalacao)    AS tipo_instalacao,
    COALESCE(SUM(petroleo_bbl_dia), 0)::float8 AS petroleo_total
  FROM anp_cdp_producao
  GROUP BY poco, campo, bacia, local
  ORDER BY petroleo_total DESC NULLS LAST;
$$;

-- ── Filtros: all dimension options ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_anp_cdp_filtros()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'bacoes',           (SELECT array_agg(DISTINCT bacia    ORDER BY bacia)    FROM anp_cdp_producao),
    'campos',           (SELECT array_agg(DISTINCT campo    ORDER BY campo)    FROM anp_cdp_producao),
    'locais',           (SELECT array_agg(DISTINCT local    ORDER BY local)    FROM anp_cdp_producao),
    'estados',          (SELECT array_agg(DISTINCT estado   ORDER BY estado)   FROM anp_cdp_producao WHERE estado            IS NOT NULL),
    'operadores',       (SELECT array_agg(DISTINCT operador ORDER BY operador) FROM anp_cdp_producao WHERE operador           IS NOT NULL),
    'instalacoes',      (SELECT array_agg(DISTINCT instalacao_destino ORDER BY instalacao_destino) FROM anp_cdp_producao WHERE instalacao_destino IS NOT NULL),
    'tipos_instalacao', (SELECT array_agg(DISTINCT tipo_instalacao ORDER BY tipo_instalacao)       FROM anp_cdp_producao WHERE tipo_instalacao    IS NOT NULL),
    'ano_min',          (SELECT MIN(ano) FROM anp_cdp_producao),
    'ano_max',          (SELECT MAX(ano) FROM anp_cdp_producao)
  );
$$;
