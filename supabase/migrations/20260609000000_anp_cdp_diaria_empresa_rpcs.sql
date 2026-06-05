-- Daily net-production-by-company RPCs for /anp-cdp-diaria (Daily Production).
--
-- Mirrors the monthly stake-weighted attribution that /well-by-well does via
-- get_production_company_aggregate, but at the daily grain over anp_cdp_diaria.
--
-- Net production = field gross production * stake_pct / 100. There is no
-- gross/net toggle in the UI; the gross value and stake_pct are still returned
-- on each row for labels/tooltips.
--
-- Join key: field_stakes.campo = anp_cdp_diaria.campo (exact name match).
-- Some stake fields have no daily rows (e.g. PRIO's WAHOO flows through the
-- FPSO FRADE and only shows up in anp_cdp_diaria_instalacao). Those fields are
-- surfaced by get_anp_cdp_diaria_empresa_campos with has_daily_data = false and
-- are never counted as phantom production by the series RPC (INNER JOIN drops
-- them).
--
-- Pegadinha #18: anp_cdp_diaria has RLS that grants SELECT only to
-- `authenticated`. Any public RPC reading it MUST be SECURITY DEFINER +
-- search_path, otherwise an anon caller silently gets []. field_stakes is
-- anon-readable, but the join still breaks without SECURITY DEFINER.
--
-- External-contract column names (campo, empresa, bacia, petroleo_bbl_dia,
-- gas_mm3_dia) are preserved in Portuguese.

-- 1) Eligible companies for the selector: only companies with >= 1 stake field
--    that actually exists in the daily table. PRIO/Petrobras highlighting is
--    done in the frontend.
CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_empresas()
RETURNS TABLE (
  empresa            text,
  n_campos_com_dado  integer,  -- stake fields present in anp_cdp_diaria
  n_campos_stake     integer   -- total stake fields for the company
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    fs.empresa,
    COUNT(*) FILTER (
      WHERE EXISTS (SELECT 1 FROM anp_cdp_diaria d WHERE d.campo = fs.campo)
    )::int AS n_campos_com_dado,
    COUNT(*)::int AS n_campos_stake
  FROM field_stakes fs
  GROUP BY fs.empresa
  HAVING COUNT(*) FILTER (
    WHERE EXISTS (SELECT 1 FROM anp_cdp_diaria d WHERE d.campo = fs.campo)
  ) > 0
  ORDER BY n_campos_com_dado DESC, fs.empresa;
$$;

-- 2) Daily net series per field for a company. One row per (data, campo).
--    INNER JOIN drops stake fields that have no daily rows. Gross values and
--    stake_pct are returned alongside the net values for labels/tooltips.
CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_empresa_serie(
  p_empresa      text,
  p_data_inicio  date DEFAULT NULL,
  p_data_fim     date DEFAULT NULL
)
RETURNS TABLE (
  data                  date,
  campo                 text,
  bacia                 text,
  stake_pct             numeric,
  petroleo_bbl_dia      real,     -- field gross oil
  gas_mm3_dia           real,     -- field gross gas
  petroleo_bbl_dia_net  numeric,  -- gross oil * stake_pct / 100
  gas_mm3_dia_net       numeric   -- gross gas * stake_pct / 100
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    d.data,
    d.campo,
    d.bacia,
    fs.stake_pct,
    d.petroleo_bbl_dia,
    d.gas_mm3_dia,
    (d.petroleo_bbl_dia::numeric * fs.stake_pct / 100) AS petroleo_bbl_dia_net,
    (d.gas_mm3_dia::numeric      * fs.stake_pct / 100) AS gas_mm3_dia_net
  FROM field_stakes fs
  JOIN anp_cdp_diaria d ON d.campo = fs.campo
  WHERE fs.empresa = p_empresa
    AND (p_data_inicio IS NULL OR d.data >= p_data_inicio)
    AND (p_data_fim    IS NULL OR d.data <= p_data_fim)
  ORDER BY d.data, d.campo;
$$;

-- 3) All stake fields for a company with a daily-coverage flag, so the UI can
--    render e.g. "Wahoo (100%) - no daily data yet".
CREATE OR REPLACE FUNCTION public.get_anp_cdp_diaria_empresa_campos(
  p_empresa text
)
RETURNS TABLE (
  campo            text,
  stake_pct        numeric,
  has_daily_data   boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    fs.campo,
    fs.stake_pct,
    EXISTS (SELECT 1 FROM anp_cdp_diaria d WHERE d.campo = fs.campo) AS has_daily_data
  FROM field_stakes fs
  WHERE fs.empresa = p_empresa
  ORDER BY has_daily_data DESC, fs.stake_pct DESC, fs.campo;
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_empresas()                          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_empresa_serie(text, date, date)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_empresa_campos(text)                TO anon, authenticated;
