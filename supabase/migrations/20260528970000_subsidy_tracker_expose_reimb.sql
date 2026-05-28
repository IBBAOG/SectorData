-- =============================================================================
-- Migration: subsidy_tracker_expose_reimb
-- Date: 2026-05-28 (timestamp slot 20260528970000)
-- =============================================================================
--
-- CONTEXT
--   /subsidy-tracker mobile renders two "Reimbursement" columns
--   (Reimb. (Imp.) / Reimb. (Prod.)) computed on the FRONTEND as
--     reimb = anp_reference - anp_commercialization
--   This is the uncapped per-region difference average, ignoring the
--   regional cap published by ANP (R$ 1,52/L importador, R$ 1,12/L produtor
--   as of 2026-04). Result: mobile users see values like 1,56 R$/L that
--   exceed the cap and don't match what actually drives _w_subsidy.
--
--   The SQL-side capped reimbursement already exists:
--     public.compute_subsidy_reimbursement(date, tipo_agente)
--       -> AVG over 5 regions of MIN(MAX(ref - comm, 0), cap)
--   and is consumed by get_subsidy_tracker_diesel() inside ipp_adjusted /
--   petrobras_adjusted via COALESCE(reimb, 0). But the bare cap-aware value
--   is not surfaced.
--
-- CHANGE
--   DROP + CREATE get_subsidy_tracker_diesel() adding 2 columns at the END
--   of the RETURNS TABLE signature:
--     reimb_importador  NUMERIC  <- rb.r_imp (NULL when no subsidy applies)
--     reimb_produtor    NUMERIC  <- rb.r_prd (NULL when no subsidy applies)
--   The existing 11 columns and their projections (including the
--   COALESCE(reimb, 0) fallback on ipp_adjusted / petrobras_adjusted from
--   the CTO 2026-05-28 rule) are UNCHANGED.
--
-- WHY NULL (not COALESCE(_, 0)) FOR THE NEW COLUMNS
--   Per task spec: the frontend should render "—" when no subsidy applies
--   on a given date. NULL preserves that distinction; the existing
--   ipp_adjusted / petrobras_adjusted columns intentionally fall back to
--   the raw value via COALESCE so the YTD-average traces stay continuous,
--   but the reimbursement column itself is semantically absent on
--   pre-period dates, so we expose NULL.
--
-- PRESERVED INVARIANTS
--   - LANGUAGE sql STABLE
--   - SECURITY DEFINER + SET search_path = public, pg_temp (Pegadinha #18)
--   - GRANT EXECUTE TO anon, authenticated
--   - PT suffixes on column names (matches src/lib/rpc.ts TS contract)
--   - Pre-flight DO block confirms prosecdef=true after CREATE
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. DROP + CREATE get_subsidy_tracker_diesel() with 2 new columns at end
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
         rp.regions         AS regions_produtor,
         -- New cap-aware reimbursement columns: NULL when no subsidy applies
         -- (frontend renders "—"). Bounded by anp_subsidy_caps.cap_brl_l per
         -- compute_subsidy_reimbursement() definition (regional AVG of
         -- MIN(MAX(ref - comm, 0), cap)).
         rb.r_imp           AS reimb_importador,
         rb.r_prd           AS reimb_produtor
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
  'Subsidy tracker daily series for diesel. ipp_adjusted = ipp - COALESCE(reimb_importador, 0); petrobras_adjusted = petrobras + COALESCE(reimb_produtor, 0). New columns reimb_importador / reimb_produtor (2026-05-28 slot 970000) expose the cap-aware regional-AVG reimbursement value (bounded by anp_subsidy_caps); NULL on dates without applicable subsidy so the frontend can render "—". PT suffixes match the TS contract in src/lib/rpc.ts. SECURITY DEFINER + search_path so anon reads work despite RLS (Pegadinha #18).';

GRANT EXECUTE ON FUNCTION public.get_subsidy_tracker_diesel() TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Pre-flight sanity: confirm SECURITY DEFINER preserved (Pegadinha #18).
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
END $$;

COMMIT;
