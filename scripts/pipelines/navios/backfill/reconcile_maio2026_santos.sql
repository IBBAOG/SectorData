-- ============================================================================
-- Reconciliation — May 2026 Santos low-confidence removal (pass 3).
--
-- FINAL surgical pass for May 2026 navios_diesel, resolving the one item that
-- pass 2 (reconcile_maio2026_cleanup.sql) deliberately left open "pending an
-- explicit decision by Eduardo". That decision is now made: REMOVE the two
-- lowest-confidence Santos entries that came from a colleague's at-the-time
-- manifest (manifesto_diesel_2026-06-03.xlsx, sheet "Manifesto").
--
--   * PACIFIC AZUR  / Porto de Santos / 07 May — ~47 337 m3 (id was 28241).
--   * ISABELLA M II / Porto de Santos / 07 May — ~35 503 m3 (id was 28240).
--
-- Both were inserted by backfill_maio2026.sql with
-- collected_at '2026-05-07T20:52:00-03:00' (stored UTC '2026-05-07T23:52:00Z'),
-- status 'Atracado', eta 2026-05-07, imo IS NULL.
--
-- WHY (Eduardo, 2026-06-03):
--   On the colleague's manifest these are the only Santos vessels flagged
--   Status="Esperado" (EXPECTED — discharge NOT confirmed): the lowest-confidence
--   rows on his sheet. Our own Santos scraper ran normally all month (19 distinct
--   vessels live-scraped — already MORE than the colleague's 14 Santos entries)
--   and never captured either vessel. With our first-party source both healthy
--   and broader than the manifest for Santos, we prioritise the accuracy of our
--   own feed over inflating the count with two unconfirmed "Esperado" rows. This
--   is the opposite trade-off from the Itaqui blackout, where our feed had a real
--   gap and the manifest was the only record.
--
-- SAFETY — the DELETE is strictly scoped so it touches ONLY the two manifest
-- backfill rows. Both vessels ALSO have legitimate, live-scraped rows that carry
-- a real IMO and MUST be preserved:
--   * PACIFIC AZUR  — live June call at Porto de Itaqui (IMO 9788540).
--   * ISABELLA M II — April Santos calls (IMO 9836440).
-- Scoping by porto='Porto de Santos' AND navio AND May window AND imo IS NULL
-- excludes all of those. Verified in-DB: each target has exactly 1 May Santos
-- row and it is the imo-NULL one.
--
-- NOT TOUCHED: the other backfill rows (MITERA/Itaqui, ELANDRA MAPLE/Maceió,
-- ELANDRA MAPLE/Suape, SUPER G/Suape, MERSEY/Suape) and every live-scraped
-- Santos vessel. (ATLANTIC PRIDE/Suape CG was already removed in pass 2.)
--
-- EFFECT: Santos distinct (porto, navio) for May drops by exactly 2 (each
-- removed vessel had only this single May Santos row).
--
-- Idempotent: the DELETE matches the natural key precisely and is a no-op once
-- the rows are gone. Reversal at the bottom (ON CONFLICT DO NOTHING).
-- ============================================================================

-- Remove the 2 low-confidence Santos manifest rows (strictly scoped: imo IS NULL).
DELETE FROM public.navios_diesel
WHERE collected_at >= '2026-05-01'
  AND collected_at <  '2026-06-01'
  AND porto = 'Porto de Santos'
  AND navio IN ('PACIFIC AZUR', 'ISABELLA M II')
  AND imo IS NULL;

-- ----------------------------------------------------------------------------
-- REVERSAL (re-insert the 2 deleted Santos rows exactly as captured before
-- deletion — volume already in m3, status 'Atracado', eta 07 May noon BRT,
-- imo NULL so pipeline 03_imo_lookup can re-fill it on the next run):
--
--   INSERT INTO public.navios_diesel
--     (collected_at, porto, status, navio, produto, quantidade, unidade,
--      quantidade_convertida, eta, inicio_descarga, fim_descarga, origem, berco, imo)
--   VALUES
--     ('2026-05-07T20:52:00-03:00','Porto de Santos','Atracado','PACIFIC AZUR','Óleo Diesel',47337,'m³',47337,'2026-05-07T12:00:00-03:00',NULL,NULL,NULL,NULL,NULL),
--     ('2026-05-07T20:52:00-03:00','Porto de Santos','Atracado','ISABELLA M II','Óleo Diesel',35503,'m³',35503,'2026-05-07T12:00:00-03:00',NULL,NULL,NULL,NULL,NULL)
--   ON CONFLICT (collected_at, porto, navio) DO NOTHING;
-- ----------------------------------------------------------------------------
