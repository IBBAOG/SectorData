-- ANP CDP v6: performance — composite index + lazy-load pocos by filter

-- Index for the GROUP BY in pocos queries
CREATE INDEX IF NOT EXISTS anp_cdp_v6_poco_grupo_idx
  ON anp_cdp_producao (poco, campo, bacia, local);

-- Drop heavy full-scan pocos_list (replaced by filtered version)
DROP FUNCTION IF EXISTS get_anp_cdp_pocos_list CASCADE;

-- Pocos filtered by active dimensions (called only after user selects campos/bacias/locais)
-- Returns at most the wells matching the active filters, fast because it hits the index.
CREATE FUNCTION get_anp_cdp_pocos_by_filtros(
  p_campos     text[] DEFAULT NULL,
  p_bacoes     text[] DEFAULT NULL,
  p_locais     text[] DEFAULT NULL,
  p_estados    text[] DEFAULT NULL,
  p_operadores text[] DEFAULT NULL
)
RETURNS TABLE(
  poco          text,
  campo         text,
  bacia         text,
  local         text,
  petroleo_total float8
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT poco, campo, bacia, local,
    COALESCE(SUM(petroleo_bbl_dia), 0)::float8 AS petroleo_total
  FROM anp_cdp_producao
  WHERE
    (p_campos    IS NULL OR campo  = ANY(p_campos))
    AND (p_bacoes IS NULL OR bacia = ANY(p_bacoes))
    AND (p_locais IS NULL OR local = ANY(p_locais))
    AND (p_estados IS NULL OR estado = ANY(p_estados))
    AND (p_operadores IS NULL OR operador = ANY(p_operadores))
  GROUP BY poco, campo, bacia, local
  ORDER BY petroleo_total DESC NULLS LAST;
$$;
