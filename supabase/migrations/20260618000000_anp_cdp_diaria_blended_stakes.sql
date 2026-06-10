-- ============================================================================
-- /anp-cdp-diaria — fix stake weighting for merged contract tranches
--                   (per-(canonical field, company, month) BLENDED stakes)
--
-- BUG (confirmed, reconciled twice): the company-level daily RPCs
-- (20260609000000, redefined by 20260614000000) joined
-- field_stakes.campo = anp_cdp_diaria.campo (raw-name exact match).
-- field_stakes carries CONTRACT-TRANCHE rows as separate raw names — for
-- Petrobras: BÚZIOS 100% + BÚZIOS_ECO 85%, ATAPU 100% + ATAPU_ECO 52.5%,
-- SÉPIA 100% + SÉPIA_ECO 30%, ITAPU + ITAPU_ECO both 100% (harmless).
-- The monthly table anp_cdp_producao carries BOTH tranche names, so
-- mv_production_monthly (20260527133039) weights each tranche correctly via a
-- production-weighted blend. But the daily Power BI panel (anp_cdp_diaria)
-- publishes ONE MERGED row per field — *_ECO names never appear there. The
-- raw-name join therefore matched only the 100% ToR row and weighted the
-- ENTIRE merged field at 100%.
--
-- Quantified effect (Apr-2026, Petrobras): +184.8 kbpd overstatement
-- (BÚZIOS +91.3, SÉPIA +59.3, ATAPU +34.2) — 2808.3 kbpd shown vs ≈2623.5
-- with correct blended stakes.
--
-- FIX: effective blended stake per (canonical field, company, month):
--
--   blend(canonical, empresa, ano, mes) =
--       SUM(p.petroleo_bbl_dia * fs.stake_pct)
--     / NULLIF(SUM(p.petroleo_bbl_dia), 0)
--   over anp_cdp_producao p JOIN field_stakes fs ON fs.campo = p.campo
--                                               AND fs.empresa = <company>,
--   grouped by canonical_field_name(p.campo), ano, mes.
--
-- WEIGHT SOURCE: mv_production_monthly.stake_pct_weighted (20260527133039,
-- lines 67-70) IS that exact formula, already materialized per
-- (canonical, empresa, ano, mes, ambiente) and indexed on (empresa, ano, mes).
-- Reading the MV costs milliseconds; recomputing the blend from raw
-- anp_cdp_producao per call costs 2-6 s (232k+ heap fetches per call — the
-- table has ~2.2M well-level rows and no (campo, ano, mes) covering index),
-- which would be a ~40x latency regression vs the previous RPC (~150 ms) on
-- the PostgREST path (authenticator ~30s cap, pegadinha #25). The MV rows are
-- re-aggregated across `ambiente` by reconstructing gross production
-- (gross = net * 100 / stake_pct_weighted), which reproduces the formula
-- exactly; verified equal to the direct computation to the 3rd decimal for
-- every affected field (BÚZIOS 88.918, ATAPU 71.262, SÉPIA 51.909,
-- TUPI 67.311, PEREGRINO 80.000 — Apr-2026).
--
-- Two accepted deltas of sourcing from the MV (both documented):
--  * Validity filter: the MV only carries campos whose registry stakes sum to
--    100 across all companies. A campo failing that check has no blend and
--    falls back to the raw-name stake — exactly today's behavior, so coverage
--    AND weights for such fields are byte-identical to before. All current
--    tranche campos pass the check (verified live).
--  * Freshness: blends move when refresh_mv_production() runs (pg_cron after
--    the monthly ETL). The carry-forward below already tolerates the 1-2
--    month monthly-vs-daily lag, so MV refresh lag is absorbed the same way.
--  NOTE for /well-by-well owners: the /anp-cdp-diaria company RPCs now depend
--  on mv_production_monthly (columns canonical, empresa, ano, mes,
--  oil_bbl_dia, stake_pct_weighted). Do not drop/rename without updating
--  these RPCs.
--
-- CARRY-FORWARD: the daily panel leads monthly CDP by 1-2 months. For a daily
-- (canonical field, month) with no blend available, the field's most recent
-- PRIOR month's blend is used. Months whose monthly oil total is zero/NULL
-- are treated as "no blend" (HAVING SUM > 0), so the carry-forward skips them
-- instead of producing NULL/0 stakes. A field with NO blend in any month of
-- the lookback window falls back to the raw-name stake — byte-identical to
-- the previous behavior for such fields.
--
-- Lookback bound: blend months are restricted to
-- ano >= year(earliest served day) - 1 (>= 12 months of carry-forward room;
-- 2025-11-09 is anp_cdp_diaria's immutable first day, used when
-- p_data_inicio IS NULL). A field absent from monthly CDP for over a year
-- while still in the daily feed degrades to the raw-name stake — accepted:
-- a multi-year-stale blend is worse than the current stake registry.
--
-- Structural consequence (intended): canonical fields whose variants all
-- carry a blend now collapse to ONE row per (data, canonical campo) — e.g.
-- TUPI (65%) + SUL DE TUPI (100%, canonical-merged into TUPI by
-- field_canonical_names) previously emitted two rows/day and now emit a single
-- TUPI row at the blended stake (≈67.3%), with the gross columns summed across
-- variants as before. Net production for the canonical field is preserved
-- (blend is production-weighted). Fields without a blend keep today's
-- per-stake-group rows. The set of canonical fields returned is IDENTICAL to
-- before by construction — only the WEIGHT changed. mv_production_monthly's
-- validity filter is NOT applied to the daily JOIN (coverage is still
-- field_stakes x anp_cdp_diaria); it only gates whether a blend WEIGHT exists.
--
-- PERF: canonical_field_name() is SECURITY DEFINER + SET search_path, so it
-- is never inlined (~1 ms/call cold). The previous definitions called it per
-- daily row; these call it once per stake row (~66 calls for Petrobras)
-- inside a MATERIALIZED CTE and reuse the column everywhere. The blend
-- lookup reads the MV through its (empresa, ano, mes) index and the
-- carry-forward is resolved once per (canonical, served month) grid cell
-- (~66 x 8 LATERAL probes on a small materialized CTE), not per daily row.
--
-- Pegadinha #18: anp_cdp_diaria has RLS granting SELECT only to
-- `authenticated`, and mv_production_monthly had anon/authenticated SELECT
-- revoked (20260528400000); both RPCs stay SECURITY DEFINER + SET
-- search_path = public, pg_temp, and EXECUTE grants are re-issued explicitly.
--
-- get_anp_cdp_diaria_empresas() is intentionally untouched: it returns field
-- COUNTS (no stake weight involved) and was retired from the frontend
-- (Two-Tier Tabs IA, 2026-06-05).
--
-- External-contract column names (campo, bacia, petroleo_bbl_dia, gas_mm3_dia,
-- stake_pct) stay in Portuguese — existing return-column contracts.
-- ============================================================================

-- ── (1) Company-level daily serie — blended stake per (canonical, month) ────
-- Same signature and return columns. stake_pct now carries the blended stake
-- effective for that row's month (or the raw stake when no blend exists).
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
  petroleo_bbl_dia      real,     -- field gross oil (summed across canonical variants)
  gas_mm3_dia           real,     -- field gross gas (summed across canonical variants)
  petroleo_bbl_dia_net  numeric,  -- SUM(gross oil * effective stake / 100)
  gas_mm3_dia_net       numeric   -- SUM(gross gas * effective stake / 100)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH stakes AS MATERIALIZED (
    -- One canonical_field_name() call per stake row (NOT per daily row).
    SELECT fs.campo,
           fs.stake_pct,
           public.canonical_field_name(fs.campo) AS canonical
    FROM field_stakes fs
    WHERE fs.empresa = p_empresa
  ),
  -- Monthly production-weighted blend per (canonical, month), read from
  -- mv_production_monthly and re-aggregated across ambiente by reconstructing
  -- gross production (gross = net * 100 / stake). Bounded to >= 12 months
  -- before the earliest served day (2025-11-09 = first day of the daily
  -- panel, used when p_data_inicio IS NULL). Zero/NULL-production months are
  -- dropped (HAVING) so the carry-forward skips them.
  blend AS MATERIALIZED (
    SELECT mv.canonical,
           make_date(mv.ano, mv.mes, 1) AS mes,
           ROUND(  100 * SUM(mv.oil_bbl_dia)
                 / NULLIF(SUM(mv.oil_bbl_dia * 100 / NULLIF(mv.stake_pct_weighted, 0)), 0)
                 , 3) AS blend_pct
    FROM mv_production_monthly mv
    WHERE mv.empresa = p_empresa
      AND mv.ano >= EXTRACT(YEAR FROM COALESCE(p_data_inicio, DATE '2025-11-09'))::int - 1
    GROUP BY mv.canonical, make_date(mv.ano, mv.mes, 1)
    HAVING SUM(mv.oil_bbl_dia) > 0
  ),
  served_months AS MATERIALIZED (
    SELECT DISTINCT date_trunc('month', d.data)::date AS mes
    FROM anp_cdp_diaria d
    WHERE (p_data_inicio IS NULL OR d.data >= p_data_inicio)
      AND (p_data_fim    IS NULL OR d.data <= p_data_fim)
  ),
  -- Effective blend per (canonical, served month): the most recent blend at or
  -- before that month (carry-forward). NULL when the field has no blend at all
  -- within the lookback window -> COALESCE to the raw stake below.
  eff AS MATERIALIZED (
    SELECT c.canonical, m.mes, lb.blend_pct
    FROM (SELECT DISTINCT canonical FROM stakes) c
    CROSS JOIN served_months m
    LEFT JOIN LATERAL (
      SELECT b0.blend_pct
      FROM blend b0
      WHERE b0.canonical = c.canonical
        AND b0.mes <= m.mes
        AND b0.blend_pct IS NOT NULL
      ORDER BY b0.mes DESC
      LIMIT 1
    ) lb ON TRUE
  )
  SELECT
    d.data,
    s.canonical                                         AS campo,
    d.bacia,
    COALESCE(e.blend_pct, s.stake_pct)                  AS stake_pct,
    SUM(d.petroleo_bbl_dia)::real                       AS petroleo_bbl_dia,
    SUM(d.gas_mm3_dia)::real                            AS gas_mm3_dia,
    SUM(d.petroleo_bbl_dia::numeric * COALESCE(e.blend_pct, s.stake_pct) / 100)
                                                        AS petroleo_bbl_dia_net,
    SUM(d.gas_mm3_dia::numeric      * COALESCE(e.blend_pct, s.stake_pct) / 100)
                                                        AS gas_mm3_dia_net
  FROM stakes s
  JOIN anp_cdp_diaria d ON d.campo = s.campo
  LEFT JOIN eff e
    ON  e.canonical = s.canonical
    AND e.mes       = date_trunc('month', d.data)::date
  WHERE (p_data_inicio IS NULL OR d.data >= p_data_inicio)
    AND (p_data_fim    IS NULL OR d.data <= p_data_fim)
  GROUP BY d.data, s.canonical, d.bacia, COALESCE(e.blend_pct, s.stake_pct)
  ORDER BY d.data, s.canonical;
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_empresa_serie(text, date, date)
  TO anon, authenticated;

-- ── (2) Company-level field coverage — LATEST blend as the label stake ──────
-- Same signature and return columns. stake_pct now carries the field's most
-- recent available blend (last ~2 calendar years of monthly CDP), so coverage
-- labels stay consistent with the serie. Fields with no blend keep the
-- previous MAX(raw stake) behavior. has_daily_data semantics unchanged
-- (OR across raw variants).
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
  WITH stakes AS MATERIALIZED (
    SELECT fs.campo,
           fs.stake_pct,
           public.canonical_field_name(fs.campo) AS canonical
    FROM field_stakes fs
    WHERE fs.empresa = p_empresa
  ),
  blend AS MATERIALIZED (
    SELECT mv.canonical,
           make_date(mv.ano, mv.mes, 1) AS mes,
           ROUND(  100 * SUM(mv.oil_bbl_dia)
                 / NULLIF(SUM(mv.oil_bbl_dia * 100 / NULLIF(mv.stake_pct_weighted, 0)), 0)
                 , 3) AS blend_pct
    FROM mv_production_monthly mv
    WHERE mv.empresa = p_empresa
      AND mv.ano >= EXTRACT(YEAR FROM CURRENT_DATE)::int - 2
    GROUP BY mv.canonical, make_date(mv.ano, mv.mes, 1)
    HAVING SUM(mv.oil_bbl_dia) > 0
  ),
  latest_blend AS MATERIALIZED (
    SELECT DISTINCT ON (canonical) canonical, blend_pct
    FROM blend
    WHERE blend_pct IS NOT NULL
    ORDER BY canonical, mes DESC
  )
  SELECT
    s.canonical                                    AS campo,
    COALESCE(MAX(lb.blend_pct), MAX(s.stake_pct))  AS stake_pct,
    bool_or(
      EXISTS (SELECT 1 FROM anp_cdp_diaria d WHERE d.campo = s.campo)
    )                                              AS has_daily_data
  FROM stakes s
  LEFT JOIN latest_blend lb ON lb.canonical = s.canonical
  GROUP BY s.canonical
  ORDER BY 3 DESC, 2 DESC, 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_diaria_empresa_campos(text)
  TO anon, authenticated;
