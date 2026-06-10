-- News Hunter — add macro-oil-market vocabulary to the DEFAULT keyword list,
-- and backfill the same terms into every existing user's personal list.
--
-- Why:
--   The scanner (IBBAOG/news-hunter-scanner) missed the macro-oil headline
--   "Guerra destruiu demanda de 5 milhoes de barris/dia de oleo e aumentou uso
--   de carvao" (eixos.com.br, 2026-06-09). Root cause is purely a keyword gap:
--   the scanner matches against the article title + snippet only, and this
--   headline's title/subtitle contain none of the ~40 tracked terms ("oleo"
--   and "barril" were never in the watchlist; "petroleo"/"gas" appear only in
--   the body). We add 5 macro-oil terms so headlines phrased in oil-market
--   vocabulary get caught.
--
-- Terms (honoring news_hunter_default_keywords.match_type):
--   oleo    -> substring   (matches "oleo de ...", "oleo combustivel", etc.)
--   barril  -> substring
--   barris  -> substring   (Portuguese plural: the 'barril' substring does NOT
--                           match 'barris', and the missed headline says
--                           "barris/dia" — both forms are required)
--   Brent   -> exact       (whole-word; avoids accidental substring noise)
--   WTI     -> exact       (whole-word; the ticker, not a substring)
--
-- Idempotency:
--   Both INSERTs use ON CONFLICT DO NOTHING, so re-running is a no-op and any
--   user customization is preserved.
--
-- Cross-repo contract (critical — guarantees immediate effect):
--   The scanner's active search set is the UNION of per-user
--   news_hunter_keywords (with a local fallback). Per
--   docs/etl-pipelines/news-hunter-architecture.md, "scanner reads the default
--   table" via get_default_news_keywords_with_flags is still an OPEN TODO.
--   Therefore adding to news_hunter_default_keywords ALONE would not change
--   what the scanner searches on its next run (existing users were already
--   seeded; nobody re-seeds them). To guarantee the next scan actually searches
--   these terms, we ALSO backfill the same 5 terms into every existing owner in
--   news_hunter_keywords — exactly how seed_my_news_hunter_keywords propagates a
--   default into a user's personal list (see 20260529000000). If the scanner is
--   later wired to consume the default table directly, this backfill remains
--   harmless (ON CONFLICT DO NOTHING).

-- Shared term set, defined once to keep both inserts in sync.
WITH new_terms (keyword, match_type) AS (
  VALUES
    ('óleo',   'substring'),
    ('barril', 'substring'),
    ('barris', 'substring'),
    ('Brent',  'exact'),
    ('WTI',    'exact')
)
INSERT INTO public.news_hunter_default_keywords (keyword, match_type)
SELECT keyword, match_type FROM new_terms
ON CONFLICT (keyword) DO NOTHING;

-- Backfill: one (user_id, keyword) row per existing user that already owns any
-- keyword, for each of the 5 new terms, propagating the matching match_type.
-- created_at defaults to now(); match_type comes from the term set, not the
-- column default, so 'Brent'/'WTI' land as 'exact'.
WITH new_terms (keyword, match_type) AS (
  VALUES
    ('óleo',   'substring'),
    ('barril', 'substring'),
    ('barris', 'substring'),
    ('Brent',  'exact'),
    ('WTI',    'exact')
)
INSERT INTO public.news_hunter_keywords (user_id, keyword, match_type)
SELECT u.user_id, t.keyword, t.match_type
FROM (SELECT DISTINCT user_id FROM public.news_hunter_keywords) u
CROSS JOIN new_terms t
ON CONFLICT (user_id, keyword) DO NOTHING;

-- =============================================================================
-- End of migration 20260615000000_news_hunter_macro_oil_keywords.sql
-- =============================================================================
