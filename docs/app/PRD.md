# PRD — Departamento APP (Subgerente)

Dashboard Next.js + Vercel. Este PRD documenta apenas a **infra compartilhada** sob ownership do Subgerente APP. Cada dashboard tem seu próprio sub-PRD em `docs/app/<dashboard>.md`.

> **Schema/SQL/migrations/RLS** pertencem ao dept `worker_supabase` (ver [`docs/supabase/PRD.md`](../supabase/PRD.md)). APP é consumidor via wrappers JS em `src/lib/rpc.ts`.

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

src/lib/                            Helpers compartilhados (JS — chamando o que o dept supabase expõe)
  supabaseClient.ts                 Setup do cliente JS (anon key)
  rpc.ts                            Agregador de wrappers JS (cada seção pertence a um dash-*)
  profileRpc.ts                     Wrappers JS de perfil (compartilhado com dash-admin)
  filterUtils.ts                    REGIAO_UF_MAP, helpers de data
  exportExcel.ts                    Export ExcelJS para todos os dashboards

src/types/                          Tipos compartilhados (tipos scoped ficam com dash-*)

public/                             Assets estáticos (logos, previews)
.vercel/                            Config de deploy
next.config.ts, tsconfig.json,
package.json, eslint.config.mjs     Configs do projeto
```

## NÃO está mais no escopo (foi pro dept `worker_supabase`)

```
supabase/migrations/                Migrations — agora dept supabase
supabase/config.toml                Config CLI — agora dept supabase
sql/                                Legado DDL — agora dept supabase
.github/workflows/supabase-deploy.yml  Deploy de migrations — agora dept supabase
```

**Linha de divisão:** SQL = `worker_supabase`. JS chamando SQL = APP.

## Sub-agentes (donos de dashboard)

Para qualquer mudança em código de um dashboard específico, delegue ao agente correspondente:

| Dashboard | Agente | Sub-PRD |
|---|---|---|
| `/sales-volumes` | `worker_dash-sales-volumes` | [sales-volumes.md](sales-volumes.md) |
| `/market-share` | `worker_dash-market-share` | [market-share.md](market-share.md) |
| `/navios-diesel` | `worker_dash-navios-diesel` | [navios-diesel.md](navios-diesel.md) |
| `/diesel-gasoline-margins` | `worker_dash-margins` | [diesel-gasoline-margins.md](diesel-gasoline-margins.md) |
| `/price-bands` | `worker_dash-price-bands` | [price-bands.md](price-bands.md) |
| `/stocks` | `worker_dash-stocks` | [stocks.md](stocks.md) |
| `/news-hunter` | `worker_dash-news-hunter` | [news-hunter.md](news-hunter.md) |
| `/home`, `/profile`, `/admin-panel` | `worker_dash-admin` | [admin.md](admin.md) |

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

## Variáveis de ambiente

```
# .env.local (frontend)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

## Workflow Subgerente: adicionar dashboard novo

Ver `.claude/agents/worker_subgerente-app.md` → seção "Adicionar novo dashboard". Resumo dos 12 passos:

1. Copiar `template-module/` → novo módulo.
2. Entrada no `NavBar.NAV_ENTRIES`.
3. **Solicitar ao `worker_supabase`** migration com tabelas + RPCs + **RLS**. Aguardar.
4. Wrappers JS em `src/lib/rpc.ts`.
5. `INSERT INTO module_visibility` (na migration ou via `worker_dash-admin`).
6. `useModuleVisibilityGuard("<slug>")` na página.
7. **CRIAR `.claude/agents/worker_dash-<slug>.md`** (mantenha o prefixo `worker_`) ← responsabilidade do Subgerente.
8. **CRIAR `docs/app/<slug>.md`** ← sub-PRD.
9. **Disparar `worker_dash-admin`** → toggle de visibilidade + foto na home (memória do CEO).
10. Atualizar `worker_subgerente-app.md` (mapeamento).
11. Atualizar `worker_gerente-geral.md` (sub-agentes).
12. Avisar Documentador → `master.md` + este `PRD.md`.

## Princípios não-negociáveis (TODO dash-* herda)

1. **Nada de rota API para dados do Supabase.** RPCs sempre (criadas pelo dept `worker_supabase`, chamadas via wrappers JS aqui).
2. **Schema é responsabilidade do `worker_supabase`** — APP é consumidor.
3. **Auth guard** em `(dashboard)/layout.tsx` — não duplique.
4. **Visibility guard** — `useModuleVisibilityGuard("<slug>")` em cada módulo.
5. **Wrappers de RPC centralizados** em `src/lib/rpc.ts`.
6. **Idioma da UI:** português.
7. **Identidade visual** consultada via `worker_designer` antes de drift.

## Anti-padrões (deste dept)

- Criar `src/app/api/<rota>` para ler/escrever no Supabase. Use RPC.
- Componente chamando `supabase.rpc(...)` direto — sempre via wrapper.
- Tentar criar/editar migration aqui — peça ao `worker_supabase`.
- UI em inglês.
- Esquecer `useModuleVisibilityGuard` em módulo novo.
- Criar dashboard sem registrar em `module_visibility` ou sem foto na home (memória do CEO).
- Editar componente `src/components/<DashboardEspecifico>` sem ser o `dash-*` dono.

## Contratos com outros departamentos

- **`worker_supabase`** é o dono do schema. Você consome via `supabase-js` + wrappers JS. Mudanças de schema/RPC/RLS solicitadas a ele.
- **ETL** popula tabelas; quando ETL precisa coluna nova, ETL solicita ao `worker_supabase`.
- **Dados Locais** popula `d_g_margins` e `price_bands` via upload manual.
- **Alertas** lê tabelas; mudanças de schema podem quebrar bases.
- **Designer** é consultado antes de mudanças visuais.
