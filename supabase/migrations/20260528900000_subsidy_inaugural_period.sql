-- Insert inaugural diesel subsidy period (2026-03-12 to 2026-03-31)
-- Source: Portaria Normativa MME nº 127/2026 (Art. 1º importador, Art. 2º produtor)
--   modified by Portaria Normativa MME nº 128/2026 (updates Art. 2º produtor values)
-- The "1º período" reflected by the ANP HTML scraper (2026-04-01..2026-04-06) is actually
-- the SECOND period — the inaugural one was seeded manually because it precedes the HTML feed.
--
-- This migration:
--   A) Shifts existing ordinals (1..5) -> (2..6) so the inaugural period becomes ordinal=1
--   B) Inserts 10 rows (5 regions × 2 agent types) for the inaugural period
--   C) Updates table comment to document the manual seed
--
-- Cascade: AFTER triggers on anp_subsidy_commercialization will recompute
-- price_bands._w_subsidy for Diesel rows whose date falls in [2026-03-12, 2026-03-31].
-- No anp_subsidy_diesel_reference rows exist for that window yet, so the fallback
-- (_w_subsidy = raw price) will remain in effect for those dates until the reference
-- scraper backfills them.

-- A) Shift ordinals: existing periods (currently 1-5) become 2-6
UPDATE public.anp_subsidy_commercialization
SET ordinal = ordinal + 1
WHERE data_inicio >= '2026-04-01';

-- B) Insert inaugural period: 10 rows (5 regiões × 2 agentes)
INSERT INTO public.anp_subsidy_commercialization
  (data_inicio, data_fim, regiao, tipo_agente, preco_comercializacao, ordinal, pdf_url)
VALUES
  -- Importador (Art. 1º da Portaria 127, NOT changed by Portaria 128)
  ('2026-03-12','2026-03-31','NORTE',       'importador', 5.309, 1, 'https://www.gov.br/mme/pt-br/acesso-a-informacao/legislacao/portarias/2026/portaria-normativa-mme-n-127-2026.pdf'),
  ('2026-03-12','2026-03-31','NORDESTE',    'importador', 5.281, 1, 'https://www.gov.br/mme/pt-br/acesso-a-informacao/legislacao/portarias/2026/portaria-normativa-mme-n-127-2026.pdf'),
  ('2026-03-12','2026-03-31','CENTRO-OESTE','importador', 5.510, 1, 'https://www.gov.br/mme/pt-br/acesso-a-informacao/legislacao/portarias/2026/portaria-normativa-mme-n-127-2026.pdf'),
  ('2026-03-12','2026-03-31','SUDESTE',     'importador', 5.294, 1, 'https://www.gov.br/mme/pt-br/acesso-a-informacao/legislacao/portarias/2026/portaria-normativa-mme-n-127-2026.pdf'),
  ('2026-03-12','2026-03-31','SUL',         'importador', 5.310, 1, 'https://www.gov.br/mme/pt-br/acesso-a-informacao/legislacao/portarias/2026/portaria-normativa-mme-n-127-2026.pdf'),
  -- Produtor nacional próprio (Art. 2º da Portaria 127 AS AMENDED by Portaria 128 — current values)
  ('2026-03-12','2026-03-31','NORTE',       'produtor',   3.705, 1, 'https://www.gov.br/mme/pt-br/acesso-a-informacao/legislacao/portarias/2026/portaria-normativa-mme-n-127-2026.pdf'),
  ('2026-03-12','2026-03-31','NORDESTE',    'produtor',   3.516, 1, 'https://www.gov.br/mme/pt-br/acesso-a-informacao/legislacao/portarias/2026/portaria-normativa-mme-n-127-2026.pdf'),
  ('2026-03-12','2026-03-31','CENTRO-OESTE','produtor',   3.788, 1, 'https://www.gov.br/mme/pt-br/acesso-a-informacao/legislacao/portarias/2026/portaria-normativa-mme-n-127-2026.pdf'),
  ('2026-03-12','2026-03-31','SUDESTE',     'produtor',   3.799, 1, 'https://www.gov.br/mme/pt-br/acesso-a-informacao/legislacao/portarias/2026/portaria-normativa-mme-n-127-2026.pdf'),
  ('2026-03-12','2026-03-31','SUL',         'produtor',   3.683, 1, 'https://www.gov.br/mme/pt-br/acesso-a-informacao/legislacao/portarias/2026/portaria-normativa-mme-n-127-2026.pdf')
ON CONFLICT (data_inicio, regiao, tipo_agente) DO UPDATE
SET preco_comercializacao = EXCLUDED.preco_comercializacao,
    data_fim              = EXCLUDED.data_fim,
    ordinal               = EXCLUDED.ordinal,
    pdf_url               = EXCLUDED.pdf_url;

-- C) Document the manual seed in the table comment
COMMENT ON TABLE public.anp_subsidy_commercialization IS
  'Period 1 (2026-03-12 to 2026-03-31): Portaria MME 127/2026 + alteracao 128/2026. Period 2+ scraped from ANP HTML.';
