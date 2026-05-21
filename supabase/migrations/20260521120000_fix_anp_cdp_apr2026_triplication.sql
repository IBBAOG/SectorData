-- =============================================================================
-- Fix Apr 2026 cross-local triplication in anp_cdp_producao
-- =============================================================================
-- Context
-- -------
-- For (ano=2026, mes=4), 1,038 (poco, campo, bacia) tuples were inserted 3 times
-- with local in {PosSal, PreSal, Terra} because the upload pipeline did not
-- deduplicate before upsert. PK includes `local` so ON CONFLICT did not catch
-- these collisions. The Apr/2026 KPI on /anp-cdp shows 12,853.6 kbpd vs an
-- expected ~4,200 kbpd (i.e. 3.03x triplication confirmed against Mar/2026).
--
-- Pre-state confirmed via MCP execute_sql:
--   rows_apr2026      = 8,922
--   wells_apr2026     = 6,846 (distinct (poco, campo, bacia))
--   kbpd_apr2026      = 12,853.6
--   triplicated_wells = 1,038 (each with COUNT DISTINCT local = 3)
--   wells with hist  = 1,034 (clean primary signal: historical local)
--   wells no hist    = 4 (all in Campos basin)
--   Single-local wells (Terra only) = 5,808 (correctly land-based)
--
-- Strategy
-- --------
-- 1. Create _quarantine_anp_cdp_apr2026 (audit table, RLS Admin-only SELECT,
--    schema = anp_cdp_producao + audit columns).
-- 2. For each (poco, campo, bacia) with COUNT(DISTINCT local) > 1 in Apr/2026:
--      primary method 'historical'      : pick the local from the most recent
--                                         pre-Apr/2026 row for that triple.
--      fallback method 'majority_field' : if no row-level history, pick the
--                                         majority local for (campo, bacia)
--                                         across all pre-Apr/2026 rows.
--      last resort 'inconclusive'       : if neither resolves, quarantine all
--                                         3 rows. Production loses that well
--                                         for Apr/2026; the empty slot is
--                                         visible in dashboards (fail loud).
-- 3. INSERT the 2 (or 3 if inconclusive) wrong rows into the quarantine table.
-- 4. DELETE those wrong rows from anp_cdp_producao.
-- 5. Refresh dependent materialized views if any.
-- 6. RAISE EXCEPTION if any (poco, campo, bacia) still has > 1 local in Apr/2026.
--
-- Idempotency
-- -----------
-- The quarantine INSERT is guarded by NOT EXISTS on the natural key, so a
-- second execution moves no rows (Apr/2026 already cleaned) and inserts nothing.
-- The DELETE becomes a no-op once the wrong rows are gone. The whole block is
-- transactional; a failure rolls back everything.
--
-- Scope
-- -----
-- This migration touches ONLY (ano=2026, mes=4). Phase B (pipeline prevention)
-- will be handled separately in scripts/pipelines/anp/cdp/02_upload.py.
-- =============================================================================

BEGIN;

-- =============================================================================
-- Step 1: Quarantine table (idempotent CREATE)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public._quarantine_anp_cdp_apr2026 (
  LIKE public.anp_cdp_producao INCLUDING ALL,
  quarantined_at   timestamptz NOT NULL DEFAULT now(),
  reason           text        NOT NULL,
  selection_method text        NOT NULL  -- 'historical' | 'majority_field' | 'inconclusive'
);

COMMENT ON TABLE public._quarantine_anp_cdp_apr2026 IS
  'Rows removed from anp_cdp_producao due to cross-local triplication bug in the Apr 2026 ETL run. See migration 20260521120000_fix_anp_cdp_apr2026_triplication.sql. Phase B (pipeline prevention) tracked separately.';

ALTER TABLE public._quarantine_anp_cdp_apr2026 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS _quarantine_select_admin ON public._quarantine_anp_cdp_apr2026;
CREATE POLICY _quarantine_select_admin ON public._quarantine_anp_cdp_apr2026
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) = 'Admin'
  );

-- =============================================================================
-- Step 2: Pre-state log
-- =============================================================================
DO $$
DECLARE
  before_rows  int;
  before_wells int;
  before_kbpd  numeric;
BEGIN
  SELECT COUNT(*) INTO before_rows  FROM anp_cdp_producao WHERE ano=2026 AND mes=4;
  SELECT COUNT(DISTINCT (poco, campo, bacia)) INTO before_wells FROM anp_cdp_producao WHERE ano=2026 AND mes=4;
  SELECT ROUND((SUM(petroleo_bbl_dia)/1000.0)::numeric, 1) INTO before_kbpd FROM anp_cdp_producao WHERE ano=2026 AND mes=4;
  RAISE NOTICE '[BEFORE] rows=% wells=% kbpd=%', before_rows, before_wells, before_kbpd;
END $$;

-- =============================================================================
-- Step 3: Decision table — pick the correct `local` per (poco, campo, bacia)
-- =============================================================================
CREATE TEMP TABLE _apr2026_decision ON COMMIT DROP AS
WITH triplicated AS (
  SELECT poco, campo, bacia
  FROM anp_cdp_producao
  WHERE ano=2026 AND mes=4
  GROUP BY poco, campo, bacia
  HAVING COUNT(DISTINCT local) > 1
),
hist_row AS (
  -- Most recent (ano, mes) historical row per (poco, campo, bacia), pre-Apr/2026
  SELECT DISTINCT ON (h.poco, h.campo, h.bacia)
    h.poco, h.campo, h.bacia, h.local AS hist_local
  FROM anp_cdp_producao h
  JOIN triplicated t USING (poco, campo, bacia)
  WHERE (h.ano < 2026) OR (h.ano = 2026 AND h.mes < 4)
  ORDER BY h.poco, h.campo, h.bacia, h.ano DESC, h.mes DESC
),
field_majority AS (
  -- Majority local at the (campo, bacia) level across all pre-Apr/2026 rows
  SELECT DISTINCT ON (f.campo, f.bacia)
    f.campo, f.bacia, f.local AS majority_local
  FROM (
    SELECT h.campo, h.bacia, h.local, COUNT(*) AS n
    FROM anp_cdp_producao h
    JOIN triplicated t
      ON t.campo = h.campo AND t.bacia = h.bacia
    WHERE (h.ano < 2026) OR (h.ano = 2026 AND h.mes < 4)
    GROUP BY h.campo, h.bacia, h.local
  ) f
  ORDER BY f.campo, f.bacia, f.n DESC, f.local  -- deterministic tie-break by local name
)
SELECT
  t.poco, t.campo, t.bacia,
  COALESCE(hr.hist_local, fm.majority_local) AS chosen_local,
  CASE
    WHEN hr.hist_local IS NOT NULL THEN 'historical'
    WHEN fm.majority_local IS NOT NULL THEN 'majority_field'
    ELSE 'inconclusive'
  END AS method
FROM triplicated t
LEFT JOIN hist_row       hr USING (poco, campo, bacia)
LEFT JOIN field_majority fm ON fm.campo = t.campo AND fm.bacia = t.bacia;

-- =============================================================================
-- Step 4: Move WRONG rows to quarantine
--         (rows whose local does NOT match chosen_local, or all 3 if inconclusive)
-- =============================================================================
INSERT INTO public._quarantine_anp_cdp_apr2026
SELECT
  a.*,
  now() AS quarantined_at,
  'Apr/2026 cross-local triplication bug' AS reason,
  d.method AS selection_method
FROM public.anp_cdp_producao a
JOIN _apr2026_decision d USING (poco, campo, bacia)
WHERE a.ano = 2026 AND a.mes = 4
  AND (d.chosen_local IS NULL OR a.local <> d.chosen_local)
  AND NOT EXISTS (
    SELECT 1 FROM public._quarantine_anp_cdp_apr2026 q
    WHERE q.ano = a.ano AND q.mes = a.mes
      AND q.poco = a.poco AND q.campo = a.campo AND q.bacia = a.bacia
      AND q.local = a.local
  );

-- =============================================================================
-- Step 5: Delete moved rows from production
-- =============================================================================
DELETE FROM public.anp_cdp_producao a
USING _apr2026_decision d
WHERE a.poco = d.poco AND a.campo = d.campo AND a.bacia = d.bacia
  AND a.ano = 2026 AND a.mes = 4
  AND (d.chosen_local IS NULL OR a.local <> d.chosen_local);

-- =============================================================================
-- Step 6: Refresh materialized views (if any depend on anp_cdp_producao)
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refresh_anp_cdp_pocos') THEN
    PERFORM refresh_anp_cdp_pocos();
  ELSIF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'mv_anp_cdp_pocos') THEN
    REFRESH MATERIALIZED VIEW public.mv_anp_cdp_pocos;
  END IF;
END $$;

-- =============================================================================
-- Step 7: Post-state log + integrity check
-- =============================================================================
DO $$
DECLARE
  after_rows         int;
  after_wells        int;
  after_kbpd         numeric;
  q_total            int;
  q_historical       int;
  q_majority_field   int;
  q_inconclusive     int;
  still_dup_count    int;
BEGIN
  SELECT COUNT(*) INTO after_rows FROM anp_cdp_producao WHERE ano=2026 AND mes=4;
  SELECT COUNT(DISTINCT (poco, campo, bacia)) INTO after_wells FROM anp_cdp_producao WHERE ano=2026 AND mes=4;
  SELECT ROUND((SUM(petroleo_bbl_dia)/1000.0)::numeric, 1) INTO after_kbpd FROM anp_cdp_producao WHERE ano=2026 AND mes=4;
  SELECT COUNT(*) INTO q_total          FROM _quarantine_anp_cdp_apr2026;
  SELECT COUNT(*) INTO q_historical     FROM _quarantine_anp_cdp_apr2026 WHERE selection_method='historical';
  SELECT COUNT(*) INTO q_majority_field FROM _quarantine_anp_cdp_apr2026 WHERE selection_method='majority_field';
  SELECT COUNT(*) INTO q_inconclusive   FROM _quarantine_anp_cdp_apr2026 WHERE selection_method='inconclusive';
  SELECT COUNT(*) INTO still_dup_count FROM (
    SELECT poco, campo, bacia FROM anp_cdp_producao
    WHERE ano=2026 AND mes=4
    GROUP BY poco, campo, bacia
    HAVING COUNT(DISTINCT local) > 1
  ) t;

  RAISE NOTICE '[AFTER]      rows=% wells=% kbpd=%', after_rows, after_wells, after_kbpd;
  RAISE NOTICE '[QUARANTINE] total=% historical=% majority_field=% inconclusive=%',
               q_total, q_historical, q_majority_field, q_inconclusive;
  RAISE NOTICE '[INTEGRITY]  remaining_cross_local_duplicates=%', still_dup_count;

  IF still_dup_count > 0 THEN
    RAISE EXCEPTION 'Integrity check failed: % wells still have multiple locals in Apr/2026', still_dup_count;
  END IF;
END $$;

COMMIT;
