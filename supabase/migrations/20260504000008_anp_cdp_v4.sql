-- ANP CDP v4: add instalacao_destino + agua_bbl_dia; recreate all RPCs (idempotent fix)

ALTER TABLE anp_cdp_producao
  ADD COLUMN IF NOT EXISTS instalacao_destino text,
  ADD COLUMN IF NOT EXISTS agua_bbl_dia float4;

CREATE INDEX IF NOT EXISTS anp_cdp_v4_instalacao_idx ON anp_cdp_producao (instalacao_destino);

-- Serie RPC: new params (p_instalacoes) + agua in output
DROP FUNCTION IF EXISTS get_anp_cdp_poco_serie CASCADE;
CREATE FUNCTION get_anp_cdp_poco_serie(
  p_pocos          text[]  DEFAULT NULL,
  p_campos         text[]  DEFAULT NULL,
  p_bacoes         text[]  DEFAULT NULL,
  p_locais         text[]  DEFAULT NULL,
  p_instalacoes    text[]  DEFAULT NULL,
  p_ano_inicio     integer DEFAULT NULL,
  p_ano_fim        integer DEFAULT NULL
)
RETURNS TABLE(
  ano               integer,
  mes               integer,
  petroleo_bbl_dia  float8,
  gas_total_mm3_dia float8,
  agua_bbl_dia      float8
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ano, mes,
    COALESCE(SUM(petroleo_bbl_dia),  0)::float8,
    COALESCE(SUM(gas_total_mm3_dia), 0)::float8,
    COALESCE(SUM(agua_bbl_dia),      0)::float8
  FROM anp_cdp_producao
  WHERE
    (p_pocos       IS NULL OR poco               = ANY(p_pocos))
    AND (p_campos  IS NULL OR campo              = ANY(p_campos))
    AND (p_bacoes  IS NULL OR bacia              = ANY(p_bacoes))
    AND (p_locais  IS NULL OR local              = ANY(p_locais))
    AND (p_instalacoes IS NULL OR instalacao_destino = ANY(p_instalacoes))
    AND (p_ano_inicio  IS NULL OR ano            >= p_ano_inicio)
    AND (p_ano_fim     IS NULL OR ano            <= p_ano_fim)
  GROUP BY ano, mes
  ORDER BY ano, mes;
$$;

-- Pocos list: include instalacao_destino
DROP FUNCTION IF EXISTS get_anp_cdp_pocos_list CASCADE;
CREATE FUNCTION get_anp_cdp_pocos_list()
RETURNS TABLE(
  poco                text,
  campo               text,
  bacia               text,
  local               text,
  instalacao_destino  text,
  petroleo_total      float8
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    poco, campo, bacia, local,
    MAX(instalacao_destino)                    AS instalacao_destino,
    COALESCE(SUM(petroleo_bbl_dia), 0)::float8 AS petroleo_total
  FROM anp_cdp_producao
  GROUP BY poco, campo, bacia, local
  ORDER BY petroleo_total DESC NULLS LAST;
$$;

-- Filtros: add campos + instalacoes
CREATE OR REPLACE FUNCTION get_anp_cdp_filtros()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'bacoes',      (SELECT array_agg(DISTINCT bacia ORDER BY bacia)
                    FROM anp_cdp_producao),
    'campos',      (SELECT array_agg(DISTINCT campo ORDER BY campo)
                    FROM anp_cdp_producao),
    'locais',      (SELECT array_agg(DISTINCT local ORDER BY local)
                    FROM anp_cdp_producao),
    'instalacoes', (SELECT array_agg(DISTINCT instalacao_destino ORDER BY instalacao_destino)
                    FROM anp_cdp_producao
                    WHERE instalacao_destino IS NOT NULL),
    'ano_min',     (SELECT MIN(ano) FROM anp_cdp_producao),
    'ano_max',     (SELECT MAX(ano) FROM anp_cdp_producao)
  );
$$;
