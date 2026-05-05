# PRD — Departamento APP

Dashboard Next.js + Supabase + Vercel. Owner do schema do banco. Veja `README.md` na raiz para a visão geral pública; este documento é a referência **interna** do dept.

## Escopo

```
src/                              Código-fonte do Next.js
public/                           Assets estáticos
supabase/migrations/              Migrations canônicas (DDL + RPCs + RLS)
supabase/config.toml              Config Supabase CLI
.vercel/                          Config de deploy (gerado pelo Vercel CLI)
.env, .env.local, .env.example    Variáveis de ambiente
next.config.ts                    Config Next.js
package.json, package-lock.json   Deps npm
tsconfig.json                     Config TypeScript
eslint.config.mjs
```

## Stack

| Layer | Tecnologia | Versão | Observação |
|---|---|---|---|
| Framework | Next.js App Router | **16.2.1** | **Não-padrão** — sempre consultar `node_modules/next/dist/docs/` antes de mexer em coisa do framework |
| UI | React + Bootstrap | 19.2.4 / 5.3.8 | |
| Charts | Plotly.js (`react-plotly.js`) | 3.4.0 | Wrapper em `src/components/PlotlyChart.tsx` |
| DB & Auth | Supabase (`supabase-js`) | 2.100.1 | Anon key no frontend |
| Excel Export | ExcelJS + JSZip | 4.4.0 / 3.10.1 | Helpers em `src/lib/exportExcel.ts` |
| Mercado | Yahoo Finance via proxy Next.js | — | `/api/stocks/*` |
| Deploy | Vercel | — | Auto on push to `main` |

## Arquitetura

- **Sem rotas API para Supabase.** Lógica de backend mora em **funções RPC PostgreSQL**, chamadas direto do browser via `supabase-js` com anon key.
- **Yahoo Finance proxiado** via `src/app/api/stocks/*` (CORS).
- **Auth guard** em `src/app/(dashboard)/layout.tsx` — `supabase.auth.getSession()`, redireciona para `/login` se ausente.
- **Visibility por role**: Admin pode habilitar/desabilitar módulos para Clientes via `module_visibility`. Frontend lê via `UserProfileContext` e enforça com `useModuleVisibilityGuard(slug)`.
- **Materialized views** `mv_ms_serie` e `mv_ms_serie_fast` para Market Share / Sales Volumes (perf).
- **GitHub Actions como ETL externo** — donas do dept ETL, mas o `supabase-deploy.yml` é deste dept (deploya migrations).

## Módulos

| Rota | Arquivo | RPCs | Export Excel |
|---|---|---|---|
| `/home` | `src/app/(dashboard)/home/page.tsx` | — | — |
| `/sales-volumes` | `src/app/(dashboard)/sales-volumes/page.tsx` | `get_sv_opcoes_filtros`, `get_ms_serie_fast`, `get_ms_serie_others`, `get_others_players` | Sim |
| `/market-share` | `src/app/(dashboard)/market-share/page.tsx` | `get_ms_opcoes_filtros`, `get_ms_serie_fast`, `get_ms_serie_others`, `get_others_players` | Sim |
| `/navios-diesel` | `src/app/(dashboard)/navios-diesel/page.tsx` | `get_nd_ultima_coleta`, `get_nd_coletas_distintas`, `get_nd_navios`, `get_nd_resumo_portos` | Sim |
| `/diesel-gasoline-margins` | `src/app/(dashboard)/diesel-gasoline-margins/page.tsx` | `get_dg_margins_data`, `get_dg_margins_filters` | Sim |
| `/price-bands` | `src/app/(dashboard)/price-bands/page.tsx` | `get_price_bands_data` | Sim |
| `/stocks` | `src/app/(dashboard)/stocks/page.tsx` | `stock_portfolios` (PostgREST direto) | Não |
| `/news-hunter` | `src/app/(dashboard)/news-hunter/page.tsx` | `seed_my_news_hunter_keywords` | Não |
| `/profile` | `src/app/(dashboard)/profile/page.tsx` | `get_my_profile`, `upsert_my_profile` | — |
| `/admin-panel` | `src/app/(dashboard)/admin-panel/page.tsx` | `get_module_visibility`, `set_module_visibility`, `get_all_users_with_roles`, `set_user_role` | — |

Wrappers de RPC: `src/lib/rpc.ts` (organizado por módulo) e `src/lib/profileRpc.ts`.

## Componentes-chave compartilhados

| Componente | Função |
|---|---|
| `NavBar.tsx` | Config `NAV_ENTRIES`, dropdown de avatar |
| `PlotlyChart.tsx` | Wrapper `react-plotly.js` |
| `PeriodSlider.tsx` | rc-slider para range de datas |
| `CheckList.tsx` | Multi-select com Select All / Clear |
| `RegionStateFilter.tsx` | Filtro cascata Região → UF |
| `SearchableMultiSelect.tsx` | Multi-select com busca |
| `stocks/StockChart.tsx`, `ComparisonChart.tsx`, `MarketOverview.tsx`, `StockSearch.tsx`, `FuturesCurveChart.tsx` | Stocks |

## Hooks

| Hook | Função |
|---|---|
| `useStockQuote/History/Portfolios.ts` | Stocks |
| `useAutoRefresh.ts` | Refresh periódico |
| `useModuleVisibilityGuard.ts` | Bloqueia módulo se invisível pro role |
| `useRoleGuard.ts` | Bloqueia páginas Admin para não-Admin |
| `useDebounce.ts` | Debounce |

## Schema do Supabase (tabelas principais)

| Tabela | PK | Colunas-chave |
|---|---|---|
| `vendas` | `id` | `ano, mes, agente_regulado, nome_produto, regiao_destinatario, uf_destino, segmento, quantidade_produto, classificacao, date` |
| `navios_diesel` | `id` | `collected_at, porto, navio, status, produto, quantidade_convertida, eta, inicio_descarga, fim_descarga, origem, imo, mmsi, flag, is_cabotagem` (generated) |
| `d_g_margins` | `id` | `fuel_type, week, base_fuel, biofuel_component, federal_tax, state_tax, distribution_and_resale_margin, total` |
| `price_bands` | `id` | `date, product, bba_import_parity, bba_import_parity_w_subsidy, bba_export_parity, petrobras_price` |
| `stock_portfolios` | uuid | `user_id, name, tickers text[], groups jsonb, is_active` |
| `module_visibility` | `module_slug` | `is_visible_for_clients` |
| `news_articles` | `url` | `domain, source_name, title, snippet, published_at, found_at, matched_keywords text[]` |
| `news_hunter_keywords` | `(user_id, keyword)` | `created_at` (RLS por usuário) |
| `vessel_registry`, `vessel_positions`, `port_arrivals`, `import_candidates` | — | (populadas pelo ETL — ver `etl-pipelines`) |

**Materialized views:** `mv_ms_serie`, `mv_ms_serie_fast` — agregação mensal pré-computada, refresh via função `classificar_agentes()`.

**Filtragem de cabotagem:** `navios_diesel.is_cabotagem` é coluna gerada (`flag IN {Brazil, BR}` OR padrão em `origem`). Todas as RPCs de navios filtram `WHERE NOT is_cabotagem`.

## Auth & Roles

- **Guard de auth**: `(dashboard)/layout.tsx` → `supabase.auth.getSession()` → redirect `/login`.
- **Admin**: todos os módulos + `/admin-panel` (gestão de roles e visibilidade).
- **Client**: módulos permitidos pelo Admin via `module_visibility`. Enforcement: `useModuleVisibilityGuard(slug)`.
- Role armazenado em `user_profiles`, exposto via `UserProfileContext`. `useRoleGuard` protege páginas de Admin.

## Tech debt: SQL fora das migrations

Existem 3 arquivos em `sql/` (raiz do repo) cujo DDL foi aplicado **diretamente no Supabase Dashboard SQL Editor**, não via `supabase/migrations/`:

| Arquivo | Tabelas/RPCs criadas |
|---|---|
| `sql/create_price_bands.sql` | `price_bands`, `get_price_bands_data` |
| `sql/create_profiles_and_visibility.sql` | `profiles`, `module_visibility`, policies |
| `sql/create_user_management.sql` | (verificar) |

Implicação: recriar o banco apenas das migrations versionadas resultaria em schema incompleto. Para resolver: criar migrations correspondentes em `supabase/migrations/<timestamp>_<feature>.sql` espelhando o conteúdo, depois remover `sql/`.

## Variáveis de ambiente

```
# .env.local (frontend)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## Checklist — adicionar módulo novo

1. Copiar `src/app/(dashboard)/template-module/` → `src/app/(dashboard)/<slug>/`.
2. Adicionar entrada no `NAV_ENTRIES` em `src/components/NavBar.tsx`.
3. Criar migration `supabase/migrations/<timestamp>_<feature>.sql` (tabelas + RPCs + **RLS habilitada**).
4. Adicionar wrappers em `src/lib/rpc.ts` (seção do módulo).
5. `INSERT INTO module_visibility (module_slug, is_visible_for_clients) VALUES ('<slug>', true);`
6. Usar `useModuleVisibilityGuard("<slug>")` na página.
7. **Controle de visibilidade no admin panel** do módulo (memória do CEO).
8. **Upload de imagem de home** no painel admin do módulo (memória do CEO).
9. Avisar Documentador → atualizar este PRD (linha nova na tabela de módulos).

## Anti-padrões

- Criar `src/app/api/<rota>` para ler/escrever no Supabase. Use RPC.
- Componente chamando `supabase.rpc(...)` direto — sempre via wrapper em `src/lib/rpc.ts`.
- Criar tabela sem RLS.
- Editar migration já aplicada — sempre criar nova.
- UI em inglês.
- Esquecer `useModuleVisibilityGuard` em módulo novo.
- Pular controle de visibilidade ou imagem de home no admin do módulo novo.

## Contratos com outros departamentos

- **ETL** popula tabelas; quando ETL precisa de coluna nova, APP cria migration.
- **Dados Locais** popula `d_g_margins` e `price_bands` via upload manual; APP só consome.
- **Alertas** lê tabelas; mudanças de schema podem quebrar bases de alerta — coordenar via Gerente.
- **Workflow `supabase-deploy.yml`** é deste dept (deploya migrations em push para `main`).
