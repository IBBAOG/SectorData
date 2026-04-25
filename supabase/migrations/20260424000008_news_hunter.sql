-- News Hunter: oil & gas news articles ingested by the external Python scanner
-- at github.com/IBBAOG/news-hunter-scanner (GitHub Actions, triggered by
-- cron-job.org every ~5 min). The scanner uses the service_role key to
-- UPSERT rows; the frontend only reads (authenticated, RLS).

create table if not exists public.news_articles (
  url              text primary key,
  domain           text not null,
  source_name      text not null,
  title            text not null,
  snippet          text not null default '',
  published_at     timestamptz not null,
  found_at         timestamptz not null default now(),
  matched_keywords text[] not null default '{}'::text[],
  created_at       timestamptz not null default now()
);

create index if not exists news_articles_published_at_idx
  on public.news_articles (published_at desc);
create index if not exists news_articles_found_at_idx
  on public.news_articles (found_at desc);

alter table public.news_articles enable row level security;

drop policy if exists "authenticated read news_articles" on public.news_articles;
create policy "authenticated read news_articles"
  on public.news_articles
  for select
  to authenticated
  using (true);

-- Module visibility so admins can toggle per client
insert into public.module_visibility (module_slug, is_visible_for_clients)
values ('news-hunter', true)
on conflict (module_slug) do nothing;
