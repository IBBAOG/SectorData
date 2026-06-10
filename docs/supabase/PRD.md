# PRD — Departamento Supabase / Database

Único guardião do schema Postgres. Owner: [`worker_supabase`](../../.claude/agents/worker_supabase.md).

Recebe solicitações de todos os outros departamentos. Não tem desenho próprio — schema serve dado, e dado pertence aos depts consumidores.

## Escopo

```
supabase/
  migrations/                       Migrations canônicas (DDL + RPCs + RLS)
  config.toml                       Config Supabase CLI

.github/workflows/
  supabase_deploy.yml               Deploy de migrations em push pra main
```

> `sql/` foi removido em 2026-05-06. Os 3 arquivos legados foram convertidos em
> migrations versionadas: `20260505000007_legacy_price_bands.sql`,
> `20260505000008_legacy_profiles_and_visibility.sql`,
> `20260505000009_legacy_user_management.sql`.

## O que NÃO é deste departamento

- `src/lib/supabaseClient.ts` (config do cliente JS — APP)
- `src/lib/rpc.ts`, `src/lib/profileRpc.ts` (wrappers JS — APP)
- Frontend auth/sessão (APP)
- `data/*.xlsx` (Dados Locais)
- `DADOS/*.parquet` (ETL)
- `alertas/` (subsistema próprio)

## Princípios não-negociáveis

1. **RLS sempre habilitada** em qualquer tabela nova. Sem exceção.
2. **Migration nova é única fonte da verdade.** Nunca edite migration aplicada.
3. **Naming convention:** snake_case, plural pra tabelas, prefixo por domínio em RPCs.
4. **`SECURITY DEFINER`** quando RPC precisa bypass de RLS (ex: Admin RPCs).
5. **Idempotência:** `IF NOT EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT`.
6. **Constraints explícitas** (CHECK, FK, UNIQUE).
7. **Generated columns** quando regra é determinística (ex: `is_cabotagem`).

## Tabelas e RPCs do banco (overview)

> Para detalhes por dashboard, ver os sub-PRDs em `docs/app/<dashboard>.md`. Aqui é a visão de cima do schema.

### Tabelas principais

| Tabela | Dept consumidor | Populada por |
|---|---|---|
| `vendas` | dash-market-share (sole consumer since 2026-05-26 — `/sales-volumes` was folded into `/market-share` via the % Share ↔ thousand m³ toggle) | ETL (`pipelines/anp/vendas_watch.py`) |
| `navios_diesel` | dash-navios-diesel | ETL (`pipelines/navios/01_lineup_scrape.py` → `pipelines/navios/02_diesel_import.mjs`) |
| `vessel_registry`, `vessel_positions`, `port_arrivals`, `import_candidates` | dash-navios-diesel | ETL (`ais_*.py`, `vessel_*.py`) |
| `d_g_margins` | dash-margins | **ETL (computed)** via RPC `recompute_dg_margins(week_start, week_end)`, chamada pelo `etl_dg_margins.yml`. Era upload manual (`scripts/manual/dg_margins_upload.py`) até 2026-06-05; arquivo manual arquivado em `d_g_margins_manual_bak`. |
| `cepea_etanol_anidro` | input do `recompute_dg_margins` (D&G Margins) | ETL (`scripts/pipelines/cepea/cepea_etanol_anidro_sync.py`) — preço semanal R$/L do etanol anidro (CEPEA/ESALQ, 2002→presente; CC BY-NC) |
| `anp_producao_derivados` | input do `recompute_dg_margins` (D&G Margins) | ETL (`scripts/pipelines/anp/producao/anp_producao_derivados_sync.py`) — produção mensal nacional m³ (Gasolina A / Óleo Diesel, 1990→presente) |
| `fuel_tax_reference` | input do `recompute_dg_margins` (D&G Margins) | Imposto federal + ICMS R$/L por período — ANP Síntese de Preços (federal) + CONFAZ ad-rem (ICMS) |
| `fuel_blend_ratio` | input do `recompute_dg_margins` (D&G Margins) | % de mandato de etanol/biodiesel por período |
| `anp_lpc_brasil` | input do `recompute_dg_margins` (D&G Margins — pump price) | ETL (`scripts/pipelines/anp/lpc_sync.py`, mesmo run do `etl_anp_lpc.yml`) — preço de **revenda nacional** publicado pela ANP (volume-weighted, aba BRASIL do resumo semanal); ~146 semanas 2023-05→presente com lacunas |
| `field_stakes` | future `/production` dashboard (read) + dash-admin "Field Stakes" editor (write via SECURITY DEFINER + `is_admin()`) | Admin via `admin_upsert_field_stakes(p_campo, p_stakes jsonb)` — replace-all-in-1-tx with `SUM(stake_pct)=100` validation. Migration `20260527600000_field_stakes.sql`. |
| `price_bands` | dash-price-bands | Dados Locais (manual via `upload_price_bands.py`) |
| `stock_portfolios` | dash-stocks | App (CRUD direto via PostgREST). Desde `20260522000001`: coluna `is_public` + nullable `user_id` + seed do portfolio público `00000000-...-001` "Brazilian Oil & Gas (default)" |
| `news_articles`, `news_hunter_keywords` | dash-news-hunter | scanner externo + user via UI. Desde `20260522000001`: `news_articles` ganhou policy SELECT TO anon |
| `news_hunter_default_keywords` | dash-news-hunter (read) + dash-admin (write via SECURITY DEFINER RPCs) | Tabela nova `20260522000001` — 27 keywords default lidas por `get_default_news_keywords()` (anon-safe). Single source of truth (substitui lista hardcoded em `seed_my_news_hunter_keywords()`). RLS é read-only para anon/authed; writes exclusivamente via `admin_add_default_news_keyword` / `admin_remove_default_news_keyword` (`20260525230000`) — sem policies INSERT/DELETE. |
| `profiles`, `module_visibility` | dash-admin | App (RPC). Desde `20260522000001`: `module_visibility.is_visible_for_public` + trigger self-healing |
| `app_events` | dash-admin (`/admin-analytics`) | RPC `track_event()` (SECURITY DEFINER). Desde `20260522000001`: dual-actor (`user_id` OR `visitor_id`) |
| `imports_product_map`, `importer_group_map`, `ncm_densidade_kg_m3` | dash-imports-exports | Service role (DML em migration). Aux tables criadas em `20260525000010_imports_exports_enrichment.sql`. `importer_group_map` intencionalmente vazia ao seed time — populada por DML follow-up após Worktree B ETL backfill (T11 CTO). |
| `stock_guide_companies`, `stock_guide_drivers`, `stock_guide_sensitivities`, `stock_guide_scenario_grid`, `stock_guide_config` (`stock_guide_sensitivity` dormante) | dash-stock-guide (read via SECURITY DEFINER RPCs) + dash-admin (write via `is_admin()`-guarded RPCs) + Dados Locais (write em `stock_guide_scenario_grid` via service role) | Admin via RPCs (`stock_guide_scenario_grid` via service role). RLS habilitada **sem policies** em todas (hide-aware reads only). `stock_guide_companies` carrega os fundamentals (`net_debt_y1/y2`, `ebitda_y1/y2`, `net_income_y1/y2`, opcional `net_income_adj_y1/y2` adicionado `20260610000000`, `fcfe_y1/y2`, `dividends_y1/y2`, `volumes_y1/y2`) — multiplos derivados live no browser. **Sensibilidade = malha de cenários 1-D de Brent (`20260612000000`, atual):** `stock_guide_sensitivities.definition jsonb` carrega um bloco **não-sensível** `grid` (`{ x_driver_key, x_label, x_unit, output:"target_price" }`, sem empresa, gravado verbatim) que marca a tabela como malha de Brent interpolada; os valores por papel ficam na tabela relacional nova `stock_guide_scenario_grid(sensitivity_id bigint FK→stock_guide_sensitivities ON DELETE CASCADE, ticker text, x_value numeric, primary_value numeric)`, PK `(sensitivity_id, ticker, x_value)`, criada por `20260612000000_stock_guide_scenario_grid.sql`. Leitura via RPC novo `get_stock_guide_scenario_grid(p_sensitivity_id bigint) → TABLE(ticker, x_value, primary_value)` (SECURITY DEFINER, hide-aware — só tickers `is_visible` para não-admin, mesmo critério de `get_stock_guide_sensitivity_tables`; GRANT anon+authenticated). Escrita via service role (`scripts/manual/stock_guide_brent_grid_upload.py`, replace-total por `sensitivity_id`, bypassa RLS). O frontend interpola a série por ticker 1-D ao vivo (busca binária) → target price + upside. **Camada elástica `compose` substituída:** o bloco `definition.compose` (`20260611000000`) e o helper `_sg_strip_compose(jsonb,text[])` ficaram **dormentes** (não dropados; `_sg_strip_compose` segue sendo chamado por `get_stock_guide_sensitivity_tables` por defesa em profundidade, mas o frontend não renderiza mais `compose`). Schema completo + contrato RPC em [`docs/app/stock-guide.md`](../app/stock-guide.md) e [`docs/master.md`](../master.md) § "Contrato /stock-guide". |

### App Analytics (adicionada 2026-05-07, expandida 2026-05-22)

Migrations: `20260507000011_add_app_events.sql` (criação), `20260522000001_anonymous_access.sql` (dual-actor user_id OR visitor_id).

RLS: INSERT bloqueado diretamente (sem policy de INSERT — escritas apenas via `track_event()` SECURITY DEFINER). SELECT restrito a `profiles.role = 'Admin'` via policy `"app_events admin read"` com `(select auth.uid())` (Hardening A).

Schema dual-actor (a partir de `20260522000001`):
- `user_id UUID` — agora **nullable** (antes NOT NULL). Sessão autenticada preenche aqui.
- `visitor_id TEXT` — coluna **nova**. Sessão anônima preenche aqui (UUID v4 do cookie `sd_visitor_id`).
- CHECK constraint `app_events_actor_chk`: `user_id IS NOT NULL OR visitor_id IS NOT NULL` — sempre temos algum ator.

Índices: `idx_app_events_user_created (user_id, created_at DESC)`, `idx_app_events_type_created (event_type, created_at DESC)`, `idx_app_events_route_created (route, created_at DESC) WHERE route IS NOT NULL`, `idx_app_events_visitor_created (visitor_id, created_at DESC) WHERE visitor_id IS NOT NULL` (novo — partial index para queries anon).

RPCs (todas `SECURITY DEFINER`, `SET search_path = public, auth`; analytics RPCs guardam caller Admin via RAISE EXCEPTION e excluem Admins dos agregados):

| Função | Assinatura | Notas |
|---|---|---|
| `track_event` | `(p_event_type text, p_route text DEFAULT NULL, p_payload jsonb DEFAULT '{}', p_visitor_id text DEFAULT NULL) RETURNS void` | 4 args desde `20260522000001`. Se `auth.uid()` presente: INSERT com `user_id=uid, visitor_id=NULL`. Senão se `p_visitor_id` presente: INSERT com `user_id=NULL, visitor_id=p_visitor_id`. Senão: no-op silencioso. `GRANT EXECUTE TO anon, authenticated` (antes só authenticated) |
| `get_analytics_kpis` | `(period_days int DEFAULT 30) RETURNS jsonb` | Retorna `{dau, wau, mau, total_users, active_users_period, unique_visitors_period, unique_authenticated_period, exports_period, page_views_period, logins_period}`. DAU/WAU/MAU usam `COUNT(DISTINCT COALESCE(user_id::text, visitor_id))` (anônimos contam). |
| `get_analytics_by_dashboard` | `(period_days int DEFAULT 30) RETURNS TABLE(route text, page_views bigint, unique_users bigint, exports bigint, bytes_total bigint)` | `unique_users` agora conta atores únicos (autenticados + visitantes anônimos). `bytes_total` = soma de `payload->>'bytes'` em eventos export |
| `get_analytics_by_user` | `(period_days int DEFAULT 30, p_search text DEFAULT '') RETURNS TABLE(user_id uuid, full_name text, role text, last_login timestamptz, page_views bigint, exports bigint, top_routes jsonb)` | Apenas autenticados — visitantes não têm `profile` row. `last_login` = MAX created_at WHERE event_type='login'; `top_routes` = array JSON de até 3 `{route, views}`; ILIKE em full_name se p_search não-vazio; ordenado DESC por page_views |
| `get_analytics_user_timeline` | `(target_user_id uuid, period_days int DEFAULT 30) RETURNS TABLE(event_type text, route text, payload jsonb, created_at timestamptz)` | Drill-down de 1 usuário; LIMIT 500; ORDER BY created_at DESC |
| `get_analytics_heatmap` | `(period_days int DEFAULT 30) RETURNS TABLE(dow int, hour int, event_count bigint)` | Apenas page_view; DOW 0=domingo (EXTRACT(DOW)); timezone America/Sao_Paulo. Inclui linhas anon. |
| `get_analytics_anon_summary` | `(p_period_days int DEFAULT 30) RETURNS TABLE(unique_visitors bigint, total_page_views bigint, top_routes jsonb)` | Nova em `20260522000001`. KPI dedicado para seção "Anonymous Activity" em `/admin-analytics`. `top_routes` = `[{route, page_views}, ...]` LIMIT 20. Admin-only. |

Sem entrada em `module_visibility` — `/admin-analytics` protegido por `useRoleGuard`. Sem retencao automatica (LGPD pendente — nao criar pg_cron sem aprovacao do CTO).

### Anonymous Access (adicionada 2026-05-22)

Migration: `20260522000001_anonymous_access.sql`. Torna o login opcional, introduzindo 3-tier visibility (Anon / Client / Admin).

**Mudanças de schema:**

| Objeto | Mudança |
|---|---|
| `module_visibility.is_visible_for_public` | Coluna nova `BOOLEAN NOT NULL DEFAULT TRUE`. CHECK constraint `module_visibility_public_implies_clients_chk` impede `public=true AND clients=false`. BEFORE INSERT/UPDATE trigger `trg_module_visibility_public_implies_clients` coerce `clients=true` quando `public=true` (self-healing). |
| `app_events.user_id` | DROP NOT NULL (agora nullable). |
| `app_events.visitor_id` | Coluna nova `TEXT`. |
| `app_events` actor CHECK | `user_id IS NOT NULL OR visitor_id IS NOT NULL`. |
| `stock_portfolios.is_public` | Coluna nova `BOOLEAN NOT NULL DEFAULT FALSE`. |
| `stock_portfolios.user_id` | DROP NOT NULL (para portfolios públicos system-owned). |
| `stock_portfolios` policy | Nova permissive policy `"anon and authed read public portfolios"` FOR SELECT TO anon, authenticated USING `is_public=TRUE`. Policy original do dono (FOR ALL via `auth.uid() = user_id`) preservada — RLS OR-combina permissive policies. |
| `news_hunter_default_keywords` | Tabela nova `(keyword TEXT PK, created_at timestamptz)`. RLS ON. Policy SELECT TO anon, authenticated USING TRUE. Seed das 27 keywords previamente hardcoded em `seed_my_news_hunter_keywords()`. |
| `news_articles` | Nova policy `"anon read news_articles"` FOR SELECT TO anon. |

**RPCs novas/alteradas:**

| RPC | Mudança |
|---|---|
| `get_module_visibility()` | Recriada com 4 colunas (`module_slug, is_visible_for_clients, is_visible_on_home, is_visible_for_public`). `GRANT EXECUTE TO anon, authenticated` (antes só authenticated). |
| `set_module_public_visibility(p_slug, p_is_visible)` | Nova. Admin-only via `require_admin_mfa()`. Audit trail em `app_events` (event_type `admin.set_module_public_visibility`). |
| `track_event` | Nova assinatura de 4 args (ver tabela App Analytics). Old 3-arg signature **DROPADA** — PostgREST resolve overload por nome de argumento; manter ambas causaria shadowing. Frontend foi atualizado no mesmo deploy. |
| `get_default_news_keywords()` | Nova. Retorna `TEXT[]` das keywords default. `GRANT EXECUTE TO anon, authenticated`. |
| `seed_my_news_hunter_keywords()` | Refatorada — agora lê de `news_hunter_default_keywords` em vez de lista hardcoded. Single source of truth para defaults. |
| 5 RPCs analytics | Trocam `COUNT(DISTINCT user_id)` por `COUNT(DISTINCT COALESCE(user_id::text, visitor_id))` (ver App Analytics). |
| `get_analytics_anon_summary(p_period_days)` | Nova (ver App Analytics). |

**Seed:** 1 portfolio público `'00000000-0000-0000-0000-000000000001'` — "Brazilian Oil & Gas (default)" com `PETR4.SA, VBBR3.SA, BRAV3.SA, UGPA3.SA, RECV3.SA, PRIO3.SA`. UUID determinístico (idempotente). 27 keywords seed em `news_hunter_default_keywords` (`petróleo`, `Petrobras`, `Vibra`, `Brava`, `Ultrapar`, etc.).

**Verificação anon-safety:** rodar `SET role anon; SELECT * FROM stock_portfolios;` — deve retornar apenas rows com `is_public=TRUE`. `get_advisors` deve continuar clean.

### Pegadinhas — anonymous access

**Dual-actor `app_events`:** sempre filtre por `(user_id IS NOT NULL OR visitor_id IS NOT NULL)` é redundante (CHECK garante), mas ao escrever queries cross-tier use `COALESCE(user_id::text, visitor_id)` em DISTINCT. LEFT JOIN em `profiles` para preservar anon rows (`p.role IS NULL OR p.role <> 'Admin'`). RPCs como `get_analytics_by_user` são intencionalmente authed-only — visitantes não têm UUID nem profile.

**`track_event` 3-arg dropado:** a migration faz `DROP FUNCTION IF EXISTS public.track_event(text, text, jsonb)` antes do CREATE OR REPLACE da nova assinatura de 4 args. Frontend (`src/lib/tracking.ts`) foi atualizado no mesmo deploy. Se algum caller stale tentar a antiga, PostgREST retorna 404 — comportamento desejado, força refresh.

**Cookie namespacing `sd_*` vs `sb-*`:** Supabase Auth reserva o prefixo `sb-` (`sb-access-token`, `sb-refresh-token`, etc). Cookies próprios do app devem usar prefixo distinto. Usamos `sd_*` (SectorData). O cookie de visitor anônimo é `sd_visitor_id` (HttpOnly, Secure, SameSite=Lax, Max-Age 31536000s = 1 ano), emitido por `src/proxy.ts`. **Nunca** crie cookies `sb-*` próprios — risco de colisão com a chain de auth do Supabase ou misread por SSR.

**Self-healing trigger em `module_visibility`:** se um caller (frontend OU service-role direto) escreve `public=true AND clients=false`, o BEFORE trigger silenciosamente faz `clients=true` antes do INSERT/UPDATE. O CHECK constraint sobrevive como defesa em profundidade caso o trigger seja contornado (improvável, mas defensivo). UI do Admin Panel deve refletir esse comportamento — togglar Public=ON com Clients=OFF deve also toggle Clients=ON automaticamente.

**Segundo invariante em `module_visibility` (adicionado `20260526900000`):** `home=true ⇒ (public=true OR clients=true)`. Um módulo só aparece no /home se for visível para pelo menos um público. Enforced pelo CHECK constraint `module_visibility_home_requires_visible_chk` (`(NOT home) OR public OR clients`) + BEFORE trigger `trg_module_visibility_home_requires_visible` que coerce `home := false` quando ambos audiences são `false`. Mesmo padrão self-healing do invariante `public ⇒ clients`. Migration auto-healed 1 row pré-existente (`market-share`) que estava com `home=true` mas ambos audiences `false`. UI do Admin Panel: o toggle "Show on Home" deve checar se há pelo menos um audience ativo; se não, refletir `home=false` após save (o trigger silenciosamente faz isso).

### Data Sources Freshness (adicionada 2026-05-26)

Migration: `20260526200000_data_sources_freshness.sql`. RPC pública que serve a tabela live "Data Sources" da `/home` (desktop split 50/50; mobile fica só com cards).

| RPC | Assinatura | Notas |
|---|---|---|
| `get_data_sources_freshness` | `() RETURNS TABLE(source_key text, last_update timestamptz, row_count bigint)` | LANGUAGE sql STABLE SECURITY DEFINER. `SET search_path = public, pg_temp`. `GRANT EXECUTE TO anon, authenticated`. Polled 60s pelo hook `useDataSourcesFreshness` em `src/components/home/DataSourcesTable/`. SECURITY DEFINER é obrigatório porque a UNION lê tabelas com RLS authed-only (vide CLAUDE.md Pegadinha #18) — sem ele, anon callers receberiam `[]` silenciosamente. **Hotfix `20260527300000`** (Subsidy Reform): DROP+CREATE para remover branch `anp_subsidy_history` (DROPADA) e adicionar branches `anp_subsidy_caps` + `anp_subsidy_commercialization` (ambos `MAX(inserted_at)`). Total atual: 23 sources. |

A query é um UNION ALL de 22 SELECTs (1 por tabela ETL-fed). Cada SELECT carrega um literal `source_key text` que é a chave de match com o catálogo TS `src/data/dataSources.ts`. O catálogo TS tem 23 entries: 22 tabelas + `yahoo_finance` (live realtime, sem tabela Supabase — exibido pela tabela com label "live" em vez de timestamp).

**Tabelas cobertas (23, após hotfix `20260527300000`):** `anp_cdp_diaria`, `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco`, `anp_cdp_producao`, `anp_voip`, `vendas`, `anp_precos_produtores`, `anp_glp`, `anp_lpc`, `anp_precos_distribuicao`, `anp_subsidy_diesel_reference`, `anp_subsidy_caps`, `anp_subsidy_commercialization`, `mdic_comex`, `anp_daie`, `anp_desembaracos`, `navios_diesel`, `vessel_positions`, `port_arrivals`, `import_candidates`, `d_g_margins`, `price_bands`, `news_articles`. (`anp_subsidy_history` foi DROPADA pela Subsidy Reform e a branch removida do UNION — ver § "Subsidy Reform".)

**Convenções de `last_update` por tabela** (descobertas em runtime via `list_tables` durante a integração — referência para futuras tabelas que entrarem na RPC):

| Tabela | Coluna escolhida | Razão |
|---|---|---|
| `anp_cdp_diaria` / `_instalacao` / `_poco` | `data` | Coluna day-grain canônica. |
| `anp_cdp_producao` / `anp_glp` / `mdic_comex` / `anp_daie` / `anp_desembaracos` | `make_date(ano, mes, 1)` | Month-grain — synthesize via `make_date`. `last_update` representa "mês coberto", não "instante do ingest". |
| `anp_voip` | `make_date(ano_publicacao, 1, 1)` | Anual. |
| `vendas` | `date` | Day-grain (já normalizado). |
| `anp_precos_produtores` | `data_fim` | Tabela carrega uma JANELA (`data_inicio..data_fim`), não data única. Usa `data_fim` (borda superior da semana publicada). **Não existe `data_referencia` aqui** (não confundir com `anp_precos_distribuicao`). |
| `anp_lpc` | `data_fim` | Idem — semana fechada. **Não existe `data_referencia`**. |
| `anp_precos_distribuicao` / `anp_subsidy_diesel_reference` | `data_referencia` | Day-grain de publicação. |
| `anp_subsidy_caps` / `anp_subsidy_commercialization` | `MAX(inserted_at)` | Ambas append-only — o sinal de freshness é o ingest time, não a data de vigência. Hotfix `20260527300000` (Subsidy Reform). |
| `navios_diesel` | `collected_at` | Timestamp de scraping. |
| `vessel_positions` | `ts` | Timestamp do AIS ping (não `created_at`). |
| `port_arrivals` | `detected_at` | Timestamp do detector ETL — melhor que `entered_at` (que reflete ETA, não a chegada efetivamente detectada). |
| `import_candidates` | `last_seen_at` | Última vez que o candidato foi observado pelo AIS scan. |
| `d_g_margins` | `to_date(week, 'IW/IYYY')` | Coluna `week` é **TEXT** em formato `"W/YYYY"` (ISO week / ISO year). Sem `to_date` retornaria max lexicográfico (`'9/2025' > '10/2026'`). `to_date('IW/IYYY')` devolve a segunda-feira da semana ISO. |
| `price_bands` | `date` | Day-grain. |
| `news_articles` | `found_at` | Timestamp do scanner externo. |

**Consumidor:** `src/components/home/DataSourcesTable/` (8 arquivos — `index.tsx`, `SectionHeader.tsx`, `SourceRow.tsx`, `ExpandedRow.tsx`, `StatusDot.tsx`, `LastUpdateCell.tsx`, `DashboardPicker.tsx`, `useDataSourcesFreshness.ts`). Wrapper JS: `rpcGetDataSourcesFreshness` em `src/lib/rpc.ts`. Catálogo curado: `src/data/dataSources.ts`.

**Visibilidade:** acessível para Anon + Client + Admin (`GRANT EXECUTE TO anon, authenticated` cobre ambos). O download nas linhas é gated por sessão (Anon vê botão "Sign in to download" desabilitado). Sub-PRD: [`docs/app/admin.md`](../app/admin.md) § "Data Sources live table".

### Field Stakes (added 2026-05-27)

Migration: `20260527600000_field_stakes.sql`. Manually-curated catalog of per-field × per-company working-interest (stake percentage), used by the future `/production` dashboard to estimate company-attributable oil/gas production from `anp_cdp_producao` (which carries only `operador`, never the full ownership split).

**Schema — `public.field_stakes`:**

| Column | Type | Notes |
|---|---|---|
| `campo` | text NOT NULL | Field name. Joins with `anp_cdp_producao.campo` and `mv_anp_cdp_pocos.campo` (UPPER-cased, accent-preserving — same convention as the source). |
| `empresa` | text NOT NULL | Company name (operator or non-operating partner). Free-form text — autocomplete fed by `get_field_stakes_empresas()` against existing rows. |
| `stake_pct` | numeric(6,3) NOT NULL | CHECK `stake_pct > 0 AND stake_pct <= 100`. 3-decimal precision (e.g. `88.999`). |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | Audit timestamp. |
| `updated_by` | uuid REFERENCES auth.users(id) | Admin who last touched this `(campo, empresa)` row. Nullable for legacy rows. |
| PK | (campo, empresa) | One stake row per company per field — composite PK enforces uniqueness. |

Indexes: `field_stakes_campo_idx (campo)`, `field_stakes_empresa_idx (empresa)`.

**RLS pattern (read-open / write-via-RPC-only):**

- SELECT policy `field_stakes_read_all` granted to `anon, authenticated` with `USING (true)` — stakes are non-sensitive metadata (public ANP information aggregated by Admin).
- **No INSERT / UPDATE / DELETE policies** — direct writes blocked by RLS. All mutations flow through `admin_*` SECURITY DEFINER RPCs that guard via `public.is_admin()`.

**RPCs (all `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp` unless noted; CLAUDE.md Pegadinha #18):**

| RPC | Signature | Notes |
|---|---|---|
| `get_field_stakes_overview` | `() RETURNS TABLE(campo text, n_empresas int, soma_pct numeric, is_complete boolean, has_data_in_producao boolean, last_updated timestamptz)` | Drives the editor's master list. UNION of `mv_anp_cdp_pocos.campo` (all known fields) with `field_stakes.campo` (in case Admin added stakes for a campo no longer in production) — LEFT JOIN'd to aggregated stakes. `is_complete = (SUM=100)`. `has_data_in_producao` flags rows the editor can prioritize. `GRANT EXECUTE TO anon, authenticated`. |
| `get_field_stakes(p_campo text)` | `RETURNS TABLE(empresa text, stake_pct numeric, updated_at timestamptz)` | Editor consumes this when opening one campo. Ordered by `stake_pct DESC, empresa`. `GRANT EXECUTE TO anon, authenticated`. |
| `get_field_stakes_empresas()` | `RETURNS TABLE(empresa text, n_campos int)` | Autocomplete source — distinct companies already registered with the number of fields each appears in (DESC). `GRANT EXECUTE TO anon, authenticated`. |
| `admin_upsert_field_stakes(p_campo text, p_stakes jsonb)` | `RETURNS void` — `LANGUAGE plpgsql SECURITY DEFINER` | **Replace-all-in-one-transaction upsert.** Validates `public.is_admin()` (RAISE 42501 `forbidden` otherwise), validates `p_campo` non-empty (22023), validates `SUM((stake_pct))=100` across the jsonb array (RAISE 23514 `sum_must_equal_100: got <value>` otherwise), then `DELETE` of all existing rows for that campo + `INSERT` of the new set in the same tx. Empty-empresa entries are filtered out. `updated_by = auth.uid()`. Input shape: `[{"empresa":"Petrobras","stake_pct":88.99}, ...]`. `GRANT EXECUTE TO authenticated`. |
| `admin_delete_field_stakes(p_campo text)` | `RETURNS void` — `LANGUAGE plpgsql SECURITY DEFINER` | Admin-only nuke of all stakes for one campo. Validates `is_admin()`. `GRANT EXECUTE TO authenticated`. |

**Design rationale:**

- **Replace-all upsert (not row-by-row) + sum=100 enforcement in the RPC** — guarantees the editor never persists an inconsistent state. The pre-condition is a transactional invariant, not a UI concern.
- **Hard sum=100 rule** — a field's stakes by definition partition 100% ownership. Allowing 99.5 or 100.5 would silently drift dashboards downstream.
- **No DB-level trigger sum check** — sum invariant is RPC-scoped (the RPC owns the unit of work). A trigger would block the intermediate DELETE+INSERT mid-tx.
- **Admin guard via `is_admin()` (the existing helper)** — same pattern as `set_module_visibility`, `admin_add_default_news_keyword`, `track_event` admin branches. Centralizes the Admin check definition.
- **No UPDATE policy and no service-role write path defined here** — the only writer is Admin via UI. Bulk seed (if needed later) goes through a follow-up DML migration that calls `admin_upsert_field_stakes` after temporarily setting `request.jwt.claims` to an Admin uuid (same pattern used by `importer_group_map` seeding).

**Validation confirmed at apply time:**

- All 5 RPCs report `pg_proc.prosecdef = true` (Pegadinha #18 check).
- `get_field_stakes_overview()` returns rows for all campos in `mv_anp_cdp_pocos` with `n_empresas=0, soma_pct=0, has_data_in_producao=true` (since `field_stakes` is empty at seed time).
- `admin_upsert_field_stakes('__test__', '[{"empresa":"Petrobras","stake_pct":50}]'::jsonb)` raises `42501 forbidden` for non-admin callers and `23514 sum_must_equal_100: got 50` after simulating an Admin uuid via `request.jwt.claims`.

**Future consumer:** `/production` dashboard (not yet built — see plan `vou-fazer-uma-mudan-a-fizzy-quiche.md` Fase 2+). Computes `company_volume = SUM(petroleo_bbl_dia * stake_pct / 100)` after JOIN of `anp_cdp_producao` × `field_stakes` on `campo`.

**Editor location:** `/admin-panel` → "Field Stakes" section (owned by dash-admin worker, to be added in plan Fase 2).

### Production RPCs (added 2026-05-28)

Migration: `20260528000000_production_rpcs.sql`. Five RPCs feeding the `/production` dashboard (built in Fase 2 of `vou-fazer-uma-mudan-a-fizzy-quiche.md`). Reads `anp_cdp_producao` JOIN `field_stakes` on `campo` server-side, returns stake-weighted oil/gas/water aggregates per company × ambiente × month plus Top-N, by-installation, and YoY/MoM/YTD summary.

**JOIN pattern (used by 4 of the 5 RPCs):**

```sql
WITH valid_stakes AS (
  SELECT campo, empresa, stake_pct
    FROM field_stakes
   WHERE campo IN (
     SELECT campo FROM field_stakes
      GROUP BY campo
     HAVING SUM(stake_pct) = 100
   )
     AND empresa = p_empresa
)
SELECT ..., SUM(p.<metric> * vs.stake_pct / 100) ...
  FROM anp_cdp_producao p
  JOIN valid_stakes vs ON vs.campo = p.campo
```

The `HAVING SUM(stake_pct) = 100` filter silently excludes incomplete-stake campos from company aggregates (the Admin sees the incomplete state in `/admin-panel` "Field Stakes" via `get_field_stakes_overview.is_complete`). This is intentional: a campo with partial coverage would otherwise under-report a company's attributable production.

**All 5 RPCs are `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp`** because `anp_cdp_producao` and `field_stakes` have RLS scoped to `authenticated` (CLAUDE.md Pegadinha #18). Anon callers would otherwise get empty `[]` with no error.

| RPC | Signature | Notes |
|---|---|---|
| `get_production_brazil_aggregate` | `(p_date_start date, p_date_end date, p_ambientes text[] DEFAULT NULL) RETURNS TABLE(ano int, mes int, ambiente text, oil_bbl_dia numeric, gas_mm3_dia numeric, water_bbl_dia numeric, hours_rate numeric)` | No stake math — pure SUM over `anp_cdp_producao` grouped by `(ano, mes, local AS ambiente)`. `hours_rate = AVG(tempo_prod_hs_mes) / (days_in_month × 24)`. Optional `p_ambientes` filter (`PreSal` / `PosSal` / `Terra`). |
| `get_production_company_aggregate` | `(p_empresa text, p_date_start date, p_date_end date, p_ambientes text[] DEFAULT NULL) RETURNS TABLE(ano int, mes int, ambiente text, oil_bbl_dia numeric, gas_mm3_dia numeric, water_bbl_dia numeric)` | Stake-weighted via `valid_stakes` CTE. Same date/ambiente shape as Brazil aggregate, no `hours_rate` (rate is well-level, not stake-weightable). |
| `get_production_top_fields` | `(p_empresa text, p_date date, p_top_n int DEFAULT 10) RETURNS TABLE(campo text, oil_bbl_dia numeric, water_bbl_dia numeric, hours_rate numeric, stake_pct numeric)` | Single-month top-N fields by stake-weighted oil. `stake_pct` returned for editor cross-ref. `hours_rate` uses `date_trunc('month', p_date)` for days-in-month (not `make_date(p.ano,p.mes,1)`, which would violate GROUP BY when grouping only by `campo`). |
| `get_production_by_installation` | `(p_empresa text, p_date date) RETURNS TABLE(instalacao text, oil_bbl_dia numeric, gas_mm3_dia numeric, hours_rate numeric)` | Groups stake-weighted oil/gas by `instalacao_destino` (FPSO/UEP). NULL installation → `'— sem instalação —'` sentinel. |
| `get_production_yoy_table` | `(p_empresa text, p_date date) RETURNS TABLE(scope text, current_kbpd numeric, prev_month_kbpd numeric, prev_year_kbpd numeric, ytd_avg_kbpd numeric, mom_pct numeric, yoy_pct numeric)` | Returns 1 `TOTAL` row + 1 row per ambiente (`PreSal` / `PosSal` / `Terra`). All volumes in **kbpd** (`SUM(petroleo_bbl_dia × stake_pct / 100) / 1000`). MoM = vs. `p_date - 1 month`; YoY = vs. `p_date - 1 year`; YTD avg = avg of months 1..M of `p_date` year. `TOTAL.ytd_avg_kbpd` is `SUM(per_ambiente.ytd_avg_kbpd)` (fixed in Round 2 — see below). |

**Grants (all 5):** `TO anon, authenticated` — `/production` is exposed to anonymous visitors gated by `module_visibility.is_visible_for_public` (currently `false`, but the RPCs are anon-safe so toggling the flag requires no further migration).

**Module visibility seed:** `INSERT INTO module_visibility ('production', is_visible_for_clients=true, is_visible_on_home=true, is_visible_for_public=false) ON CONFLICT DO NOTHING`.

**Validation confirmed at apply time (Apr-26 / Petrobras):**

- All 5 RPCs report `pg_proc.prosecdef = true`.
- Brazil aggregate Apr-26: PreSal 3,568 kbpd / PosSal 690 kbpd / Terra 79 kbpd oil. Cross-validated PreSal against raw `SUM(petroleo_bbl_dia) WHERE local='PreSal'` → identical (3,567,700).
- Petrobras Apr-26 total = **2,710.8 kbpd** (target from PDF Well-by-Well: ~2,708 kbpd → within 0.1%).
- Top 10 Petrobras campos Apr-26: Búzios_Eco, Tupi, Mero, Búzios, Jubarte, Itapu, Marlim Sul, Berbigão, Itapu_Eco, Marlim — matches expected crown-jewel lineup.
- YoY Apr-26: TOTAL MoM +2.13%, YoY +18.19%.

**Future consumer:** `/production` dashboard (Frentes B+C of `vou-fazer-uma-mudan-a-fizzy-quiche.md` Fase 2). Wrapper to be added to `src/lib/rpc.ts` by the dash worker.

#### Round 2 (2026-05-28) — Migration `20260528100000_production_round2.sql`

- **CHANGE — `get_production_yoy_table`:** in the `total_row` CTE, replaced `AVG(ytd_avg_kbpd)` with `SUM(ytd_avg_kbpd)` so the TOTAL row is consistent with the other 3 TOTAL columns (`current_kbpd`, `prev_month_kbpd`, `prev_year_kbpd` already SUM). The previous version under-reported `TOTAL.ytd_avg_kbpd` by ~3× (averaged the 3 ambiente subtotals instead of summing them). Validated post-apply: Petrobras Apr-26 TOTAL ytd_avg = 2,599.27 kbpd = 348.38 (PosSal) + 2,231.26 (PreSal) + 19.62 (Terra). Signature unchanged; consumers need no code change.
- **NEW — `get_production_field_timeseries(p_campo text, p_empresa text, p_date_start date, p_date_end date) RETURNS TABLE(ano int, mes int, oil_bbl_dia numeric, gas_mm3_dia numeric, water_bbl_dia numeric, hours_rate numeric)`:** 13-month per-campo × empresa stake-weighted time series. Same `valid_stake` discipline as the other 4 RPCs (`HAVING SUM(stake_pct) = 100`; incomplete campos silently excluded). `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp`. Granted `TO anon, authenticated`. **Consumer:** `/production` Top Fields panel — click on a campo opens a drill-down modal showing the 13-month series. Validated post-apply: `('TUPI', 'Petrobras', 2025-04-01, 2026-04-30)` returns 13 rows; Apr-26 oil = 553,425 bbl/d → 553 kbpd, matches the value Frente A previously reported in `top_fields` for TUPI.

#### Round 3 (2026-05-28) — Migration `20260528200000_production_installation_timeseries.sql`

- **NEW — `get_production_installation_timeseries(p_instalacao text, p_empresa text, p_date_start date, p_date_end date) RETURNS TABLE(ano int, mes int, oil_bbl_dia numeric, gas_mm3_dia numeric, water_bbl_dia numeric, hours_rate numeric)`:** mirror of Round 2's `get_production_field_timeseries`, but filtered by `instalacao_destino` instead of `campo`. Stake-weighted via the same `valid_stakes` CTE pattern (`HAVING SUM(stake_pct) = 100`; incomplete campos silently excluded). The JOIN through `field_stakes × empresa` naturally restricts to wells where the user's empresa actually holds a stake, so the result is the company-attributable share of the FPSO's output (e.g. `p_instalacao='FPSO Cidade de Maricá'` + `p_empresa='Petrobras'` → ~0.65 × FPSO total because the FPSO serves TUPI where Petrobras holds 65%). `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp`. Granted `TO anon, authenticated`. **Consumer:** `/production` Installations panel — click on an FPSO opens the same 13-month drill-down modal that powers the Top Fields panel, but scoped to the installation.

#### Round 4 (2026-05-28) — Migration `20260528300000_well_by_well_round4.sql`

Five coordinated changes to support the `/production` → `/well-by-well` rename, canonical field name grouping (so `AnC_Búzios` + `Búzios_ECO` + `Búzios` collapse into one row in UI), and a live Admin "Field Stakes" overview that no longer requires a `mv_anp_cdp_pocos` refresh after each ETL run.

1. **`module_visibility` rename:** `UPDATE module_visibility SET module_slug='well-by-well' WHERE module_slug='production'`. Preserves the existing visibility flags (`is_visible_for_clients=true`, `is_visible_on_home=true`, `is_visible_for_public=false` from Round 1 seed). The frontend `useModuleVisibilityGuard('well-by-well')` will resolve correctly post-Frente B (dash worker).

2. **NEW table `field_canonical_names(variant text PK, canonical text NOT NULL, source text CHECK IN ('rule','manual') DEFAULT 'manual', created_at timestamptz DEFAULT now())`** with RLS enabled, single `SELECT` policy granted to `anon, authenticated`. No write policies — future admin RPCs (Round 5+) handle inserts. Index on `(canonical)` for reverse lookups (canonical → all variants). Intentionally seeded empty: the deterministic helper handles the common cases (`AnC_`, `EX_` prefixes; `_ECO`, `_EX` suffixes) and only edge cases need manual entries.

3. **NEW helper `canonical_field_name(p_variant text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp`:** 3-tier resolution — (a) manual override from `field_canonical_names`; (b) strip `^AnC_`/`^EX_` prefix + `(_ECO|_EX)$` suffix (case-insensitive); (c) fallback to input as-is. Validated: `AnC_Búzios` → `Búzios`, `Búzios_ECO` → `Búzios`, `EX_Marlim` → `Marlim`, `Marlim_EX` → `Marlim`, `TUPI` → `TUPI` (unchanged), `AnC_TUPI_ECO` → `TUPI` (both stripped). Granted `TO anon, authenticated`.

4. **CHANGE — `get_production_top_fields`:** now groups by `canonical_field_name(p.campo)` and aggregates stake-weighted oil/water across all variants. `stake_pct` is reported as the production-weighted average across variants (`SUM(petroleo_bbl_dia × stake_pct) / NULLIF(SUM(petroleo_bbl_dia), 0)`, falling back to `AVG(stake_pct)` for zero-production rows). For single-variant fields this equals the unique stake. Signature **unchanged** — frontend wrapper doesn't need to be touched. Cross-validated post-apply (Petrobras Apr-26): `BÚZIOS` canonical sums to 809,239.60 bbl/d = 237,721.65 (BÚZIOS) + 571,517.95 (BÚZIOS_ECO).

5. **CHANGE — `get_production_field_timeseries`:** `p_campo` is now interpreted as the **canonical** name; the WHERE clause expands to all variants via `WHERE canonical_field_name(p.campo) = p_campo`. So calling with `p_campo='BÚZIOS'` returns the combined Petrobras-attributable series across BÚZIOS + BÚZIOS_ECO. Signature unchanged.

6. **CHANGE — `get_field_stakes_overview`:** source switched from `mv_anp_cdp_pocos` (manual REFRESH MATERIALIZED VIEW required after every ETL run, which created stale-data risk) to a live read of `anp_cdp_producao` filtered to the **last 2 distinct (ano, mes)** months. New column `canonical text` added (forces `DROP FUNCTION` + `CREATE` rather than `OR REPLACE`, per Pegadinha #18 — re-granted to `anon, authenticated` immediately). The 2-month window is the operating-rule: ANP publishes monthly with a 1-month lag, so "active campos" = present in either of the 2 most recent published months. Ordering changed to `ORDER BY canonical, campo` so variants cluster in the editor UI. Validated: BÚZIOS + BÚZIOS_ECO both appear in the overview with `canonical='BÚZIOS'` and `has_data_in_producao=true`.

7. **NEW index `anp_cdp_producao_campo_idx ON anp_cdp_producao(campo)`:** supports future patterns that filter or distinct on `campo` without `(ano, mes)`. Note: the `last_two_months → active_campos` path in the new `get_field_stakes_overview` is selective enough that the planner currently still prefers an Index-Only Scan on `anp_cdp_producao_pkey` (PK leads with `(ano, mes, ...)`). The campo-only index is defense-in-depth for future RPCs that need DISTINCT campo without time bounds. Overview execution time post-apply: **42 ms** for 336 rows / 290 distinct campos — well under the 500 ms target.

**Pegadinha trail in this migration:** (a) `get_field_stakes_overview` requires `DROP FUNCTION` because adding a column to `RETURNS TABLE` changes the row type (Postgres error 42P13); (b) DROP wipes grants and `SECURITY DEFINER`, so they're re-applied explicitly right after `CREATE`; (c) the migration file in `supabase/migrations/` mirrors the applied DDL exactly (including DROP) so `supabase db push` from a fresh clone produces identical state.

**Frontend follow-ups (other Frentes of Round 4, not this migration):** Frente B renames route `/production` → `/well-by-well` and updates `getModuleVisibility('production')` → `'well-by-well'` calls. Frente C updates `/admin-panel` "Field Stakes" section to display the new `canonical` column. Frente D updates `src/lib/rpc.ts` wrappers if they hardcoded the old `RETURNS TABLE` shape.

#### Round 5 (2026-05-28) — Migration `20260528400000_well_by_well_perf_mv.sql`

Pre-aggregated materialized views to fix `/well-by-well` load latency. The 7 production RPCs were doing 2.2M-row JOINs + per-row `canonical_field_name()` calls on every dashboard load. Migration ships 3 MVs, a refresh function, and rewrites all 7 RPCs to read from the MVs.

**Baseline (Apr-26 Petrobras, typical input, EXPLAIN ANALYZE):**

| RPC | Before | After | Speedup |
|---|---:|---:|---:|
| `get_production_brazil_aggregate` (13 mo) | 2 822 ms | 2.6 ms | **1086×** |
| `get_production_company_aggregate` (13 mo) | 12 243 ms | 7.1 ms | **1724×** |
| `get_production_top_fields` (1 mo, top 10) | 268 ms | 4.3 ms | **62×** |
| `get_production_by_installation` (1 mo) | 172 ms | 6.7 ms | **26×** |
| `get_production_yoy_table` (2 yr) | 493 ms | 6.9 ms | **71×** |
| `get_production_field_timeseries` (13 mo, BÚZIOS) | 7 013 ms | 4.5 ms | **1558×** |
| `get_production_installation_timeseries` (13 mo, FPSO) | 33 ms | 4.3 ms | **8×** |
| **TOTAL dashboard load** | **~23.0 s** | **~36 ms** | **~640×** |

**Materialized views:**

| MV | Grain | Rows | Disk |
|---|---|---:|---:|
| `mv_brazil_monthly` | `(ano, mes, ambiente)` | 651 | 64 kB |
| `mv_production_monthly` | `(canonical, empresa, ano, mes, ambiente)` + pre-baked `stake_pct_weighted` column | 66 690 | 8 192 kB |
| `mv_production_installation_monthly` | `(instalacao, empresa, ano, mes)` | 70 758 | 8 704 kB |

Both stake-weighted MVs filter to campos with `SUM(stake_pct) = 100` via `valid_stakes` CTE inside the MV definition — same business rule the RPCs applied at runtime, now pre-applied at refresh time. The `canonical_field_name()` call is also pre-baked into `mv_production_monthly.canonical`.

**Indexes (each MV has UNIQUE PK + 1-2 secondary):**

- `mv_brazil_monthly_pk (ano, mes, ambiente)` UNIQUE — required for CONCURRENTLY
- `mv_brazil_monthly_date_idx (make_date(ano, mes, 1))` — supports the date BETWEEN filter
- `mv_production_monthly_pk (canonical, empresa, ano, mes, ambiente)` UNIQUE
- `mv_production_monthly_empresa_year_month_idx (empresa, ano, mes)` — top fields lookup
- `mv_production_monthly_empresa_date_idx (empresa, make_date(ano, mes, 1))` — company aggregate date range
- `mv_production_monthly_canonical_empresa_idx (canonical, empresa)` — field timeseries lookup
- `mv_production_installation_monthly_pk (instalacao, empresa, ano, mes)` UNIQUE
- `mv_production_installation_monthly_empresa_year_month_idx (empresa, ano, mes)`
- `mv_production_installation_monthly_empresa_date_idx (empresa, make_date(ano, mes, 1))`

**Refresh function:**

```sql
CREATE FUNCTION public.refresh_mv_production() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_brazil_monthly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_production_monthly;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_production_installation_monthly;
  END;
  $$;
```

`REFRESH CONCURRENTLY` requires each MV's UNIQUE INDEX (already shipped) and does **not** lock readers — dashboard stays responsive during refresh.

**Recommended call site:** end of CDP ETL upload (`scripts/pipelines/anp/cdp/02_upload.py`) using the service-role key. Schema-side ownership stops at the function; the CTO must dispatch the ETL worker to wire the post-upload call. Until then, the operator runs `SELECT public.refresh_mv_production();` manually after each ETL run, or a `pg_cron` job is scheduled (every 4-6h matches CDP's incremental cadence).

**Auto-refresh on `field_stakes` mutations (migration `20260601100000_field_stakes_auto_refresh.sql`):** STATEMENT-level `AFTER INSERT OR UPDATE OR DELETE` trigger on `field_stakes` fires `field_stakes_refresh_mv_trigger()` (SECURITY DEFINER + `SET search_path = public, pg_temp`), which calls `refresh_mv_production()`. STATEMENT-level (not row) so the atomic DELETE+INSERT inside `admin_upsert_field_stakes` collapses into a single refresh. Synchronous — admin stake edits are rare and the dashboard tolerates a few seconds of "saving..." latency; no pg_notify / async. Resolves stale-stake bug seen with Peregrino (Prio 40→80 stayed invisible until next CDP ETL ran). The migration also runs `SELECT public.refresh_mv_production();` once at deploy time to flush any pre-existing drift.

**Security hardening:**

- MVs **not** granted to `anon` / `authenticated`. Access path is RPC-only — the SECURITY DEFINER functions remain the sole entry point. This avoids the `materialized_view_in_api` advisor warning (PostgREST auto-exposes any granted view, creating a redundant attack surface beside the RPCs).
- `refresh_mv_production()` granted **only** to `service_role`. Supabase auto-grants EXECUTE to anon/authenticated on every new public function (via schema-level grants), so an explicit `REVOKE ALL ... FROM PUBLIC, anon, authenticated` is required — `REVOKE FROM PUBLIC` alone does not suffice. Without this, any visitor could trigger a full refresh via `/rest/v1/rpc/refresh_mv_production` (DoS + EXCLUSIVE lock vector).
- All 7 production RPCs keep `SECURITY DEFINER + SET search_path = public, pg_temp` per Pegadinha #18.

**Sanity-check vs Round 4 (numbers must match exactly):**

- Apr-26 Petrobras total = **2 710 806 bbl/d** (identical to Round 4; matches earlier PDF cross-check).
- BÚZIOS canonical = **809 239.6 bbl/d** (identical — sum of BÚZIOS + BÚZIOS_ECO variants).
- TUPI = 553 425 / MERO = 278 250 / JUBARTE = 206 548 / ITAPU = 155 202 bbl/d — all identical.
- YoY table TOTAL.current_kbpd = 2 710.8 (= sum of company aggregate / 1000).

**Surface area / RPCs unchanged:**

All 7 RPC signatures (param names, types, RETURNS TABLE columns) preserved verbatim. Frontend wrappers in `src/lib/rpc.ts` need **no** changes. The change is purely internal to the function bodies — same input, same output, different (cached) compute path.

#### Round 8 (2026-05-28) — Migration `20260528500000_well_by_well_header_rpc.sql`

One new RPC `get_well_by_well_header(p_empresa text, p_year int, p_month int)` to power the PDF-style 16-row stacked header table on `/well-by-well`. Single round trip returns all rows ordered by `display_order` (1..16) so the frontend renders top→down without re-sorting.

**Signature:**

```sql
RETURNS TABLE (
  display_order  int,        -- 1..16, stable client-side ordering
  section        text,       -- 'BRAZIL' | UPPER(p_empresa)
  category       text,       -- 'Oil (kbpd)' | 'Gas (kboed)' | 'Main fields (kbpd)'
  subcategory    text,       -- NULL = total row (bold) | 'Pre-Salt' / 'Post-Salt' / 'Onshore' | canonical field name
  is_total       boolean,    -- TRUE on the category-total row (display hint for bold)
  current_val    numeric,    -- value at (p_year, p_month), display unit
  prev_month_val numeric,    -- previous month (Jan rolls to Dec/y-1 automatically)
  mom_pct        numeric,    -- (current/prev_month - 1) * 100; NULL if prev_month NULL/0
  prev_year_val  numeric,    -- same month, p_year - 1
  yoy_pct        numeric,    -- (current/prev_year - 1) * 100; NULL if prev_year NULL/0
  ytd_avg        numeric     -- average of (sum-per-month) across months 1..p_month of p_year
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;
GRANT EXECUTE ON FUNCTION ... TO anon, authenticated;
```

**Row order (display_order):**

| # | section | category | subcategory | is_total | source |
|---|---|---|---|---|---|
| 1 | BRAZIL | Oil (kbpd) | NULL | TRUE | `mv_brazil_monthly` sum |
| 2-4 | BRAZIL | Oil (kbpd) | Pre-Salt / Post-Salt / Onshore | FALSE | `mv_brazil_monthly` per ambiente |
| 5 | BRAZIL | Gas (kboed) | NULL | TRUE | `mv_brazil_monthly` sum |
| 6-8 | BRAZIL | Gas (kboed) | Pre-Salt / Post-Salt / Onshore | FALSE | `mv_brazil_monthly` per ambiente |
| 9 | BRAZIL | Main fields (kbpd) | NULL | TRUE | sum of top 3 100% WI campos |
| 10-12 | BRAZIL | Main fields (kbpd) | canonical name | FALSE | `anp_cdp_producao` raw + `canonical_field_name()` |
| 13 | `UPPER(p_empresa)` | Oil (kbpd) | NULL | TRUE | `mv_production_monthly` stake-weighted |
| 14-16 | `UPPER(p_empresa)` | Oil (kbpd) | Pre-Salt / Post-Salt / Onshore | FALSE | `mv_production_monthly` per ambiente |

**Math notes:**

- **Oil unit**: `oil_bbl_dia / 1000.0` → kbpd. All sources are bbl/d at row grain.
- **Gas unit**: `gas_mm3_dia * 6.29 / 1000.0` → kboed. Industry-standard 1 m³ gas ≈ 6.29 boe (`anp_cdp_producao.gas_total_mm3_dia` is stored in m³/d despite the column name — Apr-26 raw sum 206,603 m³/d × 6.29 / 1000 ≈ 1,299 kboed, matches PDF page 2).
- **Ambiente labels**: source values `PreSal` / `PosSal` / `Terra` are translated to display labels `Pre-Salt` / `Post-Salt` / `Onshore` in the RPC. Frontend renders these verbatim.
- **Main fields**: top 3 canonical campos by Brazil 100% WI oil in (p_year, p_month). Tie-break by `oil_curr DESC NULLS LAST` via `ROW_NUMBER()`. Each campo's prev_month / prev_year / ytd_avg is computed across all variants (`canonical_field_name(campo) = canonical`).
- **Company section**: reads `mv_production_monthly` (already pre-applies `stake_pct/100`). Collapsed inline to (`ambiente`, `ano`, `mes`) before time-slicing.
- **MoM / YoY**: returned as percent (`* 100`). NULL when denominator is NULL or 0.
- **YTD avg**: `AVG()` of the per-month aggregate across months 1..p_month of p_year inclusive. For Brazil/Company sections, the per-month aggregate is the per-ambiente value; for Main fields, it's the per-month SUM across all variants of that canonical.
- **Type discipline**: all numeric outputs explicit-cast to `numeric` to avoid `double precision` coercion from the literal `6.29` (Postgres parses it as numeric but mixed-type aggregates can drift; `RETURNS TABLE` requires exact match per Pegadinha #18 family).

**Sanity-check vs PDF page 2 (Apr-26 Petrobras report):**

| Row | Expected | Got | Match |
|---|---|---|---|
| BRAZIL Oil total | 4,337 | 4,337.4 | ✓ |
| BRAZIL Oil Pre-Salt | 3,584 | 3,567.7 | ~ (snapshot variance) |
| BRAZIL Oil Onshore | 79 | 79.4 | ✓ |
| BRAZIL Gas total | 1,299 | 1,299.5 | ✓ |
| BRAZIL Gas Onshore | 155 | 154.9 | ✓ |
| BÚZIOS (kbpd) | 910 | 910.1 | ✓ |
| MERO (kbpd) | 721 | 720.9 | ✓ |
| PETROBRAS Oil total | 2,708 | 2,710.8 | ✓ |
| PETROBRAS Oil Onshore | 20 | 20.0 | ✓ |
| Petrobras MoM | +2% | +2.1% | ✓ |
| Petrobras YoY | +18% | +18.2% | ✓ |
| Petrobras YTD | 2,596 | 2,599 | ✓ |

Edge cases tested: PRIO (Pre-Salt + Onshore subcategory rows are NULL because PRIO has zero production there — frontend should render as em-dash / blank); January query (prev_month correctly rolls to Dec of previous year).

**Consumer:** Frente B `dash-well-by-well` adds wrapper `getWellByWellHeader(empresa, year, month)` in `src/lib/rpc.ts` and renders the table in both `desktop/View.tsx` and `mobile/View.tsx` (dual-view sync rule). `is_total=TRUE` rows render with `font-weight: bold` and a thin top border to delimit category groups visually.

#### Round 9 (2026-05-28) — Migration `20260528600000_well_by_well_brazil_rpcs.sql`

Adds the data backend for the new "Visão Brasil" pill on `/well-by-well`. When the user toggles from an empresa to Brasil, the dashboard shows **raw 100% working-interest** numbers (no JOIN with `field_stakes` — country-level aggregates, like the PDF reports).

**Two new materialized views** (private, no anon/authenticated GRANT — same Round 5 pattern as `mv_production_monthly`):

| MV | Grain | Source | Rows | Size |
|---|---|---|---|---|
| `mv_brazil_canonical_monthly` | (canonical, ano, mes, ambiente) | `anp_cdp_producao` GROUP BY `canonical_field_name(campo)`, ano, mes, local | 76,933 | 6.5 MB |
| `mv_brazil_installation_monthly` | (instalacao, ano, mes) | `anp_cdp_producao` GROUP BY COALESCE(`instalacao_destino`, em-dash), ano, mes | 64,929 | 6.5 MB |

Both with `UNIQUE INDEX (...pk)` + secondary `(ano, mes)` index. `WHERE campo IS NOT NULL` on the canonical MV to keep the index clean.

**`refresh_mv_production()` updated** to refresh all 5 MVs in this order:

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_production_monthly;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_production_installation_monthly;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_brazil_monthly;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_brazil_canonical_monthly;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_brazil_installation_monthly;
```

`REVOKE ALL FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE TO service_role` re-applied defensively (DoS guard on REFRESH CONCURRENTLY EXCLUSIVE locks). ETL `scripts/pipelines/anp/cdp/02_upload.py` already calls `refresh_mv_production()` at end of run — no pipeline changes needed.

**Four new RPCs** (all `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp`, all granted to `anon, authenticated`):

| RPC | Signature | Reads from |
|---|---|---|
| `get_production_brazil_top_fields(p_date date, p_top_n int DEFAULT 10)` | `(campo, oil_bbl_dia, water_bbl_dia, hours_rate)` | `mv_brazil_canonical_monthly` |
| `get_production_brazil_installation(p_date date)` | `(instalacao, oil_bbl_dia, gas_mm3_dia, hours_rate)` | `mv_brazil_installation_monthly` |
| `get_production_brazil_field_timeseries(p_campo text, p_date_start date, p_date_end date)` | `(ano, mes, oil_bbl_dia, gas_mm3_dia, water_bbl_dia, hours_rate)` | `mv_brazil_canonical_monthly` |
| `get_production_brazil_installation_timeseries(p_instalacao text, p_date_start date, p_date_end date)` | `(ano, mes, oil_bbl_dia, gas_mm3_dia, water_bbl_dia, hours_rate)` | `mv_brazil_installation_monthly` |

Top-fields RPC groups by canonical across all ambientes before ordering by oil DESC.

**Sanity-check vs PDF page 3 (Apr-26 Brazil top fields):**

| Field | PDF | Got | Match |
|---|---|---|---|
| BÚZIOS | 910 | 910.1 | ✓ |
| TUPI | 917 | 857.3 | ~ (-60 — see note) |
| MERO | 721 | 720.9 | ✓ |
| JUBARTE | 207 | 206.5 | ✓ |
| ITAPU | 155 | 155.2 | ✓ |

TUPI gap of ~60 kbpd is consistent across the 13-month timeseries (Apr-25 787 vs PDF 833; Apr-26 857 vs PDF 917). Other top fields match exactly, so the MV/RPC math is sound. Most likely cause: `canonical_field_name()` does not yet map every PDF-side TUPI variant to canonical TUPI (e.g. peripheral well clusters the report rolls in). Tracked separately; not a Round 9 regression — same canonicalization was present in Round 5 MVs.

**Top installations Apr-26 vs PDF**: FPSO Almirante Tamandaré 248.6 (PDF ~249), Marechal Duque de Caxias 196.1 (PDF ~196), SEPETIBA 181.9 (PDF ~182) — exact match.

**Performance:** `EXPLAIN ANALYZE get_production_brazil_top_fields('2026-04-01', 10)` returns in **3.7 ms** end-to-end (target was <50 ms). MV index lookup + small GROUP BY.

**Security pattern (preserved from Round 5, Pegadinha #18):** MVs themselves are NOT granted to anon/authenticated. The 4 RPCs are the sole public surface; the MVs stay private to the function definer's privileges. The advisor's `materialized_view_in_api` warning is avoided this way (PostgREST does not expose them as `/rest/v1/<mv_name>`).

**Consumer:** `worker_dash-well-by-well` adds 4 wrappers to `src/lib/rpc.ts` (`getProductionBrazilTopFields`, `getProductionBrazilInstallation`, `getProductionBrazilFieldTimeseries`, `getProductionBrazilInstallationTimeseries`) and the dashboard switches between empresa-scoped (`mv_production_*`-backed) and Brasil-scoped (`mv_brazil_*`-backed) RPCs based on the active pill. Dual-view sync rule applies to both desktop and mobile.

#### Round 10 (2026-05-28) — Migration `20260528700000_canonical_overrides_tupi.sql`

Closes the Round 9 TUPI gap. The PDF Well-by-Well explicitly aggregates `SUL DE TUPI` into `TUPI` (pages 3–4: "Tupi data contains 'Sul de Tupi' field"), but `canonical_field_name()`'s regex did not catch the `SUL DE` prefix. Fix: insert a single override row into `field_canonical_names`.

```sql
INSERT INTO public.field_canonical_names (variant, canonical, source)
VALUES ('SUL DE TUPI', 'TUPI', 'manual')
ON CONFLICT (variant) DO UPDATE
   SET canonical = EXCLUDED.canonical,
       source = EXCLUDED.source;
```

**Post-refresh validation (Apr-26):**

| Check | Before | After | PDF |
|---|---|---|---|
| `mv_brazil_canonical_monthly` TUPI (consolidated) | ~857 kbpd | **917.5 kbpd** | 917 |
| `get_production_top_fields('Petrobras', '2026-04-01', 3)` — TUPI row | ~540 kbpd | **613.6 kbpd** | (range 590–620) |

**Why the refresh matters:** the override only affects rows joined through `canonical_field_name()` at MV build time. Existing MV rows keep the old canonical until the next refresh — so the migration ships the override **and** issues `REFRESH MATERIALIZED VIEW CONCURRENTLY` on both `mv_production_monthly` and `mv_brazil_canonical_monthly`. In production both refreshes ran in <60s; if a future override hits the MCP timeout, drop the REFRESH lines and rely on `02_upload.py` Round 5+ hook (which calls `refresh_mv_production()` at end of every ETL run).

**Maintenance pattern (going forward).** When a PDF / IR report aggregates a "X de Y" field into Y but the regex misses it:

1. Verify in source: `SELECT DISTINCT campo FROM anp_cdp_producao WHERE campo ILIKE '%<Y>%' ORDER BY 1;`
2. Confirm in PDF that the aggregation is explicit (not the analyst's guess). Conservative default: leave separate unless the PDF states it.
3. Insert override row in `field_canonical_names` (`variant=upper`, `canonical=target`, `source='manual'`).
4. Refresh the 2 MVs (`mv_production_monthly`, `mv_brazil_canonical_monthly`).
5. Cross-check the resulting kbpd against the PDF page that motivated the override.

**Conservative scope of this round.** Other "X de Y" variants exist in the data (LESTE DE POÇO XAVIER, NORTE DE FAZENDA CARUAÇU, NORTE DE PESCADA, OESTE DE ATAPU, OESTE DE UBARANA, SUL DE BERBIGÃO, SUL DE CORURIPE, SUL DE LULA) but the PDF only explicitly aggregates Sul de Tupi into Tupi. All other variants stay separate until a PDF/IR doc justifies merging.

#### Override (2026-06-08) — `PITANGOLA → PEREGRINO` — Migration `20260614000000_anp_cdp_diaria_merge_pitangola_into_peregrino.sql`

CEO rule: investors treat **Peregrino = Peregrino + Pitangola** (both PRIO 80% working interest, both in bacia `Campos`). Adds a second manual row to `field_canonical_names`:

```sql
INSERT INTO public.field_canonical_names (variant, canonical, source)
VALUES ('PITANGOLA', 'PEREGRINO', 'manual')
ON CONFLICT (variant) DO UPDATE
   SET canonical = EXCLUDED.canonical, source = EXCLUDED.source;
```

The migration's primary target is `/anp-cdp-diaria`: it recreates the 4 **field/company-scoped** daily RPCs (`get_anp_cdp_diaria_serie`, `get_anp_cdp_diaria_filtros`, `get_anp_cdp_diaria_empresa_serie`, `get_anp_cdp_diaria_empresa_campos`) to project `canonical_field_name(campo)` + `SUM(...)` + GROUP BY canonical (relabel-and-aggregate, since `anp_cdp_diaria` carries separate raw PEREGRINO/PITANGOLA rows per day). Signatures, `SECURITY DEFINER`, `search_path` and grants preserved. The installation/well daily RPCs are untouched (field-scoped merge only).

> **Cross-table caveat — `field_canonical_names` is shared.** Because `canonical_field_name()` is also baked into the `/well-by-well` MVs (`mv_production_monthly`, `mv_brazil_canonical_monthly`) at refresh time, this override **will** fold PITANGOLA into PEREGRINO there too on the **next MV refresh** (via `02_upload.py`'s `refresh_mv_production()` hook). That is consistent with the same investor convention (PRIO IR reports Peregrino combined), so it is acceptable — but note it is **not isolated to `/anp-cdp-diaria`**. This migration does **not** issue a REFRESH (the daily dashboard reads `anp_cdp_diaria` live, not the MVs); the `/well-by-well` MVs pick it up on their normal refresh cadence. If a future analyst needs Peregrino and Pitangola kept separate on `/well-by-well`, this override would have to be scoped differently (the canonical helper is global today).

#### Round 12 (2026-05-29) — Migration `20260529300000_well_by_well_header_expand.sql`

Expands `get_well_by_well_header(p_empresa, p_year, p_month)` from 16 rows to **24 rows** so the per-empresa section matches the structure of the Brazil section verbatim. Before Round 12 the empresa block carried only Oil rows (display_order 13–16). After Round 12 it carries Oil + Gas + Main fields, mirroring Brazil (1–12).

**New rows (display_order 17–24):**

| # | section | category | subcategory | is_total | source |
|---|---|---|---|---|---|
| 17 | `UPPER(p_empresa)` | Gas (kboed) | NULL | TRUE | `mv_production_monthly` sum across ambiente |
| 18 | `UPPER(p_empresa)` | Gas (kboed) | Pre-Salt | FALSE | `mv_production_monthly` per ambiente |
| 19 | `UPPER(p_empresa)` | Gas (kboed) | Post-Salt | FALSE | `mv_production_monthly` per ambiente |
| 20 | `UPPER(p_empresa)` | Gas (kboed) | Onshore | FALSE | `mv_production_monthly` per ambiente |
| 21 | `UPPER(p_empresa)` | Main fields (kbpd) | NULL | TRUE | sum of top 3 stake-weighted canonical (= `company_top3_data`) |
| 22 | `UPPER(p_empresa)` | Main fields (kbpd) | canonical name | FALSE | `mv_production_monthly` rank 1 by `oil_curr DESC` |
| 23 | `UPPER(p_empresa)` | Main fields (kbpd) | canonical name | FALSE | `mv_production_monthly` rank 2 |
| 24 | `UPPER(p_empresa)` | Main fields (kbpd) | canonical name | FALSE | `mv_production_monthly` rank 3 |

**Math notes:**

- **Gas conversion**: `gas_mm3_dia * 6.29 / 1000.0` → kboed. Identical factor to Brazil Gas (rows 5–8) — `anp_cdp_producao.gas_total_mm3_dia` is m³/d despite the name.
- **Per-ambiente gas aggregation**: extended the existing `company_per_ambiente` CTE to also `MAX(...gas_mm3_dia...)` per ambiente per period. Inner subquery groups `mv_production_monthly` by `(empresa, ano, mes, ambiente)` and `SUM`s both `oil_bbl_dia` and `gas_mm3_dia` before the outer per-ambiente roll-up. The MV is **already stake-weighted at extract time** (Round 5) — no JOIN with `field_stakes` at query time.
- **Top 3 canonical for empresa**: new CTEs `company_top3_set` → `company_top3_data` → `company_top3_ranked`. Same shape as `brazil_top3_*` but sourced from `mv_production_monthly` (stake-weighted) instead of `anp_cdp_producao` (100% WI). Tie-break by `oil_curr DESC NULLS LAST` via `ROW_NUMBER()`.
- **Main fields total (row 21)**: SUM of the 3 stake-weighted canonical rows — matches how Brazil Main fields total (row 9) is the sum of TUPI + BÚZIOS + MERO at 100% WI.
- **YTD avg**: AVG of monthly sums across months 1..p_month for the empresa. Mirrors Brazil Main YTD logic but with the empresa scope baked in.
- **Empty-ambiente NULLs**: LEFT JOIN with `ambiente_label_map` already returns NULL for empresas without production in an ambiente (e.g. PRIO has no Pre-Salt or Onshore — rows 14/16/18/20 all emit NULL, and downstream `mom_pct`/`yoy_pct` correctly become NULL because the CASE guards on `prev_month_val IS NULL`).
- **Backwards compat**: rows 1–16 preserved **verbatim** (same CTE names, math, signatures). Only NEW CTEs (`company_gas_total`, `company_gas_rows`, `company_main_total`, `company_main_rows`, `company_top3_set`, `company_top3_data`, `company_top3_ranked`) and 4 new entries in the final `UNION ALL`. Frontend filters on `display_order` / `section` / `is_total` keep working — same shape, more rows.

**Validation vs PDF page 2 (Apr-26 Petrobras report):**

| Row | Subcategory | PDF | Got | Match |
|---|---|---|---|---|
| 13 | PETROBRAS Oil total | 2,708 | 2,711 | ✓ |
| 14 | PETROBRAS Oil Pre-Salt | 2,351 | 2,339 | ~ (snapshot variance) |
| 15 | PETROBRAS Oil Post-Salt | 337 | 352 | ~ |
| 16 | PETROBRAS Oil Onshore | 20 | 20 | ✓ |
| 17 | PETROBRAS Gas total | — | 798 | (sum check 646+63+89=798 ✓) |
| 21 | PETROBRAS Main fields total | — | 1,701 | (sum check 809+614+278=1701 ✓) |
| 22 | PETROBRAS top-1 (BÚZIOS) | — | 809 | (matches Round 5 stake-weight 809.2 ✓) |
| 23 | PETROBRAS top-2 (TUPI) | — | 614 | (matches Round 10 post-canonical 613.6 ✓) |
| 24 | PETROBRAS top-3 (MERO) | — | 278 | (matches Round 5 278.2 ✓) |

**Edge-case validation (PRIO, Apr-26):**

| Row | Subcategory | Got | Notes |
|---|---|---|---|
| 13 | PRIO Oil total | 101.9 | |
| 14 | PRIO Oil Pre-Salt | NULL | PRIO has no Pre-Salt assets — LEFT JOIN emits NULL → mom/yoy NULL |
| 15 | PRIO Oil Post-Salt | 101.9 | Equals total — PRIO is all-PosSal |
| 16 | PRIO Oil Onshore | NULL | |
| 17 | PRIO Gas total | 7.0 | |
| 18 | PRIO Gas Pre-Salt | NULL | |
| 19 | PRIO Gas Post-Salt | 7.0 | |
| 20 | PRIO Gas Onshore | NULL | |
| 21 | PRIO Main fields total | 86.0 | PEREGRINO 34.5 + FRADE 28.9 + ALBACORA LESTE 22.5 |
| 22 | PEREGRINO | 34.5 | |
| 23 | FRADE | 28.9 | |
| 24 | ALBACORA LESTE | 22.5 | |

**Operator with <3 canonical fields.** If an empresa has fewer than 3 canonical fields with production in (p_year, p_month), `company_top3_set` returns fewer rows; the `JOIN ... ON canonical` in `company_top3_data` shrinks accordingly; `company_top3_ranked` ranks only what exists; the UNION emits 1 or 2 rows in slots 22/23 with no slot 24. The total row (21) still sums correctly because it aggregates `company_top3_data`. No NULL padding — frontend should not assume exactly 3 rows.

**Signature unchanged.** Same `RETURNS TABLE(...)` columns, same param signature. Frontend `getWellByWellHeader(empresa, year, month)` wrapper in `src/lib/rpc.ts` needs **no** changes; both `desktop/View.tsx` and `mobile/View.tsx` get the 8 new rows automatically (dual-view rule). `is_total=TRUE` rendering for rows 17 and 21 reuses the same bold/border treatment as rows 5/9/13.

**Security preserved.** `SECURITY DEFINER` + `SET search_path = public, pg_temp` retained from Round 8. Explicit `GRANT EXECUTE TO anon, authenticated` re-stated in the migration for defense-in-depth (Pegadinha #18 — DROP+CREATE wipes grants, CREATE OR REPLACE preserves them but we don't rely on that).

#### CDP RPCs — Canonical expansion (Phase 2 of `/well-by-well` drill-down, 2026-05-30) — Migration `20260530000000_cdp_rpcs_canonical_expansion.sql`

Adiciona parâmetro opcional `p_expand_canonical bool DEFAULT false` em 4 RPCs CDP que servem os dashboards `/anp-cdp-bsw` e `/anp-cdp-depletion`. Quando `true`, o array `p_campos` é expandido server-side via o helper `canonical_field_name()` (Round 4) — todo campo cujo canonical bata com qualquer entrada do array é incluído (ex.: `p_campos=['TUPI']` agrega `{TUPI, SUL DE TUPI, AnC_TUPI}`).

> **Slot:** o nome `20260528400000` originalmente sugerido já estava tomado no `schema_migrations` remoto pelo `well_by_well_perf_mv` (Round 5); por isso a migration usa o slot `20260530000000`, o próximo prefixo limpo após `20260529300000_well_by_well_header_expand`.

**RPCs alteradas (4):**

| RPC | Antes | Depois |
|---|---|---|
| `get_anp_cdp_bsw_scatter(text[])` | 1 param | `(text[], bool DEFAULT false)` — strict default preserva comportamento `/anp-cdp-bsw` |
| `get_anp_cdp_bsw_field_aggregate(text[])` | 1 param | `(text[], bool DEFAULT false)` |
| `get_anp_cdp_depletion_scatter(text[])` | 1 param | `(text[], bool DEFAULT false)` |
| `get_anp_cdp_depletion_field_aggregate(text[])` | 1 param | `(text[], bool DEFAULT false)` |

Todas mantêm `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp` e `GRANT EXECUTE TO anon, authenticated`.

**Compatibilidade.** Callers existentes (frontend `/anp-cdp-bsw`, `/anp-cdp-depletion`) não passam `p_expand_canonical` e recebem o default `false` — comportamento idêntico ao pré-migration. O novo popup de drill-down do `/well-by-well` chama via 4 wrappers `*Canonical` em `src/lib/rpc.ts` (`rpcGetAnpCdpBswScatterCanonical`, `rpcGetAnpCdpBswFieldAggregateCanonical`, `rpcGetAnpCdpDepletionScatterCanonical`, `rpcGetAnpCdpDepletionFieldAggregateCanonical`) que passam `true` explicitamente.

**Frontend follow-up (não está nesta migration):** chart builders `buildPerWellChart` e `buildFieldAverageChart` foram extraídos para `src/lib/charts/bsw.ts` e `src/lib/charts/depletion.ts` (commits anteriores na Fase 1 do plano), permitindo que o popup do `/well-by-well` consuma a mesma lógica visual sem duplicar código. Mudanças em qualquer dos dois builders afetam ambos os dashboards — coordenar.

**Padrão precedente.** Esta é a primeira RPC com `p_expand_canonical` — o padrão pode ser adotado por futuras RPCs que façam JOIN com `anp_cdp_producao` por `campo` e queiram coerência com a filosofia canonical do `/well-by-well` (`canonical_field_name()` helper, `field_canonical_names` table). Critério: o caller serve um sumário executivo onde "TUPI" deve significar "o campo físico TUPI" (agregando variantes); o default `false` continua adequado para callers analíticos que precisam ver as variantes separadas.

### Sessions / Auth state

| Tabela | Dept consumidor | Populada por |
|---|---|---|
| `alertas_session` | dept Alertas (read + update `last_used_at`), dept ETL (write) | `etl_anp_cdp.yml` (capture mensal via Selenium+CAPTCHA) — `alertas_monitor.yml` (read + update `last_used_at` a cada 2h) |

`alertas_session`: sem policies por design — somente service-role bypassa RLS. Migration: `20260507000001_alertas_session.sql`. `metadata` jsonb armazena flags de debounce (`last_capture_attempt`) e contexto APEX (`app_id`, `page_id`, `p_instance`, `captured_periodo`).

### Tabelas Fase 3 (adicionadas 2026-05-04)

Todas com RLS habilitada, policy `acesso autenticado` FOR SELECT TO authenticated USING (true). `anp_cdp_producao` foi corrigida via `20260504000013_anp_cdp_rls_authenticated.sql` (antes tinha `public read` sem restrição a `authenticated`).

| Tabela | PK | Colunas-chave | Migration | Pipeline |
|---|---|---|---|---|
| `mdic_comex` | (ano, mes, flow, ncm_codigo, pais) | volume_kg, valor_fob_usd. **Continua viva** após retirada de `/mdic-comex` (2026-05-25) — alimenta `/imports-exports` Panel D ("Import Price USD/m³") via `get_imports_exports_imports_unit_price`, o mirror `get_imports_exports_exports_unit_price` (Exports tab), o gráfico By Origin Country + YoY `paises` via `get_imports_exports_paises_stacked`/`yoy_table p_scope='paises'` (migrados de `anp_desembaracos` para ComexStat em `20260608400000` — ComexStat publica o mês M semanas antes da ANP), e toda a Exports tab. O gráfico By Importer (`importers_stacked` + `yoy_table p_scope='importers'`) continua em `anp_desembaracos` (única fonte com CNPJ). (Panel C "Import Price USD/bbl" e `get_imports_exports_fob_price_serie` foram removidos em 2026-05-28; ver `20260528960000_imports_exports_unit_price_with_volume.sql`.) | `20260504000012_mdic_comex.sql` | `pipelines/mdic_comex_sync.py` |
| `anp_precos_produtores` | (data_inicio, produto, regiao) | preco, unidade | `20260504000002_anp_precos.sql` | `pipelines/anp/precos/02_precos_produtores_sync.py` |
| `anp_glp` | (ano, mes, distribuidora, categoria) | vendas_kg | `20260504000002_anp_precos.sql` | `pipelines/anp/glp_sync.py` |
| `anp_daie` | (ano, mes, produto, operacao) | volume_m3, valor_usd | `20260504000003_anp_fase3.sql` | `pipelines/anp/fase3/01_daie_sync.py` |
| `anp_desembaracos` | (ano, mes, ncm_codigo, pais_origem, cnpj) | quantidade_kg, **importador**, **cnpj**, **uf_cnpj** — enriquecida em `20260525000010` (Imports & Exports reform). PK estendida com `cnpj`. Rows pré-backfill carregam sentinela `cnpj='__legacy__'` até Worktree B ETL backfill rodar. Desde `20260608400000` alimenta apenas o lado By Importer (Brazil) do `/imports-exports` (única fonte com CNPJ); o gráfico By Origin Country + YoY `paises` migraram para `mdic_comex`/ComexStat. | `20260504000003_anp_fase3.sql` + `20260525000010_imports_exports_enrichment.sql` | `pipelines/anp/fase3/02_desembaracos_sync.py` |
| ~~`anp_painel_imp_dist`~~ | — | **DROPADA** em `20260525000010_imports_exports_enrichment.sql` (CASCADE) — substituída pela `anp_desembaracos` enriquecida na reforma Imports & Exports | — | — |
| `anp_lpc` | (data_fim, produto, estado) | preco_medio_venda, preco_medio_compra, n_postos | `20260504000004_lpc_sindicom.sql` | `pipelines/anp/lpc_sync.py` |
| `anp_lpc_brasil` | (data_fim, produto) | preco_revenda, n_postos, fonte. Preço de **revenda nacional** publicado pela ANP (volume-weighted por região), aba **BRASIL** do `resumo_semanal_lpc_*.xlsx`. `produto` normalizado: `GASOLINA COMUM` / `DIESEL S10`. Consumida diretamente como **pump price** pelo `recompute_dg_margins` (D&G Margins) — substitui o cálculo station-weighted sobre `anp_lpc`, que rodava ~R$0,04 alto. **Separada de propósito** de `anp_lpc` (per-UF, consumida por `/anp-prices`) — não fundir. ~146 semanas (2023-05→presente) **com lacunas** (ANP não publica o resumo toda semana). RLS: SELECT `authenticated`; writes só service-role. | `20260617000000_anp_lpc_brasil.sql` | `pipelines/anp/lpc_sync.py` (mesmo run do `etl_anp_lpc.yml` que popula `anp_lpc`) |
| `anp_cdp_producao` | (ano, mes, poco, campo, bacia, local) | petroleo_bbl_dia, gas_total_mm3_dia, oleo_bbl_dia, agua_bbl_dia, operador, local (PosSal/PreSal/Terra), instalacao_destino, tipo_instalacao, tempo_prod_hs_mes | `20260504000005_anp_cdp.sql` (v1) → `_v7` (schema final) → `20260504000013` (RLS authenticated) | `pipelines/anp/cdp/01_extract.py` → `02_upload.py` (~1.8M rows) |
| `anp_precos_distribuicao` | (data_referencia, distribuidora, produto, uf) | preco_distribuicao, unidade | `20260507000005_anp_precos_distribuicao.sql` | `pipelines/anp/precos_distribuicao_sync.py` |
| `anp_cdp_diaria` | (data, campo, bacia) | petroleo_bbl_dia, gas_mm3_dia; histórico desde 2025-11-09 (limitação da fonte Power BI). Populada por `scripts/extractors/anp_cdp_powerbi.py` 3×/dia em modo **append-only** (`ON CONFLICT DO NOTHING`). Linhas existentes nunca são sobrescritas — snapshot histórico imutável a partir de 2025-11-09. | `20260508000001_anp_cdp_diaria.sql` | `scripts/extractors/anp_cdp_powerbi.py` (workflow `etl_anp_cdp_diaria.yml`, 3×/dia) |
| `anp_cdp_diaria_instalacao` | (data, instalacao) | campo (NOT NULL), petroleo_bbl_dia, gas_mm3_dia. Sem coluna bacia — entidade Power BI `v_instalacoes_final` não expõe bacia. ~16.3k rows (93 instalações; range 2025-11-09 → presente). Populada em modo **append-only** (`ON CONFLICT DO NOTHING`) — linhas existentes nunca sobrescritas. | `20260508120001_anp_cdp_diaria_levels.sql` | `scripts/extractors/anp_cdp_powerbi.py --level instalacao` |
| `anp_cdp_diaria_poco` | (data, poco) | campo (nullable), bacia (nullable), instalacao (nullable; adicionada em `20260508130001`), petroleo_bbl_dia, gas_mm3_dia. ~180.7k rows (1.219 poços; range 2025-11-09 → presente). Populada em modo **append-only** (`ON CONFLICT DO NOTHING`) — linhas existentes nunca sobrescritas. **Nota:** atribuição poço↔campo é 1:1 (último mapeamento contratual). Para análise N:N (poços compartilhados entre múltiplos campos), use `anp_cdp_producao` (mensal × poço × campo, PK composta suporta N:N nativamente). Ver limitação documentada em [`docs/app/anp-cdp-diaria.md`](../app/anp-cdp-diaria.md). | `20260508120001_anp_cdp_diaria_levels.sql` + `20260508130001` (add instalacao) | `scripts/extractors/anp_cdp_powerbi.py --level poco` |

### Imports & Exports reform (adicionada 2026-05-25)

Migration única: `20260525000010_imports_exports_enrichment.sql`. Consolida 3 dashboards retirados (`/anp-daie`, `/anp-desembaracos`, `/anp-painel-importacoes`) em um único `/imports-exports`.

**Mudanças de schema:**

| Objeto | Mudança |
|---|---|
| `anp_desembaracos` | Adicionadas colunas `importador text`, `cnpj text NOT NULL`, `uf_cnpj text`. PK substituída de `(ano, mes, ncm_codigo, pais_origem)` para `(ano, mes, ncm_codigo, pais_origem, cnpj)`. Índices novos: `idx_anp_desembaracos_cnpj`, `idx_anp_desembaracos_importador`. Rows pré-existentes (~6.204) carregam sentinela `cnpj='__legacy__'` até Worktree B ETL backfill substituir por CNPJs reais via `DELETE + INSERT`. |
| `anp_painel_imp_dist` | **DROPADA** com `CASCADE` (removeu também as 3 RPCs `get_anp_painel_imp_*`). |
| `imports_product_map` | Tabela nova. Mapeia identificadores de fonte (DAIE `produto` strings + Desembaraços `ncm_codigo`) → unified product (`Diesel` / `Gasoline` / `Crude Oil`). PK `(source, source_key)` com CHECK `source IN ('daie','desembaracos')`. Seed: 6 rows (3 produtos × 2 fontes). RLS habilitada, policy SELECT TO anon, authenticated USING (true). |
| `importer_group_map` | Tabela nova. Mapeia `cnpj text PRIMARY KEY` → `unified_importer text NOT NULL`, com auditing `razao_social_seed text`. **Intencionalmente vazia no seed time** — populada por DML migration follow-up depois que Worktree B backfill descobre os CNPJs reais (T11 do plano). RPCs caem em fallback de razão social limpada via regex enquanto map estiver vazio. RLS habilitada, policy SELECT TO anon, authenticated USING (true). |
| `ncm_densidade_kg_m3` | Tabela nova. Mapeia `ncm_codigo text PRIMARY KEY` → `densidade_kg_m3 numeric NOT NULL` + `produto_label text NOT NULL`. Seed: 3 rows (`27101921`→840 Diesel, `27101931`→740 Gasoline, `27090010`→850 Crude Oil). Usada server-side para conversão kg → m³. RLS habilitada, policy SELECT TO anon, authenticated USING (true). |
| `module_visibility` | DELETE dos 3 slugs retirados (`anp-daie`, `anp-desembaracos`, `anp-painel-importacoes`) + INSERT do novo `imports-exports` (default `is_visible_for_public=true`, `is_visible_for_clients=true`, `is_visible_on_home=true`). |

**RPCs novas (6):**

| RPC | Assinatura | Notas |
|---|---|---|
| `get_imports_exports_filtros()` | `() RETURNS TABLE(ano_min int, ano_max int, produtos text[])` | LANGUAGE sql STABLE SECURITY INVOKER. `produtos` é sempre `['Diesel','Gasoline','Crude Oil']`. `ano_min/max` deriva de `LEAST/GREATEST` sobre `MIN/MAX(ano)` em `anp_desembaracos` ∪ `anp_daie`. |
| `get_imports_exports_paises_stacked(p_unified_product, p_ano_inicio, p_ano_fim, p_top_n DEFAULT 10)` | `RETURNS TABLE(ano int, mes int, pais_origem text, total_kg numeric)` | **Fonte migrada de `anp_desembaracos` para `mdic_comex` (ComexStat, `flow='import'`) em `20260608400000` — ComexStat publica o mês M semanas antes da ANP.** Top-N por `total_kg` no window inteiro; resto colapsa em `pais_origem='Others'`. Frontend converte `total_kg / 1e6 = kt`. Mês sem publicação não é emitido como zero (não renderiza linha falsa). |
| `get_imports_exports_importers_stacked(p_unified_product, p_ano_inicio, p_ano_fim, p_top_n DEFAULT 10)` | `RETURNS TABLE(ano int, mes int, unified_importer text, total_mil_m3 numeric)` | JOIN com `ncm_densidade_kg_m3` (conversão kg→m³ server-side) e LEFT JOIN com `importer_group_map`. Fallback de razão social via `regexp_replace` de sufixos (LTDA, S.A., EIRELI, ME) quando não há mapping. Filtra `cnpj <> '__legacy__'`. Retorna `total_mil_m3` (já dividido por 1000). |
| `get_imports_exports_yoy_table(p_scope, p_unified_product, p_ano_fim, p_mes_fim, p_top_n DEFAULT 10)` | `RETURNS TABLE(entity text, last_12m numeric, prev_12m numeric, yoy_pct numeric)` | LANGUAGE plpgsql STABLE. `p_scope IN ('paises','importers')` (raise exception em outros valores). **Split de fontes (desde `20260608400000`): `p_scope='paises'` lê de `mdic_comex`/ComexStat (`flow='import'`); `p_scope='importers'` continua em `anp_desembaracos` (única fonte com CNPJ/importador).** Janela rolling 12m terminando em `(p_ano_fim, p_mes_fim)`. `yoy_pct = NULL` quando `prev_12m=0`. Usa `#variable_conflict use_column`. |
| `get_imports_exports_exports_paises_stacked(p_unified_product, p_ano_inicio, p_ano_fim, p_metric DEFAULT 'volume', p_top_n DEFAULT 10)` | `RETURNS TABLE(ano int, mes int, pais text, value numeric)` | LANGUAGE plpgsql STABLE SECURITY DEFINER. Stacked monthly series por país de destino (top-N + `'Others'`), de `mdic_comex` filtrando `flow='export'`. `p_metric IN ('volume','usd')` (raise exception em outros). Para `volume`, conversão kg → mil m³ server-side via JOIN com `ncm_densidade_kg_m3` (`volume_kg / densidade_kg_m3 / 1000`). JOIN com `imports_product_map source='mdic'`. |
| `get_imports_exports_exports_yoy_table(p_unified_product, p_ano_fim, p_mes_fim, p_metric DEFAULT 'volume', p_top_n DEFAULT 10)` | `RETURNS TABLE(entity text, last_12m numeric, prev_12m numeric, yoy_pct numeric)` | LANGUAGE plpgsql STABLE SECURITY DEFINER. Janela rolling 12m terminando em `(p_ano_fim, p_mes_fim)` vs 12m anteriores. Top-N + `'Others'` por país de destino. `yoy_pct = NULL` quando `prev_12m=0`. Mesma fonte de dados (`mdic_comex flow='export'` + densidade) e mesmas regras de `p_metric` que a função stacked. |

Todas as 6 RPCs: `SET search_path = public`, `GRANT EXECUTE TO anon, authenticated`. `filtros` e `importers_stacked` são `STABLE SECURITY INVOKER`; `paises_stacked` e `yoy_table` passaram a `STABLE SECURITY DEFINER` em `20260608400000` (migração da fonte país para `mdic_comex`); as 2 RPCs de Exports (`exports_paises_stacked`, `exports_yoy_table`) já eram `STABLE SECURITY DEFINER` (escopo MDIC, sem RLS user-aware necessário).

**RPCs DROPADAS (8):**

`get_anp_daie_filtros`, `get_anp_daie_serie`, `get_anp_desembaracos_filtros`, `get_anp_desembaracos_serie`, `get_anp_desembaracos_top_paises`, `get_anp_painel_imp_filtros`, `get_anp_painel_imp_serie`, `get_anp_painel_imp_top_dist` — todas via `DROP FUNCTION ... CASCADE`. As 3 `get_anp_painel_imp_*` já cairiam pelo `DROP TABLE ... CASCADE` em `anp_painel_imp_dist`; explicitadas por idempotência.

**ETL companion (Worktree B):**

`scripts/pipelines/anp/fase3/02_desembaracos_sync.py` foi refatorado para preservar `Importador` + `CNPJ` + `UF do CNPJ` do XLSX bruto da ANP (antes esses campos eram descartados na linha 171 da versão pré-reforma). `scripts/pipelines/anp/fase3/03_painel_imp_sync.py` foi **deletado**. Workflow `etl_anp_fase3.yml` agora tem 2 steps (era 3). Backfill rodado via `workflow_dispatch` após merge na main. Ver `docs/etl-pipelines/PRD.md` § "Imports & Exports reform (2026-05-25)" para detalhes.

### Pegadinhas — Imports & Exports

**Sentinela `__legacy__`:** rows em `anp_desembaracos.cnpj` carregam `'__legacy__'` enquanto Worktree B ETL backfill não roda. Todas as RPCs que dependem de CNPJ (`get_imports_exports_importers_stacked`, `get_imports_exports_yoy_table p_scope='importers'`) filtram `cnpj <> '__legacy__'` — retornam 0 rows até backfill. Frontend trata isso como informational empty state, não erro.

**`importer_group_map` vazia por design:** seed time intencionalmente sem rows. Worker `worker_supabase` populará via DML migration follow-up depois que Worktree B backfill expor CNPJs reais (T11 do plano CTO). Enquanto vazia, RPCs fazem fallback para `regexp_replace` removendo sufixos comuns de razão social.

**Exports vêm de `mdic_comex`, não de `anp_daie`:** migration `20260525000110_imports_exports_exports_by_country.sql` retirou `get_imports_exports_exports_serie` e introduziu `get_imports_exports_exports_paises_stacked` + `get_imports_exports_exports_yoy_table`, ambas lendo de `mdic_comex` com filtro `flow='export'` + JOIN em `imports_product_map source='mdic'`. A tabela `anp_daie` permanece viva (alimenta os panels de Importação via `get_imports_exports_paises_stacked`/`importers_stacked`/`yoy_table` por `imports_product_map source='daie'`), mas Exports não a consultam mais. Conversão kg→mil m³ é server-side via `ncm_densidade_kg_m3`.

### Imports & Exports unit-price expansion (2026-05-28)

Migration `20260528960000_imports_exports_unit_price_with_volume.sql`. Três mudanças coordenadas:

1. **DROP `get_imports_exports_fob_price_serie(text, int, int, int, int)`** — Panel C ("Import Price USD/bbl") foi removido do dashboard `/imports-exports`. RPC ficou órfã.
2. **DROP+CREATE `get_imports_exports_imports_unit_price(text, int, int, int, int, int)`** — return tuple expandido de `(ano, mes, pais, usd_per_m3)` para `(ano, mes, pais, usd_per_m3, vol_m3)`. `vol_m3` é o volume mensal agregado em m³ por país, usado como denominador de weighted-average no client (linha "Others" do Imports summary table). Lógica server-side inalterada (Top-N por volume + monthly aggregates).
3. **DROP+CREATE `get_imports_exports_exports_unit_price(text, int, int, int, int, int)`** — mesma expansão de tuple para o mirror de Exports.

Ambas as RPCs recriadas: `LANGUAGE plpgsql STABLE SECURITY DEFINER` + `SET search_path = public, pg_temp` + `GRANT EXECUTE TO anon, authenticated` re-aplicados explicitamente (Pegadinha #18 — DROP+CREATE apaga grants e atributos). Slot `20260528960000` escolhido após confirmar que o slot mais alto de 28-mai era `20260528950000_subsidy_synthetic_pr_march` (Pegadinha #19).

### Subsidy Reform (2026-05-27)

Migrations: `20260527200000_subsidy_reform.sql` (núcleo) + `20260527300000_data_sources_freshness_subsidy_fix.sql` (hotfix do `get_data_sources_freshness`).

A versão anterior do subsídio do diesel tratava `anp_subsidy_history.subsidio_brl_l` como a **diferença** entre preço de referência e preço de comercialização. Isso estava semanticamente errado: o valor é o **teto** (cap) do reembolso. O reembolso real, por região, é

```
reimb_região = MIN(MAX(ref_diária − comm_período, 0), cap_agente_vigente)
```

e a métrica usada nos dashboards é a média das 5 regiões. Duas trilhas de agente (`importador`, `produtor`) têm caps independentes desde 2026-04-07.

**Mudanças de schema:**

| Objeto | Mudança |
|---|---|
| `anp_subsidy_history` | **DROPADA** (`DROP TABLE ... CASCADE`). |
| `anp_subsidy_caps` | Tabela nova. PK `(vigente_desde DATE, tipo_agente TEXT CHECK IN ('importador','produtor'))`. Colunas: `cap_brl_l NUMERIC(10,4) NOT NULL CHECK >= 0`, `observacao TEXT`, `inserted_at TIMESTAMPTZ DEFAULT now()`. Seed: 4 rows (`2026-03-13 × 2 = 0.32` unificado + `2026-04-07: produtor=1.12, importador=1.52`). RLS ON, policy `caps_read` SELECT TO anon, authenticated USING (true). Mantida manualmente (cardinalidade muito baixa). |
| `anp_subsidy_commercialization` | Tabela nova. PK `(data_inicio DATE, regiao TEXT CHECK IN 5 regions, tipo_agente TEXT)`. Colunas: `data_fim DATE` (CHECK `>= data_inicio`), `preco_comercializacao NUMERIC(10,4) NOT NULL CHECK >= 0`, `ordinal INT`, `pdf_url TEXT`, `inserted_at TIMESTAMPTZ`. Índices: `idx_comm_data_fim (data_fim)`, `idx_comm_lookup (regiao, tipo_agente, data_inicio)`. RLS ON, policy `comm_read` SELECT TO anon, authenticated USING (true). Populada pelo stage HTML novo de `scripts/pipelines/anp/subsidy_diesel_sync.py`. |

**Function:**

| Function | Assinatura | Notas |
|---|---|---|
| `compute_subsidy_reimbursement` | `(p_date DATE, p_tipo_agente TEXT) RETURNS NUMERIC` | `LANGUAGE sql STABLE SECURITY DEFINER` + `SET search_path = public, pg_temp`. **Regulatory regime split (since `20260608200000`, see below): for `p_date >= 2026-06-01` returns a flat `1.12` BRL/L for both agents; for earlier dates falls back to the historical formula** — joins `anp_subsidy_diesel_reference` × `anp_subsidy_commercialization` por `(regiao, tipo_agente)` com `p_date BETWEEN c.data_inicio AND c.data_fim`, aplica `LEAST(GREATEST(ref − comm, 0), cap)` por região (cap é o vigente em `p_date` para o `tipo_agente`), e retorna `AVG(...)`. NULL se faltar dado. `GRANT EXECUTE TO anon, authenticated`. SECURITY DEFINER é obrigatório porque as tabelas têm RLS authed-only no caso da `anp_subsidy_diesel_reference` (Pegadinha #18). |

**Triggers** (todos em SECURITY DEFINER + `search_path = public, pg_temp`):

| Trigger | Tabela alvo | Evento | Função |
|---|---|---|---|
| `populate_pb_w_subsidy_on_insert` | `price_bands` | BEFORE INSERT OR UPDATE OF (`date`, `product`, `bba_import_parity`, `petrobras_price`) | `_pb_populate_w_subsidy()` — para rows com `product='Diesel'`, recalcula `bba_import_parity_w_subsidy = bba_import_parity − reimb_importador` e `petrobras_price_w_subsidy = petrobras_price + reimb_produtor`. Cada um NULL se input ou reimb for NULL. |
| `recompute_pb_on_reference_change` | `anp_subsidy_diesel_reference` | AFTER INSERT/UPDATE/DELETE | `_on_subsidy_reference_change()` — issue um self-UPDATE no `price_bands` para o `data_referencia` afetado, disparando a BEFORE trigger acima. |
| `recompute_pb_on_comm_change` | `anp_subsidy_commercialization` | AFTER INSERT/UPDATE/DELETE | `_on_subsidy_commercialization_change()` — issue self-UPDATE em `price_bands` para `date BETWEEN data_inicio AND data_fim`. |
| `recompute_pb_on_caps_change` | `anp_subsidy_caps` | AFTER INSERT/UPDATE/DELETE | `_on_subsidy_caps_change()` — issue self-UPDATE em `price_bands` para `date >= LEAST(OLD.vigente_desde, NEW.vigente_desde)`. |

Helpers internos: `_pb_refresh_w_subsidy_for_dates(DATE[])` e `_pb_refresh_w_subsidy_from_date(DATE)` — fazem `UPDATE price_bands SET date = date WHERE product='Diesel' AND ...` (no-op de coluna que re-dispara a BEFORE trigger).

**RPC rewrite — `get_subsidy_tracker_diesel()`:**

DROP + CREATE (com explicit re-grant + SECURITY DEFINER + search_path, conforme Pegadinha #18). Nova assinatura retorna 11 colunas:

| Coluna | Tipo | Significado |
|---|---|---|
| `date` | DATE | Dia |
| `ipp` | NUMERIC | `price_bands.bba_import_parity` para Diesel |
| `ipp_adjusted` | NUMERIC | `ipp − reimb_importador`; NULL se input ou reimb NULL |
| `petrobras` | NUMERIC | `price_bands.petrobras_price` para Diesel |
| `petrobras_adjusted` | NUMERIC | `petrobras + reimb_produtor`; NULL se input ou reimb NULL |
| `anp_reference_importador` | NUMERIC | AVG das 5 regiões em `anp_subsidy_diesel_reference` para `tipo_agente='importador'` |
| `anp_reference_produtor` | NUMERIC | AVG das 5 regiões para `tipo_agente='produtor'` |
| `anp_commercialization_importador` | NUMERIC | AVG das 5 regiões em `anp_subsidy_commercialization` para `tipo_agente='importador'`, joining por `date BETWEEN data_inicio AND data_fim` |
| `anp_commercialization_produtor` | NUMERIC | AVG das 5 regiões para `tipo_agente='produtor'` |
| `regions_importador` | JSONB | `{regiao: preco_referencia}` para tooltip |
| `regions_produtor` | JSONB | idem |

`LANGUAGE sql STABLE SECURITY DEFINER` + `SET search_path = public, pg_temp` + `GRANT EXECUTE TO anon, authenticated`. Consumida por `useSubsidyTrackerData.ts` (frontend `/subsidy-tracker`).

**Hotfix `20260527300000_data_sources_freshness_subsidy_fix.sql`:**

`get_data_sources_freshness()` foi DROP+CREATE (não dava CREATE OR REPLACE com o body referenciando `anp_subsidy_history` DROPADA). Removida a branch de `anp_subsidy_history`; adicionadas duas branches novas:

```sql
SELECT 'anp_subsidy_caps'::text, MAX(inserted_at), count(*)::bigint FROM public.anp_subsidy_caps
UNION ALL
SELECT 'anp_subsidy_commercialization'::text, MAX(inserted_at), count(*)::bigint FROM public.anp_subsidy_commercialization
```

Total: 23 sources (era 22). Atributos preservados na recriação: `LANGUAGE sql STABLE SECURITY DEFINER` + `search_path = public, pg_temp` + `GRANT EXECUTE TO anon, authenticated`.

**Pegadinhas — Subsidy Reform:**

- **Não use `CREATE OR REPLACE`** numa migration que altera a estrutura interna de tabelas referenciadas pela função se uma das tabelas referenciadas foi DROPADA — o body sempre é re-parseado. Use `DROP FUNCTION IF EXISTS ... ; CREATE FUNCTION ...`. Foi exatamente o bug que motivou o hotfix do `get_data_sources_freshness` (a reforma DROPOU `anp_subsidy_history` mas a função ainda tinha branch lendo ela).
- **Triggers AFTER em 3 tabelas distintas (`reference`, `commercialization`, `caps`) fazem self-UPDATE no `price_bands`**, que re-dispara a BEFORE trigger. Esse padrão funciona porque a BEFORE trigger é idempotente (recalcula a partir de inputs vivos), mas significa que um INSERT pesado em `anp_subsidy_diesel_reference` pode tocar muitos rows em `price_bands` em cascata. Acompanhar perf via `pg_stat_user_tables` se a ingestão crescer (atualmente ~1 row/dia × 5 regiões × 2 agentes ≈ 10 rows/dia em `reference`, trivial).
- **`anp_subsidy_history` está realmente DROPADA.** Qualquer migration nova que referencie esse nome quebra silenciosamente (table not found) — checar com `\dt anp_subsidy_*` antes de qualquer SQL.

### Fixed subsidy regime since 2026-06-01

Migration: `supabase/migrations/20260613000000_subsidy_fixed_diesel_1_47.sql` (applied in production) — supersedes the earlier `20260608200000_subsidy_fixed_diesel_1_12.sql` (which set the flat value to 1.12).

A regulatory change effective **2026-06-01** turned the fuel subsidy into a **flat value** for both agents:

| Product | Fixed value (≥ 2026-06-01) | Where it lives |
|---|---|---|
| Diesel | **1.47 BRL/L** effective (`importador` and `produtor`) | DB — `compute_subsidy_reimbursement` |
| Gasoline | **0.44 BRL/L** delta (Petrobras +0.44, import parity −0.44) | client-side in `/price-bands` (`use<PriceBands>Data` hook) — see `docs/app/price-bands.md` |

**Why 1.47, not the 1.12 headline:** MP nº 1.363 (30/05/2026) carries a **headline** subvention of BRL 1.12. The **effective** subsidy that keeps Petrobras / importers whole is **1.47 = 1.12 (subvention) + 0.35 (compensation)**: on 2026-06-01 Petrobras cut its refinery price by BRL 0.35 (3.65 → 3.30, already reflected in `price_bands.petrobras_price`) and PIS/COFINS of an equivalent amount was reactivated. Economic identity: 3.30 (price) + 1.47 (subsidy) = 4.77 = the pre-reform realization (3.65 + 1.12). The dashboards reflect the **effective** economics (1.47), not the MP headline (1.12). Validated with the CEO on 2026-06-08. **Do not revert to 1.12.**

**Diesel mechanics:** `compute_subsidy_reimbursement(p_date, p_tipo_agente)` was `CREATE OR REPLACE`d with a leading `CASE WHEN p_date >= DATE '2026-06-01' THEN 1.47 ELSE (<historical AVG-over-5-regions-of-MIN(MAX(ref−comm,0),cap) formula>) END`. The historical branch is byte-for-byte the prior formula wrapped as a scalar subquery, so dates before 2026-06-01 are **untouched** and still depend on `anp_subsidy_caps` + `anp_subsidy_commercialization` + `anp_subsidy_diesel_reference`. SECURITY DEFINER + `search_path` + `GRANT EXECUTE TO anon, authenticated` re-applied (Pegadinha #18). The migration finishes by calling `_pb_refresh_w_subsidy_from_date(DATE '2026-06-01')` so the `price_bands._w_subsidy` columns (and therefore `/price-bands` Petrobras-w/subsidy and `/subsidy-tracker` `petrobras_adjusted` / `ipp_adjusted`) pick up the flat value automatically.

**Implication:** `anp_subsidy_caps` and `anp_subsidy_commercialization` no longer affect any date on/after 2026-06-01 — they only drive the historical (< 2026-06-01) leg. Their ETL (`etl_anp_subsidy_diesel.yml`) keeps running and remains the freshness signal for those sources, but new caps/commercialization rows have no effect on current-regime reimbursement.

**Gasoline mechanics:** entirely client-side in `/price-bands`; the DB has no gasoline subsidy column. From 2026-06-01 a fixed 0.44 delta is applied to a new import-parity series. The pre-existing flat **3.05 BRL/L** line is preserved for the 2026-05-29 → 2026-05-31 window only. Owned by `docs/app/price-bands.md`.

### Trigger: cross-local guard em `anp_cdp_producao`

**Causa**: incidente Apr/2026 — mesmo poço republicado pela ANP com `local` diferente (PosSal + PreSal + Terra) produziu 3× linhas. PK natural inclui `local`, então `ON CONFLICT` não disparou e o dashboard somou as 3 cópias (12.853 → 4.337 kbpd após cleanup; 2.076 linhas movidas para `_quarantine_anp_cdp_apr2026`).

**Defesa de banco**: `trg_anp_cdp_guard_cross_local` (BEFORE INSERT) chama `fn_anp_cdp_guard_cross_local()`. Se já existe row com mesma `(ano, mes, poco, campo, bacia)` mas `local` diferente, levanta `unique_violation` (ERRCODE 23505) com mensagem instrutiva. UPDATE não é guardado — `ON CONFLICT DO UPDATE` na PK completa continua funcionando normalmente.

**Reclassificação legítima** (raro — ANP move poço PosSal → PreSal): exige `DELETE WHERE (ano, mes, poco, campo, bacia)` ANTES do `INSERT`, ou `--purge` no modo manual. Trigger falha alto se o caller esquecer.

**Migration**: `20260521130000_anp_cdp_cross_local_guard.sql`. Lookup é O(log n) via prefix do PK `(ano, mes, poco, campo, bacia, local)` — sem índice novo. Defesas Fase A (`20260521120000_fix_anp_cdp_apr2026_triplication.sql`, quarentena) e Fase B1 (pipeline Python, ver `docs/etl-pipelines/PRD.md`).

### Alerts v2 (rebuild 2026-06-02)

> **Supersedes the old cloud alerts product.** The first product (anon double-opt-in, confirmation tokens, per-IP rate limiting, 2h polling detectors) was dropped in `20260608000000_alerts_rebuild_drop_old_product.sql` (6 old `alert_*` tables + ~16 RPCs + the confirmation trigger). The new product is **logged-in only**, event-driven by end-of-ETL hooks. The legacy LOCAL-ONLY `alertas_*` tables (`alertas_session` etc.) are a different subsystem and were **not** touched. Schema created in `20260608100000_alerts_rebuild_new_schema.sql`. Frontend sub-PRD: [`docs/app/alerts.md`](../app/alerts.md); engine: [`docs/etl-pipelines/PRD.md`](../etl-pipelines/PRD.md) § "Client Alerts".

**6 tables** (all RLS-enabled; `(select auth.uid())` wrapped per Hardening A):

| Tabela | PK / UNIQUE | Papel | RLS |
|---|---|---|---|
| `alert_sources` | `source_slug` | Catálogo de bases inscritíveis. Cols: `category`, `display_name`, `description`, `cadence` (`immediate`/`digest`), `period_kind` (`month`/`date`/`iso_week`/`window_end`/`year`/`timestamp`), `period_table`, `metadata` (`frontend_route`), `is_active`. **Sem `detection_module`** (não há detectores). | SELECT `authenticated`; ALL `is_admin()` |
| `alert_subscriptions` | `id`; UNIQUE `(user_id, source_slug)` | 1 linha por (cliente, base). `user_id → auth.users` (CASCADE), `is_active`, `cadence_override` (NULL = herda), `unsubscribe_token`. **Sem email** (resolvido de `auth.users` no envio), sem confirmation/IP. | self (`user_id = auth.uid()`) SELECT/INSERT/UPDATE/DELETE + admin ALL |
| `alert_events` | `id`; UNIQUE `(source_slug, event_key)` | Log imutável "1 evento por fato". Âncora de idempotência. INSERT via service-role (bypassa RLS). | SELECT `is_admin()` only |
| `alert_outbox` | `id`; UNIQUE `(subscription_id, event_id)` | Fila de fanout. `status` (`queued`/`sending`/`sent`/`failed`/`skipped`), `send_attempts`, `provider_message_id`. | SELECT admin + self (via join na subscription) |
| `alert_email_log` | `id` | Auditoria append-only do envio. `outbox_id`, `email`, `subject`, `status`, `provider_message_id`, `provider_response`. | SELECT `is_admin()` only |
| `alert_source_state` | `source_slug` | **Watermark** "último período alertado": `last_period_key`, `last_event_id`, `last_alerted_at`. Torna o check "período avançou?" O(1) e race-safe. | SELECT `is_admin()` only |

**14 RPCs** (todas SECURITY DEFINER + `SET search_path = public, pg_temp`):

| RPC | Grant | Papel |
|---|---|---|
| `alerts_current_period(p_source_slug)` → text | **service_role only** | Deriva o período corrente por `period_kind`/`period_table`, portando as expressões exatas de `get_data_sources_freshness` (`20260527300000`). Anon/authenticated explicitamente revogados (IDOR/least-privilege). |
| `alerts_active_recipients(p_source_slug)` → (subscription_id, email, unsubscribe_token) | **service_role only** | Join `alert_subscriptions → auth.users` (definer lê `auth.users.email`). Revoke explícito de anon/authenticated (senão qualquer caller faria harvest de emails/tokens). |
| `list_subscribable_bases()` | authenticated | Catálogo ativo + flags do usuário (`is_subscribed`, `sub_is_active`, `cadence`, `cadence_override`). |
| `set_my_subscription(p_source_slug, p_active)` | authenticated | Liga/desliga 1 base (upsert `ON CONFLICT (user_id, source_slug)`). |
| `set_my_subscriptions(p_source_slugs[], p_active)` | authenticated | Bulk (Select all / Clear por categoria). Retorna count. |
| `set_my_subscription_cadence(p_source_slug, p_cadence)` | authenticated | Override por inscrição (NULL = herda). **Dormante na v1** — não exposto na UI. |
| `list_my_subscriptions()` | authenticated | Inscrições do usuário + `effective_cadence` (`COALESCE(cadence_override, src.cadence)`). |
| `list_my_recent_alerts(p_limit=20)` | authenticated | Feed recente; injeta `frontend_route` no payload (fallback do `metadata` da source). |
| `unsubscribe_by_token(p_token)` | **anon** + authenticated | A ÚNICA escrita anon-callable (link do email). Idempotente. |
| `admin_alerts_list_subscribers(p_source_slug?, p_limit)` | authenticated (gated `is_admin()`) | Lista subscribers + email resolvido. |
| `admin_alerts_email_log_recent(p_limit)` | authenticated (gated) | Auditoria de envio. |
| `admin_alerts_stats()` | authenticated (gated) | Totais, por-source, 7d sent/bounced. |
| `admin_alerts_toggle_source(p_source_slug, p_is_active)` | authenticated (gated) | Liga/desliga base no catálogo. |
| `admin_alerts_send_test(p_source_slug, p_email?)` | authenticated (gated) | Injeta evento sintético de teste para validar fanout/delivery E2E. |

**Seed:** 22 rows em `alert_sources` (todas as tabelas de ingestão exceto `news_articles`) — 21 ativas + `anp_subsidy_caps` inativa (admin-edit, sem trigger limpo). Daily/AIS/timestamp = `digest`; o resto = `immediate`.

**`module_visibility('alerts')`** setado para `public=false, clients=true` (preserva o invariante `public ⇒ clients`).

### Materialized views

| MV | Função de refresh | Índices |
|---|---|---|
| `mv_ms_serie` | `classificar_agentes()` | — |
| `mv_ms_serie_fast` | `classificar_agentes()` | versão otimizada de `mv_ms_serie` |
| `mv_anp_cdp_pocos` | `refresh_anp_cdp_pocos()` | UNIQUE (poco, campo, bacia, local); campo, bacia, estado |

`mv_ms_serie` / `mv_ms_serie_fast`: refresh após upload em `vendas`.
`mv_anp_cdp_pocos`: pré-agrega metadados de poços (~24K rows) para o filter UI do dash anp-cdp. Refresh chamado pelo script de upload após cada upsert. Suporta `REFRESH CONCURRENTLY` (índice único presente). Definida em `20260504000011_anp_cdp_v7.sql`.

### RPCs (ver detalhe nos sub-PRDs)

| Domínio | Prefixo / Funções | Dono lógico |
|---|---|---|
| Market Share (absorveu Sales Volumes em 2026-05-26) | `get_ms_*` (sole family in use). `get_sv_*` legacy RPCs dropped in migration `20260526400000_drop_sv_rpcs.sql`. | dash-market-share |
| Navios | `get_nd_*` | dash-navios-diesel |
| D&G Margins | `get_dg_*` (read, anon/authenticated) + `recompute_dg_margins(p_week_start text, p_week_end text)` — **SECURITY DEFINER, `SET search_path = public, pg_temp`, `SET statement_timeout = '300s'`, `EXECUTE` only `service_role`** (recompute job chamado pelo `etl_dg_margins.yml`; recalcula `d_g_margins` a partir das tabelas-fonte de preço/produção/etanol/imposto/blend). Bounded args são ISO `"W/YYYY"` unpadded (ex. `12/2026`), parseados via `to_date('IYYY-IW')`; ambos NULL = timeline completa. Ver § "`recompute_dg_margins` — timeout guard & optimization (incident 2026-06-09)". | dash-margins |
| Price Bands | `get_price_bands_*` | dash-price-bands |
| Profile / Admin | `get_my_*`, `set_*`, `upsert_my_*`, `set_module_public_visibility`, `admin_list_default_news_keywords`, `admin_add_default_news_keyword`, `admin_set_default_news_keyword_match_type`, `admin_remove_default_news_keyword` | dash-admin |
| News Hunter | `seed_my_news_hunter_keywords`, `get_default_news_keywords` (retrocompat — retorna `text[]`), `get_default_news_keywords_with_flags` (retorna `keyword, match_type` — consumido pelo scanner repo). Writes admin via `admin_*_default_news_keyword*` listados em Profile/Admin | dash-news-hunter |
| Generic / metrics | `get_metricas`, `classificar_agentes` | base |
| MDIC Comex | ~~`get_mdic_comex_filtros`, `get_mdic_comex_serie`, `get_mdic_comex_top_paises`, `get_mdic_comex_aggregated`, `get_mdic_comex_export_count`~~ — **DROPPED 2026-05-25** com a retirada de `/mdic-comex`. A tabela `mdic_comex` continua viva, alimentada pelo `etl_mdic_comex.yml`, e é consumida pelo `/imports-exports` via `get_imports_exports_imports_unit_price` (Panel D) e `get_imports_exports_exports_unit_price` (Exports tab) — ambas retornam `vol_m3` no tuple desde `20260528960000` para suportar weighted-average client-side. ~~`get_imports_exports_fob_price_serie`~~ (Panel C "Import Price USD/bbl") também foi DROPADA em 2026-05-28 pela mesma migration. | ~~dash-mdic-comex~~ (sub-PRD arquivado em `docs/app/_deprecated/mdic-comex.md`) |
| ANP Preços Produtores | `get_anp_precos_produtores_filtros`, `get_anp_precos_produtores_serie` | dash-anp-precos-produtores |
| ANP GLP | `get_anp_glp_filtros`, `get_anp_glp_serie` | dash-anp-glp |
| Imports & Exports | `get_imports_exports_filtros`, `get_imports_exports_paises_stacked`, `get_imports_exports_importers_stacked`, `get_imports_exports_yoy_table`, `get_imports_exports_exports_paises_stacked`, `get_imports_exports_exports_yoy_table`, `get_imports_exports_imports_unit_price` (Panel D — `vol_m3` no tuple desde `20260528960000`), `get_imports_exports_exports_unit_price` (Exports tab mirror — `vol_m3` idem) — consolidam DAIE + Desembaraços + MDIC Comex (sem `anp_painel_imp_dist`, que foi dropada). Migrations: `20260525000010_imports_exports_enrichment.sql` (panels A/B) + `20260525000110_imports_exports_exports_by_country.sql` (Exports tab por país de destino) + `20260528960000_imports_exports_unit_price_with_volume.sql` (DROP `get_imports_exports_fob_price_serie` — Panel C "Import Price USD/bbl" removido; reCREATE das duas `_unit_price` RPCs com `vol_m3 numeric` no tuple para weighted-avg client-side da linha "Others" do summary table). RPCs antigas `get_anp_daie_*`, `get_anp_desembaracos_*`, `get_anp_painel_imp_*` (8 funções) foram DROPPED em `20260525000010`. | dash-imports-exports |
| ANP LPC | `get_anp_lpc_filtros`, `get_anp_lpc_serie`, `get_anp_lpc_nacional` | dash-anp-lpc |
| ANP CDP | `get_anp_cdp_filtros`, `get_anp_cdp_serie`, `get_anp_cdp_pocos_json` | dash-anp-cdp |
| ANP Preços Distribuição | `get_anp_precos_distribuicao_filtros`, `get_anp_precos_distribuicao_serie`, `get_anp_precos_distribuicao_top_distribuidoras` | dash-anp-precos-distribuicao |
| ANP CDP Diária — Field | `get_anp_cdp_diaria_filtros`, `get_anp_cdp_diaria_serie` | dash-anp-cdp-diaria |
| ANP CDP Diária — Installation | `get_anp_cdp_diaria_instalacao_filtros`, `get_anp_cdp_diaria_instalacao_serie` | dash-anp-cdp-diaria |
| ANP CDP Diária — Well | `get_anp_cdp_diaria_poco_filtros`, `get_anp_cdp_diaria_poco_serie` | dash-anp-cdp-diaria |
| Export count (Tier 2) | `get_ms_export_count(p_data_inicio, p_data_fim, p_regioes, p_ufs, p_mercados) → bigint`, `get_anp_cdp_export_count(p_pocos, p_campos, p_bacoes, p_locais, p_estados, p_operadores, p_instalacoes, p_tipos_instalacao, p_ano_inicio, p_ano_fim) → bigint`, `get_anp_lpc_export_count(p_produtos, p_estados, p_data_inicio, p_data_fim) → bigint` | APP (useExportSize) — retornam count filtrado para estimar tamanho do export antes do download. Migration: `20260507000003_export_count_rpcs.sql`. (Nota: `get_mdic_comex_export_count` foi DROPPED em 2026-05-25 com a retirada de `/mdic-comex`.) |
| Data Sources freshness | `get_data_sources_freshness() → TABLE(source_key text, last_update timestamptz, row_count bigint)` | Consumida pela tabela live "Data Sources" da `/home` (desktop only). UNION ALL sobre 23 tabelas ETL-fed (era 22 — Subsidy Reform `20260527300000` trocou `anp_subsidy_history` por `anp_subsidy_caps` + `anp_subsidy_commercialization`). SECURITY DEFINER + `search_path = public, pg_temp`; `GRANT EXECUTE TO anon, authenticated`. Migrations: `20260526200000_data_sources_freshness.sql` + hotfix `20260527300000_data_sources_freshness_subsidy_fix.sql`. Detalhes em § "Data Sources Freshness". Owner: dash-admin (UI) + worker_supabase (RPC). |
| Subsidy Tracker | `get_subsidy_tracker_diesel() → TABLE(date, ipp, ipp_adjusted, petrobras, petrobras_adjusted, anp_reference_importador, anp_reference_produtor, anp_commercialization_importador, anp_commercialization_produtor, regions_importador jsonb, regions_produtor jsonb)` + interna `compute_subsidy_reimbursement(date, tipo_agente) → numeric`. RPC rewrite em `20260527200000_subsidy_reform.sql` (era 1 col simples antes; nova signature dual-agent com sufixos PT). SECURITY DEFINER + `search_path = public, pg_temp` + `GRANT EXECUTE TO anon, authenticated`. Detalhes em § "Subsidy Reform". | dash-subsidy-tracker + dash-price-bands (trigger-side: `_pb_populate_w_subsidy` lê via `compute_subsidy_reimbursement` para preencher `price_bands._w_subsidy`) |
| Alerts v2 (rebuild 2026-06-02) | Client: `list_subscribable_bases`, `set_my_subscription[s]`, `set_my_subscription_cadence` (dormant), `list_my_subscriptions`, `list_my_recent_alerts`. Anon: `unsubscribe_by_token`. Service-role only: `alerts_current_period`, `alerts_active_recipients`. Admin: `admin_alerts_list_subscribers`/`_email_log_recent`/`_stats`/`_toggle_source`/`_send_test`. 14 total — ver § "Alerts v2". Migration `20260608100000` (DROP do produto antigo em `20260608000000`). | dash-alerts (client) + alerts-product/etl-pipelines (backend: `scripts/client_alerts/`) |

## Usuário compartilhado IBBA

Login coletivo do time IBBA. Provisionado em 2026-05-27 via `execute_sql` one-time seed (**não versionado em migration** — senha em texto plano não vai para o git).

| Campo | Valor |
|---|---|
| Email interno (alias para Supabase Auth) | `ibba@sectordata.internal` |
| Username de exibição no login | `IBBA` (sem `@` — frontend traduz para o email interno antes do signIn) |
| `auth.users.id` | `e3ebd6a1-2bc4-4aba-988b-bc439e643b99` |
| `profiles.role` | `Client` |
| `profiles.full_name` | `IBBA Team` |
| MFA | **Não enrolado** (e nunca deve ser — é credencial compartilhada) |
| `email_confirmed_at` | preenchido no insert (skip confirmation flow) |

### Por que existe

Time IBBA precisa de acesso ao SectorData sem o overhead de provisionar conta individual por pessoa. Tradeoff aceito: senha compartilhada + visibilidade restrita ao tier Client.

### Como rotacionar a senha

Supabase Dashboard → Authentication → Users → `ibba@sectordata.internal` → "Reset password" (ou via SQL: `UPDATE auth.users SET encrypted_password = extensions.crypt('<nova>', extensions.gen_salt('bf')) WHERE email = 'ibba@sectordata.internal';`).

Comunicar a nova senha pelos canais usuais com o time IBBA.

### Restrições e invariantes

- **NÃO promover este usuário a Admin.** Admin exige MFA AAL2 (vide `useRoleGuard("Admin")` e `(dashboard)/layout.tsx`); credencial compartilhada não pode satisfazer MFA por design (várias pessoas atrás do mesmo secret). Promover quebra o invariante implícito "todo Admin tem MFA enrolado".
- **NÃO recriar via migration versionada.** Migration vai para o histórico do git e expõe a senha permanentemente. Provisionamento foi feito uma única vez via `execute_sql` MCP; este doc é o registro do que foi feito.
- **Profile inserido manualmente.** Não há trigger `handle_new_user` em `auth.users` neste projeto — o seed faz INSERT explícito em `public.profiles`.

### Acoplamento frontend

`src/app/login/page.tsx` aceita o username `IBBA` (sem `@`) e o traduz para `ibba@sectordata.internal` antes de chamar `supabase.auth.signInWithPassword`. Isso é UX-only — o backend só conhece o email interno. Worker `worker_subgerente-app` (ou `worker_dash-admin`) é dono dessa lógica de tradução.

### Auditoria

- Recriar o seed em ambiente novo: requer privilégio service-role + acesso ao `auth.users`. Documentar o SQL (sem a senha real) em runbook interno; nunca versionar.
- Detecção: `SELECT * FROM auth.users WHERE email = 'ibba@sectordata.internal'` deve retornar exatamente 1 row com `email_confirmed_at IS NOT NULL`.
- Cruzamento: `SELECT p.role FROM public.profiles p JOIN auth.users u ON u.id = p.id WHERE u.email = 'ibba@sectordata.internal'` deve retornar `Client`. Se virar `Admin` em algum momento, é regressão crítica.

## Migration smoke test

`supabase/tests/migration_smoke.sql` — criado em 2026-05-07 após o bug do `/sales-volumes`.

### Contexto do bug

Migration `20260402000000_sales_volumes` foi registrada em `schema_migrations` mas as 4 funções `get_sv_*` nunca foram criadas: `mv_ms_serie` não existia na hora da execução, causando falha silenciosa. O frontend usava `try/catch` retornando `[]`, então o módulo ficou vazio sem alertar ninguém por meses.

### O que o teste verifica

O script roda dentro de `DO $smoke$ ... END $smoke$;` e falha com `RAISE EXCEPTION` no primeiro item ausente:

| Categoria | O que verifica |
|---|---|
| Tabelas (24) | Existência em `information_schema.tables` (schema `public`) |
| RLS (17 tabelas) | `rowsecurity = TRUE` em `pg_tables` para tabelas com dados de usuário |
| Materialized views (3) | Existência em `pg_matviews` |
| Funções (58) | Existência em `pg_proc` + `pg_namespace` (schema `public`) |

Total: **102 assertions**.

### Integração CI

Step `Post-migration smoke test` em `.github/workflows/supabase_deploy.yml`, executado **após** `supabase db push`. Se o script levantar exceção, o job falha e o push fica vermelho.

```yaml
- name: Post-migration smoke test
  run: supabase db query --linked --file supabase/tests/migration_smoke.sql
  env:
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

### Como adicionar novos checks

Após criar uma migration com tabela nova ou RPC nova, adicione ao final do bloco `DO $smoke$` antes do `RAISE NOTICE` final:

**Tabela nova:**
```sql
-- Tabela
PERFORM 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = '<nome_tabela>';
IF NOT FOUND THEN RAISE EXCEPTION 'Missing table: <nome_tabela>'; END IF;

-- RLS (obrigatório para qualquer tabela com dados de usuário)
PERFORM 1 FROM pg_tables
  WHERE schemaname = 'public' AND tablename = '<nome_tabela>' AND rowsecurity = TRUE;
IF NOT FOUND THEN RAISE EXCEPTION 'RLS not enabled on: <nome_tabela>'; END IF;
```

**Função nova:**
```sql
PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '<nome_funcao>';
IF NOT FOUND THEN RAISE EXCEPTION 'Missing function: <nome_funcao>'; END IF;
```

Atualize também o `RAISE NOTICE` no final do script com os novos totais.

## Pre-deploy anon grants audit

Gate complementar ao smoke test, focado em **Pegadinha #18** (RPC `public.get_*` sem `SECURITY DEFINER` OU sem GRANT EXECUTE para `anon`, em dashboards com `is_visible_for_public=true`). Já ocorreu 4 vezes em 6 semanas — o mais recente foi `20260530000000_cdp_rpcs_canonical_expansion.sql` (fix em `20260601400000_restore_anon_grants_cdp_canonical_rpcs.sql`). Esse gate roda DEPOIS do `supabase db push` no `supabase_deploy.yml` e DEVE falhar o workflow se encontrar violação.

### Modelo de detecção

Auditoria genérica (Opção A — sem dependência de mapping "dashboard → RPCs"): toda função `public.get_*` deve ter `prosecdef=true` E `has_function_privilege('anon', oid, 'EXECUTE')=true`. Funções fora desse contrato têm que estar em uma das listas abaixo:

- **Exclusões por prefixo:** `admin_*` (mutations administrativas — escopo `is_admin()` guarded). Note que **apenas funções `get_*` são auditadas**; `set_*`, `upsert_*`, `delete_*` ficam de fora do filtro de cara.
- **Whitelist explícita** (admin-only / internal RPCs `get_*` que legítimamente não precisam de anon):
  - `get_analytics_anon_summary`, `get_analytics_by_dashboard`, `get_analytics_by_user`, `get_analytics_heatmap`, `get_analytics_kpis`, `get_analytics_user_timeline` — todos backam `/admin-analytics` (Admin tier only).
  - `get_candidate_trail` — debug interno AIS, sem surface público.
  - `get_nd_unresolved` — debug interno AIS, sem surface público.

Para adicionar item à whitelist: **só** adicione se a função NÃO backa nenhum dashboard `is_visible_for_public=true`. Anote a justificativa inline (comentário no `VALUES`).

### Query SQL canônica

```sql
-- ============================================================================
-- PRE-DEPLOY ANON GRANTS AUDIT
-- 0 rows  → pass (deploy continues)
-- ≥1 row  → fail (workflow aborts; investigate violation_type)
-- ============================================================================
WITH whitelist(proname) AS (
  -- Admin-only / internal RPCs that legitimately do NOT need anon EXECUTE.
  -- Each entry must have a comment justifying inclusion.
  VALUES
    ('get_analytics_anon_summary'),   -- /admin-analytics only
    ('get_analytics_by_dashboard'),   -- /admin-analytics only
    ('get_analytics_by_user'),        -- /admin-analytics only
    ('get_analytics_heatmap'),        -- /admin-analytics only
    ('get_analytics_kpis'),           -- /admin-analytics only
    ('get_analytics_user_timeline'),  -- /admin-analytics only
    ('get_candidate_trail'),          -- internal AIS debug, no public surface
    ('get_nd_unresolved')             -- internal AIS debug, no public surface
)
SELECT
  p.oid::regprocedure::text AS function_signature,
  p.prosecdef AS is_security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS has_anon_grant,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS has_authenticated_grant,
  CASE
    WHEN NOT p.prosecdef AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      THEN 'missing_security_definer_and_anon_grant'
    WHEN NOT p.prosecdef
      THEN 'missing_security_definer'
    WHEN NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      THEN 'missing_anon_grant'
  END AS violation_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname LIKE 'get\_%' ESCAPE '\'
  AND p.proname NOT LIKE 'admin\_%' ESCAPE '\'
  AND p.proname NOT IN (SELECT proname FROM whitelist)
  AND (
    p.prosecdef = false
    OR NOT has_function_privilege('anon', p.oid, 'EXECUTE')
  )
ORDER BY p.proname;
```

Notas técnicas:

- `has_function_privilege(role, oid, 'EXECUTE')` resolve overloads corretamente (chave é `oid`, não `proname`), então cobre todas as assinaturas (ex: `get_anp_cdp_bsw_scatter(text[])` vs `get_anp_cdp_bsw_scatter(text[], boolean)`).
- `oid::regprocedure::text` rende a assinatura completa (`get_anp_cdp_bsw_scatter(text[],boolean)`) — útil para o GRANT corretivo.
- `LIKE 'get\_%' ESCAPE '\'` evita falso-match (`_` é wildcard em LIKE).

### Procedimento de fix quando o gate falhar

1. **Identifique a assinatura exata** das funções listadas (coluna `function_signature`).
2. **Decida se é violação real ou false-positive**:
   - Se a função backa dashboard com `is_visible_for_public=true` (a maioria dos casos) → violação real, fix.
   - Se a função é admin-only / interna → adicionar à whitelist neste documento E na query do `supabase_deploy.yml`, com justificativa inline.
3. **Para violação real**, criar migration nova `supabase/migrations/<timestamp>_restore_anon_grants_<scope>.sql`:
   ```sql
   BEGIN;
   -- Para cada violação, com a assinatura exata da coluna function_signature:
   GRANT EXECUTE ON FUNCTION public.<func>(<arg_types>) TO anon, authenticated;
   -- Se for missing_security_definer, também: ALTER FUNCTION ... SECURITY DEFINER;
   COMMIT;
   ```
4. **Investigue a migration que causou drift** — quase sempre é `DROP FUNCTION` + `CREATE FUNCTION` sem re-aplicar GRANT/SECURITY DEFINER (vide § "d) DROP FUNCTION + CREATE FUNCTION apaga grants E atributos"). Adicione `GRANT EXECUTE ... TO anon, authenticated;` E `SECURITY DEFINER` ao final da migration original num próximo refactor pra prevenir regressão.

### Integração CI

Próxima etapa (owner: `worker_etl-pipelines`): adicionar step ao `.github/workflows/supabase_deploy.yml` após o `supabase db push`, rodando esta query via `supabase db query` (ou MCP via service token) e abortando o workflow se houver linhas no resultado. Não-blocking até a 1ª execução verde; depois flip para hard fail.

### Última auditoria local (2026-05-28)

- Total de funções `get_*` no schema `public`: ~100
- Whitelisted: 8
- Violations atuais: 4 (todas em `_field_aggregate` / `_scatter` das famílias `bsw` e `depletion`) — cobertas pelo `20260601400000_restore_anon_grants_cdp_canonical_rpcs.sql`, pendente de aplicar no remote. Pós-deploy: esperado 0 violations.

## Pegadinhas do `supabase_deploy.yml` e CLI

### a) `supabase db execute` removido; `db query` sem `--linked` falha no CI

O comando `supabase db execute --file <arquivo.sql>` não existe mais na CLI atual.

O substituto `supabase db query --file <arquivo.sql>` **sem flags** tenta conectar ao Postgres local (`127.0.0.1:54322`). No runner do GitHub Actions não há instância local, então o step falha com `connection refused` mesmo após `supabase db push` ter sido bem-sucedido.

Solução: sempre usar `--linked` quando o projeto já foi linkado no step anterior:

```bash
supabase db query --linked --file <arquivo.sql>
```

O step `Post-migration smoke test` em `supabase_deploy.yml` usa `--linked` desde o fix em `ce367a12` (bug inicial) e foi atualizado novamente para garantir a flag.

### b) Repair de versões remotas fantasma

Quando `supabase_migrations.schema_migrations` contém versões sem arquivo `.sql` local correspondente (situação normal após aplicação manual via Dashboard), `supabase db push` recusa-se a rodar. O workflow `supabase_deploy.yml` deve ter step explícito de repair ANTES do push para cada versão fantasma conhecida:

```bash
supabase migration repair --status reverted <version>
```

Não tente loop dinâmico parsando output de `supabase migration list` — o formato não é estável. Use lista explícita hardcoded. Versões fantasmas conhecidas (atualizar quando novas forem identificadas):

| Versão | Origem |
|---|---|
| `20260504000001` | Slot reutilizado (add_brasil_energia_keyword revertido, reutilizado para mdic_comex) |

O incidente de produção do rollout Export (2026-05-07) foi causado pela ausência de repair explícito de `20260504000001` na lista do workflow, fazendo `supabase db push` falhar silenciosamente por dias.

### c) Monitorar runs do `supabase_deploy.yml`

Auto-aplicação de migrations só funciona se o workflow passa. Checar periodicamente:

```bash
gh run list --workflow=supabase_deploy.yml --limit 5
```

Se houver fail recente sem fix, escalar para `worker_supabase`. Falhas silenciosas já causaram migration não-aplicada por dias em prod (incidente Export 2026-05-07).

### d) `DROP FUNCTION` + `CREATE FUNCTION` apaga grants **E** atributos (SECURITY DEFINER, etc.)

`CREATE OR REPLACE FUNCTION` **preserva** grants existentes e atributos (SECURITY DEFINER, search_path, volatility) da função anterior — não precisa reaplicar.

`DROP FUNCTION ... [CASCADE]` seguido de `CREATE FUNCTION` **NÃO** preserva nada. A função renasce do zero com:
- **Grants vazios** (apenas o owner consegue executar). Frontend usa role `anon` (e/ou `authenticated`); chamadas via PostgREST passam a falhar com PostgreSQL erro **42501 `permission denied for function ...`**.
- **SECURITY INVOKER por default** (não SECURITY DEFINER). Funções que liam tabelas com RLS authenticated-only passam a retornar `[]` silenciosamente para anon (RLS bloqueia mas não há erro — só zero rows).
- **`search_path` desset** (vulnerável a search-path hijack quando combinado com SECURITY DEFINER).

Sintoma típico (grants):
- Função existe (`\df` mostra ela, `service_role` consegue chamar).
- Frontend retorna 42501 para anon/authenticated.
- Migration recente tem `DROP FUNCTION` no log.

Sintoma típico (SECURITY DEFINER perdido):
- Função existe e tem grant EXECUTE para anon.
- Frontend não dá erro, retorna `[]` ou zero count.
- Dashboard fica em loading state forever / charts vazios / dropdowns de filtro funcionam mas data charts não.
- Validação via `SET LOCAL ROLE anon` + chamar a função reproduz o `[]`.

Regra: **sempre que a migration drop-and-recreate uma RPC pública**, anexe AO FINAL:
1. `GRANT EXECUTE ON FUNCTION ... TO anon, authenticated;`
2. `ALTER FUNCTION ... SECURITY DEFINER;` (se a RPC lê de tabela com RLS authed-only)
3. `ALTER FUNCTION ... SET search_path = public, pg_temp;`

Audit periódico (manual ou em CI):

```sql
-- Grants ausentes para anon
SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS func
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
  AND p.proname LIKE 'get\_%'
  AND NOT has_function_privilege('anon', p.oid, 'EXECUTE');

-- SECURITY DEFINER ausente em RPCs públicas (que tipicamente leem RLS-protected tables)
SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS func,
       p.prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
  AND p.proname LIKE 'get\_%'
  AND p.prosecdef = false;
```

Empty set é o resultado desejado em ambos. Qualquer linha = atributo faltando.

**Incidente 1 registrado**: 2026-05-25 — 6 RPCs `get_anp_cdp_bsw_*` (3) + `get_anp_cdp_depletion_*` (3) ficaram sem grant `anon` após DROP/CREATE em onda anterior. Smoke test do `/anp-cdp-bsw` retornou 42501 para todas. Fixed por `20260525210050_grant_execute_anon_rpcs.sql` (grant-only).

**Incidente 2 registrado**: 2026-05-25 (mesmo dia) — após corrigir os grants, smoke test ainda reportou `/anp-cdp-bsw` e `/anp-cdp-depletion` vazios para anon. Audit via `pg_proc.prosecdef` revelou que os MESMOS 4 RPCs de data (BSW `field_aggregate` + `scatter`, Depletion `field_aggregate` + `scatter`) perderam SECURITY DEFINER no DROP+CREATE — não tinha erro porque o grant foi restaurado, mas o caller anon batia em RLS de `anp_cdp_producao` e `anp_voip` (ambas authed-only) e retornava `[]` silenciosamente. Fixed por `20260526100000_restore_security_definer_cdp_rpcs.sql` (ALTER FUNCTION ... SECURITY DEFINER + SET search_path em 13 RPCs: 7 quebradas + 6 funcionando-por-sorte convertidas defensivamente). Validação anon: `bsw_field_aggregate(MARLIM)` 0 → 256 rows; `bsw_scatter(MARLIM,RONCADOR)` 0 → 21.583; `depletion_field_aggregate(MARLIM)` 0 → 135; `depletion_scatter(MARLIM)` 0 → 4.821; `ms_export_count(...)` 0 → 93.514. Pegadinha #18 (CLAUDE.md) documenta o sintoma.

## Workflow `supabase_deploy.yml`

Deploya migrations em push pra `main`. Use `SUPABASE_PROJECT_REF` e `SUPABASE_ACCESS_TOKEN`.

## Cliente Supabase MCP

Quando MCP tools `mcp__*__apply_migration`, `mcp__*__execute_sql`, `mcp__*__list_tables`, `mcp__*__list_migrations`, `mcp__*__get_advisors`, `mcp__*__list_extensions`, `mcp__*__deploy_edge_function` estão disponíveis, **prefira eles** ao CLI. Operam direto no project remoto.

## Tech Debt

### Migration slot collision — `20260504000001` (resolvido)

A migration `20260504000001` foi originalmente `add_brasil_energia_keyword` (commit 8307a66d), revertida via git revert (commit 98531667), e o slot foi reutilizado para `mdic_comex`. Isso causou collision: `schema_migrations` tinha `name=add_brasil_energia_keyword` enquanto o disco tinha `mdic_comex.sql`. Resolvido em commit 880782e9: arquivo `mdic_comex` renomeado para `_000012_mdic_comex.sql` + repair step adicionado ao workflow `supabase_deploy.yml` para atualizar o registro em `schema_migrations` antes do push.

### `sql/` fora das migrations versionadas — RESOLVIDO (2026-05-06)

3 arquivos legados em `sql/` foram convertidos em migrations versionadas e `sql/` foi deletado via `git rm`.

| Migration criada | Schema coberto |
|---|---|
| `20260505000007_legacy_price_bands.sql` | `price_bands`, `get_price_bands_data` |
| `20260505000008_legacy_profiles_and_visibility.sql` | `profiles`, `module_visibility` (`module_slug`, `is_visible_for_clients`), policies, `get_my_profile`, `upsert_my_profile`, `get_module_visibility` (returns `module_slug, is_visible_for_clients`), `set_module_visibility` |
| `20260513120000_add_home_visibility.sql` | `module_visibility`: adds `is_visible_on_home BOOLEAN NOT NULL DEFAULT true`; updates `get_module_visibility()` to also return `is_visible_on_home`; adds `set_module_home_visibility(p_slug, p_is_visible)` Admin-only RPC |
| `20260505000009_legacy_user_management.sql` | `get_all_users_with_roles`, `set_user_role`, `ensure_user_profile` |

Drift documentado nas migrations:
- `get_price_bands_data`: hardening_b (`20260505000002`) já havia aplicado `SET search_path = public, pg_temp` via ALTER FUNCTION; as migrations legacy incluem esse search_path inline (equivalente).
- Policies de `profiles` e `module_visibility`: hardening_a (`20260505000001`) recriou policies com `(select auth.uid())` wrapping. As migrations legacy usam guards `DO $$ BEGIN IF NOT EXISTS ... END $$` para não duplicar caso o nome da policy já exista.
- `get_all_users_with_roles`, `set_user_role`, `ensure_user_profile`: sem drift — adicionado `pg_temp` ao search_path (melhoria de segurança).

As 3 migrations são 100% idempotentes (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, INSERT ON CONFLICT DO NOTHING, policy guards). Aplicáveis sem efeito colateral mesmo com objetos já existentes em prod.

### Outras observações

- Algumas RPCs em `remote_schema.sql` têm múltiplas assinaturas (overload) — é histórico e funciona, mas convém consolidar.
- Auditoria periódica via `get_advisors`: rodada em 2026-05-06 — ver Hardening 2026-05-06 abaixo.

### Hardening 2026-05-06 (migrations 20260505000001 a 20260505000005)

Cinco migrations de hardening aplicadas após auditoria `get_advisors` (53 perf + 264 security issues):

**A — Quick wins** (`20260505000001_hardening_a_rls_indexes.sql`):
- 9 policies que usavam `auth.uid()` diretamente agora usam `(select auth.uid())` (wrapping elimina re-avaliação por row).
- `profiles`: duas policies SELECT (own + admin) consolidadas em `"profiles read"` com OR.
- `card_previews`: policy `FOR ALL` separada em INSERT/UPDATE/DELETE para eliminar overlap com SELECT.
- 3 duplicate indexes em `vendas` dropados: `idx_vendas_agente`, `idx_vendas_regiao`, `idx_vendas_uf`.
- FK index adicionado: `idx_stock_portfolios_user_id`.

**B — Search path** (`20260505000002_hardening_b_search_path.sql`):
- `ALTER FUNCTION ... SET search_path = public, pg_temp` aplicado a ~75 funções sem search_path fixo.
- Resolve `function_search_path_mutable` para todas as RPCs de dashboard e pipeline.

**C — MV exposure** (`20260505000003_hardening_c_mv_revoke.sql`):
- `REVOKE SELECT ON mv_ms_serie, mv_ms_serie_fast, mv_anp_cdp_pocos FROM anon, authenticated`.
- Confirmado via grep em `src/`: nenhum acesso direto — apenas via RPCs SECURITY DEFINER.

**D — SECURITY DEFINER audit** (`20260505000004_hardening_d_revoke_internal_rpcs.sql`):
- Revogado EXECUTE para anon/authenticated em funções internas: `classificar_agentes`, `fn_classificar_agente`, `_match_candidate_on_navio_insert`, `get_nd_unresolved`, `get_candidate_trail`.
- Revogado também para 7 overloads legados (8-param com `regiao_origem`/`uf_origem`) que não são chamados pelo frontend.
- Mantidas: todas as funções em `src/lib/rpc.ts`.

**E — Unused indexes** (`20260505000005_hardening_e_unused_indexes.sql`):
- Dropado apenas `anp_cdp_v3_poco_idx` (redundante com `anp_cdp_v6_poco_grupo_idx`).
- 20 outros índices suspeitos retidos pendentes de verificação de stats de produção.

### Clipping Cookies (adicionada 2026-05-13)

Migration: `20260513130000_clipping_cookies.sql`.

Tabela `clipping_cookies` — armazena strings de cookies no formato Netscape por domínio de notícia, usadas pela rota `/api/clipping/scrape` para acessar sites com paywall (ex: Valor Econômico, Brasil Energia).

RLS: Admin-only para SELECT / INSERT / UPDATE / DELETE (`profiles.role = 'Admin'`). Service role bypassa RLS (usado pela API route). Usa `(select auth.uid())` em todas as policies (Hardening A).

Convenções:
- `domain` é canonical sem prefixo `www.` (PK). A aplicação faz strip de `www.` antes de consultar.
- `cookies_netscape` armazena o arquivo Netscape HTTP Cookie completo (tabs literais preservados).
- Seed de cookies (dados sensíveis) aplicado via `execute_sql` — **nunca commitado em arquivo**.

### Admin RPCs — Default News Keywords (adicionada 2026-05-25, expandida 2026-05-25 com `match_type`)

Migrations: `20260525230000_admin_default_news_keywords_rpcs.sql` (CRUD inicial) + `20260525250000_default_news_keywords_match_type.sql` (coluna `match_type` + 2 RPCs novas + 2 RPCs alteradas).

Cria RPCs `SECURITY DEFINER` para CRUD admin sobre `public.news_hunter_default_keywords`. A tabela permanece com RLS read-only (`SELECT` aberto para `anon` + `authenticated` via policy `20260522000001`); writes ocorrem **exclusivamente** via estas RPCs — não há policies INSERT/DELETE em `news_hunter_default_keywords`. Padrão segue o usado em `set_module_visibility` / `set_module_public_visibility`.

**Schema da tabela** (após `20260525250000`): `(keyword text PK, match_type text NOT NULL DEFAULT 'substring' CHECK IN ('substring','exact'), created_at timestamptz)`. Schema simétrico com `news_hunter_keywords` (per-user, que tem `match_type` desde `20260520000001`).

| RPC | Assinatura | Notas |
|---|---|---|
| `admin_list_default_news_keywords` | `() RETURNS TABLE(keyword text, match_type text, created_at timestamptz)` | LANGUAGE plpgsql STABLE. Ordenado por `keyword ASC`. **3 colunas** desde `20260525250000` (era 2). |
| `admin_add_default_news_keyword` | `(p_keyword text, p_match_type text DEFAULT 'substring') RETURNS void` | `trim()` + reject empty (`ERRCODE 22023`). Valida `match_type IN ('substring','exact')` (`ERRCODE 22023` se inválido). Idempotente (`INSERT ... ON CONFLICT (keyword) DO NOTHING`). Audit em `app_events` com `event_type='admin.add_default_news_keyword'`, `route='/admin-panel'`, `payload={keyword, match_type}`. **2 params** desde `20260525250000` (era 1, default 'substring' preserva chamadas antigas). |
| `admin_set_default_news_keyword_match_type` | `(p_keyword text, p_match_type text) RETURNS void` | **Nova em `20260525250000`**. UPDATE idempotente — no-op se `keyword` não existe (DELETE sem RAISE). Valida `match_type` contra CHECK. Audit em `app_events` com `event_type='admin.set_default_news_keyword_match_type'`, `route='/admin-panel'`, `payload={keyword, match_type}`. |
| `admin_remove_default_news_keyword` | `(p_keyword text) RETURNS void` | `trim()` + reject empty (`ERRCODE 22023`). Idempotente (`DELETE WHERE keyword = ...` — no-op se ausente). Audit em `app_events` com `event_type='admin.remove_default_news_keyword'`, `route='/admin-panel'`, `payload={keyword}`. Recriada em `20260525250000` (DROP+CREATE) para idempotência/ownership; signature inalterada. |

Todas as admin RPCs: inline admin gate via `public.is_admin()` (RAISE EXCEPTION 'admin only') + `public.require_admin_mfa()`. `SET search_path = public`. `REVOKE ALL FROM PUBLIC` + `REVOKE EXECUTE FROM anon` + `GRANT EXECUTE TO authenticated` (ver "Pegadinha: REVOKE FROM PUBLIC não exclui anon" abaixo). Audit é INSERT direto em `app_events` (não via `track_event()`, que valida `event_type` contra `{login,page_view,export}` apenas — o CHECK constraint da tabela permite `admin.%` adicionalmente).

**RPC anon-accessible companion** (mesma migration `20260525250000`):

| RPC | Assinatura | Notas |
|---|---|---|
| `get_default_news_keywords` | `() RETURNS TEXT[]` | **Inalterada** — retrocompat preservada. Consumida por `NewsHunterContext.tsx`. `GRANT EXECUTE TO anon, authenticated`. |
| `get_default_news_keywords_with_flags` | `() RETURNS TABLE(keyword text, match_type text)` | **Nova em `20260525250000`**. Para uso do scanner repo (`IBBAOG/news-hunter-scanner`) e qualquer consumidor futuro que precise de matching per-keyword. LANGUAGE sql STABLE SECURITY DEFINER. `GRANT EXECUTE TO anon, authenticated`. |

Consumido pelo `/admin-panel` → seção "Default News Keywords" (sidebar `default-news`). Wrappers JS: `rpcAdminListDefaultNewsKeywords`, `rpcAdminAddDefaultNewsKeyword(supabase, keyword, matchType='substring')`, `rpcAdminSetDefaultNewsKeywordMatchType(supabase, keyword, matchType)`, `rpcAdminRemoveDefaultNewsKeyword` em `src/lib/rpc.ts`. Type: `DefaultNewsKeyword = { keyword: string; match_type: 'substring' | 'exact'; created_at: string }`.

#### Pegadinha: `REVOKE FROM PUBLIC` não exclui `anon` neste projeto Supabase

Descoberta em 2026-05-25 ao auditar as 4 admin RPCs criadas em `20260525230000`: o ACL default do Supabase (`pg_default_acl` sobre o role do owner) injeta `EXECUTE` para `anon` automaticamente quando uma função nova é criada. `REVOKE ALL ... FROM PUBLIC` revoga o privilégio default sobre `PUBLIC` (pseudo-role), mas **não** revoga o grant default específico para `anon`. Resultado: as 4 admin RPCs ficaram com `anon` podendo chamar (e quebrando no `is_admin()` check internamente — defesa em profundidade funcionou, mas a superfície de ataque ficou maior que o necessário por 1 dia).

**Best practice obrigatória** para qualquer função admin daqui em diante:

```sql
REVOKE ALL ON FUNCTION public.<func>(<args>) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.<func>(<args>) FROM anon;   -- ← explícito, OBRIGATÓRIO
GRANT EXECUTE ON FUNCTION public.<func>(<args>) TO authenticated;
```

A migration `20260525250000_default_news_keywords_match_type.sql` aplica esse padrão nas 4 RPCs admin (`admin_list_*`, `admin_add_*`, `admin_set_*_match_type`, `admin_remove_*`). Auditoria periódica via `has_function_privilege('anon', p.oid, 'EXECUTE')` em RPCs admin é desejável — qualquer linha onde a função `admin_*` retorna `true` é gap.

### `recompute_dg_margins` — timeout guard & optimization (incident 2026-06-09)

Migration `20260616100000_recompute_dg_margins_timeout_guard.sql` (live in prod). Signature is **unchanged** — `recompute_dg_margins(p_week_start text, p_week_end text)`, `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `EXECUTE` only `service_role`. Args are unpadded ISO `"W/YYYY"` (e.g. `12/2026`), parsed to that ISO week's Monday via `to_date(split_part(...,'/',2) || '-' || split_part(...,'/',1), 'IYYY-IW')`; both NULL = full timeline.

**What the migration added:**

1. **Function-level `SET statement_timeout = '300s'`** (plus a `SET LOCAL statement_timeout = '300s'` at the top of the body).
2. **Set-based `imp_pct` precompute.** The import%/production% split is a pure function of `(fuel_type, target month)`. The old body evaluated that correlated `INTERSECT`/`MAX`/`SUM` block once **per `(week, fuel)` grid row** (~2254 rows). It is now computed **once per distinct `(fuel_type, m_year, m_month)`** (~526 combinations, ~4.3× fewer evaluations of the heaviest subquery) in an `imp_pct_by_month` CTE, then `LEFT JOIN`ed back to the grid. **Results are identical** (verified by QA): `imp_pct` depends only on `(fuel_type, m_year, m_month)`, so deduplicating its evaluation cannot change any value; every other column and the final arithmetic are byte-for-byte the prior body (`20260613300000`).

**Critical nuance — the function-level `SET statement_timeout` does NOT rescue the PostgREST call path.** PostgREST connects as the `authenticator` login role, whose role config carries `statement_timeout=30s`; `SET ROLE service_role` does **not** pick up `service_role`'s config (its `rolconfig` is NULL), so the request runs under the 30s `authenticator` cap. The `SELECT recompute_dg_margins(...)` statement's timer is armed at 30s **before** the function body executes, and a `SET` inside an already-running statement does **not** re-arm that timer. So:

- The **function-level `SET statement_timeout`** only protects **direct in-database callers** whose enclosing statement *is* the function call — psql / pg_cron / a SECURITY DEFINER caller / a future internal call (their timer is armed after the GUC is in effect).
- The things that actually fix the **prod (ETL → PostgREST) path** are (a) the **set-based optimization** (full recompute now runs well under 30s) and (b) the **ETL's bounded-window call** (`etl_dg_margins.yml` recomputes only the last ~12 ISO weeks, ~2s). See `docs/etl-pipelines/PRD.md` § "D&G Margins — ordering & bounded recompute (incident 2026-06-09)".

> Incident origin: GitHub run 27223589112 (2026-06-09 17:22 UTC) died at the recompute step with PostgREST `57014` (`canceling statement due to statement timeout`) ~31s in; the failed step skipped the gated Client Alerts hook, so subscribers got no alert and `/diesel-gasoline-margins` went stale.

### `recompute_dg_margins` — pump = ANP national (Brasil) resale price (2026-06-08)

Migrations `20260617000000_anp_lpc_brasil.sql` (new table) + `20260617100000_recompute_dg_margins_brasil_pump.sql` (recompute body; commit `1f83077f`). Signature, `SECURITY DEFINER`, `SET search_path`, `SET statement_timeout = '300s'`, and service-role-only grants are **unchanged**; `CREATE OR REPLACE` + explicit REVOKE/GRANT re-application (Pegadinha #18 defence).

**Only behavioural change vs `20260616100000`** — the `pump` value:

```
pump(fuel, week) = COALESCE(
  -- (1) ANP-published Brasil value for the same ISO (week, isoyear) of the grid's
  --     monday, matched to the fuel's anp_lpc_brasil produto
  --     ('GASOLINA COMUM' for Gasoline C, 'DIESEL S10' for Diesel B):
  anp_lpc_brasil.preco_revenda,   -- ORDER BY data_fim DESC LIMIT 1 (defensive)
  -- (2) fallback ONLY on gap weeks with no Brasil row — byte-for-byte the old
  --     station-weighted anp_lpc aggregation:
  SUM(preco_medio_venda * n_postos) / NULLIF(SUM(n_postos), 0)
)
```

- New table `anp_lpc_brasil(data_fim, produto, preco_revenda, n_postos, fonte)` (PK `(data_fim, produto)`) holds ANP's official **volume-weighted national** resale price (`GASOLINA COMUM` / `DIESEL S10`), ~146 weeks 2023-05→present **with gaps**. `pump` now matches the ANP national figure exactly on covered weeks (e.g. wk23/2026 Gasolina 6.61 / Diesel 7.12); the prior always-station-weighted pump ran ~R$0.04 high.
- `total = pump` (unchanged definition). `distribution_and_resale_margin` is the residual off `pump`, so **only `total` and `dist_margin` shift** on covered weeks (~ −R$0.04); `base_fuel`, `biofuel_component`, `federal_tax`, `state_tax` are identical. The skip-if-NULL guard still fires only when **both** the Brasil row and the `anp_lpc` rows are absent for a week.

## Contratos com outros departamentos

### Recebo solicitações de:

| Dept | Pede o quê |
|---|---|
| ETL | Tabelas pra dados scrape, colunas novas em `vendas`, `navios_diesel`, etc. Mudanças de schema típicas: nova coluna no parquet → solicita coluna correspondente |
| Dados Locais | Tabelas pra Excel manual. Hoje: `price_bands` apenas (`d_g_margins` migrou pra ETL computado em 2026-06-05). Mudanças quando CEO adiciona coluna no Excel |
| APP / Subgerente | RPCs novas, ajustes, RLS pra módulos novos. Geralmente disparado ao criar dashboard novo |
| Alertas | Quase nada — Alertas só lê do schema existente |

### Mudo schema → quem precisa saber:

- **Dept consumidor** (deve atualizar wrapper / componente)
- **Documentador** (atualiza contratos em `master.md`)
- **dash-*** específico (se afeta um dashboard)

## Backups & PITR

### Status (2026-05-14)

PITR must be manually confirmed in the Supabase dashboard:
**Project Settings → Database → Point in Time Recovery**.

PITR requires a Pro (or higher) plan. On Free plan there is no PITR — only daily snapshots retained for 7 days.

### Recovery targets

| Metric | Expected value | Notes |
|--------|----------------|-------|
| RTO (Recovery Time Objective) | ~24 h | Supabase restore spins a new project from backup; DNS/env update takes additional time |
| RPO (Recovery Point Objective) | ~5 min | PITR granularity on Pro plan |

### Backup test cadence

Quarterly: create a Supabase branch from a past PITR snapshot and run `supabase/tests/migration_smoke.sql` against it. Validate that key RPCs and tables exist and return data. Document result as a comment in this file.

### pg_cron for retention jobs

`pg_cron` extension is required by migration `20260514110001_app_events_retention.sql`.
On Supabase hosted (Pro plan) `pg_cron` is available in the `extensions` schema. To confirm:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_cron';
```

If not installed, enable it via **Project Settings → Database → Extensions → pg_cron** in the Supabase dashboard, then re-run the migration.

## Audit trail (added 2026-05-14)

Migration `20260514110000_audit_admin_actions.sql` instruments three admin RPCs with INSERT into `app_events`:

| RPC | event_type logged |
|-----|-------------------|
| `set_user_role` | `admin.set_user_role` |
| `set_module_visibility` | `admin.set_module_visibility` |
| `set_module_home_visibility` | `admin.set_module_home_visibility` |

Audit rows use `payload` (jsonb) to store before/after values; `route` is NULL.

The `app_events.event_type` CHECK constraint was relaxed to also allow `event_type LIKE 'admin.%'` (previously only `IN ('login', 'page_view', 'export')`).

View `admin_audit_log` filters `event_type LIKE 'admin.%'` from `app_events`. Uses `security_invoker = true` so the existing Admin-only RLS policy on `app_events` applies to the caller automatically.

## Retention policy (added 2026-05-14)

Migration `20260514110001_app_events_retention.sql`:

| Event category | Retention |
|----------------|-----------|
| `login`, `page_view`, `export` | 12 months |
| `admin.*` | 5 years |

Implemented as a `pg_cron` weekly job (`app_events_cleanup`, Sunday 03:00 UTC).

## Tarefas comuns

Ver `.claude/agents/worker_supabase.md` (mesma seção). Resumo:

- Criar tabela nova
- Adicionar/modificar RPC
- Mudar política RLS
- Criar/refresh materialized view
- Converter `sql/` legado em migration
- Auditoria periódica (`get_advisors`)
