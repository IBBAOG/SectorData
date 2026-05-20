-- News Hunter — add `match_type` column to per-user keywords list.
--
-- Motivation:
--   Frontend keyword filtering currently uses substring case-insensitive
--   matching (.includes()), so short acronyms like "ANS" (Agência Nacional de
--   Saúde Suplementar) match unrelated words like "trANSporte", "trANSparência",
--   "ANSiedade". Adding `match_type` lets users opt a keyword into whole-word
--   (word-boundary) matching while preserving substring as the default.
--
-- Schema choice: text enum, not boolean.
--   - 'substring' (default, current behaviour)
--   - 'exact'     (whole word, word-boundary \b{kw}\b case-insensitive)
--   Leaves room for future modes (regex, prefix) without another migration.
--
-- Cross-repo coordination:
--   The scanner repo (IBBAOG/news-hunter-scanner) reads this table via
--   service_role; it must SELECT the new column and route matching accordingly.
--   PR opened alongside this migration; merge order is independent (scanner
--   defaults to 'substring' for keywords without the column server-side via
--   .get(), so it stays backward compatible if the migration lands first).

alter table public.news_hunter_keywords
  add column if not exists match_type text not null default 'substring';

alter table public.news_hunter_keywords
  drop constraint if exists news_hunter_keywords_match_type_check;

alter table public.news_hunter_keywords
  add constraint news_hunter_keywords_match_type_check
  check (match_type in ('substring', 'exact'));

comment on column public.news_hunter_keywords.match_type is
  'How the keyword should match article text. ''substring'' (default): case-insensitive substring match. ''exact'': case-insensitive word-boundary match (\b{keyword}\b).';

-- Seed RPC: all seeded defaults stay on 'substring' (no behaviour change for
-- existing users; idempotent ON CONFLICT preserves existing rows including
-- any 'exact' match_type the user already set).
create or replace function public.seed_my_news_hunter_keywords()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  insert into public.news_hunter_keywords (user_id, keyword, match_type) values
    (uid, 'petróleo', 'substring'),
    (uid, 'petroleo', 'substring'),
    (uid, 'Petrobras', 'substring'),
    (uid, 'Vibra', 'substring'),
    (uid, 'Brava', 'substring'),
    (uid, 'Ultrapar', 'substring'),
    (uid, 'Ipiranga', 'substring'),
    (uid, 'PetroReconcavo', 'substring'),
    (uid, 'PetroRecôncavo', 'substring'),
    (uid, 'oil', 'substring'),
    (uid, 'gasolina', 'substring'),
    (uid, 'gás', 'substring'),
    (uid, 'gas', 'substring'),
    (uid, 'diesel', 'substring'),
    (uid, 'combustível', 'substring'),
    (uid, 'combustivel', 'substring'),
    (uid, 'combustíveis', 'substring'),
    (uid, 'combustiveis', 'substring'),
    (uid, 'OceanPact', 'substring'),
    (uid, 'Cosan', 'substring'),
    (uid, 'Raízen', 'substring'),
    (uid, 'Raizen', 'substring'),
    (uid, 'Braskem', 'substring'),
    (uid, 'Compass', 'substring'),
    (uid, 'PRIO', 'substring'),
    (uid, 'ANP', 'substring'),
    (uid, 'refit', 'substring')
  on conflict (user_id, keyword) do nothing;
end;
$$;

grant execute on function public.seed_my_news_hunter_keywords() to authenticated;
