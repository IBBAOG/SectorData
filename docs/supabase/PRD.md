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

### Materialized views

| MV | Função |
|---|---|
| `mv_ms_serie` | Agregação mensal por agente (sales-volumes / market-share) |
| `mv_ms_serie_fast` | Versão otimizada de `mv_ms_serie` |

Refresh via função `classificar_agentes()`. Chamada após upload em `vendas`.

### RPCs (ver detalhe nos sub-PRDs)

| Domínio | Prefixo | Dono lógico |
|---|---|---|
| Sales Volumes | `get_sv_*`, `get_ms_*` (compartilhado) | dash-sales-volumes / dash-market-share |
| Market Share | `get_ms_*` | dash-market-share |
| Navios | `get_nd_*` | dash-navios-diesel |
| D&G Margins | `get_dg_*` | dash-margins |
| Price Bands | `get_price_bands_*` | dash-price-bands |
| Profile / Admin | `get_my_*`, `set_*`, `upsert_my_*` | dash-admin |
| News Hunter | `seed_my_news_hunter_keywords` | dash-news-hunter |
| Generic / metrics | `get_metricas`, `classificar_agentes` | base |

## Workflow `supabase_deploy.yml`

Deploya migrations em push pra `main`. Use `SUPABASE_PROJECT_REF` e `SUPABASE_ACCESS_TOKEN`.

## Cliente Supabase MCP

Quando MCP tools `mcp__*__apply_migration`, `mcp__*__execute_sql`, `mcp__*__list_tables`, `mcp__*__list_migrations`, `mcp__*__get_advisors`, `mcp__*__list_extensions`, `mcp__*__deploy_edge_function` estão disponíveis, **prefira eles** ao CLI. Operam direto no project remoto.

## Tech Debt

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
