-- anp_sintese_taxes — ANP Síntese de Preços published TAX lines (per litre).
--
-- The ANP "Síntese de Preços" weekly edition publishes a price-composition breakdown
-- that includes two tax lines per fuel: "Tributos Federais" (CIDE + PIS/PASEP + COFINS,
-- already summed by the ANP) and "ICMS" (state tax), both in R$/L. This table captures
-- exactly those published lines, week by week, so /diesel-gasoline-margins can use the
-- ANP-published taxes as the PRIMARY, auto-updating tax source.
--
-- Relationship to fuel_tax_reference: fuel_tax_reference stays as the curated
-- HISTORICAL / GAP fallback (time-versioned vigente_desde..vigente_ate rows maintained
-- by Admin/CONFAZ). recompute_dg_margins prefers a matching anp_sintese_taxes row for a
-- given week and falls back to fuel_tax_reference when the Síntese edition has no line
-- for that week. This migration does NOT touch fuel_tax_reference.
--
-- Chain: Step 1 (this table). Step 2 = ETL populates it from the Síntese editions.
-- Step 3 = recompute_dg_margins consumes it (prefer-then-fallback).
--
-- RLS pattern: SELECT to authenticated (frontend uses the anon key — reads flow through
-- SECURITY DEFINER RPCs, so no anon SELECT policy is needed); writes service_role ONLY
-- (the RLS-bypassing ETL pipeline). No anon/authenticated/admin write policy is defined.

CREATE TABLE IF NOT EXISTS public.anp_sintese_taxes (
  data_fim          DATE NOT NULL,                                   -- week-end (Saturday) the Síntese edition covers
  fuel_type         TEXT NOT NULL CHECK (fuel_type IN ('Gasoline C', 'Diesel B')),
  federal_rs_litro  NUMERIC NOT NULL,                                -- Síntese "Tributos Federais" line (R$/L)
  icms_rs_litro     NUMERIC NOT NULL,                                -- Síntese "ICMS" line (R$/L)
  fonte             TEXT DEFAULT 'ANP Síntese de Preços (composição)',
  sintese_edicao    TEXT,                                            -- edition id/filename for traceability (e.g. 'sintese-precos-19' / '2026')
  created_at        TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT anp_sintese_taxes_pkey PRIMARY KEY (data_fim, fuel_type)
);

-- Lookup index: recompute_dg_margins resolves taxes per (fuel_type, week-end).
CREATE INDEX IF NOT EXISTS anp_sintese_taxes_fuel_data_idx
  ON public.anp_sintese_taxes (fuel_type, data_fim);

ALTER TABLE public.anp_sintese_taxes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anp_sintese_taxes_read ON public.anp_sintese_taxes;
CREATE POLICY anp_sintese_taxes_read
  ON public.anp_sintese_taxes
  FOR SELECT TO authenticated
  USING (true);
-- No INSERT/UPDATE/DELETE policy: only service_role (the ETL pipeline) writes, and it
-- bypasses RLS. There is intentionally no anon/public write path and no is_admin() write
-- path — this is an auto-populated source table, not a manually-curated reference.

COMMENT ON TABLE public.anp_sintese_taxes IS
  'ANP Síntese de Preços published tax lines (Tributos Federais + ICMS, R$/L) per week-end (data_fim) and fuel_type. Primary auto-updating tax source for /diesel-gasoline-margins; fuel_tax_reference is the historical/gap fallback. Populated by the ETL pipeline (service_role).';
