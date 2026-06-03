-- ============================================================================
-- Reconciliation cleanup — May 2026 diesel vessels in navios_diesel (pass 2).
--
-- Follow-up to backfill_maio2026.sql (the 7-row ADD). This pass applies the two
-- surgical data-quality fixes that remained after the main backfill, both
-- against the May 2026 window (collected_at >= '2026-05-01' AND < '2026-06-01').
-- Source of truth: port line-ups + a colleague's at-the-time manifest
-- (manifesto_diesel_2026-06-03.xlsx, sheet "Manifesto").
--
--   ADJUSTMENT 1 — REMOVE the ATLANTIC PRIDE / Porto de Suape false-positive.
--     Captured by the OLD Suape scraper before the discharge-only fix
--     (2026-06-03). All of ATLANTIC PRIDE's diesel blocks on Suape's "Dados
--     Brutos" sheet are CG (Carga/embarque = load-out, NOT a discharge/import),
--     and its ETA is 2026-06-01 (not even a May discharge). It is absent from
--     the manifest entirely. This is exactly the bug fixed forward in
--     buscar_suape() (pairs Produto.N with "Tipo da Operação".N and keeps only
--     DG/TB DG) — remaining here only as stale history. 4 rows (all status
--     'Esperado', ids 28005/28014/28023/28032).
--
--   ADJUSTMENT 2 — Itaqui blackout window (12–20 May): NO new rows.
--     Set-difference of the manifest's "Desembarcado" rows (excluding any
--     'Terceiros') attributed to May against navios_diesel found EVERY genuine
--     May discharge already present after backfill_maio2026.sql:
--       * MITERA / Itaqui was the only blackout casualty — already backfilled.
--       * MERSEY / Itaqui (manifest 39 300 m³, último rel. 29/05) is the
--         vessel's LATE-May call (25–29 May, IMO 9865752, ~39 222 m³ qtyconv),
--         which landed AFTER the scraper recovered on 21/05 — so it was never
--         lost and is already live-scraped (its earlier 01–04 May Itaqui call
--         is also present). The Suape leg (50 000 m³) was already backfilled.
--       * ELANDRA MAPLE / Itaqui (manifest 37 892 m³) is flagged 'Terceiros' in
--         the manifest → excluded from backfill by rule; it is independently
--         present from the live Itaqui feed (01–02 May, status Atracado) and is
--         left untouched.
--     => Adjustment 2 inserts 0 rows. Documented here for provenance.
--
-- NOT TOUCHED (out of scope, intentionally):
--   * Porto de Suape / PINE OLIA — uncertain (may be a legitimate discharge the
--     colleague simply did not list); not removed on speculation.
--   * Porto de Santos / PACIFIC AZUR & ISABELLA M II (07 May) — pending an
--     explicit decision by Eduardo; kept for now. They are the manifest's
--     lowest-confidence May entries (the colleague marked them Status=Esperado).
--   * The 5 prior backfill rows from backfill_maio2026.sql.
--
-- Idempotent: the DELETE matches the natural key precisely and is a no-op once
-- the rows are gone. Reversal at the bottom.
-- ============================================================================

-- ADJUSTMENT 1 — delete the ATLANTIC PRIDE / Suape CG false-positive (4 rows).
DELETE FROM public.navios_diesel
WHERE collected_at >= '2026-05-01'
  AND collected_at <  '2026-06-01'
  AND porto = 'Porto de Suape'
  AND navio = 'ATLANTIC PRIDE';

-- ADJUSTMENT 2 — intentionally no INSERT (see header). Itaqui blackout fully
-- reconciled by backfill_maio2026.sql; MERSEY/Itaqui already present.

-- ----------------------------------------------------------------------------
-- REVERSAL of ADJUSTMENT 1 (re-insert the 4 deleted ATLANTIC PRIDE rows exactly
-- as captured before deletion — quantidade in unit 'c' as the old scraper
-- emitted it; eta 2026-06-01 09:00Z; status 'Esperado'; berco PGL-3A):
--
--   INSERT INTO public.navios_diesel
--     (collected_at, porto, status, navio, produto, quantidade, unidade,
--      quantidade_convertida, eta, berco)
--   VALUES
--     ('2026-05-27T13:01:00+00:00','Porto de Suape','Esperado','ATLANTIC PRIDE','Óleo Diesel',16200,'c',16200,'2026-06-01T09:00:00+00:00','PGL-3A'),
--     ('2026-05-27T19:01:00+00:00','Porto de Suape','Esperado','ATLANTIC PRIDE','Óleo Diesel',16200,'c',16200,'2026-06-01T09:00:00+00:00','PGL-3A'),
--     ('2026-05-28T01:00:00+00:00','Porto de Suape','Esperado','ATLANTIC PRIDE','Óleo Diesel',16200,'c',16200,'2026-06-01T09:00:00+00:00','PGL-3A'),
--     ('2026-05-28T07:00:00+00:00','Porto de Suape','Esperado','ATLANTIC PRIDE','Óleo Diesel',16200,'c',16200,'2026-06-01T09:00:00+00:00','PGL-3A')
--   ON CONFLICT (collected_at, porto, navio) DO NOTHING;
-- ----------------------------------------------------------------------------
