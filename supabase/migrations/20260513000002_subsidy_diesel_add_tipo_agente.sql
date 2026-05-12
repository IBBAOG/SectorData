-- ============================================================================
-- Subsidy Diesel — add tipo_agente column and rebuild PK
--
-- The ANP reference price PDFs publish two price tables per period:
--   'importador'  — importers and refiners of imported + domestic oil
--   'produtor'    — producers refining their own domestic crude
--
-- Without this column the unique key was (data_referencia, regiao), which
-- could not store both agent types for the same day+region.
--
-- Migration is safe to run even if the table is empty.
-- ============================================================================

-- 1. Drop the existing PK constraint (the column cannot have a default
--    while a PK enforces uniqueness — we need to add the column first).
ALTER TABLE public.anp_subsidy_diesel_reference
  DROP CONSTRAINT IF EXISTS anp_subsidy_diesel_reference_pkey;

-- 2. Add the new column (default 'importador' covers any existing rows).
ALTER TABLE public.anp_subsidy_diesel_reference
  ADD COLUMN IF NOT EXISTS tipo_agente TEXT NOT NULL DEFAULT 'importador';

-- 3. Recreate PK with the three-column composite key.
ALTER TABLE public.anp_subsidy_diesel_reference
  ADD CONSTRAINT anp_subsidy_diesel_reference_pkey
    PRIMARY KEY (data_referencia, regiao, tipo_agente);

-- 4. Update the RPC to filter only importador rows by default so existing
--    callers keep working unchanged (AVG across importador prices).
CREATE OR REPLACE FUNCTION public.get_subsidy_tracker_diesel()
RETURNS TABLE (
  date                  DATE,
  ipp                   NUMERIC,
  anp_reference         NUMERIC,
  anp_commercialization NUMERIC,
  petrobras             NUMERIC,
  regions               JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH daily_ref AS (
    SELECT
      data_referencia AS date,
      AVG(preco_referencia)::NUMERIC(10,4) AS anp_reference,
      jsonb_object_agg(regiao, preco_referencia) AS regions
    FROM public.anp_subsidy_diesel_reference
    WHERE tipo_agente = 'importador'
    GROUP BY data_referencia
  ),
  pb AS (
    SELECT date, bba_import_parity AS ipp, petrobras_price AS petrobras
    FROM public.price_bands
    WHERE product = 'Diesel'
  ),
  unified AS (
    SELECT COALESCE(pb.date, dr.date) AS date,
           pb.ipp,
           dr.anp_reference,
           dr.regions,
           pb.petrobras
    FROM pb FULL OUTER JOIN daily_ref dr USING (date)
  )
  SELECT u.date,
         u.ipp,
         u.anp_reference,
         CASE WHEN u.anp_reference IS NULL THEN NULL
              ELSE u.anp_reference - (
                SELECT h.subsidio_brl_l
                FROM public.anp_subsidy_history h
                WHERE h.vigente_desde <= u.date
                ORDER BY h.vigente_desde DESC
                LIMIT 1
              )
         END AS anp_commercialization,
         u.petrobras,
         u.regions
  FROM unified u
  ORDER BY u.date;
$$;

GRANT EXECUTE ON FUNCTION public.get_subsidy_tracker_diesel() TO authenticated;
