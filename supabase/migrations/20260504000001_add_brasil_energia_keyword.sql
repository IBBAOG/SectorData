-- Add "Brasil Energia" to all existing users' keyword lists and update the seed
-- function so new users also receive it automatically.
-- Fixes: Brasil Energia articles not appearing in News Hunter because no default
-- keyword matched source_name "Brasil Energia".

-- Backfill all existing users (service role bypasses RLS; idempotent).
insert into public.news_hunter_keywords (user_id, keyword)
select distinct user_id, 'Brasil Energia'
from public.news_hunter_keywords
on conflict (user_id, keyword) do nothing;

-- Update seed so new users start with this keyword included.
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
    (uid, 'Braskem'), (uid, 'Compass'), (uid, 'PRIO'), (uid, 'ANP'), (uid, 'refit'),
    (uid, 'Brasil Energia')
  on conflict (user_id, keyword) do nothing;
end;
$$;
