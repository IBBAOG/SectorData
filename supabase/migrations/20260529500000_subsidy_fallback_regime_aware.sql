-- =============================================================================
-- Migration: subsidy_fallback_regime_aware
-- Date: 2026-05-29 (timestamp slot 20260529500000)
-- =============================================================================
--
-- CONTEXT
--   Migration 20260528800000_subsidy_fallback_to_raw made the trigger fn
--   _pb_populate_w_subsidy() and the RPC get_subsidy_tracker_diesel() COALESCE
--   compute_subsidy_reimbursement(...) NULL -> 0. That fix was correct for the
--   START of the series (pre-subsidy regime, Jan -> early Mar) so the dashed
--   "with subsidy" series remained continuous with the raw series for YTD-
--   average semantics.
--
--   BUT the same COALESCE-NULL-to-0 ALSO fires at the TRAILING EDGE: when
--   the daily ANP reference scraper hasn't ingested today's row yet
--   (anp_subsidy_diesel_reference last row = D-1), compute_subsidy_reimbursement
--   returns NULL for D, and _w_subsidy snaps back to raw — producing the
--   visible "snap to base" spike at the latest day on /subsidy-tracker.
--
--   Concrete symptom (2026-05-29): IPP (adjusted) snaps up by +44.32% WoW,
--   Petrobras (adjusted) snaps down by -23.48% WoW on the last day.
--
-- ROOT CAUSE
--   COALESCE(reimb, 0) is regime-blind. Both "pre-regime" (no subsidy exists)
--   and "ETL lag" (subsidy exists but today's ref not yet ingested) look
--   identical to the function.
--
-- FIX (Option B — regime-start sentinel + NULL on ETL gap, approved by CTO)
--   Define regime_start per tipo_agente:
--     regime_start(p_tipo_agente) :=
--       (SELECT MIN(data_referencia)
--          FROM anp_subsidy_diesel_reference
--         WHERE tipo_agente = p_tipo_agente)
--
--   Then:
--     date <  regime_start  -> fallback to raw (preserve Jan->Mar continuity)
--     date >= regime_start AND reimb IS NULL -> NULL (honest break; Plotly
--                                                    breaks dashed line)
--     date >= regime_start AND reimb IS NOT NULL -> raw +/- reimb
--
-- CHANGES
--   1. CREATE helper public._subsidy_regime_start(tipo_agente TEXT) -> DATE
--      (STABLE, SECURITY DEFINER, search_path locked).
--   2. CREATE OR REPLACE _pb_populate_w_subsidy() with regime-aware logic.
--      Trigger binding preserved.
--   3. DROP + CREATE get_subsidy_tracker_diesel() with same regime-aware logic
--      in ipp_adjusted / petrobras_adjusted projections. PT suffixes + 13-col
--      signature (incl. reimb_importador / reimb_produtor from slot 970000)
--      preserved. SECURITY DEFINER + search_path + GRANT EXECUTE re-applied.
--   4. Backfill: UPDATE price_bands SET date = date WHERE product='Diesel' to
--      re-fire BEFORE trigger and recompute _w_subsidy with the new logic.
--      Expected outcome:
--        - pre-2026-03-12 Diesel rows: _w_subsidy = raw (unchanged)
--        - in-regime rows w/ ref data: _w_subsidy = raw +/- reimb (unchanged)
--        - in-regime rows w/o ref data (e.g. 2026-05-29 trailing edge):
--            _w_subsidy = NULL  (was: raw — the bug we are fixing)
--
-- PEGADINHAS RESPECTED
--   - SECURITY DEFINER + SET search_path = public, pg_temp on every fn touched.
--   - DROP+CREATE wipes grants -> re-applied GRANT EXECUTE TO anon, authenticated.
--   - Timestamp slot 20260529500000 > all current migrations (max 20260529400000).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Helper: per-agent regime start
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._subsidy_regime_start(p_tipo_agente TEXT)
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT MIN(data_referencia)
    FROM public.anp_subsidy_diesel_reference
   WHERE tipo_agente = p_tipo_agente;
$$;

COMMENT ON FUNCTION public._subsidy_regime_start(TEXT) IS
  'First date for which anp_subsidy_diesel_reference has any row for the given tipo_agente. Used by _pb_populate_w_subsidy and get_subsidy_tracker_diesel to distinguish "pre-regime" (date < regime_start -> fallback to raw) from "ETL gap" (date >= regime_start AND reimb IS NULL -> NULL). SECURITY DEFINER + search_path (Pegadinha #18).';

GRANT EXECUTE ON FUNCTION public._subsidy_regime_start(TEXT) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. _pb_populate_w_subsidy: regime-aware fallback
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._pb_populate_w_subsidy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reimb_imp        NUMERIC;
  v_reimb_prd        NUMERIC;
  v_regime_start_imp DATE;
  v_regime_start_prd DATE;
BEGIN
  IF NEW.product IS DISTINCT FROM 'Diesel' THEN
    RETURN NEW;
  END IF;

  v_reimb_imp        := public.compute_subsidy_reimbursement(NEW.date, 'importador');
  v_reimb_prd        := public.compute_subsidy_reimbursement(NEW.date, 'produtor');
  v_regime_start_imp := public._subsidy_regime_start('importador');
  v_regime_start_prd := public._subsidy_regime_start('produtor');

  -- Importer side
  IF NEW.bba_import_parity IS NULL THEN
    NEW.bba_import_parity_w_subsidy := NULL;
  ELSIF v_regime_start_imp IS NULL OR NEW.date < v_regime_start_imp THEN
    -- Pre-regime: subsidy does not exist yet. Fall back to raw so the
    -- YTD-average dashed series stays continuous from Jan onward.
    NEW.bba_import_parity_w_subsidy := NEW.bba_import_parity;
  ELSIF v_reimb_imp IS NULL THEN
    -- In-regime but no reimbursement value (ETL lag — today's ANP reference
    -- not yet ingested, or commercialization period not yet defined).
    -- Emit NULL so the chart breaks the dashed line at the gap (honest
    -- about data lag instead of snapping back to raw).
    NEW.bba_import_parity_w_subsidy := NULL;
  ELSE
    NEW.bba_import_parity_w_subsidy := NEW.bba_import_parity - v_reimb_imp;
  END IF;

  -- Producer side (symmetric)
  IF NEW.petrobras_price IS NULL THEN
    NEW.petrobras_price_w_subsidy := NULL;
  ELSIF v_regime_start_prd IS NULL OR NEW.date < v_regime_start_prd THEN
    NEW.petrobras_price_w_subsidy := NEW.petrobras_price;
  ELSIF v_reimb_prd IS NULL THEN
    NEW.petrobras_price_w_subsidy := NULL;
  ELSE
    NEW.petrobras_price_w_subsidy := NEW.petrobras_price + v_reimb_prd;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public._pb_populate_w_subsidy() IS
  'BEFORE INSERT/UPDATE trigger fn on price_bands. Regime-aware fallback (CTO 2026-05-29): date < regime_start -> _w_subsidy = raw (preserve Jan->Mar continuity); date >= regime_start AND reimb IS NULL -> NULL (honest ETL-gap break); otherwise raw +/- reimb. Replaces the COALESCE(reimb,0) introduced in slot 800000 which was regime-blind and caused trailing-edge "snap to base" when the ANP ref scraper lagged.';

-- The trigger binding `populate_pb_w_subsidy_on_insert` from migration
-- 20260527200000 is preserved automatically — CREATE OR REPLACE FUNCTION
-- keeps existing triggers bound to the same name.

-- -----------------------------------------------------------------------------
-- 3. get_subsidy_tracker_diesel: regime-aware fallback in adjusted projections
--    Signature unchanged (13 columns including reimb_importador / reimb_produtor
--    from slot 20260528970000). DROP + CREATE to re-apply SECURITY DEFINER
--    + search_path + GRANT cleanly (Pegadinha #18 audit).
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_subsidy_tracker_diesel();

CREATE OR REPLACE FUNCTION public.get_subsidy_tracker_diesel()
RETURNS TABLE (
  date                              DATE,
  ipp                               NUMERIC,
  ipp_adjusted                      NUMERIC,
  petrobras                         NUMERIC,
  petrobras_adjusted                NUMERIC,
  anp_reference_importador          NUMERIC,
  anp_reference_produtor            NUMERIC,
  anp_commercialization_importador  NUMERIC,
  anp_commercialization_produtor    NUMERIC,
  regions_importador                JSONB,
  regions_produtor                  JSONB,
  reimb_importador                  NUMERIC,
  reimb_produtor                    NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ref_imp AS (
    SELECT data_referencia AS date,
           AVG(preco_referencia)::NUMERIC(10,4) AS anp_reference,
           jsonb_object_agg(regiao, preco_referencia) AS regions
      FROM public.anp_subsidy_diesel_reference
     WHERE tipo_agente = 'importador'
     GROUP BY data_referencia
  ),
  ref_prd AS (
    SELECT data_referencia AS date,
           AVG(preco_referencia)::NUMERIC(10,4) AS anp_reference,
           jsonb_object_agg(regiao, preco_referencia) AS regions
      FROM public.anp_subsidy_diesel_reference
     WHERE tipo_agente = 'produtor'
     GROUP BY data_referencia
  ),
  comm_imp AS (
    SELECT r.data_referencia AS date,
           AVG(c.preco_comercializacao)::NUMERIC(10,4) AS anp_commercialization
      FROM public.anp_subsidy_diesel_reference r
      JOIN public.anp_subsidy_commercialization c
        ON c.regiao      = r.regiao
       AND c.tipo_agente = r.tipo_agente
       AND r.data_referencia BETWEEN c.data_inicio AND c.data_fim
     WHERE r.tipo_agente = 'importador'
     GROUP BY r.data_referencia
  ),
  comm_prd AS (
    SELECT r.data_referencia AS date,
           AVG(c.preco_comercializacao)::NUMERIC(10,4) AS anp_commercialization
      FROM public.anp_subsidy_diesel_reference r
      JOIN public.anp_subsidy_commercialization c
        ON c.regiao      = r.regiao
       AND c.tipo_agente = r.tipo_agente
       AND r.data_referencia BETWEEN c.data_inicio AND c.data_fim
     WHERE r.tipo_agente = 'produtor'
     GROUP BY r.data_referencia
  ),
  pb AS (
    SELECT date,
           bba_import_parity AS ipp,
           petrobras_price   AS petrobras
      FROM public.price_bands
     WHERE product = 'Diesel'
  ),
  all_dates AS (
    SELECT date FROM pb
    UNION SELECT date FROM ref_imp
    UNION SELECT date FROM ref_prd
  ),
  reimb AS (
    SELECT d.date,
           public.compute_subsidy_reimbursement(d.date, 'importador') AS r_imp,
           public.compute_subsidy_reimbursement(d.date, 'produtor')   AS r_prd
      FROM all_dates d
  ),
  regime AS (
    SELECT public._subsidy_regime_start('importador') AS start_imp,
           public._subsidy_regime_start('produtor')   AS start_prd
  )
  SELECT d.date,
         pb.ipp,
         -- Regime-aware fallback for ipp_adjusted (CTO 2026-05-29):
         --   ipp NULL                         -> NULL
         --   date < regime_start (importador) -> raw (pre-regime continuity)
         --   reimb NULL (ETL gap)             -> NULL (honest break)
         --   else                             -> ipp - reimb
         CASE
           WHEN pb.ipp IS NULL THEN NULL
           WHEN g.start_imp IS NULL OR d.date < g.start_imp THEN pb.ipp
           WHEN rb.r_imp IS NULL THEN NULL
           ELSE pb.ipp - rb.r_imp
         END AS ipp_adjusted,
         pb.petrobras,
         CASE
           WHEN pb.petrobras IS NULL THEN NULL
           WHEN g.start_prd IS NULL OR d.date < g.start_prd THEN pb.petrobras
           WHEN rb.r_prd IS NULL THEN NULL
           ELSE pb.petrobras + rb.r_prd
         END AS petrobras_adjusted,
         ri.anp_reference   AS anp_reference_importador,
         rp.anp_reference   AS anp_reference_produtor,
         ci.anp_commercialization AS anp_commercialization_importador,
         cp.anp_commercialization AS anp_commercialization_produtor,
         ri.regions         AS regions_importador,
         rp.regions         AS regions_produtor,
         rb.r_imp           AS reimb_importador,
         rb.r_prd           AS reimb_produtor
    FROM all_dates d
    CROSS JOIN regime g
    LEFT JOIN pb       ON pb.date = d.date
    LEFT JOIN ref_imp  ri ON ri.date = d.date
    LEFT JOIN ref_prd  rp ON rp.date = d.date
    LEFT JOIN comm_imp ci ON ci.date = d.date
    LEFT JOIN comm_prd cp ON cp.date = d.date
    LEFT JOIN reimb    rb ON rb.date = d.date
   ORDER BY d.date;
$$;

COMMENT ON FUNCTION public.get_subsidy_tracker_diesel() IS
  'Subsidy tracker daily series for diesel. Regime-aware fallback (CTO 2026-05-29): for each agent side, pre-regime dates (date < MIN reference date) keep adjusted=raw to preserve Jan->Mar YTD continuity; in-regime dates with NULL reimbursement (ETL lag) emit NULL so Plotly breaks the dashed line; otherwise raw +/- reimb. 13 columns incl. reimb_importador / reimb_produtor exposed for mobile/tooltip use. PT suffixes match the TS contract in src/lib/rpc.ts. SECURITY DEFINER + search_path so anon reads work despite RLS (Pegadinha #18).';

GRANT EXECUTE ON FUNCTION public.get_subsidy_tracker_diesel() TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Pre-flight sanity: SECURITY DEFINER preserved on every touched fn
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_sec_def BOOLEAN;
BEGIN
  SELECT prosecdef INTO v_sec_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_subsidy_tracker_diesel';
  IF NOT v_sec_def THEN
    RAISE EXCEPTION 'get_subsidy_tracker_diesel must be SECURITY DEFINER (Pegadinha #18)';
  END IF;

  SELECT prosecdef INTO v_sec_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_pb_populate_w_subsidy';
  IF NOT v_sec_def THEN
    RAISE EXCEPTION '_pb_populate_w_subsidy must be SECURITY DEFINER (Pegadinha #18)';
  END IF;

  SELECT prosecdef INTO v_sec_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_subsidy_regime_start';
  IF NOT v_sec_def THEN
    RAISE EXCEPTION '_subsidy_regime_start must be SECURITY DEFINER (Pegadinha #18)';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Backfill: re-fire BEFORE trigger on every Diesel row.
--    `SET date = date` counts as UPDATE OF date in the trigger column list,
--    fires _pb_populate_w_subsidy() with the new regime-aware semantics.
--    Expected delta vs slot 800000:
--      - pre-2026-03-12 rows: no change (still _w_subsidy = raw)
--      - in-regime rows with ref data: no change (still raw +/- reimb)
--      - in-regime rows without ref data (e.g. 2026-05-29 trailing edge):
--          was raw -> now NULL  (this is the bug fix)
-- -----------------------------------------------------------------------------
UPDATE public.price_bands
   SET date = date
 WHERE product = 'Diesel';

COMMIT;
