-- alertas_estado: persistent state for the alert monitoring subsystem.
-- Each row stores the last-seen state for one detection base (slug).
-- Only the service role may read or write this table — frontend has no access.

create table if not exists alertas_estado (
    base        text primary key,
    estado      jsonb not null default '{}'::jsonb,
    updated_at  timestamptz not null default now()
);

-- Row-level security: no access for anon / authenticated roles.
-- Only the service-role key (used by GitHub Actions) bypasses RLS.
alter table alertas_estado enable row level security;

-- No policies intentionally: service role bypasses RLS entirely.
-- Anon and authenticated roles get zero rows.

comment on table alertas_estado is
    'Persistent state for the alert monitoring subsystem (one row per detection base). '
    'Written by alertas/bases/base.py via service-role key. '
    'Owner: worker_alertas. Schema owner: worker_supabase.';
