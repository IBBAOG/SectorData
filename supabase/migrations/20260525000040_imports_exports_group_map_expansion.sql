-- Imports & Exports: expand importer_group_map with 5 additional economic groups.
--
-- Background: migration 20260525000030 seeded importer_group_map with 4 groups
-- (Petrobras, Vibra, Ipiranga, Raízen) by INSERT SELECT from anp_desembaracos
-- on the CNPJ root (first 8 digits). This migration adds 5 more groups discovered
-- in the post-backfill data: Blueway, Acelen, Braskem, Cosan Lubrificantes, Refit.
--
-- Idempotent: all INSERTs use ON CONFLICT (cnpj) DO NOTHING. Safe to re-run.
--
-- CHECK constraint (migration 20260525000020): cnpj ~ '^[0-9]{14}$' OR cnpj = '__legacy__'.
-- All cnpj values read from anp_desembaracos are already canonical 14-digit after the
-- LPAD enforcement in 20260525000030. The WHERE clause excludes the '__legacy__' sentinel.

-- Blueway (root 04958554, 13 distinct CNPJs, ~9.3 kt)
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Blueway', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '04958554' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- Acelen group: Refinaria de Mataripe (root 41777706, 4 CNPJs) +
-- Acelen Energia Renovavel (root 50886095, 1 CNPJ).
-- Acelen is the holding (Mubadala-backed) that bought Mataripe refinery from Petrobras in 2021.
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Acelen', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) IN ('41777706', '50886095') AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- Braskem (root 42150391, 11 distinct CNPJs, ~5.7 kt) -- petrochemical
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Braskem', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '42150391' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- Cosan Lubrificantes (root 33000092, 7 CNPJs, ~1.6 kt) -- Cosan group's lubricants arm.
-- Naming intentionally narrow ("Cosan Lubrificantes") to avoid lumping in unrelated
-- Cosan subsidiaries that may import other products (Raízen JV is already its own group).
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Cosan Lubrificantes', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '33000092' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- Refit (root 33412081, 2 CNPJs, ~2.3 kt) -- Refinaria de Petroleos de Manguinhos
-- (em recuperacao judicial). Stored as "Refit" because that's the operating brand.
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Refit', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '33412081' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;
