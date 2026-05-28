-- Refine PetroReconcavo stake assignments to match the company's
-- April/2026 oil production figure published in the official PDF
-- (~13,499 bbl/d). The prior consolidation migration
-- (20260528980000) over-attributed 4 fields to PetroReconcavo, lifting
-- the dashboard total to 15,947 bbl/d (+18%).
--
-- Corrections:
--   TAQUIPE          → Petrobras 100      (PetroR is only the field operator under
--                                          contract, not an equity holder)
--   ANGICO           → Brava Energia 100  (Brava is a standalone E&P, not a
--                                          PetroReconcavo subsidiary)
--   SABIÁ BICO-DE-OSSO → PetroReconcavo 70 + SHB Energia 30
--                                         (Potiguar E&P is a PetroR subsidiary, so
--                                          70% rolls up to the parent; SHB is
--                                          independent and was wrongly absorbed)
--   SABIÁ DA MATA    → PetroReconcavo 70 + SHB Energia 30  (same rationale)
--
-- Invariant SUM(stake_pct)=100 per campo is preserved.

BEGIN;

-- TAQUIPE: revert to Petrobras 100 (PetroR is operator-only, not owner)
DELETE FROM field_stakes WHERE campo = 'TAQUIPE';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('TAQUIPE', 'Petrobras', 100.000, now(), NULL);

-- ANGICO: revert to Brava Energia 100
DELETE FROM field_stakes WHERE campo = 'ANGICO';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('ANGICO', 'Brava Energia', 100.000, now(), NULL);

-- SABIÁ BICO-DE-OSSO: PetroR 70 (via Potiguar E&P) + SHB 30
DELETE FROM field_stakes WHERE campo = 'SABIÁ BICO-DE-OSSO';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by) VALUES
  ('SABIÁ BICO-DE-OSSO', 'PetroReconcavo', 70.000, now(), NULL),
  ('SABIÁ BICO-DE-OSSO', 'SHB Energia',    30.000, now(), NULL);

-- SABIÁ DA MATA: PetroR 70 (via Potiguar E&P) + SHB 30
DELETE FROM field_stakes WHERE campo = 'SABIÁ DA MATA';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by) VALUES
  ('SABIÁ DA MATA', 'PetroReconcavo', 70.000, now(), NULL),
  ('SABIÁ DA MATA', 'SHB Energia',    30.000, now(), NULL);

COMMIT;

-- Refresh dependent MVs so /well-by-well and the company aggregate
-- reflect the corrected stakes. CONCURRENTLY requires a unique index
-- (already present on each MV).
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_brazil_monthly;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_production_monthly;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_production_installation_monthly;
