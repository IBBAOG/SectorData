-- =============================================================================
-- Migration: subsidy_tracker_restore_pt_suffixes
-- Date: 2026-05-27 (timestamp slot 20260527900000)
-- =============================================================================
--
-- EMERGENCY FIX (prod):
--   `20260527800000_subsidy_tracker_rpc_column_alignment` renamed RPC OUT
--   columns from PT (anp_reference_importador, regions_produtor, ...) to EN
--   (anp_reference_importer, regions_producer, ...) based on a stale parent
--   worktree read of src/lib/rpc.ts. The actual contract on origin/main is
--   PT — both src/lib/rpc.ts and src/app/(dashboard)/subsidy-tracker/
--   useSubsidyTrackerData.ts read row.anp_reference_importador etc.
--
--   Result: /subsidy-tracker is currently broken in prod — TS reads
--   undefined properties and traces are empty.
--
-- THIS MIGRATION:
--   Restores the get_subsidy_tracker_diesel() signature to the PT contract
--   that matches origin/main TS. Body is identical to the original
--   `20260527200000_subsidy_reform` definition. SECURITY DEFINER + grants
--   re-applied explicitly (Pegadinha #18 — DROP+CREATE strips them).
-- =============================================================================

BEGIN;

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
         CASE WHEN pb.ipp IS NULL OR rb.r_imp IS NULL
              THEN NULL
              ELSE pb.ipp - rb.r_imp
         END AS ipp_adjusted,
         pb.petrobras,
         CASE WHEN pb.petrobras IS NULL OR rb.r_prd IS NULL
              THEN NULL
              ELSE pb.petrobras + rb.r_prd
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
  'Subsidy tracker daily series for diesel: IPP, IPP_adjusted (IPP - reimb_importador), Petrobras, Petrobras_adjusted (Petrobras + reimb_produtor), plus ANP reference/commercialization aggregates and per-region jsonb for tooltips. PT suffixes (importador/produtor) match the TS contract in src/lib/rpc.ts. SECURITY DEFINER + search_path so anon reads work despite RLS (Pegadinha #18).';

GRANT EXECUTE ON FUNCTION public.get_subsidy_tracker_diesel() TO anon, authenticated;

COMMIT;
