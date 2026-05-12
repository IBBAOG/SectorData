-- ============================================================================
-- Subsidy Tracker — tables, indexes, RLS, RPC, module visibility
--
-- Dashboard: /subsidy-tracker
-- Consumer: dash-subsidy-tracker (APP)
-- ETL writes via service_role key; Admin users can also write.
-- Authenticated users read via SECURITY DEFINER RPC get_subsidy_tracker_diesel().
-- ============================================================================

-- ── Table: anp_subsidy_diesel_reference ──────────────────────────────────────
-- Stores ANP daily reference prices by region.
-- Populated by ETL pipeline (service_role).

CREATE TABLE IF NOT EXISTS public.anp_subsidy_diesel_reference (
  data_referencia DATE        NOT NULL,
  regiao          TEXT        NOT NULL,
  preco_referencia NUMERIC(10,4) NOT NULL,
  inserted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (data_referencia, regiao)
);

-- Index to speed up range queries on period slider
CREATE INDEX IF NOT EXISTS idx_anp_subsidy_ref_data
  ON public.anp_subsidy_diesel_reference (data_referencia);

-- ── RLS: anp_subsidy_diesel_reference ────────────────────────────────────────

ALTER TABLE public.anp_subsidy_diesel_reference ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all rows
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'anp_subsidy_diesel_reference'
      AND policyname = 'subsidy_ref authenticated read'
  ) THEN
    CREATE POLICY "subsidy_ref authenticated read"
      ON public.anp_subsidy_diesel_reference
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$policy$;

-- Service role (pipelines) has full write access
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'anp_subsidy_diesel_reference'
      AND policyname = 'subsidy_ref service role write'
  ) THEN
    CREATE POLICY "subsidy_ref service role write"
      ON public.anp_subsidy_diesel_reference
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END
$policy$;

-- Admin users can also write (INSERT / UPDATE / DELETE)
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'anp_subsidy_diesel_reference'
      AND policyname = 'subsidy_ref admin write'
  ) THEN
    CREATE POLICY "subsidy_ref admin write"
      ON public.anp_subsidy_diesel_reference
      FOR ALL TO authenticated
      USING (
        (SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) = 'Admin'
      )
      WITH CHECK (
        (SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) = 'Admin'
      );
  END IF;
END
$policy$;

-- ── Table: anp_subsidy_history ────────────────────────────────────────────────
-- Lookup table of effective subsidy rates.
-- Each row represents a rate in effect from vigente_desde until the next row.

CREATE TABLE IF NOT EXISTS public.anp_subsidy_history (
  vigente_desde   DATE           PRIMARY KEY,
  subsidio_brl_l  NUMERIC(10,4)  NOT NULL,
  observacao      TEXT
);

-- ── RLS: anp_subsidy_history ──────────────────────────────────────────────────

ALTER TABLE public.anp_subsidy_history ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all rows
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'anp_subsidy_history'
      AND policyname = 'subsidy_hist authenticated read'
  ) THEN
    CREATE POLICY "subsidy_hist authenticated read"
      ON public.anp_subsidy_history
      FOR SELECT TO authenticated USING (true);
  END IF;
END
$policy$;

-- Service role (pipelines) has full write access
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'anp_subsidy_history'
      AND policyname = 'subsidy_hist service role write'
  ) THEN
    CREATE POLICY "subsidy_hist service role write"
      ON public.anp_subsidy_history
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END
$policy$;

-- Admin users can also write (INSERT / UPDATE / DELETE)
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'anp_subsidy_history'
      AND policyname = 'subsidy_hist admin write'
  ) THEN
    CREATE POLICY "subsidy_hist admin write"
      ON public.anp_subsidy_history
      FOR ALL TO authenticated
      USING (
        (SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) = 'Admin'
      )
      WITH CHECK (
        (SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) = 'Admin'
      );
  END IF;
END
$policy$;

-- ── Seed: initial subsidy history ────────────────────────────────────────────

INSERT INTO public.anp_subsidy_history (vigente_desde, subsidio_brl_l, observacao) VALUES
  ('2026-03-13', 0.3200, 'Subsidio federal inicial'),
  ('2026-04-07', 1.5200, 'Adicao de R$ 1,20 ao subsidio base')
ON CONFLICT DO NOTHING;

-- ── Module visibility seed ────────────────────────────────────────────────────

INSERT INTO public.module_visibility (module_slug, is_visible_for_clients)
VALUES ('subsidy-tracker', true)
ON CONFLICT (module_slug) DO NOTHING;

-- ── RPC: get_subsidy_tracker_diesel ──────────────────────────────────────────
-- Returns a unified time series joining price_bands (Diesel) with ANP reference
-- prices, calculating anp_commercialization by subtracting the applicable subsidy
-- rate from the ANP reference price using a correlated subquery on subsidy history.
--
-- Columns:
--   date                  — calendar date
--   ipp                   — BBA import parity (from price_bands)
--   anp_reference         — average ANP reference price across all regions
--   anp_commercialization — anp_reference minus the subsidy in effect on that date
--   petrobras             — Petrobras official price (from price_bands)
--   regions               — jsonb mapping regiao → preco_referencia for that date

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
