-- Carteiras de ações por usuário
create table stock_portfolios (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  tickers text[] not null default '{}',
  is_active boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table stock_portfolios enable row level security;

create policy "users manage own stock portfolios"
  on stock_portfolios for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Registrar o módulo para visibilidade
insert into module_visibility (module_slug, is_visible_for_clients)
  values ('stocks', true)
  on conflict (module_slug) do nothing;
