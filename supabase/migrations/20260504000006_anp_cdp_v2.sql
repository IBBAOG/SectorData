-- ANP CDP v2: re-aggregate at (ano, mes, campo, bacia, local) level
-- Drops operador dimension; adds campo for field-level filtering.

drop function if exists get_anp_cdp_serie cascade;
drop function if exists get_anp_cdp_filtros cascade;
drop table  if exists anp_cdp_producao cascade;

create table anp_cdp_producao (
  ano               integer not null,
  mes               integer not null,
  campo             text    not null,
  bacia             text    not null,
  local             text    not null,  -- 'PosSal' | 'PreSal' | 'Terra'
  petroleo_bbl_dia  float4,
  gas_total_mm3_dia float4,
  agua_bbl_dia      float4,
  n_pocos           integer,
  primary key (ano, mes, campo, bacia, local)
);

alter table anp_cdp_producao enable row level security;
create policy "public read" on anp_cdp_producao for select using (true);

create index if not exists anp_cdp_v2_ano_mes_idx on anp_cdp_producao (ano, mes);
create index if not exists anp_cdp_v2_campo_idx   on anp_cdp_producao (campo);
create index if not exists anp_cdp_v2_bacia_idx   on anp_cdp_producao (bacia);

-- ── RPC: aggregated time series for selected campos (server-side sum → ~252 rows) ─
create or replace function get_anp_cdp_campo_serie(
  p_campos     text[]  default null,
  p_bacoes     text[]  default null,
  p_locais     text[]  default null,
  p_ano_inicio integer default null,
  p_ano_fim    integer default null
)
returns table(
  ano               integer,
  mes               integer,
  petroleo_bbl_dia  float8,
  gas_total_mm3_dia float8,
  n_pocos           bigint
)
language sql stable security definer
set search_path = public
as $$
  select
    ano, mes,
    coalesce(sum(petroleo_bbl_dia),  0)::float8 as petroleo_bbl_dia,
    coalesce(sum(gas_total_mm3_dia), 0)::float8 as gas_total_mm3_dia,
    coalesce(sum(n_pocos),           0)::bigint  as n_pocos
  from anp_cdp_producao
  where
    (p_campos    is null or campo = any(p_campos))
    and (p_bacoes    is null or bacia = any(p_bacoes))
    and (p_locais    is null or local = any(p_locais))
    and (p_ano_inicio is null or ano  >= p_ano_inicio)
    and (p_ano_fim    is null or ano  <= p_ano_fim)
  group by ano, mes
  order by ano, mes;
$$;

-- ── RPC: campos metadata list (for filter UI, ~591 rows) ─────────────────────
create or replace function get_anp_cdp_campos_list()
returns table(
  campo          text,
  bacia          text,
  local          text,
  petroleo_total float8,
  n_pocos_total  bigint
)
language sql stable security definer
set search_path = public
as $$
  select
    campo, bacia, local,
    coalesce(sum(petroleo_bbl_dia),  0)::float8 as petroleo_total,
    coalesce(sum(n_pocos),           0)::bigint  as n_pocos_total
  from anp_cdp_producao
  group by campo, bacia, local
  order by petroleo_total desc nulls last;
$$;

-- ── RPC: filter options ───────────────────────────────────────────────────────
create or replace function get_anp_cdp_filtros()
returns json
language sql stable security definer
set search_path = public
as $$
  select json_build_object(
    'bacoes',  (select array_agg(distinct bacia order by bacia) from anp_cdp_producao),
    'locais',  (select array_agg(distinct local order by local) from anp_cdp_producao),
    'ano_min', (select min(ano) from anp_cdp_producao),
    'ano_max', (select max(ano) from anp_cdp_producao)
  );
$$;

insert into module_visibility (module_slug, is_visible_for_clients)
values ('anp-cdp', true)
on conflict (module_slug) do nothing;
