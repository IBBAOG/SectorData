-- ANP CDP — Produção por Poço (aggregated to operador+bacia+local level)
-- Source: ANP/CDP weekly well-level CSVs, aggregated monthly by scripts/anp_cdp_upload.py

create table if not exists anp_cdp_producao (
  ano                  integer  not null,
  mes                  integer  not null,
  operador             text     not null,
  bacia                text     not null,
  local                text     not null,  -- 'PosSal' | 'PreSal' | 'Terra'
  oleo_bbl_dia         float4,
  condensado_bbl_dia   float4,
  petroleo_bbl_dia     float4,
  gas_total_mm3_dia    float4,
  agua_bbl_dia         float4,
  n_pocos              integer,
  primary key (ano, mes, operador, bacia, local)
);

alter table anp_cdp_producao enable row level security;
create policy "public read" on anp_cdp_producao for select using (true);

create index if not exists anp_cdp_producao_ano_mes_idx  on anp_cdp_producao (ano, mes);
create index if not exists anp_cdp_producao_bacia_idx    on anp_cdp_producao (bacia);
create index if not exists anp_cdp_producao_operador_idx on anp_cdp_producao (operador);

-- ── RPC: full series (returns operator-level rows for client-side aggregation) ──
create or replace function get_anp_cdp_serie(
  p_bacoes     text[]  default null,
  p_locais     text[]  default null,
  p_ano_inicio integer default null,
  p_ano_fim    integer default null
)
returns table(
  ano                integer,
  mes                integer,
  operador           text,
  bacia              text,
  local              text,
  petroleo_bbl_dia   float4,
  oleo_bbl_dia       float4,
  condensado_bbl_dia float4,
  gas_total_mm3_dia  float4,
  agua_bbl_dia       float4,
  n_pocos            integer
)
language sql stable security definer
set search_path = public
as $$
  select
    ano, mes, operador, bacia, local,
    petroleo_bbl_dia, oleo_bbl_dia, condensado_bbl_dia,
    gas_total_mm3_dia, agua_bbl_dia, n_pocos
  from anp_cdp_producao
  where
    (p_bacoes    is null or bacia = any(p_bacoes))
    and (p_locais    is null or local = any(p_locais))
    and (p_ano_inicio is null or ano >= p_ano_inicio)
    and (p_ano_fim    is null or ano <= p_ano_fim)
  order by ano, mes, bacia, local, operador;
$$;

-- ── RPC: filter options ───────────────────────────────────────────────────────
create or replace function get_anp_cdp_filtros()
returns json
language sql stable security definer
set search_path = public
as $$
  select json_build_object(
    'bacoes',     (select array_agg(distinct bacia    order by bacia)    from anp_cdp_producao),
    'operadores', (select array_agg(distinct operador order by operador) from anp_cdp_producao),
    'locais',     (select array_agg(distinct local    order by local)    from anp_cdp_producao),
    'ano_min',    (select min(ano) from anp_cdp_producao),
    'ano_max',    (select max(ano) from anp_cdp_producao)
  );
$$;

-- Visibility entry for role-based access
insert into module_visibility (module_slug, is_visible_for_clients)
values ('anp-cdp', true)
on conflict (module_slug) do nothing;
