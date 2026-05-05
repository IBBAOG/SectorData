# PRD — Departamento APP (Subgerente)

Dashboard Next.js + Supabase + Vercel. Owner do schema do banco. Este PRD documenta apenas a **infra compartilhada** sob ownership do Subgerente APP. Cada dashboard tem seu próprio sub-PRD em `docs/app/<dashboard>.md`.

> **Visão geral pública** está no `README.md` da raiz. Aqui é a referência **interna** do Subgerente.

## Escopo do Subgerente (infra compartilhada)

```
src/app/
  layout.tsx                        Root shell (Bootstrap, lang=pt-BR)
  globals.css                       Estilos globais (co-mantido com Designer)
  login/                            Tela de login + auth
  api/stocks/                       Yahoo Finance proxy (mas dash-stocks consome)
  (dashboard)/
    layout.tsx                      Auth guard → /login
    template-module/                Template para criar módulos novos (não é módulo)

src/components/                     Componentes COMPARTILHADOS
  NavBar.tsx                        Config NAV_ENTRIES, dropdown de avatar
  PlotlyChart.tsx                   Wrapper react-plotly.js
  PeriodSlider.tsx                  rc-slider para range de datas
  CheckList.tsx                     Multi-select com Select All / Clear
  RegionStateFilter.tsx             Filtro cascata Região → UF
  SearchableMultiSelect.tsx         Multi-select com busca
  (Componentes scoped por dashboard NÃO ficam aqui — ficam com o dash-*)

src/context/
  UserProfileContext.tsx            Profile + moduleVisibility

src/hooks/                          Hooks COMPARTILHADOS
  useAutoRefresh.ts
  useModuleVisibilityGuard.ts
  useRoleGuard.ts
  useDebounce.ts
  (useStockQuote/History/Portfolios.ts são scoped — pertencem a dash-stocks)

src/lib/                            Helpers compartilhados
  supabaseClient.ts
  rpc.ts                            Agregador de RPCs (cada seção pertence a um dash-*)
  profileRpc.ts                     RPCs de perfil (compartilhado com dash-admin)
  filterUtils.ts                    REGIAO_UF_MAP, helpers de data
  exportExcel.ts                    Export ExcelJS para todos os dashboards

src/types/                          Tipos compartilhados (tipos scoped ficam com dash-*)

supabase/migrations/                Migrations canônicas (DDL + RPCs + RLS)
supabase/config.toml                Config Supabase CLI

public/                             Assets estáticos (logos, previews)
.vercel/                            Config de deploy
next.config.ts, tsconfig.json,
package.json, eslint.config.mjs     Configs do projeto
```

## Sub-agentes (donos de dashboard)

Para qualquer mudança em código de um dashboard específico, delegue ao agente correspondente:

| Dashboard | Agente | Sub-PRD |
|---|---|---|
| `/sales-volumes` | `dash-sales-volumes` | [sales-volumes.md](sales-volumes.md) |
| `/market-share` | `dash-market-share` | [market-share.md](market-share.md) |
| `/navios-diesel` | `dash-navios-diesel` | [navios-diesel.md](navios-diesel.md) |
| `/diesel-gasoline-margins` | `dash-margins` | [diesel-gasoline-margins.md](diesel-gasoline-margins.md) |
| `/price-bands` | `dash-price-bands` | [price-bands.md](price-bands.md) |
| `/stocks` | `dash-stocks` | [stocks.md](stocks.md) |
| `/news-hunter` | `dash-news-hunter` | [news-hunter.md](news-hunter.md) |
| `/home`, `/profile`, `/admin-panel` | `dash-admin` | [admin.md](admin.md) |

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

## Arquitetura (princípios herdados por todos os dash-*)

- **Sem rotas API para Supabase.** Lógica de backend mora em **funções RPC PostgreSQL**, chamadas direto do browser via `supabase-js` com anon key.
- **Yahoo Finance proxiado** via `src/app/api/stocks/*` (CORS).
- **Auth guard** em `src/app/(dashboard)/layout.tsx` — `supabase.auth.getSession()`, redireciona para `/login` se ausente.
- **Visibility por role**: Admin pode habilitar/desabilitar módulos para Clientes via `module_visibility`.
- **Materialized views** `mv_ms_serie` e `mv_ms_serie_fast` para Market Share / Sales Volumes (perf).
- **Workflow `supabase-deploy.yml`** é deste dept — deploya migrations em push para `main`.

## Schema do Supabase (overview)

Schema completo é responsabilidade compartilhada — cada `dash-*` documenta as tabelas/RPCs específicas no seu sub-PRD. Aqui só a visão de cima:

| Tabela | Dono lógico | Populada por |
|---|---|---|
| `vendas` | dash-sales-volumes / dash-market-share | ETL (anp_watcher) |
| `mv_ms_serie`, `mv_ms_serie_fast` | dash-sales-volumes / dash-market-share | Função `classificar_agentes()` |
| `navios_diesel` | dash-navios-diesel | ETL (navios_esperados → import_navios_diesel) |
| `vessel_registry`, `vessel_positions`, `port_arrivals`, `import_candidates` | dash-navios-diesel | ETL (ais_*, vessel_*) |
| `d_g_margins` | dash-margins | Dados Locais (upload manual) |
| `price_bands` | dash-price-bands | Dados Locais (upload manual) |
| `stock_portfolios` | dash-stocks | App (CRUD direto via PostgREST) |
| `news_articles`, `news_hunter_keywords` | dash-news-hunter | News Hunter scanner (repo separado) + user via UI |
| `profiles`, `module_visibility` | dash-admin | App (RPC) |

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

## Workflow Subgerente: adicionar dashboard novo

Ver `.claude/agents/subgerente-app.md` → seção "Adicionar novo dashboard". Resumo dos 12 passos:

1. Copiar `template-module/` → novo módulo.
2. Entrada no `NavBar.NAV_ENTRIES`.
3. Migration (tabelas + RPCs + **RLS**).
4. Wrappers em `src/lib/rpc.ts`.
5. `INSERT INTO module_visibility`.
6. `useModuleVisibilityGuard("<slug>")` na página.
7. **CRIAR `.claude/agents/dash-<slug>.md`** ← responsabilidade do Subgerente.
8. **CRIAR `docs/app/<slug>.md`** ← sub-PRD.
9. **Disparar `dash-admin`** → toggle de visibilidade + foto na home (memória do CEO).
10. Atualizar `subgerente-app.md` (mapeamento).
11. Atualizar `gerente-geral.md` (sub-agentes).
12. Avisar Documentador → `master.md` + este `PRD.md`.

## Princípios não-negociáveis (TODO dash-* herda)

1. **Nada de rota API para dados do Supabase.** RPCs sempre.
2. **RLS sempre ligada** em qualquer tabela nova.
3. **Auth guard** em `(dashboard)/layout.tsx` — não duplique.
4. **Visibility guard** — `useModuleVisibilityGuard("<slug>")` em cada módulo.
5. **Wrappers de RPC centralizados** em `src/lib/rpc.ts`.
6. **Idioma da UI:** português.
7. **Migration nova é única fonte da verdade** — nunca edite migration aplicada.
8. **Identidade visual** consultada via `designer` antes de drift.

## Anti-padrões (deste dept)

- Criar `src/app/api/<rota>` para ler/escrever no Supabase. Use RPC.
- Componente chamando `supabase.rpc(...)` direto — sempre via wrapper.
- Tabela sem RLS.
- Editar migration já aplicada.
- UI em inglês.
- Esquecer `useModuleVisibilityGuard` em módulo novo.
- Criar dashboard sem registrar em `module_visibility` ou sem foto na home (memória do CEO).
- Editar componente `src/components/<DashboardEspecifico>` sem ser o `dash-*` dono.

## Contratos com outros departamentos

- **ETL** popula tabelas; quando ETL precisa coluna nova, APP cria migration.
- **Dados Locais** popula `d_g_margins` e `price_bands` via upload manual.
- **Alertas** lê tabelas; mudanças de schema podem quebrar bases.
- **Designer** é consultado antes de mudanças visuais.
- **Workflow `supabase-deploy.yml`** é deste dept (deploya migrations).
