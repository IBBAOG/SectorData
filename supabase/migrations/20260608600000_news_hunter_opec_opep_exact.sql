-- News Hunter: force OPEC / OPEP keywords to whole-word (exact) matching.
--
-- Why: with match_type = 'substring' the scanner casts an overly wide net and
-- pulls in off-sector articles (substring false-positives) into the O&G feed.
-- The scanner treats match_type = 'exact' as a \b{kw}\b whole-word match, which
-- is the correct behavior for these acronyms. Valid values: 'substring' | 'exact'.
-- CTO decision 2026-06-05: apply to every existing user AND to the new-user seed.
--
-- Pure DML, idempotent (re-runnable), case-insensitive on keyword.
-- Touches ONLY OPEC and OPEP.

UPDATE news_hunter_keywords
   SET match_type = 'exact'
 WHERE lower(keyword) IN ('opec', 'opep')
   AND match_type <> 'exact';

UPDATE news_hunter_default_keywords
   SET match_type = 'exact'
 WHERE lower(keyword) IN ('opec', 'opep')
   AND match_type <> 'exact';
