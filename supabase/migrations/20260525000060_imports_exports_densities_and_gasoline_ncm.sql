-- Imports & Exports — align NCM densities with ANP standard + add MDIC gasoline NCM
--
-- Context: The /imports-exports dashboard was created with provisional densities
-- (840/850/740 for diesel/crude/gasoline). The /mdic-comex dashboard uses ANP-standard
-- densities (832/870/745). To unify both dashboards (especially the new FOB Price chart
-- that pulls from mdic_comex), align ncm_densidade_kg_m3 to the ANP values.
--
-- Also add NCM 27101259 ("Outras Gasolinas, exceto aviação" — the bulk-import gasoline
-- NCM that MDIC tracks). ANP Desembaraços does not currently report this NCM, but the
-- mapping prevents drift if it ever does, and the density entry lets the FOB chart
-- convert kg → m³ consistently.

-- Step 1: Correct densities (ANP standard, matches /mdic-comex)
UPDATE ncm_densidade_kg_m3 SET densidade_kg_m3 = 832 WHERE ncm_codigo = '27101921';  -- Diesel (was 840)
UPDATE ncm_densidade_kg_m3 SET densidade_kg_m3 = 870 WHERE ncm_codigo = '27090010';  -- Crude (was 850)
UPDATE ncm_densidade_kg_m3 SET densidade_kg_m3 = 745 WHERE ncm_codigo = '27101931';  -- Gasolina A (was 740)

-- Step 2: Add NCM 27101259 — MDIC's gasoline NCM (bulk import). ANP doesn't currently
-- track this NCM in its Desembaraços report, but the new FOB Price chart pulls from
-- mdic_comex which does. Density same as 27101931 (both motor gasoline grades).
INSERT INTO ncm_densidade_kg_m3 (ncm_codigo, densidade_kg_m3, produto_label)
VALUES ('27101259', 745, 'Gasoline')
ON CONFLICT (ncm_codigo) DO NOTHING;

-- Step 3: Map 27101259 to unified_product 'Gasoline' so future ETL rows from
-- anp_desembaracos (if any) flow into Panel A/B automatically, alongside 27101931.
INSERT INTO imports_product_map (unified_product, source, source_key)
VALUES ('Gasoline', 'desembaracos', '27101259')
ON CONFLICT (source, source_key) DO NOTHING;

COMMENT ON TABLE imports_product_map IS
'Maps source-specific keys (NCM codes or DAIE produto strings) to unified product labels for /imports-exports. Gasoline has dual NCM mapping under source=desembaracos: 27101931 (Gasolina A, ANP regulatory) and 27101259 (Outras gasolinas, MDIC scope). 27101259 may currently have zero ANP rows — that''s expected and harmless.';
