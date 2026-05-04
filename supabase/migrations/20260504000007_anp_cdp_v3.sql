-- ANP CDP v3: well-level granularity (nome_poco_anp, campo, bacia, local)
-- Only active records (petroleo > 0 OR gas > 0), ~2M rows

drop function if exists get_anp_cdp_campo_serie  cascade;
drop function if exists get_anp_cdp_campos_list  cascade;
drop function if exists get_anp_cdp_filtros       cascade;
drop table  if exists anp_cdp_producao            cascade;

create table anp_cdp_producao (
  ano               integer not null,
  mes               integer not null,
  poco              text    not null,
  campo             text    not null,
  bacia             text    not null,
  local             text    not null,  -- 'PosSal' | 'PreSal' | 'Terra'
  petroleo_bbl_dia  float4,
  gas_total_mm3_dia float4,
  primary key (ano, mes, poco, campo, bacia, local)
);

alter table anp_cdp_producao enable row level security;
create policy "public read" on anp_cdp_producao for select using (true);

create index if not exists anp_cdp_v3_ano_mes_idx on anp_cdp_producao (ano, mes);
create index if not exists anp_cdp_v3_poco_idx    on anp_cdp_producao (poco);
create index if not exists anp_cdp_v3_campo_idx   on anp_cdp_producao (campo);
create index if not exists anp_cdp_v3_bacia_idx   on anp_cdp_producao (bacia);

-- ── RPC: aggregated time series for selected wells → ≤252 rows ───────────────
create or replace function get_anp_cdp_poco_serie(
  p_pocos      text[]  default null,
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
  gas_total_mm3_dia float8
)
language sql stable security definer
set search_path = public
as $$
  select
    ano, mes,
    coalesce(sum(petroleo_bbl_dia),  0)::float8 as petroleo_bbl_dia,
    coalesce(sum(gas_total_mm3_dia), 0)::float8 as gas_total_mm3_dia
  from anp_cdp_producao
  where
    (p_pocos     is null or poco  = any(p_pocos))
    and (p_campos    is null or campo = any(p_campos))
    and (p_bacoes    is null or bacia = any(p_bacoes))
    and (p_locais    is null or local = any(p_locais))
    and (p_ano_inicio is null or ano  >= p_ano_inicio)
    and (p_ano_fim    is null or ano  <= p_ano_fim)
  group by ano, mes
  order by ano, mes;
$$;

-- ── RPC: well metadata list for filter UI (~24K rows) ────────────────────────
create or replace function get_anp_cdp_pocos_list()
returns table(
  poco           text,
  campo          text,
  bacia          text,
  local          text,
  petroleo_total float8
)
language sql stable security definer
set search_path = public
as $$
  select
    poco, campo, bacia, local,
    coalesce(sum(petroleo_bbl_dia), 0)::float8 as petroleo_total
  from anp_cdp_producao
  group by poco, campo, bacia, local
  order by petroleo_total desc nulls last;
$$;

-- ── RPC: filter options ───────────────────────────────────────────────────────
create or replace function get_anp_cdp_filtros()
returns json
language sql stable security definer
set search_path = public
as $$
  select json_build_object(
    'bacoes',  (select array_agg(distinct bacia  order by bacia)  from anp_cdp_producao),
    'campos',  (select array_agg(distinct campo  order by campo)  from anp_cdp_producao),
    'locais',  (select array_agg(distinct local  order by local)  from anp_cdp_producao),
    'ano_min', (select min(ano) from anp_cdp_producao),
    'ano_max', (select max(ano) from anp_cdp_producao)
  );
$$;

insert into module_visibility (module_slug, is_visible_for_clients)
values ('anp-cdp', true)
on conflict (module_slug) do nothing;
