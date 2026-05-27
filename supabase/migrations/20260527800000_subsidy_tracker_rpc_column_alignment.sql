-- ============================================================================
-- Subsidy Tracker — align RPC column names with the TypeScript contract.
--
-- Context
--   Migration 20260527200000_subsidy_reform.sql rewrote
--   get_subsidy_tracker_diesel() with Portuguese-suffixed columns
--   (anp_reference_importador / _produtor, anp_commercialization_importador /
--   _produtor, regions_importador / _produtor).
--
--   The TypeScript layer (src/lib/rpc.ts SubsidyTrackerRow + the entire
--   /subsidy-tracker dashboard hook) addresses these columns with the
--   pre-reform English suffix (_importer / _producer).
--
--   Result of the drift: PostgREST returns row objects keyed by the
--   Portuguese names; row.anp_reference_importer === undefined; the Reference
--   and Commercialization traces render as NaN/empty on the chart. IPP and
--   Petrobras traces still render because those names match.
--
-- Resolution
--   Rename the RPC return columns to the English suffix the dashboard expects.
--   Keep ipp_adjusted / petrobras_adjusted as-is (already English, harmless).
--
-- Side-effects of DROP+CREATE (CLAUDE.md Pegadinha #18):
--   * search_path TO 'public', 'pg_temp' must be re-declared (done below).
--   * SECURITY DEFINER must be re-declared (done below).
--   * GRANT EXECUTE TO anon, authenticated must be re-issued (done below).
--   * The function body is otherwise identical to the reform version — it
--     still goes through compute_subsidy_reimbursement / the cap-bounded
--     regional average; only the OUTPUT column names change.
--
-- Ordering: ORDER BY d.date is preserved (ascending) — the frontend wrapper
-- in src/lib/rpc.ts paginates via .range() and accumulates every page, so the
-- order is consistent with the existing ascending-date assumption in
-- useSubsidyTrackerData.ts (Array.from(seen).sort() ascending).
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_subsidy_tracker_diesel();

CREATE OR REPLACE FUNCTION public.get_subsidy_tracker_diesel()
RETURNS TABLE (
  date                              DATE,
  ipp                               NUMERIC,
  ipp_adjusted                      NUMERIC,
  petrobras                         NUMERIC,
  petrobras_adjusted                NUMERIC,
  anp_reference_importer            NUMERIC,
  anp_reference_producer            NUMERIC,
  anp_commercialization_importer    NUMERIC,
  anp_commercialization_producer    NUMERIC,
  regions_importer                  JSONB,
  regions_producer                  JSONB
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
         ri.anp_reference   AS anp_reference_importer,
         rp.anp_reference   AS anp_reference_producer,
         ci.anp_commercialization AS anp_commercialization_importer,
         cp.anp_commercialization AS anp_commercialization_producer,
         ri.regions         AS regions_importer,
         rp.regions         AS regions_producer
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
  'Subsidy tracker daily series for diesel: IPP, IPP_adjusted (IPP - reimb_importer), Petrobras, Petrobras_adjusted (Petrobras + reimb_producer), plus ANP reference/commercialization aggregates and per-region jsonb for tooltips. Column suffixes are English (_importer / _producer) to match the TypeScript contract in src/lib/rpc.ts (SubsidyTrackerRow). SECURITY DEFINER + search_path so anon reads work despite RLS (Pegadinha #18).';

GRANT EXECUTE ON FUNCTION public.get_subsidy_tracker_diesel() TO anon, authenticated;

-- Pre-flight sanity: confirm SECURITY DEFINER preserved (audit per Pegadinha #18).
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
