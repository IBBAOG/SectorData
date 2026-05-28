-- Parque das Conchas (BC-10) partner update — historical succession fix.
--
-- The BC-10 block (campos ARGONAUTA, OSTRA, ABALONE) had QatarEnergy as the
-- 23% non-operating partner alongside Shell (operator, 50%) and ONGC (27%).
-- QatarEnergy sold its 23% stake to Enauta in 2019; Enauta merged with 3R in
-- 2024 to form Brava Energia. field_stakes was never updated to reflect the
-- succession, so /well-by-well Brava Apr/2026 oil totals were ~7,996 bbl/d
-- below the official Brava PDF (54,819 measured vs 62,816 reported).
--
-- This migration replaces the QatarEnergy row with Brava Energia in the 3
-- fields. The (campo, empresa) PK plus the SUM(stake_pct)=100 invariant per
-- campo are preserved.

BEGIN;

-- ARGONAUTA
DELETE FROM public.field_stakes WHERE campo = 'ARGONAUTA';
INSERT INTO public.field_stakes (campo, empresa, stake_pct, updated_at, updated_by) VALUES
  ('ARGONAUTA', 'Shell',         50.000, now(), NULL),
  ('ARGONAUTA', 'ONGC',          27.000, now(), NULL),
  ('ARGONAUTA', 'Brava Energia', 23.000, now(), NULL);

-- OSTRA
DELETE FROM public.field_stakes WHERE campo = 'OSTRA';
INSERT INTO public.field_stakes (campo, empresa, stake_pct, updated_at, updated_by) VALUES
  ('OSTRA', 'Shell',         50.000, now(), NULL),
  ('OSTRA', 'ONGC',          27.000, now(), NULL),
  ('OSTRA', 'Brava Energia', 23.000, now(), NULL);

-- ABALONE
DELETE FROM public.field_stakes WHERE campo = 'ABALONE';
INSERT INTO public.field_stakes (campo, empresa, stake_pct, updated_at, updated_by) VALUES
  ('ABALONE', 'Shell',         50.000, now(), NULL),
  ('ABALONE', 'ONGC',          27.000, now(), NULL),
  ('ABALONE', 'Brava Energia', 23.000, now(), NULL);

COMMIT;

REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_brazil_monthly;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_production_monthly;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_production_installation_monthly;
