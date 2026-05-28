-- ============================================================================
-- Consolidate PetroReconcavo group field_stakes
-- ============================================================================
-- Background:
--   /well-by-well reports ~6 kbpd oil for PetroReconcavo (Apr/2026) while the
--   company's official PDF reports ~13.5 kbpd. Root cause: field_stakes has only
--   21 campos under empresa='PetroReconcavo'; ~44 campos operated by the group
--   (parent PetroRecôncavo, Mandacaru subsidiary, Recôncavo Energ SPE subsidiary)
--   are registered under wrong empresa labels (Potiguar E&P, Brava Energia,
--   SHB Energia, Petrobras, Reconcavo Energia) or are missing entirely.
--
-- Mechanic:
--   For each campo, DELETE all existing rows, then INSERT a single row crediting
--   100% to PetroReconcavo. Wrapped in a single transaction so the invariant
--   SUM(stake_pct)=100 per campo is preserved (no intermediate inconsistent state
--   visible to readers).
--
-- Refs:
--   field_stakes table: 20260527600000_field_stakes.sql
--   mv_brazil_monthly / mv_production_monthly: 20260528400000_well_by_well_perf_mv.sql
--   mv_production_installation_monthly: 20260528200000_production_installation_timeseries.sql
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Drop the lowercase legacy row first (stale 2022 variant; canonical row is
-- created below under the uppercase name in the Grupo B block).
-- ----------------------------------------------------------------------------
DELETE FROM field_stakes
 WHERE campo   = 'Rio Mariricu'
   AND empresa = 'Mandacaru Energia';

-- ----------------------------------------------------------------------------
-- Grupo A — operated by parent PetroRecôncavo (28 campos)
-- ----------------------------------------------------------------------------
DELETE FROM field_stakes WHERE campo = 'ANGICO';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('ANGICO', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'ASA BRANCA';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('ASA BRANCA', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'BOA ESPERANÇA';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('BOA ESPERANÇA', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'BREJINHO RN';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('BREJINHO RN', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'CACHOEIRINHA';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('CACHOEIRINHA', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'JAÇANÃ';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('JAÇANÃ', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'JANDUÍ';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('JANDUÍ', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'JUAZEIRO';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('JUAZEIRO', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'LAGOA DO PAULO';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('LAGOA DO PAULO', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'LAGOA DO PAULO NORTE';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('LAGOA DO PAULO NORTE', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'LAGOA DO PAULO SUL';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('LAGOA DO PAULO SUL', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'LESTE DE POÇO XAVIER';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('LESTE DE POÇO XAVIER', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'LIVRAMENTO';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('LIVRAMENTO', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'LORENA';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('LORENA', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'MAÇARICO';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('MAÇARICO', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'PARDAL';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('PARDAL', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'PATATIVA';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('PATATIVA', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'PATURI';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('PATURI', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'RIACHO DA FORQUILHA';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('RIACHO DA FORQUILHA', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'SABIÁ';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('SABIÁ', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'SABIÁ BICO-DE-OSSO';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('SABIÁ BICO-DE-OSSO', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'SABIÁ DA MATA';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('SABIÁ DA MATA', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'SABIÁ-LARANJEIRA';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('SABIÁ-LARANJEIRA', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'SIBITE';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('SIBITE', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'TAQUIPE';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('TAQUIPE', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'TRINCA FERRO';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('TRINCA FERRO', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'UPANEMA';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('UPANEMA', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'VARGINHA';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('VARGINHA', 'PetroReconcavo', 100.000, now(), NULL);

-- ----------------------------------------------------------------------------
-- Grupo B — operated by Mandacaru Energia subsidiary (12 campos)
-- ----------------------------------------------------------------------------
DELETE FROM field_stakes WHERE campo = 'ACAUÃ';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('ACAUÃ', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'BAIXA DO ALGODÃO';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('BAIXA DO ALGODÃO', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'CARDEAL';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('CARDEAL', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'COLIBRI';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('COLIBRI', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'DÓ-RÉ-MI';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('DÓ-RÉ-MI', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'FAZENDA CURRAL';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('FAZENDA CURRAL', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'FAZENDA MALAQUIAS';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('FAZENDA MALAQUIAS', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'PAJEÚ';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('PAJEÚ', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'RIO MARIRICU';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('RIO MARIRICU', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'RIO MOSSORÓ';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('RIO MOSSORÓ', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'TRÊS MARIAS';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('TRÊS MARIAS', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'URUTAU';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('URUTAU', 'PetroReconcavo', 100.000, now(), NULL);

-- ----------------------------------------------------------------------------
-- Grupo C — operated by Recôncavo Energ SPE subsidiary (2 campos)
-- ----------------------------------------------------------------------------
DELETE FROM field_stakes WHERE campo = 'CARDEAL AMARELO';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('CARDEAL AMARELO', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'CARDEAL DO NORDESTE';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('CARDEAL DO NORDESTE', 'PetroReconcavo', 100.000, now(), NULL);

-- ----------------------------------------------------------------------------
-- Grupo D — relabel of legacy variant "Reconcavo Energia" (2 campos)
-- ----------------------------------------------------------------------------
DELETE FROM field_stakes WHERE campo = 'ACAJÁ-BURIZINHO';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('ACAJÁ-BURIZINHO', 'PetroReconcavo', 100.000, now(), NULL);

DELETE FROM field_stakes WHERE campo = 'JURITI';
INSERT INTO field_stakes (campo, empresa, stake_pct, updated_at, updated_by)
VALUES ('JURITI', 'PetroReconcavo', 100.000, now(), NULL);

COMMIT;

-- ----------------------------------------------------------------------------
-- Refresh materialized views consumed by /well-by-well so the new stakes
-- propagate to dashboards immediately (CONCURRENTLY keeps the views readable
-- during the refresh; requires the UNIQUE indexes set in their parent migs).
-- ----------------------------------------------------------------------------
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_brazil_monthly;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_production_monthly;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_production_installation_monthly;
