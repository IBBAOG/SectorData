-- Flip the news_hunter keyword 'Brava' (Brava Energia) from substring to exact match.
-- Substring matching produces false positives inside common Portuguese verbs like
-- 'cobrava' / 'cobravam' (confirmed 2026-05-27 on a G1 article unrelated to oil & gas).
-- Applies to both the global default (news_hunter_default_keywords) and every existing
-- per-user replica (news_hunter_keywords). New users continue to seed from the default,
-- which will now propagate match_type='exact'.

UPDATE public.news_hunter_default_keywords
SET match_type = 'exact'
WHERE keyword = 'Brava' AND match_type <> 'exact';

UPDATE public.news_hunter_keywords
SET match_type = 'exact'
WHERE keyword = 'Brava' AND match_type <> 'exact';
