-- =====================================================================
-- Imports & Exports — post-backfill corrective DML
-- =====================================================================
-- Context: the Imports & Exports reform (20260525000010) enriched
-- anp_desembaracos with (importador, cnpj, uf_cnpj) and extended the PK
-- with cnpj. The ETL backfill (workflow run #26405747331) populated
-- per-CNPJ rows, leaving three data issues that this migration fixes:
--
--   1) Legacy sentinel rows (cnpj='__legacy__') overlap 100% with real
--      per-CNPJ rows on (ano, mes, ncm_codigo, pais_origem). Summing
--      across all rows double-counts Panel A "By Origin Country". The
--      legacy aggregate is now obsolete and must be deleted.
--
--   2) ~599 real CNPJs were stored with a stripped leading zero (Python
--      int() conversion in the ETL produced 11/12/13 digit strings).
--      LPAD to 14 digits to restore canonical form. This is required
--      for the JOIN with importer_group_map (CHECK enforces 14 digits).
--
--   3) importer_group_map was intentionally empty at seed time. Now
--      that real CNPJs are exposed, seed the four big economic groups
--      (Petrobras, Vibra, Ipiranga, Raízen) by CNPJ root prefix.
--
-- This migration is idempotent: DELETE/UPDATE are naturally idempotent
-- and INSERT uses ON CONFLICT (cnpj) DO NOTHING.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Step 1 — Delete legacy sentinel rows
-- ---------------------------------------------------------------------
-- Verified: 6204 unique groups (ano,mes,ncm_codigo,pais_origem) on the
-- legacy side, 6204 unique groups on the real side, 6204 overlap. So
-- every legacy row is fully shadowed by real per-CNPJ rows. Safe to drop.
DELETE FROM public.anp_desembaracos
WHERE cnpj = '__legacy__';

-- ---------------------------------------------------------------------
-- Step 2 — Pad truncated CNPJs to 14 digits
-- ---------------------------------------------------------------------
-- Pre-flight confirmed there are NO PK collisions between short-cnpj
-- rows and their LPAD'd canonical counterparts. So a straight UPDATE
-- is safe — no defensive aggregation needed.
UPDATE public.anp_desembaracos
SET cnpj = LPAD(cnpj, 14, '0')
WHERE LENGTH(cnpj) < 14
  AND cnpj <> '__legacy__';

-- ---------------------------------------------------------------------
-- Step 3 — Seed importer_group_map with the four big economic groups
-- ---------------------------------------------------------------------
-- IMPORTANT: this runs AFTER Step 2 so the SELECTs read canonical
-- 14-digit CNPJs. The CHECK constraint on importer_group_map.cnpj
-- enforces 14 digits, so any pre-pad CNPJ would have failed.

-- Petrobras — root 33000167 (all "PETROLEO BRASILEIRO S A PETROBRAS")
INSERT INTO public.importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Petrobras', importador
FROM public.anp_desembaracos
WHERE LEFT(cnpj, 8) = '33000167'
  AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- Vibra — "VIBRA ENERGIA S.A" root 34274233 + "VIBRA TRADING" root 44321374
INSERT INTO public.importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Vibra', importador
FROM public.anp_desembaracos
WHERE LEFT(cnpj, 8) IN ('34274233', '44321374')
  AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- Ipiranga — "IPIRANGA PRODUTOS DE PETROLEO" root 33337122 +
-- "IPIRANGA AGROINDUSTRIAL" root 07280328
INSERT INTO public.importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Ipiranga', importador
FROM public.anp_desembaracos
WHERE LEFT(cnpj, 8) IN ('33337122', '07280328')
  AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- Raízen — multiple subsidiaries:
--   33453598 RAIZEN S.A.
--   08070508 RAIZEN ENERGIA S.A
--   52189420 RAIZEN PARAGUACU LTDA
--   09538989 RAIZEN CAARAPO ACUCAR E ALCOOL LTDA
--   43960335 RAIZEN ARARAQUARA ACUCAR E ALCOOL LTDA
INSERT INTO public.importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Raízen', importador
FROM public.anp_desembaracos
WHERE LEFT(cnpj, 8) IN ('33453598', '08070508', '52189420', '09538989', '43960335')
  AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

COMMIT;
