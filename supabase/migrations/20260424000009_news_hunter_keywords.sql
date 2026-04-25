-- Per-user keyword list for News Hunter. Each user maintains their own
-- preferences. The scanner (GitHub Actions workflow at
-- github.com/IBBAOG/news-hunter-scanner, triggered by cron-job.org every
-- ~5 min, using the service_role key) reads
-- SELECT DISTINCT keyword FROM news_hunter_keywords across all users
-- to build the search set; the frontend filters per-user client-side using
-- only auth.uid()'s rows.

create table if not exists public.news_hunter_keywords (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  keyword    text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, keyword)
);

create index if not exists news_hunter_keywords_user_idx
  on public.news_hunter_keywords (user_id);

alter table public.news_hunter_keywords enable row level security;

drop policy if exists "own keywords read" on public.news_hunter_keywords;
create policy "own keywords read"
  on public.news_hunter_keywords for select
  to authenticated using (user_id = auth.uid());

drop policy if exists "own keywords insert" on public.news_hunter_keywords;
create policy "own keywords insert"
  on public.news_hunter_keywords for insert
  to authenticated with check (user_id = auth.uid());

drop policy if exists "own keywords delete" on public.news_hunter_keywords;
create policy "own keywords delete"
  on public.news_hunter_keywords for delete
  to authenticated using (user_id = auth.uid());

-- Seed-on-first-visit RPC. Called by the frontend when the user's keyword
-- list comes back empty on initial load. Idempotent: ON CONFLICT DO NOTHING.
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
  insert into public.news_hunter_keywords (user_id, keyword) values
    (uid, 'petróleo'), (uid, 'petroleo'), (uid, 'Petrobras'),
    (uid, 'Vibra'), (uid, 'Brava'), (uid, 'Ultrapar'),
    (uid, 'Ipiranga'), (uid, 'PetroReconcavo'), (uid, 'PetroRecôncavo'),
    (uid, 'oil'), (uid, 'gasolina'), (uid, 'gás'), (uid, 'gas'),
    (uid, 'diesel'), (uid, 'combustível'), (uid, 'combustivel'),
    (uid, 'combustíveis'), (uid, 'combustiveis'),
    (uid, 'OceanPact'), (uid, 'Cosan'), (uid, 'Raízen'), (uid, 'Raizen'),
    (uid, 'Braskem'), (uid, 'Compass'), (uid, 'PRIO'), (uid, 'ANP'), (uid, 'refit')
  on conflict (user_id, keyword) do nothing;
end;
$$;

grant execute on function public.seed_my_news_hunter_keywords() to authenticated;
