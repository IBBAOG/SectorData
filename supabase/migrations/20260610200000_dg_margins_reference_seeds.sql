-- Diesel & Gasoline margin automation — Wave 1: reference-table seeds.
--
-- Recent / confirmed values only. The back-test validated these against the manual
-- d_g_margins sheet. The earliest vigente_desde is opened at 2015-01-01 so the lookup
-- covers the whole d_g_margins history with these as the baseline; Wave 2 refines the
-- pre-2026 timeline (full CEPEA/production backfill + pre-2025 tax/blend history).
--
-- All seeds idempotent via ON CONFLICT on the natural UNIQUE keys.

-- ---------------------------------------------------------------------------
-- fuel_blend_ratio — E27 -> E30 (Lei 14.993/2024, Combustivel do Futuro);
--                    B14 -> B15. Pre-2024 diesel timeline left for Wave 2.
-- ---------------------------------------------------------------------------
INSERT INTO public.fuel_blend_ratio (vigente_desde, vigente_ate, fuel_type, blend_pct, fonte) VALUES
  ('2015-04-01', '2025-07-31', 'Gasoline C', 0.27, 'curated, back-test (E27)'),
  ('2025-08-01', NULL,         'Gasoline C', 0.30, 'curated, back-test (E30, Lei 14.993/2024)'),
  ('2024-03-01', '2025-07-31', 'Diesel B',   0.14, 'curated, back-test (B14)'),
  ('2025-08-01', NULL,         'Diesel B',   0.15, 'curated, back-test (B15)')
ON CONFLICT (vigente_desde, fuel_type) DO UPDATE
  SET vigente_ate = EXCLUDED.vigente_ate,
      blend_pct   = EXCLUDED.blend_pct,
      fonte       = EXCLUDED.fonte;

-- ---------------------------------------------------------------------------
-- fuel_tax_reference (R$/L).
-- federal_tax = SUM(rate) for tax_type <> 'ICMS'; state_tax = ICMS rate.
-- Federal totals are back-out values the back-test deduced from the manual sheet
-- (approximate per CTO). We model the federal total as a single PIS_PASEP row per
-- regime so SUM(non-ICMS) equals the documented total exactly.
-- ---------------------------------------------------------------------------

-- Gasoline C — federal total ~= 0.68241 (flat across the seeded window).
INSERT INTO public.fuel_tax_reference (vigente_desde, vigente_ate, fuel_type, tax_type, rate_rs_litro, fonte) VALUES
  ('2015-01-01', NULL, 'Gasoline C', 'PIS_PASEP', 0.68241, 'curated, back-test (federal total)')
ON CONFLICT (vigente_desde, fuel_type, tax_type) DO UPDATE
  SET vigente_ate = EXCLUDED.vigente_ate, rate_rs_litro = EXCLUDED.rate_rs_litro, fonte = EXCLUDED.fonte;

-- Gasoline C — ICMS: 1.478229 (baseline -> 2026-01-11), then 1.578789 (2026-01-12 -> NULL).
INSERT INTO public.fuel_tax_reference (vigente_desde, vigente_ate, fuel_type, tax_type, rate_rs_litro, fonte) VALUES
  ('2015-01-01', '2026-01-11', 'Gasoline C', 'ICMS', 1.478229, 'curated, back-test'),
  ('2026-01-12', NULL,         'Gasoline C', 'ICMS', 1.578789, 'curated, back-test')
ON CONFLICT (vigente_desde, fuel_type, tax_type) DO UPDATE
  SET vigente_ate = EXCLUDED.vigente_ate, rate_rs_litro = EXCLUDED.rate_rs_litro, fonte = EXCLUDED.fonte;

-- Diesel B — federal total: 0.320975 (baseline -> 2026-03-15), 0.02 (2026-03-16 -> 2026-04-05),
--            0.0 (2026-04-06 -> NULL). 2026-W11 ~= 2026-03-15 (ISO week 11 ends Sat 2026-03-14).
INSERT INTO public.fuel_tax_reference (vigente_desde, vigente_ate, fuel_type, tax_type, rate_rs_litro, fonte) VALUES
  ('2015-01-01', '2026-03-15', 'Diesel B', 'PIS_PASEP', 0.320975, 'curated, back-test (federal total)'),
  ('2026-03-16', '2026-04-05', 'Diesel B', 'PIS_PASEP', 0.02,     'curated, back-test (federal total)'),
  ('2026-04-06', NULL,         'Diesel B', 'PIS_PASEP', 0.0,      'curated, back-test (federal total)')
ON CONFLICT (vigente_desde, fuel_type, tax_type) DO UPDATE
  SET vigente_ate = EXCLUDED.vigente_ate, rate_rs_litro = EXCLUDED.rate_rs_litro, fonte = EXCLUDED.fonte;

-- Diesel B — ICMS: 1.124775 (baseline -> 2026-01-11), then 1.174988 (2026-01-12 -> NULL).
INSERT INTO public.fuel_tax_reference (vigente_desde, vigente_ate, fuel_type, tax_type, rate_rs_litro, fonte) VALUES
  ('2015-01-01', '2026-01-11', 'Diesel B', 'ICMS', 1.124775, 'curated, back-test'),
  ('2026-01-12', NULL,         'Diesel B', 'ICMS', 1.174988, 'curated, back-test')
ON CONFLICT (vigente_desde, fuel_type, tax_type) DO UPDATE
  SET vigente_ate = EXCLUDED.vigente_ate, rate_rs_litro = EXCLUDED.rate_rs_litro, fonte = EXCLUDED.fonte;
