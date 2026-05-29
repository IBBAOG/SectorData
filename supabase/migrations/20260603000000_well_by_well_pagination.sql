-- =============================================================================
-- 20260603000000_well_by_well_pagination.sql
--
-- P0 PROD FIX: /well-by-well export was truncated to ~1000 rows because
-- PostgREST applies a default `max-rows` cap when invoking SETOF RPCs over
-- REST. The Brazil sheet came out empty for the same reason combined with
-- a likely client-side fallback. Server-side the functions work (verified
-- via execute_sql: SELECT * FROM get_production_brazil_well_full_history()
-- LIMIT 5000 returns 5000 rows; anp_cdp_producao has ~2.2M rows total).
--
-- Fix: replace the two RPCs with paginated variants accepting
-- (p_offset bigint, p_limit bigint), and add two lightweight COUNT helpers
-- so the size estimator on the frontend doesn't have to drain the full set
-- just to count rows.
--
-- Pegadinha #18: every new RPC stays SECURITY DEFINER + search_path so anon
-- can read through RLS-scoped tables (anp_cdp_producao, field_stakes).
-- Pegadinha #19: slot 20260603000000 chosen (next free hourly slot past
-- 20260602300000_admin_analytics_views_by_hour_pegadinha18.sql).
--
-- Strategy: DROP + CREATE (not CREATE OR REPLACE) because the signature
-- changes (new bigint params). Frontend wrappers are being updated in
-- parallel by worker_dash-well-by-well to pass (offset, limit) explicitly.
--
-- Owner: worker_supabase
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Drop the legacy signatures so we can recreate them with new params.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_production_well_full_history(text);
DROP FUNCTION IF EXISTS public.get_production_brazil_well_full_history();


-- -----------------------------------------------------------------------------
-- 2. get_production_well_full_history(p_empresa, p_offset, p_limit)
--    Stake-weighted well-level history for one company, paginated.
--    Deterministic ORDER BY for stable pagination across calls.
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.get_production_well_full_history(
  p_empresa text,
  p_offset  bigint DEFAULT 0,
  p_limit   bigint DEFAULT 5000
) RETURNS TABLE (
  ano           int,
  mes           int,
  bacia         text,
  estado        text,
  ambiente      text,
  campo         text,
  poco          text,
  operador      text,
  instalacao    text,
  oil_bbl_dia   numeric,
  gas_mm3_dia   numeric,
  water_bbl_dia numeric,
  uptime_hs_mes numeric,
  stake_pct     numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH valid_stakes AS (
    SELECT campo, stake_pct
      FROM field_stakes
     WHERE empresa = p_empresa
       AND campo IN (
         SELECT campo FROM field_stakes
          GROUP BY campo
         HAVING SUM(stake_pct) = 100
       )
  )
  SELECT
    p.ano,
    p.mes,
    p.bacia,
    p.estado,
    p.local                                            AS ambiente,
    canonical_field_name(p.campo)                      AS campo,
    p.poco,
    p.operador,
    p.instalacao_destino                               AS instalacao,
    (p.petroleo_bbl_dia  * vs.stake_pct / 100)::numeric AS oil_bbl_dia,
    (p.gas_total_mm3_dia * vs.stake_pct / 100)::numeric AS gas_mm3_dia,
    (p.agua_bbl_dia      * vs.stake_pct / 100)::numeric AS water_bbl_dia,
    p.tempo_prod_hs_mes::numeric                        AS uptime_hs_mes,
    vs.stake_pct::numeric                               AS stake_pct
  FROM anp_cdp_producao p
  JOIN valid_stakes vs ON vs.campo = p.campo
  ORDER BY p.ano, p.mes, canonical_field_name(p.campo), p.poco
  OFFSET p_offset
  LIMIT  p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_production_well_full_history(text, bigint, bigint)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_production_well_full_history(text, bigint, bigint) IS
  'Paginated stake-weighted well-level production history for one company. Pair with get_production_well_count(p_empresa) to drive the page loop. PostgREST max-rows cap requires offset/limit pagination for >1000-row exports.';


-- -----------------------------------------------------------------------------
-- 3. get_production_brazil_well_full_history(p_offset, p_limit)
--    Brazil-wide raw rows, paginated. ~2.2M rows total — pagination is
--    mandatory.
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.get_production_brazil_well_full_history(
  p_offset bigint DEFAULT 0,
  p_limit  bigint DEFAULT 5000
) RETURNS TABLE (
  ano           int,
  mes           int,
  bacia         text,
  estado        text,
  ambiente      text,
  campo         text,
  poco          text,
  operador      text,
  instalacao    text,
  oil_bbl_dia   numeric,
  gas_mm3_dia   numeric,
  water_bbl_dia numeric,
  uptime_hs_mes numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT
    p.ano,
    p.mes,
    p.bacia,
    p.estado,
    p.local                       AS ambiente,
    canonical_field_name(p.campo) AS campo,
    p.poco,
    p.operador,
    p.instalacao_destino          AS instalacao,
    p.petroleo_bbl_dia::numeric   AS oil_bbl_dia,
    p.gas_total_mm3_dia::numeric  AS gas_mm3_dia,
    p.agua_bbl_dia::numeric       AS water_bbl_dia,
    p.tempo_prod_hs_mes::numeric  AS uptime_hs_mes
  FROM anp_cdp_producao p
  ORDER BY p.ano, p.mes, canonical_field_name(p.campo), p.poco
  OFFSET p_offset
  LIMIT  p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_production_brazil_well_full_history(bigint, bigint)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_production_brazil_well_full_history(bigint, bigint) IS
  'Paginated Brazil-wide raw well-level production history (100% WI). Pair with get_production_brazil_well_count(). ~2.2M rows total — caller must page.';


-- -----------------------------------------------------------------------------
-- 4. get_production_well_count(p_empresa)
--    Lightweight COUNT(*) helper for the export size estimator.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_production_well_count(p_empresa text)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH valid_stakes AS (
    SELECT campo
      FROM field_stakes
     WHERE empresa = p_empresa
       AND campo IN (
         SELECT campo FROM field_stakes
          GROUP BY campo
         HAVING SUM(stake_pct) = 100
       )
  )
  SELECT COUNT(*)::bigint
    FROM anp_cdp_producao p
    JOIN valid_stakes vs ON vs.campo = p.campo;
$$;

GRANT EXECUTE ON FUNCTION public.get_production_well_count(text)
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_production_well_count(text) IS
  'Row-count estimator companion to get_production_well_full_history. Used by the export size modal to avoid draining all rows just to count.';


-- -----------------------------------------------------------------------------
-- 5. get_production_brazil_well_count()
--    Lightweight COUNT(*) helper for the Brazil sheet.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_production_brazil_well_count()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::bigint FROM anp_cdp_producao;
$$;

GRANT EXECUTE ON FUNCTION public.get_production_brazil_well_count()
  TO anon, authenticated;

COMMENT ON FUNCTION public.get_production_brazil_well_count() IS
  'Row-count estimator companion to get_production_brazil_well_full_history. Returns ~2.2M as of 2026-06.';


COMMIT;
