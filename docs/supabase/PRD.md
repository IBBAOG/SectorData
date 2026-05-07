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
| `stock_portfolios` | dash-stocks | App (CRUD direto via PostgREST) |
| `news_articles`, `news_hunter_keywords` | dash-news-hunter | scanner externo + user via UI |
| `profiles`, `module_visibility` | dash-admin | App (RPC) |

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
| `anp_cdp_producao` | (ano, mes, operador, bacia, local) | petroleo_bbl_dia, gas_total_mm3_dia, oleo_bbl_dia, condensado_bbl_dia, agua_bbl_dia, n_pocos | `20260504000005_anp_cdp.sql` (v1) → `_v7` (schema final) → `20260504000013` (RLS authenticated) | `pipelines/anp/cdp/01_extract.py` → `02_upload.py` (~1.8M rows) |
| `anp_precos_distribuicao` | (data_referencia, distribuidora, produto, uf) | preco_distribuicao, unidade | `20260507000005_anp_precos_distribuicao.sql` | `pipelines/anp/precos_distribuicao_sync.py` |

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
| Profile / Admin | `get_my_*`, `set_*`, `upsert_my_*` | dash-admin |
| News Hunter | `seed_my_news_hunter_keywords` | dash-news-hunter |
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
  run: supabase db execute --file supabase/tests/migration_smoke.sql
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

### a) `supabase db execute` foi removido da CLI

O comando `supabase db execute --file <arquivo.sql>` não existe mais na CLI atual. Use:

```bash
supabase db query --file <arquivo.sql>
```

O smoke test em `supabase/tests/migration_smoke.sql` deve ser invocado com `db query --file`, não `db execute --file`. O step do workflow foi corrigido em `9310496e`.

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
| `20260505000008_legacy_profiles_and_visibility.sql` | `profiles`, `module_visibility`, policies, `get_my_profile`, `upsert_my_profile`, `get_module_visibility`, `set_module_visibility` |
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

## Tarefas comuns

Ver `.claude/agents/worker_supabase.md` (mesma seção). Resumo:

- Criar tabela nova
- Adicionar/modificar RPC
- Mudar política RLS
- Criar/refresh materialized view
- Converter `sql/` legado em migration
- Auditoria periódica (`get_advisors`)
