-- clipping_cookies — stores Netscape-format cookie strings per domain.
-- Used by /api/clipping/scrape to send authenticated requests to paywalled news sites
-- (e.g. Valor Econômico, Brasil Energia). Admin-only via RLS.
-- domain is canonical (no www. prefix); application strips www. before querying.

create table if not exists public.clipping_cookies (
  domain            text primary key,
  cookies_netscape  text not null,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id)
);

comment on table public.clipping_cookies is
  'HTTP cookies (Netscape format) per news domain, used by Admin-only clipping scrape route.';

alter table public.clipping_cookies enable row level security;

-- Admin-only read. Service role bypasses RLS (used by API route).
create policy "clipping_cookies admin select"
  on public.clipping_cookies for select to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'Admin'
    )
  );

create policy "clipping_cookies admin insert"
  on public.clipping_cookies for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'Admin'
    )
  );

create policy "clipping_cookies admin update"
  on public.clipping_cookies for update to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'Admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'Admin'
    )
  );

create policy "clipping_cookies admin delete"
  on public.clipping_cookies for delete to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role = 'Admin'
    )
  );
