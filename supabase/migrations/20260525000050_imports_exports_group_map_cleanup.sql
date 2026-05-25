-- ============================================================================
-- Imports & Exports: importer_group_map cleanup
-- ----------------------------------------------------------------------------
-- Two corporate consolidations + several new commercial-name renames.
-- All operations idempotent (UPDATE is naturally idempotent; INSERTs use
-- ON CONFLICT DO NOTHING). Touches DML only — no schema/RPC changes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Part A — Corporate consolidations
-- ----------------------------------------------------------------------------

-- A1. Relabel Blueway -> Raízen.
-- Blueway is a Raízen subsidiary; Raízen has imported gasoline through
-- Blueway since 2014.
UPDATE importer_group_map
SET unified_importer = 'Raízen'
WHERE unified_importer = 'Blueway';

-- A2. Add Oil Trading -> Ipiranga.
-- Ipiranga Produtos de Petróleo is the registered shareholder of
-- Oil Trading Importadora e Exportadora.
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Ipiranga', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '11454455' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- A3. Add Iconic -> Ipiranga.
-- Iconic Lubrificantes JV (Ipiranga 56% / Chevron 44%); controller is Ipiranga.
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Ipiranga', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '05524572' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- A4. Create Atem's group.
-- Atem's Distribuidora acquired Reman/Refinaria de Manaus from Petrobras
-- in Nov 2022 via Ream Participações (Cade approved without restrictions).
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Atem''s', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) IN ('03987364', '40180943') AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- A5. Create Royal FIC group.
-- Royal FIC Comercial + Royal FIC Distribuidora — same commercial brand,
-- different legal entities.
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Royal FIC', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) IN ('31856288', '01349764') AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- A6. Create GNA group.
-- Gás Natural Açu JV (Prumo Logística + BP + Siemens + SPIC Brasil);
-- UTE GNA I and UTE GNA II are the two thermal power plants of the same JV.
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'GNA', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) IN ('23449511', '23514652') AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Part B — Commercial-name renames (single-brand polish)
-- ----------------------------------------------------------------------------
-- Razão social is verbose; replace with the commercial name buyers recognize.

-- "Riograndense" (Refinaria de Petroleo Riograndense)
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Riograndense', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '94845674' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "Excelerate" (Excelerate Energy Comercializadora de Gas Natural)
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Excelerate', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '40606305' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "Compass" (Cosan group natural-gas arm; separate from Cosan Lubrificantes)
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Compass', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '19046324' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "Greenergy" (Greenergy Brasil Trading)
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Greenergy', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '11964260' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "Âmbar" (Âmbar Energia, J&F group)
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Âmbar', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '01645009' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "Tricon" (Tricon Energy do Brasil)
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Tricon', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '07274637' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "Eneva"
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Eneva', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '04423567' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "Amazônia Energia"
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Amazônia Energia', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '21996818' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "AXA Oil"
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'AXA Oil', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '22588256' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "Nimofast"
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Nimofast', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '77696235' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "Sul Plata"
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Sul Plata', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '02487698' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "Sertrading"
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Sertrading', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '04626426' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "NFX"
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'NFX', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '18459798' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "MTGás" (Companhia Mato-Grossense de Gas)
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'MTGás', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '06023921' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "CELSE"
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'CELSE', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '23758522' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "CELBA"
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'CELBA', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '22634191' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "Fair Energy"
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Fair Energy', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '39227267' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "Global Import"
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Global Import', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '23946105' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "WM Comercial"
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'WM Comercial', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '06194675' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "Ciapetro"
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'Ciapetro', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '24155554' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "ICE Química"
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'ICE Química', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '30182219' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;

-- "MGás"
INSERT INTO importer_group_map (cnpj, unified_importer, razao_social_seed)
SELECT DISTINCT cnpj, 'MGás', importador
FROM anp_desembaracos
WHERE LEFT(cnpj, 8) = '48516886' AND cnpj <> '__legacy__'
ON CONFLICT (cnpj) DO NOTHING;
