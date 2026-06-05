-- Diesel & Gasoline margin automation — Wave 1: reference + source tables.
--
-- Replaces the manual entry of `d_g_margins` (R$/L per ISO week, national) with an
-- automatic composition computed by `recompute_dg_margins()` (see the function
-- migration). These four tables hold the inputs that the manual sheet used to bake
-- in by hand:
--   * cepea_etanol_anidro   — weekly anhydrous-ethanol price (gasoline biofuel leg)
--   * anp_producao_derivados — national monthly refined-product output (import % split)
--   * fuel_tax_reference     — time-versioned per-litre taxes (federal = non-ICMS, state = ICMS)
--   * fuel_blend_ratio       — time-versioned mandatory biofuel blend (E27/E30, B14/B15)
--
-- RLS pattern: SELECT to authenticated (frontend uses the anon key — reads go through
-- SECURITY DEFINER RPCs, so no anon SELECT policy is needed here); writes via service_role
-- (RLS-bypassing pipelines) and, for the two manually-curated reference tables, via is_admin().

-- ---------------------------------------------------------------------------
-- 1) cepea_etanol_anidro — weekly anhydrous ethanol price (R$/L), CEPEA/ESALQ.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cepea_etanol_anidro (
  data_semana   DATE PRIMARY KEY,                       -- Saturday (ISO week last day) of the quoted week
  week          TEXT,                                   -- unpadded "W/YYYY" mirror of the ISO week
  preco_rs_litro NUMERIC NOT NULL,
  fonte         TEXT DEFAULT 'CEPEA/ESALQ',
  inserted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cepea_etanol_anidro ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cepea_etanol_anidro_read ON public.cepea_etanol_anidro;
CREATE POLICY cepea_etanol_anidro_read
  ON public.cepea_etanol_anidro
  FOR SELECT TO authenticated
  USING (true);
-- No INSERT/UPDATE/DELETE policy: only service_role (pipelines) writes; it bypasses RLS.

-- ---------------------------------------------------------------------------
-- 2) anp_producao_derivados — national monthly refined-product production (m3).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.anp_producao_derivados (
  ano        INT NOT NULL,
  mes        INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  produto    TEXT NOT NULL CHECK (produto IN ('GASOLINA A', 'OLEO DIESEL')),
  volume_m3  NUMERIC,
  fonte      TEXT,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ano, mes, produto)
);

ALTER TABLE public.anp_producao_derivados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anp_producao_derivados_read ON public.anp_producao_derivados;
CREATE POLICY anp_producao_derivados_read
  ON public.anp_producao_derivados
  FOR SELECT TO authenticated
  USING (true);
-- No write policy: service_role (pipeline) only.

-- ---------------------------------------------------------------------------
-- 3) fuel_tax_reference — time-versioned per-litre taxes (R$/L).
--    tax_type IN ('CIDE','PIS_PASEP','COFINS','ICMS').
--    federal_tax = SUM(non-ICMS); state_tax = ICMS. fuel_type matches d_g_margins.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fuel_tax_reference (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vigente_desde DATE NOT NULL,
  vigente_ate   DATE,                                   -- NULL = open-ended
  fuel_type     TEXT NOT NULL CHECK (fuel_type IN ('Diesel B', 'Gasoline C')),
  tax_type      TEXT NOT NULL CHECK (tax_type IN ('CIDE', 'PIS_PASEP', 'COFINS', 'ICMS')),
  rate_rs_litro NUMERIC NOT NULL,
  fonte         TEXT,
  inserted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fuel_tax_reference_period_chk CHECK (vigente_ate IS NULL OR vigente_ate >= vigente_desde),
  CONSTRAINT fuel_tax_reference_uq UNIQUE (vigente_desde, fuel_type, tax_type)
);

CREATE INDEX IF NOT EXISTS fuel_tax_reference_lookup_idx
  ON public.fuel_tax_reference (fuel_type, vigente_desde);

ALTER TABLE public.fuel_tax_reference ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fuel_tax_reference_read ON public.fuel_tax_reference;
CREATE POLICY fuel_tax_reference_read
  ON public.fuel_tax_reference
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS fuel_tax_reference_admin_write ON public.fuel_tax_reference;
CREATE POLICY fuel_tax_reference_admin_write
  ON public.fuel_tax_reference
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
-- service_role also writes (bypasses RLS); admins curate via the is_admin() policy.

-- ---------------------------------------------------------------------------
-- 4) fuel_blend_ratio — time-versioned mandatory biofuel blend (fraction, 0.30 not 30).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fuel_blend_ratio (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vigente_desde DATE NOT NULL,
  vigente_ate   DATE,                                   -- NULL = open-ended
  fuel_type     TEXT NOT NULL CHECK (fuel_type IN ('Diesel B', 'Gasoline C')),
  blend_pct     NUMERIC NOT NULL CHECK (blend_pct >= 0 AND blend_pct <= 1),
  fonte         TEXT,
  inserted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fuel_blend_ratio_period_chk CHECK (vigente_ate IS NULL OR vigente_ate >= vigente_desde),
  CONSTRAINT fuel_blend_ratio_uq UNIQUE (vigente_desde, fuel_type)
);

CREATE INDEX IF NOT EXISTS fuel_blend_ratio_lookup_idx
  ON public.fuel_blend_ratio (fuel_type, vigente_desde);

ALTER TABLE public.fuel_blend_ratio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fuel_blend_ratio_read ON public.fuel_blend_ratio;
CREATE POLICY fuel_blend_ratio_read
  ON public.fuel_blend_ratio
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS fuel_blend_ratio_admin_write ON public.fuel_blend_ratio;
CREATE POLICY fuel_blend_ratio_admin_write
  ON public.fuel_blend_ratio
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
