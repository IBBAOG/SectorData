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
| `d_g_margins` | dash-margins | Dados Locais (manual via `scripts/manual/dg_margins_upload.py`) |
| `field_stakes` | future `/production` dashboard (read) + dash-admin "Field Stakes" editor (write via SECURITY DEFINER + `is_admin()`) | Admin via `admin_upsert_field_stakes(p_campo, p_stakes jsonb)` — replace-all-in-1-tx with `SUM(stake_pct)=100` validation. Migration `20260527600000_field_stakes.sql`. |
| `price_bands` | dash-price-bands | Dados Locais (manual via `upload_price_bands.py`) |
| `stock_portfolios` | dash-stocks | App (CRUD direto via PostgREST). Desde `20260522000001`: coluna `is_public` + nullable `user_id` + seed do portfolio público `00000000-...-001` "Brazilian Oil & Gas (default)" |
| `news_articles`, `news_hunter_keywords` | dash-news-hunter | scanner externo + user via UI. Desde `20260522000001`: `news_articles` ganhou policy SELECT TO anon |
| `news_hunter_default_keywords` | dash-news-hunter (read) + dash-admin (write via SECURITY DEFINER RPCs) | Tabela nova `20260522000001` — 27 keywords default lidas por `get_default_news_keywords()` (anon-safe). Single source of truth (substitui lista hardcoded em `seed_my_news_hunter_keywords()`). RLS é read-only para anon/authed; writes exclusivamente via `admin_add_default_news_keyword` / `admin_remove_default_news_keyword` (`20260525230000`) — sem policies INSERT/DELETE. |
| `profiles`, `module_visibility` | dash-admin | App (RPC). Desde `20260522000001`: `module_visibility.is_visible_for_public` + trigger self-healing |
| `app_events` | dash-admin (`/admin-analytics`) | RPC `track_event()` (SECURITY DEFINER). Desde `20260522000001`: dual-actor (`user_id` OR `visitor_id`) |
| `imports_product_map`, `importer_group_map`, `ncm_densidade_kg_m3` | dash-imports-exports | Service role (DML em migration). Aux tables criadas em `20260525000010_imports_exports_enrichment.sql`. `importer_group_map` intencionalmente vazia ao seed time — populada por DML follow-up após Worktree B ETL backfill (T11 CTO). |

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

### Sessions / Auth state

| Tabela | Dept consumidor | Populada por |
|---|---|---|
| `alertas_session` | dept Alertas (read + update `last_used_at`), dept ETL (write) | `etl_anp_cdp.yml` (capture mensal via Selenium+CAPTCHA) — `alertas_monitor.yml` (read + update `last_used_at` a cada 2h) |

`alertas_session`: sem policies por design — somente service-role bypassa RLS. Migration: `20260507000001_alertas_session.sql`. `metadata` jsonb armazena flags de debounce (`last_capture_attempt`) e contexto APEX (`app_id`, `page_id`, `p_instance`, `captured_periodo`).

### Tabelas Fase 3 (adicionadas 2026-05-04)

Todas com RLS habilitada, policy `acesso autenticado` FOR SELECT TO authenticated USING (true). `anp_cdp_producao` foi corrigida via `20260504000013_anp_cdp_rls_authenticated.sql` (antes tinha `public read` sem restrição a `authenticated`).

| Tabela | PK | Colunas-chave | Migration | Pipeline |
|---|---|---|---|---|
| `mdic_comex` | (ano, mes, flow, ncm_codigo, pais) | volume_kg, valor_fob_usd. **Continua viva** após retirada de `/mdic-comex` (2026-05-25) — agora alimenta `/imports-exports` Panel C ("Import Price") via `get_imports_exports_fob_price_serie`. | `20260504000012_mdic_comex.sql` | `pipelines/mdic_comex_sync.py` |
| `anp_precos_produtores` | (data_inicio, produto, regiao) | preco, unidade | `20260504000002_anp_precos.sql` | `pipelines/anp/precos/02_precos_produtores_sync.py` |
| `anp_glp` | (ano, mes, distribuidora, categoria) | vendas_kg | `20260504000002_anp_precos.sql` | `pipelines/anp/glp_sync.py` |
| `anp_daie` | (ano, mes, produto, operacao) | volume_m3, valor_usd | `20260504000003_anp_fase3.sql` | `pipelines/anp/fase3/01_daie_sync.py` |
| `anp_desembaracos` | (ano, mes, ncm_codigo, pais_origem, cnpj) | quantidade_kg, **importador**, **cnpj**, **uf_cnpj** — enriquecida em `20260525000010` (Imports & Exports reform). PK estendida com `cnpj`. Rows pré-backfill carregam sentinela `cnpj='__legacy__'` até Worktree B ETL backfill rodar. | `20260504000003_anp_fase3.sql` + `20260525000010_imports_exports_enrichment.sql` | `pipelines/anp/fase3/02_desembaracos_sync.py` |
| ~~`anp_painel_imp_dist`~~ | — | **DROPADA** em `20260525000010_imports_exports_enrichment.sql` (CASCADE) — substituída pela `anp_desembaracos` enriquecida na reforma Imports & Exports | — | — |
| `anp_lpc` | (data_fim, produto, estado) | preco_medio_venda, preco_medio_compra, n_postos | `20260504000004_lpc_sindicom.sql` | `pipelines/anp/lpc_sync.py` |
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
| `get_imports_exports_paises_stacked(p_unified_product, p_ano_inicio, p_ano_fim, p_top_n DEFAULT 10)` | `RETURNS TABLE(ano int, mes int, pais_origem text, total_kg numeric)` | Top-N por `total_kg` no window inteiro; resto colapsa em `pais_origem='Others'`. Frontend converte `total_kg / 1e6 = kt`. |
| `get_imports_exports_importers_stacked(p_unified_product, p_ano_inicio, p_ano_fim, p_top_n DEFAULT 10)` | `RETURNS TABLE(ano int, mes int, unified_importer text, total_mil_m3 numeric)` | JOIN com `ncm_densidade_kg_m3` (conversão kg→m³ server-side) e LEFT JOIN com `importer_group_map`. Fallback de razão social via `regexp_replace` de sufixos (LTDA, S.A., EIRELI, ME) quando não há mapping. Filtra `cnpj <> '__legacy__'`. Retorna `total_mil_m3` (já dividido por 1000). |
| `get_imports_exports_yoy_table(p_scope, p_unified_product, p_ano_fim, p_mes_fim, p_top_n DEFAULT 10)` | `RETURNS TABLE(entity text, last_12m numeric, prev_12m numeric, yoy_pct numeric)` | LANGUAGE plpgsql STABLE. `p_scope IN ('paises','importers')` (raise exception em outros valores). Janela rolling 12m terminando em `(p_ano_fim, p_mes_fim)`. `yoy_pct = NULL` quando `prev_12m=0`. Usa `#variable_conflict use_column`. |
| `get_imports_exports_exports_paises_stacked(p_unified_product, p_ano_inicio, p_ano_fim, p_metric DEFAULT 'volume', p_top_n DEFAULT 10)` | `RETURNS TABLE(ano int, mes int, pais text, value numeric)` | LANGUAGE plpgsql STABLE SECURITY DEFINER. Stacked monthly series por país de destino (top-N + `'Others'`), de `mdic_comex` filtrando `flow='export'`. `p_metric IN ('volume','usd')` (raise exception em outros). Para `volume`, conversão kg → mil m³ server-side via JOIN com `ncm_densidade_kg_m3` (`volume_kg / densidade_kg_m3 / 1000`). JOIN com `imports_product_map source='mdic'`. |
| `get_imports_exports_exports_yoy_table(p_unified_product, p_ano_fim, p_mes_fim, p_metric DEFAULT 'volume', p_top_n DEFAULT 10)` | `RETURNS TABLE(entity text, last_12m numeric, prev_12m numeric, yoy_pct numeric)` | LANGUAGE plpgsql STABLE SECURITY DEFINER. Janela rolling 12m terminando em `(p_ano_fim, p_mes_fim)` vs 12m anteriores. Top-N + `'Others'` por país de destino. `yoy_pct = NULL` quando `prev_12m=0`. Mesma fonte de dados (`mdic_comex flow='export'` + densidade) e mesmas regras de `p_metric` que a função stacked. |

Todas as 6 RPCs: `SET search_path = public`, `GRANT EXECUTE TO anon, authenticated`. As 4 RPCs originais (`filtros`, `paises_stacked`, `importers_stacked`, `yoy_table`) são `STABLE SECURITY INVOKER`; as 2 RPCs de Exports (`exports_paises_stacked`, `exports_yoy_table`) são `STABLE SECURITY DEFINER` (escopo MDIC, sem RLS user-aware necessário).

**RPCs DROPADAS (8):**

`get_anp_daie_filtros`, `get_anp_daie_serie`, `get_anp_desembaracos_filtros`, `get_anp_desembaracos_serie`, `get_anp_desembaracos_top_paises`, `get_anp_painel_imp_filtros`, `get_anp_painel_imp_serie`, `get_anp_painel_imp_top_dist` — todas via `DROP FUNCTION ... CASCADE`. As 3 `get_anp_painel_imp_*` já cairiam pelo `DROP TABLE ... CASCADE` em `anp_painel_imp_dist`; explicitadas por idempotência.

**ETL companion (Worktree B):**

`scripts/pipelines/anp/fase3/02_desembaracos_sync.py` foi refatorado para preservar `Importador` + `CNPJ` + `UF do CNPJ` do XLSX bruto da ANP (antes esses campos eram descartados na linha 171 da versão pré-reforma). `scripts/pipelines/anp/fase3/03_painel_imp_sync.py` foi **deletado**. Workflow `etl_anp_fase3.yml` agora tem 2 steps (era 3). Backfill rodado via `workflow_dispatch` após merge na main. Ver `docs/etl-pipelines/PRD.md` § "Imports & Exports reform (2026-05-25)" para detalhes.

### Pegadinhas — Imports & Exports

**Sentinela `__legacy__`:** rows em `anp_desembaracos.cnpj` carregam `'__legacy__'` enquanto Worktree B ETL backfill não roda. Todas as RPCs que dependem de CNPJ (`get_imports_exports_importers_stacked`, `get_imports_exports_yoy_table p_scope='importers'`) filtram `cnpj <> '__legacy__'` — retornam 0 rows até backfill. Frontend trata isso como informational empty state, não erro.

**`importer_group_map` vazia por design:** seed time intencionalmente sem rows. Worker `worker_supabase` populará via DML migration follow-up depois que Worktree B backfill expor CNPJs reais (T11 do plano CTO). Enquanto vazia, RPCs fazem fallback para `regexp_replace` removendo sufixos comuns de razão social.

**Exports vêm de `mdic_comex`, não de `anp_daie`:** migration `20260525000110_imports_exports_exports_by_country.sql` retirou `get_imports_exports_exports_serie` e introduziu `get_imports_exports_exports_paises_stacked` + `get_imports_exports_exports_yoy_table`, ambas lendo de `mdic_comex` com filtro `flow='export'` + JOIN em `imports_product_map source='mdic'`. A tabela `anp_daie` permanece viva (alimenta os panels de Importação via `get_imports_exports_paises_stacked`/`importers_stacked`/`yoy_table` por `imports_product_map source='daie'`), mas Exports não a consultam mais. Conversão kg→mil m³ é server-side via `ncm_densidade_kg_m3`.

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
| `compute_subsidy_reimbursement` | `(p_date DATE, p_tipo_agente TEXT) RETURNS NUMERIC` | `LANGUAGE sql STABLE SECURITY DEFINER` + `SET search_path = public, pg_temp`. Joins `anp_subsidy_diesel_reference` × `anp_subsidy_commercialization` por `(regiao, tipo_agente)` com `p_date BETWEEN c.data_inicio AND c.data_fim`, aplica `LEAST(GREATEST(ref − comm, 0), cap)` por região (cap é o vigente em `p_date` para o `tipo_agente`), e retorna `AVG(...)`. NULL se faltar dado. `GRANT EXECUTE TO anon, authenticated`. SECURITY DEFINER é obrigatório porque as tabelas têm RLS authed-only no caso da `anp_subsidy_diesel_reference` (Pegadinha #18). |

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

### Trigger: cross-local guard em `anp_cdp_producao`

**Causa**: incidente Apr/2026 — mesmo poço republicado pela ANP com `local` diferente (PosSal + PreSal + Terra) produziu 3× linhas. PK natural inclui `local`, então `ON CONFLICT` não disparou e o dashboard somou as 3 cópias (12.853 → 4.337 kbpd após cleanup; 2.076 linhas movidas para `_quarantine_anp_cdp_apr2026`).

**Defesa de banco**: `trg_anp_cdp_guard_cross_local` (BEFORE INSERT) chama `fn_anp_cdp_guard_cross_local()`. Se já existe row com mesma `(ano, mes, poco, campo, bacia)` mas `local` diferente, levanta `unique_violation` (ERRCODE 23505) com mensagem instrutiva. UPDATE não é guardado — `ON CONFLICT DO UPDATE` na PK completa continua funcionando normalmente.

**Reclassificação legítima** (raro — ANP move poço PosSal → PreSal): exige `DELETE WHERE (ano, mes, poco, campo, bacia)` ANTES do `INSERT`, ou `--purge` no modo manual. Trigger falha alto se o caller esquecer.

**Migration**: `20260521130000_anp_cdp_cross_local_guard.sql`. Lookup é O(log n) via prefix do PK `(ano, mes, poco, campo, bacia, local)` — sem índice novo. Defesas Fase A (`20260521120000_fix_anp_cdp_apr2026_triplication.sql`, quarentena) e Fase B1 (pipeline Python, ver `docs/etl-pipelines/PRD.md`).

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
| D&G Margins | `get_dg_*` | dash-margins |
| Price Bands | `get_price_bands_*` | dash-price-bands |
| Profile / Admin | `get_my_*`, `set_*`, `upsert_my_*`, `set_module_public_visibility`, `admin_list_default_news_keywords`, `admin_add_default_news_keyword`, `admin_set_default_news_keyword_match_type`, `admin_remove_default_news_keyword` | dash-admin |
| News Hunter | `seed_my_news_hunter_keywords`, `get_default_news_keywords` (retrocompat — retorna `text[]`), `get_default_news_keywords_with_flags` (retorna `keyword, match_type` — consumido pelo scanner repo). Writes admin via `admin_*_default_news_keyword*` listados em Profile/Admin | dash-news-hunter |
| Generic / metrics | `get_metricas`, `classificar_agentes` | base |
| MDIC Comex | ~~`get_mdic_comex_filtros`, `get_mdic_comex_serie`, `get_mdic_comex_top_paises`, `get_mdic_comex_aggregated`, `get_mdic_comex_export_count`~~ — **DROPPED 2026-05-25** com a retirada de `/mdic-comex`. A tabela `mdic_comex` continua viva, alimentada pelo `etl_mdic_comex.yml`, e é consumida pelo `/imports-exports` Panel C via `get_imports_exports_fob_price_serie`. | ~~dash-mdic-comex~~ (sub-PRD arquivado em `docs/app/_deprecated/mdic-comex.md`) |
| ANP Preços Produtores | `get_anp_precos_produtores_filtros`, `get_anp_precos_produtores_serie` | dash-anp-precos-produtores |
| ANP GLP | `get_anp_glp_filtros`, `get_anp_glp_serie` | dash-anp-glp |
| Imports & Exports | `get_imports_exports_filtros`, `get_imports_exports_paises_stacked`, `get_imports_exports_importers_stacked`, `get_imports_exports_yoy_table`, `get_imports_exports_exports_paises_stacked`, `get_imports_exports_exports_yoy_table`, `get_imports_exports_fob_price_serie` — consolidam DAIE + Desembaraços + MDIC Comex (sem `anp_painel_imp_dist`, que foi dropada). Migrations: `20260525000010_imports_exports_enrichment.sql` (panels A/B/C) + `20260525000110_imports_exports_exports_by_country.sql` (Exports tab: drop de `get_imports_exports_exports_serie`, intro de stacked + YoY a partir de `mdic_comex flow='export'`). RPCs antigas `get_anp_daie_*`, `get_anp_desembaracos_*`, `get_anp_painel_imp_*` (8 funções) foram DROPPED em `20260525000010`. | dash-imports-exports |
| ANP LPC | `get_anp_lpc_filtros`, `get_anp_lpc_serie`, `get_anp_lpc_nacional` | dash-anp-lpc |
| ANP CDP | `get_anp_cdp_filtros`, `get_anp_cdp_serie`, `get_anp_cdp_pocos_json` | dash-anp-cdp |
| ANP Preços Distribuição | `get_anp_precos_distribuicao_filtros`, `get_anp_precos_distribuicao_serie`, `get_anp_precos_distribuicao_top_distribuidoras` | dash-anp-precos-distribuicao |
| ANP CDP Diária — Field | `get_anp_cdp_diaria_filtros`, `get_anp_cdp_diaria_serie` | dash-anp-cdp-diaria |
| ANP CDP Diária — Installation | `get_anp_cdp_diaria_instalacao_filtros`, `get_anp_cdp_diaria_instalacao_serie` | dash-anp-cdp-diaria |
| ANP CDP Diária — Well | `get_anp_cdp_diaria_poco_filtros`, `get_anp_cdp_diaria_poco_serie` | dash-anp-cdp-diaria |
| Export count (Tier 2) | `get_ms_export_count(p_data_inicio, p_data_fim, p_regioes, p_ufs, p_mercados) → bigint`, `get_anp_cdp_export_count(p_pocos, p_campos, p_bacoes, p_locais, p_estados, p_operadores, p_instalacoes, p_tipos_instalacao, p_ano_inicio, p_ano_fim) → bigint`, `get_anp_lpc_export_count(p_produtos, p_estados, p_data_inicio, p_data_fim) → bigint` | APP (useExportSize) — retornam count filtrado para estimar tamanho do export antes do download. Migration: `20260507000003_export_count_rpcs.sql`. (Nota: `get_mdic_comex_export_count` foi DROPPED em 2026-05-25 com a retirada de `/mdic-comex`.) |
| Data Sources freshness | `get_data_sources_freshness() → TABLE(source_key text, last_update timestamptz, row_count bigint)` | Consumida pela tabela live "Data Sources" da `/home` (desktop only). UNION ALL sobre 23 tabelas ETL-fed (era 22 — Subsidy Reform `20260527300000` trocou `anp_subsidy_history` por `anp_subsidy_caps` + `anp_subsidy_commercialization`). SECURITY DEFINER + `search_path = public, pg_temp`; `GRANT EXECUTE TO anon, authenticated`. Migrations: `20260526200000_data_sources_freshness.sql` + hotfix `20260527300000_data_sources_freshness_subsidy_fix.sql`. Detalhes em § "Data Sources Freshness". Owner: dash-admin (UI) + worker_supabase (RPC). |
| Subsidy Tracker | `get_subsidy_tracker_diesel() → TABLE(date, ipp, ipp_adjusted, petrobras, petrobras_adjusted, anp_reference_importador, anp_reference_produtor, anp_commercialization_importador, anp_commercialization_produtor, regions_importador jsonb, regions_produtor jsonb)` + interna `compute_subsidy_reimbursement(date, tipo_agente) → numeric`. RPC rewrite em `20260527200000_subsidy_reform.sql` (era 1 col simples antes; nova signature dual-agent com sufixos PT). SECURITY DEFINER + `search_path = public, pg_temp` + `GRANT EXECUTE TO anon, authenticated`. Detalhes em § "Subsidy Reform". | dash-subsidy-tracker + dash-price-bands (trigger-side: `_pb_populate_w_subsidy` lê via `compute_subsidy_reimbursement` para preencher `price_bands._w_subsidy`) |

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

## Contratos com outros departamentos

### Recebo solicitações de:

| Dept | Pede o quê |
|---|---|
| ETL | Tabelas pra dados scrape, colunas novas em `vendas`, `navios_diesel`, etc. Mudanças de schema típicas: nova coluna no parquet → solicita coluna correspondente |
| Dados Locais | Tabelas pra Excel manual. Hoje: `d_g_margins`, `price_bands`. Mudanças quando CEO adiciona coluna no Excel |
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
