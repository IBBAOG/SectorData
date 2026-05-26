-- =============================================================================
-- Migration: subsidy_reform
-- Date: 2026-05-26 (timestamp slot 20260527200000)
-- =============================================================================
--
-- Reform of the diesel subsidy calculation.
--
-- BEFORE: get_subsidy_tracker_diesel treated anp_subsidy_history.subsidio_brl_l
--         as the *difference* between reference and commercialization prices:
--           commercialization = reference - subsidio_brl_l   (WRONG)
--
-- AFTER:  subsidio_brl_l is actually the CAP (ceiling) of the reimbursement.
--         The reimbursement to Petrobras / importers is, per region:
--           reimb_region = MIN(MAX(ref_daily - comm_period, 0), cap_agente_period)
--         then averaged across the 5 regions.
--           IPP_adjusted        = IPP - reimb_importador
--           Petrobras_adjusted  = Petrobras + reimb_produtor
--
-- Changes:
--   1. DROP anp_subsidy_history (semantically wrong).
--   2. CREATE anp_subsidy_caps      — caps by (vigente_desde, tipo_agente).
--   3. CREATE anp_subsidy_commercialization — period x regiao x tipo_agente
--      commercialization prices (populated by ETL HTML scrape stage).
--   4. CREATE FUNCTION compute_subsidy_reimbursement(date, tipo_agente).
--   5. Triggers on price_bands / reference / commercialization / caps that
--      auto-populate price_bands.bba_import_parity_w_subsidy and
--      price_bands.petrobras_price_w_subsidy whenever any input changes.
--   6. REWRITE RPC get_subsidy_tracker_diesel() to use the correct formula.
--
-- All RPC + function definitions are SECURITY DEFINER + search_path set
-- (Pegadinha #18 — anon role would otherwise silently get NULLs).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Drop wrong-semantics history table
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.anp_subsidy_history CASCADE;

-- -----------------------------------------------------------------------------
-- 2. Caps by (vigente_desde, tipo_agente)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.anp_subsidy_caps (
  vigente_desde DATE NOT NULL,
  tipo_agente   TEXT NOT NULL CHECK (tipo_agente IN ('importador','produtor')),
  cap_brl_l     NUMERIC(10,4) NOT NULL CHECK (cap_brl_l >= 0),
  observacao    TEXT,
  inserted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vigente_desde, tipo_agente)
);

COMMENT ON TABLE public.anp_subsidy_caps IS
  'Diesel subsidy caps by (vigente_desde, tipo_agente). cap_brl_l is the CEILING of the per-region reimbursement; the actual reimbursement is MIN(MAX(ref - comm, 0), cap). Owner: worker_supabase. Maintained manually for now (very low cardinality — handful of rows per year).';

-- Seed: known caps as of 2026-03-13 (unified 0.32) and 2026-04-07 (split).
INSERT INTO public.anp_subsidy_caps (vigente_desde, tipo_agente, cap_brl_l, observacao) VALUES
  ('2026-03-13', 'importador', 0.32, 'Subsidio inicial unificado'),
  ('2026-03-13', 'produtor',   0.32, 'Subsidio inicial unificado'),
  ('2026-04-07', 'importador', 1.52, 'Split: 1.20 + 0.32 (importador)'),
  ('2026-04-07', 'produtor',   1.12, 'Split: 0.80 + 0.32 (produtor nacional proprio)')
ON CONFLICT (vigente_desde, tipo_agente) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Commercialization price (period x regiao x tipo_agente)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.anp_subsidy_commercialization (
  data_inicio           DATE NOT NULL,
  data_fim              DATE NOT NULL,
  regiao                TEXT NOT NULL CHECK (regiao IN ('NORTE','NORDESTE','CENTRO-OESTE','SUDESTE','SUL')),
  tipo_agente           TEXT NOT NULL CHECK (tipo_agente IN ('importador','produtor')),
  preco_comercializacao NUMERIC(10,4) NOT NULL CHECK (preco_comercializacao >= 0),
  ordinal               INT,
  pdf_url               TEXT,
  inserted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (data_inicio, regiao, tipo_agente),
  CHECK (data_fim >= data_inicio)
);

COMMENT ON TABLE public.anp_subsidy_commercialization IS
  'Diesel commercialization prices published by ANP per period (data_inicio..data_fim) x regiao x tipo_agente. Populated by the HTML scrape stage of scripts/pipelines/anp/subsidy_diesel_sync.py (URL: subvencao-a-comercializacao-de-oleo-diesel-rodoviario-<year>). Each ANP page block becomes 10 rows (5 regions x 2 agent types). Owner: worker_supabase (schema); worker_etl-pipelines (data).';

CREATE INDEX IF NOT EXISTS idx_comm_data_fim ON public.anp_subsidy_commercialization (data_fim);
CREATE INDEX IF NOT EXISTS idx_comm_lookup   ON public.anp_subsidy_commercialization (regiao, tipo_agente, data_inicio);

-- -----------------------------------------------------------------------------
-- 4. RLS — read-open for anon/authenticated; writes only via service-role
-- -----------------------------------------------------------------------------
ALTER TABLE public.anp_subsidy_caps               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anp_subsidy_commercialization  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS caps_read ON public.anp_subsidy_caps;
CREATE POLICY caps_read
  ON public.anp_subsidy_caps
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS comm_read ON public.anp_subsidy_commercialization;
CREATE POLICY comm_read
  ON public.anp_subsidy_commercialization
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.anp_subsidy_caps              TO anon, authenticated;
GRANT SELECT ON public.anp_subsidy_commercialization TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. compute_subsidy_reimbursement(date, tipo_agente)
--
--    Returns the average across the 5 regions of:
--      MIN(MAX(reference_daily - commercialization_period, 0), cap_period)
--    Returns NULL if no reference or no commercialization data is available
--    for the given date.
--
--    SECURITY DEFINER + explicit search_path so anon callers can read tables
--    with RLS enabled (Pegadinha #18 in CLAUDE.md).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_subsidy_reimbursement(
  p_date        DATE,
  p_tipo_agente TEXT
) RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH cap AS (
    SELECT cap_brl_l
    FROM public.anp_subsidy_caps
    WHERE tipo_agente   = p_tipo_agente
      AND vigente_desde <= p_date
    ORDER BY vigente_desde DESC
    LIMIT 1
  ),
  regional AS (
    SELECT LEAST(
             GREATEST(r.preco_referencia - c.preco_comercializacao, 0),
             (SELECT cap_brl_l FROM cap)
           ) AS reimb
    FROM public.anp_subsidy_diesel_reference r
    JOIN public.anp_subsidy_commercialization c
      ON c.regiao       = r.regiao
     AND c.tipo_agente  = r.tipo_agente
     AND p_date BETWEEN c.data_inicio AND c.data_fim
    WHERE r.data_referencia = p_date
      AND r.tipo_agente     = p_tipo_agente
  )
  SELECT AVG(reimb)::NUMERIC FROM regional;
$$;

COMMENT ON FUNCTION public.compute_subsidy_reimbursement(DATE, TEXT) IS
  'Per-day, per-agent diesel subsidy reimbursement: AVG over 5 regions of MIN(MAX(ref - comm, 0), cap). Returns NULL if no data. SECURITY DEFINER + search_path so anon callers see real data (Pegadinha #18). Caller convention: tipo_agente is one of (''importador'',''produtor'').';

GRANT EXECUTE ON FUNCTION public.compute_subsidy_reimbursement(DATE, TEXT) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Trigger functions — keep price_bands._w_subsidy in sync
-- -----------------------------------------------------------------------------

-- 6a. BEFORE INSERT/UPDATE on price_bands itself.
--     When a Diesel row lands or is edited, compute the _w_subsidy columns
--     before the row is written, so the row is always self-consistent.
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

  IF v_reimb_imp IS NOT NULL AND NEW.bba_import_parity IS NOT NULL THEN
    NEW.bba_import_parity_w_subsidy := NEW.bba_import_parity - v_reimb_imp;
  ELSE
    NEW.bba_import_parity_w_subsidy := NULL;
  END IF;

  IF v_reimb_prd IS NOT NULL AND NEW.petrobras_price IS NOT NULL THEN
    NEW.petrobras_price_w_subsidy := NEW.petrobras_price + v_reimb_prd;
  ELSE
    NEW.petrobras_price_w_subsidy := NULL;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public._pb_populate_w_subsidy() IS
  'BEFORE INSERT/UPDATE trigger fn on price_bands. For Diesel rows, recompute bba_import_parity_w_subsidy and petrobras_price_w_subsidy using compute_subsidy_reimbursement().';

DROP TRIGGER IF EXISTS populate_pb_w_subsidy_on_insert ON public.price_bands;
CREATE TRIGGER populate_pb_w_subsidy_on_insert
  BEFORE INSERT OR UPDATE OF date, product, bba_import_parity, petrobras_price
  ON public.price_bands
  FOR EACH ROW
  EXECUTE FUNCTION public._pb_populate_w_subsidy();

-- 6b. Helper: refresh price_bands rows for one or many dates.
--     Re-runs the BEFORE trigger by issuing a no-op UPDATE of `date`.
CREATE OR REPLACE FUNCTION public._pb_refresh_w_subsidy_for_dates(p_dates DATE[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_dates IS NULL OR array_length(p_dates, 1) IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.price_bands
     SET date = date  -- triggers BEFORE UPDATE OF date -> recomputes _w_subsidy
   WHERE product = 'Diesel'
     AND date = ANY (p_dates);
END;
$$;

COMMENT ON FUNCTION public._pb_refresh_w_subsidy_for_dates(DATE[]) IS
  'Refreshes price_bands._w_subsidy for the given Diesel dates by triggering a self-UPDATE that fires populate_pb_w_subsidy_on_insert.';

CREATE OR REPLACE FUNCTION public._pb_refresh_w_subsidy_from_date(p_from DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_from IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.price_bands
     SET date = date  -- triggers BEFORE UPDATE OF date -> recomputes _w_subsidy
   WHERE product = 'Diesel'
     AND date >= p_from;
END;
$$;

COMMENT ON FUNCTION public._pb_refresh_w_subsidy_from_date(DATE) IS
  'Refreshes price_bands._w_subsidy for all Diesel rows on/after p_from.';

-- 6c. AFTER trigger on anp_subsidy_diesel_reference — recompute the affected
--     date (single day, since reference is daily).
CREATE OR REPLACE FUNCTION public._on_subsidy_reference_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public._pb_refresh_w_subsidy_for_dates(ARRAY[OLD.data_referencia]);
  ELSE
    PERFORM public._pb_refresh_w_subsidy_for_dates(ARRAY[NEW.data_referencia]);
    IF TG_OP = 'UPDATE' AND OLD.data_referencia IS DISTINCT FROM NEW.data_referencia THEN
      PERFORM public._pb_refresh_w_subsidy_for_dates(ARRAY[OLD.data_referencia]);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public._on_subsidy_reference_change() IS
  'AFTER trigger on anp_subsidy_diesel_reference: refreshes price_bands._w_subsidy for the affected date(s).';

DROP TRIGGER IF EXISTS recompute_pb_on_reference_change ON public.anp_subsidy_diesel_reference;
CREATE TRIGGER recompute_pb_on_reference_change
  AFTER INSERT OR UPDATE OR DELETE
  ON public.anp_subsidy_diesel_reference
  FOR EACH ROW
  EXECUTE FUNCTION public._on_subsidy_reference_change();

-- 6d. AFTER trigger on anp_subsidy_commercialization — recompute all dates
--     in [data_inicio, data_fim] of OLD/NEW.
CREATE OR REPLACE FUNCTION public._on_subsidy_commercialization_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_min DATE;
  v_max DATE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_min := OLD.data_inicio;
    v_max := OLD.data_fim;
  ELSIF TG_OP = 'UPDATE' THEN
    v_min := LEAST(OLD.data_inicio, NEW.data_inicio);
    v_max := GREATEST(OLD.data_fim, NEW.data_fim);
  ELSE -- INSERT
    v_min := NEW.data_inicio;
    v_max := NEW.data_fim;
  END IF;

  UPDATE public.price_bands
     SET date = date
   WHERE product = 'Diesel'
     AND date BETWEEN v_min AND v_max;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public._on_subsidy_commercialization_change() IS
  'AFTER trigger on anp_subsidy_commercialization: refreshes price_bands._w_subsidy across the affected period.';

DROP TRIGGER IF EXISTS recompute_pb_on_comm_change ON public.anp_subsidy_commercialization;
CREATE TRIGGER recompute_pb_on_comm_change
  AFTER INSERT OR UPDATE OR DELETE
  ON public.anp_subsidy_commercialization
  FOR EACH ROW
  EXECUTE FUNCTION public._on_subsidy_commercialization_change();

-- 6e. AFTER trigger on anp_subsidy_caps — recompute all Diesel rows from
--     min(OLD.vigente_desde, NEW.vigente_desde) onwards.
CREATE OR REPLACE FUNCTION public._on_subsidy_caps_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from DATE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_from := OLD.vigente_desde;
  ELSIF TG_OP = 'UPDATE' THEN
    v_from := LEAST(OLD.vigente_desde, NEW.vigente_desde);
  ELSE -- INSERT
    v_from := NEW.vigente_desde;
  END IF;

  PERFORM public._pb_refresh_w_subsidy_from_date(v_from);
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public._on_subsidy_caps_change() IS
  'AFTER trigger on anp_subsidy_caps: refreshes price_bands._w_subsidy for all Diesel rows from the affected vigente_desde onward.';

DROP TRIGGER IF EXISTS recompute_pb_on_caps_change ON public.anp_subsidy_caps;
CREATE TRIGGER recompute_pb_on_caps_change
  AFTER INSERT OR UPDATE OR DELETE
  ON public.anp_subsidy_caps
  FOR EACH ROW
  EXECUTE FUNCTION public._on_subsidy_caps_change();

-- -----------------------------------------------------------------------------
-- 7. RPC rewrite: get_subsidy_tracker_diesel()
--
--    Returns one row per date with cru + adjusted values.
--    SECURITY DEFINER + search_path — anon SELECT works (Pegadinha #18).
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
  'Subsidy tracker daily series for diesel: IPP, IPP_adjusted (IPP - reimb_importador), Petrobras, Petrobras_adjusted (Petrobras + reimb_produtor), plus ANP reference/commercialization aggregates and per-region jsonb for tooltips. Replaces the older wrong formula (commercialization = reference - subsidio_brl_l). SECURITY DEFINER + search_path so anon reads work despite RLS (Pegadinha #18).';

GRANT EXECUTE ON FUNCTION public.get_subsidy_tracker_diesel() TO anon, authenticated;

COMMIT;
