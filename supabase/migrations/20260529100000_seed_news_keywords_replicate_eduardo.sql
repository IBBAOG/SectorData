-- One-shot DML: replicate Eduardo's full News Hunter keyword list (36 entries)
-- to every existing user in auth.users.
--
-- Rationale: a prior backfill (20260529000000) seeded the 27 default keywords
-- from public.news_hunter_default_keywords into every user. Eduardo's personal
-- list grew beyond the defaults (9 extra terms: Brasil Energia, Hormuz, Irã,
-- OPEC, OPEP, Ormuz, petroleira, petroleiras, petrolíferas). We want those
-- extras to also become a starting point for every existing user.
--
-- We intentionally do NOT modify news_hunter_default_keywords (anonymous
-- visitors must keep seeing 27 defaults) and we do NOT alter
-- seed_my_news_hunter_keywords (new signups continue to receive the 27
-- defaults). This is a one-shot for existing users only.
--
-- Idempotent: ON CONFLICT (user_id, keyword) DO NOTHING preserves any user
-- customization — running it again touches no existing row.
--
-- match_type is propagated from Eduardo's row so each keyword lands with the
-- intended matcher. created_at takes the column default (now()).
--
-- Trade-off accepted (mirroring the 20260529000000 backfill): users who
-- intentionally removed one of these 36 terms will receive it back.

DO $$
DECLARE
  v_eduardo_id uuid;
BEGIN
  SELECT id INTO v_eduardo_id
  FROM auth.users
  WHERE email = 'eduardo.mendes@itaubba.com';

  IF v_eduardo_id IS NULL THEN
    RAISE EXCEPTION 'Eduardo user (eduardo.mendes@itaubba.com) not found in auth.users';
  END IF;

  INSERT INTO public.news_hunter_keywords (user_id, keyword, match_type)
  SELECT u.id, k.keyword, k.match_type
  FROM auth.users u
  CROSS JOIN public.news_hunter_keywords k
  WHERE k.user_id = v_eduardo_id
  ON CONFLICT (user_id, keyword) DO NOTHING;
END $$;
