-- One-shot backfill: copy default News Hunter keywords into every existing user's
-- per-user keyword list (news_hunter_keywords), as a starting point.
--
-- This is a DML-only migration. It is idempotent:
--   * ON CONFLICT (user_id, keyword) DO NOTHING preserves any user customization
--     (re-running this migration touches no existing row).
--   * Users who removed a default keyword and never re-added it will get it back
--     once. After this one-shot, the function seed_my_news_hunter_keywords keeps
--     handling new sign-ups as before.
--
-- We propagate match_type from the defaults table so 'exact'-flagged defaults
-- land with the correct match_type for the user. created_at defaults to now()
-- (column NOT NULL with default).
--
-- Verification of behavior at write time (see commit message): pre-insert count
-- of would-insert rows was 252 across 39 users × 27 defaults (some users have
-- custom keywords beyond the default pool, which are untouched).

INSERT INTO public.news_hunter_keywords (user_id, keyword, match_type)
SELECT u.id, d.keyword, d.match_type
FROM auth.users u
CROSS JOIN public.news_hunter_default_keywords d
ON CONFLICT (user_id, keyword) DO NOTHING;
