-- ANP CDP v7: materialized view for pocos + single-request JSON RPC

-- Drop lazy-only function from v6 (replaced by client-side filtering)
DROP FUNCTION IF EXISTS get_anp_cdp_pocos_by_filtros CASCADE;

-- Materialized view: pre-aggregated well metadata (~24K rows, refreshed after each upload)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_anp_cdp_pocos AS
  SELECT
    poco,
    campo,
    bacia,
    local,
    MAX(estado)    AS estado,
    MAX(operador)  AS operador,
    COALESCE(SUM(petroleo_bbl_dia), 0)::float8 AS petroleo_total
  FROM anp_cdp_producao
  GROUP BY poco, campo, bacia, local
  ORDER BY petroleo_total DESC NULLS LAST;

-- Unique index required for REFRESH CONCURRENTLY (non-blocking)
CREATE UNIQUE INDEX IF NOT EXISTS mv_anp_cdp_pocos_pk
  ON mv_anp_cdp_pocos (poco, campo, bacia, local);

CREATE INDEX IF NOT EXISTS mv_anp_cdp_pocos_campo_idx  ON mv_anp_cdp_pocos (campo);
CREATE INDEX IF NOT EXISTS mv_anp_cdp_pocos_bacia_idx  ON mv_anp_cdp_pocos (bacia);
CREATE INDEX IF NOT EXISTS mv_anp_cdp_pocos_estado_idx ON mv_anp_cdp_pocos (estado);

-- Single JSON request: returns all wells in one shot (bypasses PostgREST row limit)
CREATE OR REPLACE FUNCTION get_anp_cdp_pocos_json()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'poco',    poco,
        'campo',   campo,
        'bacia',   bacia,
        'local',   local,
        'estado',  estado,
        'operador', operador
      )
      ORDER BY petroleo_total DESC NULLS LAST
    ),
    '[]'::json
  )
  FROM mv_anp_cdp_pocos;
$$;

-- Non-blocking refresh called from upload script after each upsert
CREATE OR REPLACE FUNCTION refresh_anp_cdp_pocos()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_anp_cdp_pocos;
END;
$$;
