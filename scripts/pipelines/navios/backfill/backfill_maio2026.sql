-- ============================================================================
-- Backfill — May 2026 diesel vessels missing from navios_diesel.
--
-- Source of truth: port line-ups (NOT AIS). Two gaps left May short:
--   1. Porto de Itaqui Brotli blackout 12-20 May 2026 (silent 0 rows for 9
--      days; encoding fixed 2026-05-21 in 5efe3077; watchdog hardened in the
--      same task as this backfill). MITERA was lost entirely.
--   2. Porto de Maceió was never scraped before 2026-06-03.
--   + a few distinct Suape/Santos port-calls of vessels we held at another
--     port that month.
--
-- These 7 rows are the SET DIFFERENCE between a colleague's at-the-time port
-- line-up manifest (manifesto_diesel_2026-06-03.xlsx) and what navios_diesel
-- already held for May. Idempotent: ON CONFLICT DO NOTHING.
--
-- collected_at = manifest 'último rel.' (mid-May, NOT the 2026-05-31 anchor)
-- so get_nd_volume_mensal_historico counts each as DISCHARGED for closed May.
-- Per-row provenance in the comment after each VALUES tuple.
-- ============================================================================

INSERT INTO public.navios_diesel (collected_at, porto, status, navio, produto, quantidade, unidade, quantidade_convertida, eta, inicio_descarga, fim_descarga, origem, berco, imo) VALUES
  ('2026-05-19T09:32:00-03:00', 'Porto de Itaqui', 'Atracado', 'MITERA', 'Óleo Diesel', 60218.0, 'm³', 60218.0, NULL, NULL, NULL, NULL, NULL, NULL),  -- Itaqui blackout 12-20 May; absent from navios_diesel entirely; manifest record
  ('2026-05-21T09:34:00-03:00', 'Porto de Maceió', 'Atracado', 'ELANDRA MAPLE', 'Óleo Diesel', 23400.0, 'm³', 23400.0, NULL, NULL, NULL, NULL, NULL, NULL),  -- Maceió not covered before 2026-06-03; manifest record
  ('2026-05-07T20:52:00-03:00', 'Porto de Santos', 'Atracado', 'ISABELLA M II', 'Óleo Diesel', 35503.0, 'm³', 35503.0, '2026-05-07T12:00:00-03:00', NULL, NULL, NULL, NULL, NULL),  -- Santos call 07 May missing (DB had only an April Santos call); manifest record
  ('2026-05-07T20:52:00-03:00', 'Porto de Santos', 'Atracado', 'PACIFIC AZUR', 'Óleo Diesel', 47337.0, 'm³', 47337.0, '2026-05-07T12:00:00-03:00', NULL, NULL, NULL, NULL, NULL),  -- Santos call 07 May missing (DB had only an Itaqui call); manifest record
  ('2026-05-15T09:31:00-03:00', 'Porto de Suape', 'Atracado', 'ELANDRA MAPLE', 'Óleo Diesel', 18840.0, 'm³', 18840.0, '2026-05-11T12:00:00-03:00', NULL, NULL, NULL, NULL, NULL),  -- Suape call missing (DB had only an Itaqui call); manifest record
  ('2026-05-19T09:32:00-03:00', 'Porto de Suape', 'Atracado', 'SUPER G', 'Óleo Diesel', 10150.0, 'm³', 10150.0, '2026-05-16T12:00:00-03:00', NULL, NULL, NULL, NULL, NULL),  -- Suape call missing (DB had only an Itaqui call); manifest record
  ('2026-05-21T09:34:00-03:00', 'Porto de Suape', 'Atracado', 'MERSEY', 'Óleo Diesel', 50000.0, 'm³', 50000.0, '2026-05-20T12:00:00-03:00', NULL, NULL, NULL, NULL, NULL)  -- Suape call missing (DB had only an Itaqui call); manifest record
ON CONFLICT (collected_at, porto, navio) DO NOTHING;

-- Reversal:
--   DELETE FROM public.navios_diesel
--   WHERE (collected_at, porto, navio) IN (
--     ('2026-05-19T09:32:00-03:00', 'Porto de Itaqui', 'MITERA'),
--     ('2026-05-21T09:34:00-03:00', 'Porto de Maceió', 'ELANDRA MAPLE'),
--     ('2026-05-07T20:52:00-03:00', 'Porto de Santos', 'ISABELLA M II'),
--     ('2026-05-07T20:52:00-03:00', 'Porto de Santos', 'PACIFIC AZUR'),
--     ('2026-05-15T09:31:00-03:00', 'Porto de Suape', 'ELANDRA MAPLE'),
--     ('2026-05-19T09:32:00-03:00', 'Porto de Suape', 'SUPER G'),
--     ('2026-05-21T09:34:00-03:00', 'Porto de Suape', 'MERSEY')
--   );
