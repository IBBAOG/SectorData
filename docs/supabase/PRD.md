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
| `vendas` | dash-sales-volumes / dash-market-share | ETL (`pipelines/anp/vendas_watch.py`) |
| `navios_diesel` | dash-navios-diesel | ETL (`pipelines/navios/01_lineup_scrape.py` → `pipelines/navios/02_diesel_import.mjs`) |
| `vessel_registry`, `vessel_positions`, `port_arrivals`, `import_candidates` | dash-navios-diesel | ETL (`ais_*.py`, `vessel_*.py`) |
| `d_g_margins` | dash-margins | Dados Locais (manual via `scripts/manual/dg_margins_upload.py`) |
| `price_bands` | dash-price-bands | Dados Locais (manual via `upload_price_bands.py`) |
| `stock_portfolios` | dash-stocks | App (CRUD direto via PostgREST). Desde `20260522000001`: coluna `is_public` + nullable `user_id` + seed do portfolio público `00000000-...-001` "Brazilian Oil & Gas (default)" |
| `news_articles`, `news_hunter_keywords` | dash-news-hunter | scanner externo + user via UI. Desde `20260522000001`: `news_articles` ganhou policy SELECT TO anon |
| `news_hunter_default_keywords` | dash-news-hunter | Tabela nova `20260522000001` — 27 keywords default lidas por `get_default_news_keywords()` (anon-safe). Single source of truth (substitui lista hardcoded em `seed_my_news_hunter_keywords()`) |
| `profiles`, `module_visibility` | dash-admin | App (RPC). Desde `20260522000001`: `module_visibility.is_visible_for_public` + trigger self-healing |
| `app_events` | dash-admin (`/admin-analytics`) | RPC `track_event()` (SECURITY DEFINER). Desde `20260522000001`: dual-actor (`user_id` OR `visitor_id`) |

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

### Sessions / Auth state

| Tabela | Dept consumidor | Populada por |
|---|---|---|
| `alertas_session` | dept Alertas (read + update `last_used_at`), dept ETL (write) | `etl_anp_cdp.yml` (capture mensal via Selenium+CAPTCHA) — `alertas_monitor.yml` (read + update `last_used_at` a cada 2h) |

`alertas_session`: sem policies por design — somente service-role bypassa RLS. Migration: `20260507000001_alertas_session.sql`. `metadata` jsonb armazena flags de debounce (`last_capture_attempt`) e contexto APEX (`app_id`, `page_id`, `p_instance`, `captured_periodo`).

### Tabelas Fase 3 (adicionadas 2026-05-04)

Todas com RLS habilitada, policy `acesso autenticado` FOR SELECT TO authenticated USING (true). `anp_cdp_producao` foi corrigida via `20260504000013_anp_cdp_rls_authenticated.sql` (antes tinha `public read` sem restrição a `authenticated`).

| Tabela | PK | Colunas-chave | Migration | Pipeline |
|---|---|---|---|---|
| `mdic_comex` | (ano, mes, flow, ncm_codigo, pais) | volume_kg, valor_fob_usd | `20260504000012_mdic_comex.sql` | `pipelines/mdic_comex_sync.py` |
| `anp_ppi` | (data_fim, produto, local) | preco, variacao_pct, unidade | `20260504000002_anp_precos.sql` | `pipelines/anp/precos/01_ppi_sync.py` |
| `anp_precos_produtores` | (data_inicio, produto, regiao) | preco, unidade | `20260504000002_anp_precos.sql` | `pipelines/anp/precos/02_precos_produtores_sync.py` |
| `anp_glp` | (ano, mes, distribuidora, categoria) | vendas_kg | `20260504000002_anp_precos.sql` | `pipelines/anp/glp_sync.py` |
| `anp_daie` | (ano, mes, produto, operacao) | volume_m3, valor_usd | `20260504000003_anp_fase3.sql` | `pipelines/anp/fase3/01_daie_sync.py` |
| `anp_desembaracos` | (ano, mes, ncm_codigo, pais_origem) | quantidade_kg | `20260504000003_anp_fase3.sql` | `pipelines/anp/fase3/02_desembaracos_sync.py` |
| `anp_painel_imp_dist` | (ano, mes, distribuidor, uf, nome_produto) | volume_m3 | `20260504000003_anp_fase3.sql` | `pipelines/anp/fase3/03_painel_imp_sync.py` |
| `anp_lpc` | (data_fim, produto, estado) | preco_medio_venda, preco_medio_compra, n_postos | `20260504000004_lpc_sindicom.sql` | `pipelines/anp/lpc_sync.py` |
| `sindicom` | (ano, mes, empresa, nome_produto, segmento, uf) | volume | `20260504000004_lpc_sindicom.sql` | `pipelines/sindicom_sync.py` |
| `anp_cdp_producao` | (ano, mes, poco, campo, bacia, local) | petroleo_bbl_dia, gas_total_mm3_dia, oleo_bbl_dia, condensado_bbl_dia, agua_bbl_dia, operador, local (PosSal/PreSal/Terra), instalacao_destino, tipo_instalacao, tempo_prod_hs_mes | `20260504000005_anp_cdp.sql` (v1) → `_v7` (schema final) → `20260504000013` (RLS authenticated) | `pipelines/anp/cdp/01_extract.py` → `02_upload.py` (~1.8M rows) |
| `anp_precos_distribuicao` | (data_referencia, distribuidora, produto, uf) | preco_distribuicao, unidade | `20260507000005_anp_precos_distribuicao.sql` | `pipelines/anp/precos_distribuicao_sync.py` |
| `anp_cdp_diaria` | (data, campo, bacia) | petroleo_bbl_dia, gas_mm3_dia; histórico desde 2025-11-09 (limitação da fonte Power BI). Populada por `scripts/extractors/anp_cdp_powerbi.py` 3×/dia em modo **append-only** (`ON CONFLICT DO NOTHING`). Linhas existentes nunca são sobrescritas — snapshot histórico imutável a partir de 2025-11-09. | `20260508000001_anp_cdp_diaria.sql` | `scripts/extractors/anp_cdp_powerbi.py` (workflow `etl_anp_cdp_diaria.yml`, 3×/dia) |
| `anp_cdp_diaria_instalacao` | (data, instalacao) | campo (NOT NULL), petroleo_bbl_dia, gas_mm3_dia. Sem coluna bacia — entidade Power BI `v_instalacoes_final` não expõe bacia. ~16.3k rows (93 instalações; range 2025-11-09 → presente). Populada em modo **append-only** (`ON CONFLICT DO NOTHING`) — linhas existentes nunca sobrescritas. | `20260508120001_anp_cdp_diaria_levels.sql` | `scripts/extractors/anp_cdp_powerbi.py --level instalacao` |
| `anp_cdp_diaria_poco` | (data, poco) | campo (nullable), bacia (nullable), instalacao (nullable; adicionada em `20260508130001`), petroleo_bbl_dia, gas_mm3_dia. ~180.7k rows (1.219 poços; range 2025-11-09 → presente). Populada em modo **append-only** (`ON CONFLICT DO NOTHING`) — linhas existentes nunca sobrescritas. **Nota:** atribuição poço↔campo é 1:1 (último mapeamento contratual). Para análise N:N (poços compartilhados entre múltiplos campos), use `anp_cdp_producao` (mensal × poço × campo, PK composta suporta N:N nativamente). Ver limitação documentada em [`docs/app/anp-cdp-diaria.md`](../app/anp-cdp-diaria.md). | `20260508120001_anp_cdp_diaria_levels.sql` + `20260508130001` (add instalacao) | `scripts/extractors/anp_cdp_powerbi.py --level poco` |

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
| Sales Volumes | `get_sv_*`, `get_ms_*` (compartilhado) | dash-sales-volumes / dash-market-share |
| Market Share | `get_ms_*` | dash-market-share |
| Navios | `get_nd_*` | dash-navios-diesel |
| D&G Margins | `get_dg_*` | dash-margins |
| Price Bands | `get_price_bands_*` | dash-price-bands |
| Profile / Admin | `get_my_*`, `set_*`, `upsert_my_*`, `set_module_public_visibility` | dash-admin |
| News Hunter | `seed_my_news_hunter_keywords`, `get_default_news_keywords` | dash-news-hunter |
| Generic / metrics | `get_metricas`, `classificar_agentes` | base |
| MDIC Comex | `get_mdic_comex_filtros`, `get_mdic_comex_serie`, `get_mdic_comex_top_paises` | dash-mdic-comex |
| ANP PPI | `get_anp_ppi_filtros`, `get_anp_ppi_media_serie`, `get_anp_ppi_locais_serie` | dash-anp-ppi |
| ANP Preços Produtores | `get_anp_precos_produtores_filtros`, `get_anp_precos_produtores_serie` | dash-anp-precos-produtores |
| ANP GLP | `get_anp_glp_filtros`, `get_anp_glp_serie` | dash-anp-glp |
| ANP DAIE | `get_anp_daie_filtros`, `get_anp_daie_serie` | dash-anp-daie |
| ANP Desembaraços | `get_anp_desembaracos_filtros`, `get_anp_desembaracos_serie`, `get_anp_desembaracos_top_paises` | dash-anp-desembaracos |
| ANP Painel Imp. | `get_anp_painel_imp_filtros`, `get_anp_painel_imp_serie`, `get_anp_painel_imp_top_dist` | dash-anp-painel-importacoes |
| ANP LPC | `get_anp_lpc_filtros`, `get_anp_lpc_serie`, `get_anp_lpc_nacional` | dash-anp-lpc |
| SINDICOM | `get_sindicom_filtros`, `get_sindicom_serie` | dash-sindicom |
| ANP CDP | `get_anp_cdp_filtros`, `get_anp_cdp_serie`, `get_anp_cdp_pocos_json` | dash-anp-cdp |
| ANP Preços Distribuição | `get_anp_precos_distribuicao_filtros`, `get_anp_precos_distribuicao_serie`, `get_anp_precos_distribuicao_top_distribuidoras` | dash-anp-precos-distribuicao |
| ANP CDP Diária — Field | `get_anp_cdp_diaria_filtros`, `get_anp_cdp_diaria_serie` | dash-anp-cdp-diaria |
| ANP CDP Diária — Installation | `get_anp_cdp_diaria_instalacao_filtros`, `get_anp_cdp_diaria_instalacao_serie` | dash-anp-cdp-diaria |
| ANP CDP Diária — Well | `get_anp_cdp_diaria_poco_filtros`, `get_anp_cdp_diaria_poco_serie` | dash-anp-cdp-diaria |
| Export count (Tier 2) | `get_ms_export_count(p_data_inicio, p_data_fim, p_regioes, p_ufs, p_mercados) → bigint`, `get_mdic_comex_export_count(p_flow, p_ncms, p_ano_inicio, p_ano_fim) → bigint`, `get_anp_cdp_export_count(p_pocos, p_campos, p_bacoes, p_locais, p_estados, p_operadores, p_instalacoes, p_tipos_instalacao, p_ano_inicio, p_ano_fim) → bigint`, `get_anp_lpc_export_count(p_produtos, p_estados, p_data_inicio, p_data_fim) → bigint` | APP (useExportSize) — retornam count filtrado para estimar tamanho do export antes do download. Migration: `20260507000003_export_count_rpcs.sql`. |

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
