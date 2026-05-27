-- =============================================================================
-- Migration: subsidy_fallback_to_raw
-- Date: 2026-05-28 (timestamp slot 20260528800000)
-- =============================================================================
--
-- CONTEXT
--   Before this migration, when compute_subsidy_reimbursement(date, tipo_agente)
--   returned NULL (i.e. no commercialization data applies to that date — pre
--   2026-04-01, or any date outside any defined ANP period), the BEFORE trigger
--   _pb_populate_w_subsidy() set price_bands._w_subsidy columns to NULL, and
--   get_subsidy_tracker_diesel() returned NULL for ipp_adjusted / petrobras_
--   adjusted.
--
--   Result on /subsidy-tracker: the "with subsidy" dashed traces only had data
--   from 2026-04 onward, while the raw traces started in Jan. The YTD average
--   over the "with subsidy" series began at the first in-period data point,
--   breaking semantic continuity (the YTD average should anchor to the same
--   starting point as the raw series — they differ only where subsidy actually
--   bites).
--
-- NEW RULE (from CTO)
--   "When NO subsidy is applicable on a date, _w_subsidy must fall back to the
--   raw value (not NULL)." So:
--     bba_import_parity_w_subsidy := bba_import_parity - COALESCE(reimb, 0)
--     petrobras_price_w_subsidy   := petrobras_price   + COALESCE(reimb, 0)
--
--   Effect: pre-period rows show w_subsidy == raw; from the first ANP period
--   onward, w_subsidy diverges by the regional-cap-bounded reimbursement.
--
-- CHANGES
--   1. Recreate _pb_populate_w_subsidy() with COALESCE(reimb, 0).
--      Trigger binding `populate_pb_w_subsidy_on_insert` survives the
--      CREATE OR REPLACE FUNCTION (we are not dropping the function).
--   2. DROP + recreate get_subsidy_tracker_diesel() with COALESCE(reimb, 0)
--      in the ipp_adjusted / petrobras_adjusted projections. PT suffixes
--      preserved (matches /subsidy-tracker TS contract — restored in
--      20260527900000_subsidy_tracker_restore_pt_suffixes). SECURITY DEFINER
--      + search_path + GRANT re-applied explicitly (Pegadinha #18).
--   3. Backfill: force a no-op UPDATE on every Diesel row so the BEFORE
--      trigger fires with the new COALESCE behaviour. After this UPDATE,
--      no Diesel row should have NULL _w_subsidy where raw IS NOT NULL.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. _pb_populate_w_subsidy: COALESCE reimbursement to 0 (raw fallback)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._pb_populate_w_subsidy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reimb_imp NUMERIC;
  v_reimb_prd NUMERIC;
BEGIN
  IF NEW.product IS DISTINCT FROM 'Diesel' THEN
    RETURN NEW;
  END IF;

  v_reimb_imp := public.compute_subsidy_reimbursement(NEW.date, 'importador');
  v_reimb_prd := public.compute_subsidy_reimbursement(NEW.date, 'produtor');

  -- Fallback rule: when reimbursement is NULL (no subsidy applies on this
  -- date), treat it as 0 so w_subsidy == raw. Only NULL out when the raw
  -- value itself is NULL.
  IF NEW.bba_import_parity IS NULL THEN
    NEW.bba_import_parity_w_subsidy := NULL;
  ELSE
    NEW.bba_import_parity_w_subsidy := NEW.bba_import_parity - COALESCE(v_reimb_imp, 0);
  END IF;

  IF NEW.petrobras_price IS NULL THEN
    NEW.petrobras_price_w_subsidy := NULL;
  ELSE
    NEW.petrobras_price_w_subsidy := NEW.petrobras_price + COALESCE(v_reimb_prd, 0);
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public._pb_populate_w_subsidy() IS
  'BEFORE INSERT/UPDATE trigger fn on price_bands. For Diesel rows, recompute bba_import_parity_w_subsidy and petrobras_price_w_subsidy. When no subsidy applies on a date (compute_subsidy_reimbursement returns NULL), w_subsidy falls back to the raw value via COALESCE(reimb, 0) so the YTD-average series remains continuous from Jan onward (CTO rule 2026-05-28).';

-- The trigger binding `populate_pb_w_subsidy_on_insert` from migration
-- 20260527200000 is preserved automatically — CREATE OR REPLACE FUNCTION
-- keeps existing triggers bound to the same name.

-- -----------------------------------------------------------------------------
-- 2. get_subsidy_tracker_diesel: COALESCE(reimb, 0) in adjusted projections
--    DROP+CREATE because the RETURNS TABLE signature isn't changing but we
--    apply the same idiom used in 20260527900000 for clarity / consistency.
--    PT suffixes preserved.
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
  regions_produtor                  JSONB
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
  )
  SELECT d.date,
         pb.ipp,
         -- Fallback: w_subsidy = raw when no subsidy applies (CTO 2026-05-28).
         CASE WHEN pb.ipp IS NULL
              THEN NULL
              ELSE pb.ipp - COALESCE(rb.r_imp, 0)
         END AS ipp_adjusted,
         pb.petrobras,
         CASE WHEN pb.petrobras IS NULL
              THEN NULL
              ELSE pb.petrobras + COALESCE(rb.r_prd, 0)
         END AS petrobras_adjusted,
         ri.anp_reference   AS anp_reference_importador,
         rp.anp_reference   AS anp_reference_produtor,
         ci.anp_commercialization AS anp_commercialization_importador,
         cp.anp_commercialization AS anp_commercialization_produtor,
         ri.regions         AS regions_importador,
         rp.regions         AS regions_produtor
    FROM all_dates d
    LEFT JOIN pb       ON pb.date = d.date
    LEFT JOIN ref_imp  ri ON ri.date = d.date
    LEFT JOIN ref_prd  rp ON rp.date = d.date
    LEFT JOIN comm_imp ci ON ci.date = d.date
    LEFT JOIN comm_prd cp ON cp.date = d.date
    LEFT JOIN reimb    rb ON rb.date = d.date
   ORDER BY d.date;
$$;

COMMENT ON FUNCTION public.get_subsidy_tracker_diesel() IS
  'Subsidy tracker daily series for diesel. ipp_adjusted = ipp - COALESCE(reimb_importador, 0); petrobras_adjusted = petrobras + COALESCE(reimb_produtor, 0). When no subsidy applies on a date, adjusted == raw (CTO rule 2026-05-28 — keeps YTD averages continuous from Jan). PT suffixes match the TS contract in src/lib/rpc.ts. SECURITY DEFINER + search_path so anon reads work despite RLS (Pegadinha #18).';

GRANT EXECUTE ON FUNCTION public.get_subsidy_tracker_diesel() TO anon, authenticated;

-- Pre-flight sanity: confirm SECURITY DEFINER preserved (Pegadinha #18 audit).
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
END $$;

-- -----------------------------------------------------------------------------
-- 3. Backfill: re-fire BEFORE trigger on every Diesel row.
--    `SET date = date` is a semantic no-op but counts as an UPDATE OF date,
--    which is in the trigger's column list — fires _pb_populate_w_subsidy()
--    with the new COALESCE semantics. After this, every Diesel row with a
--    non-NULL raw value has a non-NULL _w_subsidy.
-- -----------------------------------------------------------------------------
UPDATE public.price_bands
   SET date = date
 WHERE product = 'Diesel';

COMMIT;
