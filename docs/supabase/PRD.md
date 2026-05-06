# PRD — Departamento Supabase / Database

Único guardião do schema Postgres. Owner: [`worker_supabase`](../../.claude/agents/worker_supabase.md).

Recebe solicitações de todos os outros departamentos. Não tem desenho próprio — schema serve dado, e dado pertence aos depts consumidores.

## Escopo

```
supabase/
  migrations/                       Migrations canônicas (DDL + RPCs + RLS)
  config.toml                       Config Supabase CLI

sql/                                LEGADO — DDL aplicado direto no Dashboard
  create_price_bands.sql            (price_bands, get_price_bands_data)
  create_profiles_and_visibility.sql (profiles, module_visibility, policies)
  create_user_management.sql        (verificar conteúdo)

.github/workflows/
  supabase_deploy.yml               Deploy de migrations em push pra main
```

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

## Workflow `supabase_deploy.yml`

Deploya migrations em push pra `main`. Use `SUPABASE_PROJECT_REF` e `SUPABASE_ACCESS_TOKEN`.

## Cliente Supabase MCP

Quando MCP tools `mcp__*__apply_migration`, `mcp__*__execute_sql`, `mcp__*__list_tables`, `mcp__*__list_migrations`, `mcp__*__get_advisors`, `mcp__*__list_extensions`, `mcp__*__deploy_edge_function` estão disponíveis, **prefira eles** ao CLI. Operam direto no project remoto.

## Tech Debt

### Migration slot collision — `20260504000001` (resolvido)

A migration `20260504000001` foi originalmente `add_brasil_energia_keyword` (commit 8307a66d), revertida via git revert (commit 98531667), e o slot foi reutilizado para `mdic_comex`. Isso causou collision: `schema_migrations` tinha `name=add_brasil_energia_keyword` enquanto o disco tinha `mdic_comex.sql`. Resolvido em commit 880782e9: arquivo `mdic_comex` renomeado para `_000012_mdic_comex.sql` + repair step adicionado ao workflow `supabase_deploy.yml` para atualizar o registro em `schema_migrations` antes do push.

### `sql/` fora das migrations versionadas

3 arquivos em `sql/` foram aplicados direto no Dashboard, criando schema que **não existe em `supabase/migrations/`**:

| Arquivo | Schema criado |
|---|---|
| `sql/create_price_bands.sql` | `price_bands`, `get_price_bands_data` |
| `sql/create_profiles_and_visibility.sql` | `profiles`, `module_visibility`, policies |
| `sql/create_user_management.sql` | (verificar) |

Implicação: recriar o banco apenas das migrations resultaria em schema incompleto.

**Plano de resolução** (próxima janela):
1. Para cada arquivo em `sql/`, criar migration espelhada com `IF NOT EXISTS`.
2. `apply_migration` (idempotente — não falha porque DDL já existe no banco).
3. Listar `migrations` pra confirmar registro.
4. Remover `sql/` e atualizar `docs/app/PRD.md` (remover seção tech debt).

### Outras observações

- Algumas RPCs em `remote_schema.sql` têm múltiplas assinaturas (overload) — é histórico e funciona, mas convém consolidar.
- Auditoria periódica via `get_advisors` ainda não foi rodada — fazer ao entrar em produção plena.

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
