-- ============================================================================
-- Subsidy Tracker — extend get_subsidy_tracker_diesel() to dual-agent output
--
-- The ETL pipeline scripts/pipelines/anp/subsidy_diesel_sync.py persists both
-- ANP reference price tables from each PDF, discriminated by tipo_agente:
--   'importador' — importers and refiners of imported + domestic oil
--   'produtor'   — producers refining their own domestic crude
--
-- Until now, the RPC only surfaced the importador side (filter at line 48 of
-- migration 20260513000002). This migration replaces the function with a
-- wide-row shape that returns BOTH agents in a single round-trip per date,
-- preserving the shared IPP / Petrobras context.
--
-- The return type changes, so this is DROP FUNCTION + CREATE FUNCTION
-- (CREATE OR REPLACE cannot alter return types). After the CREATE we must
-- re-declare SECURITY DEFINER, search_path, and re-grant EXECUTE — DROP+CREATE
-- wipes all attributes and grants (CLAUDE.md Pegadinha #18).
--
-- The dashboard /subsidy-tracker remains "Fuel Distribution Proprietary",
-- so EXECUTE is granted to `authenticated` only (NOT anon).
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_subsidy_tracker_diesel();

CREATE FUNCTION public.get_subsidy_tracker_diesel()
RETURNS TABLE (
  date                              DATE,
  ipp                               NUMERIC,
  anp_reference_importer            NUMERIC,
  anp_commercialization_importer    NUMERIC,
  anp_reference_producer            NUMERIC,
  anp_commercialization_producer    NUMERIC,
  petrobras                         NUMERIC,
  regions_importer                  JSONB,
  regions_producer                  JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH daily_ref_imp AS (
    SELECT data_referencia AS date,
           AVG(preco_referencia)::NUMERIC(10,4) AS anp_reference,
           jsonb_object_agg(regiao, preco_referencia) AS regions
    FROM public.anp_subsidy_diesel_reference
    WHERE tipo_agente = 'importador'
    GROUP BY data_referencia
  ),
  daily_ref_prod AS (
    SELECT data_referencia AS date,
           AVG(preco_referencia)::NUMERIC(10,4) AS anp_reference,
           jsonb_object_agg(regiao, preco_referencia) AS regions
    FROM public.anp_subsidy_diesel_reference
    WHERE tipo_agente = 'produtor'
    GROUP BY data_referencia
  ),
  pb AS (
    SELECT date, bba_import_parity AS ipp, petrobras_price AS petrobras
    FROM public.price_bands
    WHERE product = 'Diesel'
  ),
  -- union of every date that appears in any source
  all_dates AS (
    SELECT date FROM pb
    UNION SELECT date FROM daily_ref_imp
    UNION SELECT date FROM daily_ref_prod
  )
  SELECT d.date,
         pb.ipp,
         di.anp_reference AS anp_reference_importer,
         CASE WHEN di.anp_reference IS NULL THEN NULL
              ELSE di.anp_reference - (
                SELECT h.subsidio_brl_l
                FROM public.anp_subsidy_history h
                WHERE h.vigente_desde <= d.date
                ORDER BY h.vigente_desde DESC LIMIT 1)
         END AS anp_commercialization_importer,
         dp.anp_reference AS anp_reference_producer,
         CASE WHEN dp.anp_reference IS NULL THEN NULL
              ELSE dp.anp_reference - (
                SELECT h.subsidio_brl_l
                FROM public.anp_subsidy_history h
                WHERE h.vigente_desde <= d.date
                ORDER BY h.vigente_desde DESC LIMIT 1)
         END AS anp_commercialization_producer,
         pb.petrobras,
         di.regions AS regions_importer,
         dp.regions AS regions_producer
  FROM all_dates d
  LEFT JOIN pb USING (date)
  LEFT JOIN daily_ref_imp di USING (date)
  LEFT JOIN daily_ref_prod dp USING (date)
  ORDER BY d.date;
$$;

GRANT EXECUTE ON FUNCTION public.get_subsidy_tracker_diesel() TO authenticated;
