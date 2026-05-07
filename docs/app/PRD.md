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
  exportExcel.ts                    Export ExcelJS — downloadGenericExcel<T> (Tier 1) + wrappers específicos
  exportCsv.ts                      downloadCsv<T> único RFC4180 (substitui inline duplicado)
  exportSizeHeuristics.ts           estimateSize(rows, datasetKey), formatBytes(b), AVG_BYTES_PER_ROW map

src/types/                          Tipos compartilhados (tipos scoped ficam com dash-*)

public/                             Assets estáticos (logos, previews)
.vercel/                            Config de deploy
next.config.ts, tsconfig.json,
package.json, eslint.config.mjs     Configs do projeto
```

## Export padronizado (Fase B — 2026-05)

### Componentes em `src/components/dashboard/`

| Componente | Uso |
|---|---|
| [`ExportPanel.tsx`](../../src/components/dashboard/ExportPanel.tsx) | Botões declarativos `actions[]` com `kind=excel\|csv`. Para Tier 2: aceita `mode="modal"` numa action para abrir ExportModal. |
| [`ExportModal.tsx`](../../src/components/dashboard/ExportModal.tsx) | Modal Bootstrap com slot de filtros ativos + calculadora live "X MB · Y linhas" + warning >200k linhas. Usado exclusivamente por Tier 2. |

### Hooks e libs compartilhados

| Arquivo | Descrição |
|---|---|
| [`src/hooks/useExportSize.ts`](../../src/hooks/useExportSize.ts) | Chama RPC `get_*_export_count` com debounce 300ms; retorna `{ bytes, rows, label }` para o ExportModal |
| [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts) | `downloadCsv<T>(opts)` — helper único RFC4180 (substituiu duplicatas em market-share e price-bands) |
| [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts) | `downloadGenericExcel<T>` — função canônica única (aceita `key: keyof T` ou `value: (row: T) => unknown`, `mergeTitleCells?: boolean`, alias `numFmt` para `format`). Wrappers Tier 2 que chamam internamente: `downloadMdicComexExcel`, `downloadAnpCdpExcel`, `downloadAnpLpcExcel`. Handlers especiais (OOXML/custom): `downloadMarketShareExcel`, `downloadSalesVolumesExcel`, `downloadDgMarginsExcel`, `downloadPriceBandsExcel`. |
| [`src/lib/exportSizeHeuristics.ts`](../../src/lib/exportSizeHeuristics.ts) | `estimateSize(rows, datasetKey)`, `formatBytes(b)`, `AVG_BYTES_PER_ROW` (constantes empíricas por dataset) |

### RPC wrappers em `src/lib/rpc.ts` (usados pelo ExportModal via useExportSize)

| Wrapper | RPC | Dashboards |
|---|---|---|
| `getMsExportCount` | `get_ms_export_count` | `/market-share`, `/sales-volumes` |
| `getMdicComexExportCount` | `get_mdic_comex_export_count` | `/mdic-comex` |
| `getAnpCdpExportCount` | `get_anp_cdp_export_count` | `/anp-cdp` |
| `getAnpLpcExportCount` | `get_anp_lpc_export_count` | `/anp-lpc` |

### Tier 1 vs Tier 2 — critério de decisão

| Tier | Critério | UX | Quando usar |
|---|---|---|---|
| **Tier 1** | Dataset < ~50k linhas | Botões diretos no `ExportPanel` | `/navios-diesel`, `/anp-glp`, `/anp-daie`, `/anp-desembaracos`, `/anp-precos-produtores`, `/sindicom`, `/anp-ppi`, `/anp-painel-importacoes`, `/diesel-gasoline-margins`, `/price-bands` |
| **Tier 2** | Dataset >= ~50k linhas | `ExportPanel mode="modal"` + ExportModal | `/market-share`, `/sales-volumes`, `/mdic-comex`, `/anp-cdp`, `/anp-lpc` |

### Como ajustar `AVG_BYTES_PER_ROW` para dataset novo

Adicionar chave em `AVG_BYTES_PER_ROW` em [`exportSizeHeuristics.ts`](../../src/lib/exportSizeHeuristics.ts) com valor empírico (bytes médios por row do dataset). Medir exportando ~1k rows e dividindo pelo tamanho do arquivo resultante.

## NÃO está mais no escopo (foi pro dept `worker_supabase`)

```
supabase/migrations/                Migrations — agora dept supabase
supabase/config.toml                Config CLI — agora dept supabase
sql/                                Legado DDL — agora dept supabase
.github/workflows/supabase_deploy.yml  Deploy de migrations — agora dept supabase
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
| `/anp-cdp` | `worker_dash-anp-cdp` | [anp-cdp.md](anp-cdp.md) |
| `/anp-ppi` | `worker_dash-anp-ppi` | [anp-ppi.md](anp-ppi.md) |
| `/anp-precos-produtores` | `worker_dash-anp-precos-produtores` | [anp-precos-produtores.md](anp-precos-produtores.md) |
| `/anp-glp` | `worker_dash-anp-glp` | [anp-glp.md](anp-glp.md) |
| `/mdic-comex` | `worker_dash-mdic-comex` | [mdic-comex.md](mdic-comex.md) |
| `/anp-lpc` | `worker_dash-anp-lpc` | [anp-lpc.md](anp-lpc.md) |
| `/sindicom` | `worker_dash-sindicom` | [sindicom.md](sindicom.md) |
| `/anp-daie` | `worker_dash-anp-daie` | [anp-daie.md](anp-daie.md) |
| `/anp-desembaracos` | `worker_dash-anp-desembaracos` | [anp-desembaracos.md](anp-desembaracos.md) |
| `/anp-painel-importacoes` | `worker_dash-anp-painel-importacoes` | [anp-painel-importacoes.md](anp-painel-importacoes.md) |

### Dashboards adicionados na Fase 3 (categoria NavBar / tabela alvo)

| Slug | Categoria NavBar | Tabela alvo (linhas) |
|---|---|---|
| `anp-cdp` | Oil & Gas | `anp_cdp_producao` (~1.8M) |
| `anp-ppi` | Fuel Distribution | `anp_ppi` (~18k) |
| `anp-precos-produtores` | Fuel Distribution | `anp_precos_produtores` (~38k) |
| `anp-glp` | Fuel Distribution | `anp_glp` (~3k) |
| `mdic-comex` | Fuel Distribution | `mdic_comex` (~1.2k) |
| `anp-lpc` | Fuel Distribution | `anp_lpc` (~30k) |
| `sindicom` | Fuel Distribution | `sindicom` (0 — pendente Cloudflare) |
| `anp-daie` | Fuel Distribution | `anp_daie` (~7k) |
| `anp-desembaracos` | Fuel Distribution | `anp_desembaracos` (~6k) |
| `anp-painel-importacoes` | Fuel Distribution | `anp_painel_imp_dist` (~1.4k) |

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
- **Workflow `supabase_deploy.yml`** é deste dept — deploya migrations em push para `main`.

## Schema do Supabase (overview)

Schema completo é responsabilidade compartilhada — cada `dash-*` documenta as tabelas/RPCs específicas no seu sub-PRD. Aqui só a visão de cima:

| Tabela | Dono lógico | Populada por |
|---|---|---|
| `vendas` | dash-sales-volumes / dash-market-share | ETL (`pipelines/anp/vendas_watch.py`) |
| `mv_ms_serie`, `mv_ms_serie_fast` | dash-sales-volumes / dash-market-share | Função `classificar_agentes()` |
| `navios_diesel` | dash-navios-diesel | ETL (`pipelines/navios/01_lineup_scrape.py` → `02_diesel_import.mjs`) |
| `vessel_registry`, `vessel_positions`, `port_arrivals`, `import_candidates` | dash-navios-diesel | ETL (`pipelines/ais/*`, `pipelines/navios/03-05`) |
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

## Definition of Done (mandatório para qualquer dashboard novo ou refatorado)

> **Por que existe esta seção:** dois bugs caros — `/anp-daie` com fator 1000 errado e `/sales-volumes` com RPCs ausentes — passaram batido em prod por meses porque "tsc clean" foi tratado como "pronto". Smoke test visual nunca foi feito. Daqui pra frente, antes de marcar uma tarefa de dashboard como completa, valide os 5 critérios abaixo. Os critérios são exatamente os do template canônico em [`docs/app/_template.md`](_template.md) — esta seção apenas torna obrigatória a aplicação.

1. **`npx tsc --noEmit` clean** — zero erros (warnings de `<img>` pré-existentes podem ser tolerados; warnings novos não).
2. **`npx eslint src/app/(dashboard)/<slug>` clean** — só warnings pré-existentes.
3. **Smoke test em dev server** (`preview_start` + `preview_screenshot`):
   - Página carrega sem erros no console.
   - Filtros populam com options reais (não vazio).
   - Pelo menos 1 chart renderiza com dados (após selecionar 1 filtro).
   - Period slider mostra range correto.
4. **Self-QA estática**: comparado com 2 dashboards maduros (sugestão: `/anp-cdp` e `/sales-volumes`); padrões consolidados batem (header, debounce, loading, multi-select, etc.).
5. **Sub-PRD (`docs/app/<slug>.md`) atualizado** se a tarefa ganhou nova RPC, coluna, chart, filtro ou mudou unidade/divisor.

**Quem aplica:** todo `worker_dash-*` antes de retornar "task completa" ao Subgerente. **Quem audita:** Subgerente APP — pede evidência (screenshot do smoke test, output de `tsc`, link para sub-PRD atualizado) antes de aceitar a entrega. Sem evidência dos 5 itens, a entrega volta pro `dash-*` para completar.

## Migration: try/catch silencioso → useRpcResult / DataErrorBoundary

> **Por que existe esta seção:** o padrão histórico de cada dashboard é `try { setData(await rpc()); } catch { setData([]); }`. Esse `catch` silencioso fez `/sales-volumes` ficar meses em produção retornando array vazio sem que ninguém percebesse. A infraestrutura nova (preparada na sessão de 2026-05-06) substitui esse padrão por feedback explícito ao usuário.

**Infra disponível** (já criada — não é tarefa para os `worker_dash-*` mexerem):

- **`src/hooks/useRpcResult.ts`** — `useRpcResult<T>(fetcher, deps, fallback)` retorna `{ data, loading, error, refetch }`. Mantém `data: fallback` para a UI continuar funcional, mas expõe `error` para o boundary mostrar.
- **`src/components/dashboard/DataErrorBoundary.tsx`** — card vermelho (`#dc3545`) com mensagem "Erro ao carregar dados", detalhe técnico (em dev: `error.message`; em prod: hint para console) e botão "Tentar novamente" se `retry` for fornecido.

**Como migrar um dashboard** (referência para os `worker_dash-*`):

```tsx
// ANTES — silencia falha
const [data, setData] = useState<Row[]>([]);
useEffect(() => {
  rpcGetSerie(period)
    .then((r) => setData(r ?? []))
    .catch((e) => { console.warn(e); setData([]); });
}, [period]);

return <Chart data={data} />;

// DEPOIS — falha visível, com retry
const { data, loading, error, refetch } = useRpcResult<Row[]>(
  () => rpcGetSerie(period),
  [period],
  [],
);

return (
  <DataErrorBoundary error={error} loading={loading} retry={refetch}>
    <Chart data={data} />
  </DataErrorBoundary>
);
```

**Ordem de prioridade da migração** (sugestão por volume de uso — Subgerente confirma com Gerente Geral antes de disparar cada onda):

| Onda | Dashboards | Justificativa |
|---|---|---|
| 1 (alta prioridade) | `sales-volumes`, `market-share`, `navios-diesel` | Mais usuários ativos. Bugs silenciosos são caros aqui. |
| 2 (média) | `diesel-gasoline-margins`, `price-bands`, `stocks` | Fluxo Market Watch — usuários executivos. |
| 3 (baixa) | `news-hunter`, `home`/`profile`/`admin-panel` | Fluxos administrativos / passivos. |
| 4 (Fase 3) | `anp-cdp`, `anp-ppi`, `anp-precos-produtores`, `anp-glp`, `mdic-comex`, `anp-lpc`, `sindicom`, `anp-daie`, `anp-desembaracos`, `anp-painel-importacoes` | Dashboards mais novos — já têm padrões consolidados; aplicar incrementalmente. |

**Regras de migração:**

- Cada `worker_dash-*` migra o seu dashboard de forma incremental (não tem que ser tudo de uma vez — pode ser uma RPC por commit).
- `useRpcResult` substitui `try { ... } catch { setData([]) }`. Não substitui `useDebouncedFetch` para fetches reativos a filtros — esse continua sendo o padrão para input-driven; apenas adicione tratamento de erro composto se for usar.
- Após migrar, adicione no sub-PRD (`docs/app/<slug>.md`, seção "Padrões consolidados aplicados"): `[x] Error boundary para falhas de RPC`.
- Não migrar e ignorar o erro silenciosamente nunca mais — é anti-padrão a partir desta data.

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
- **Wrappers de RPC em `src/lib/rpc.ts` NUNCA devem `return 0` (ou `return []`) em erro.** O padrão correto é `throw error` — o cliente captura via `useRpcResult` / `DataErrorBoundary` e exibe mensagem visível ao usuário. Anti-pattern documentado no incidente Export (2026-05-07): wrappers `get*ExportCount` silenciavam erro 42883 (function does not exist) como "0 linhas no modal" por dias. Após fix em `f2537cb2`, todos os wrappers de export count fazem `throw`.

## Contratos com outros departamentos

- **`worker_supabase`** é o dono do schema. Você consome via `supabase-js` + wrappers JS. Mudanças de schema/RPC/RLS solicitadas a ele.
- **ETL** popula tabelas; quando ETL precisa coluna nova, ETL solicita ao `worker_supabase`.
- **Dados Locais** popula `d_g_margins` e `price_bands` via upload manual.
- **Alertas** lê tabelas; mudanças de schema podem quebrar bases.
- **Designer** é consultado antes de mudanças visuais.

## Padrões consolidados na Fase 3 (referência para futuros dashboards)

A Fase 3 entregou 10 dashboards (ANP CDP, PPI, Preços Produtores, GLP, MDIC Comex, ANP LPC, SINDICOM, DAIE, Desembaraços, Painel Importações) e cristalizou os seguintes padrões. Use como checklist ao criar dashboard novo:

1. **Header** — `page-header-title` + `page-header-sub` + `<hr>` (`border-top: 2px solid #e0e0e0`) + period badge condicional.
2. **Push de período para server-side** — passar ANO ou DATE pra RPC (`p_ano_inicio/p_ano_fim` ou `p_data_inicio/p_data_fim`); evita filtrar volumes grandes no cliente.
3. **Debounce 400ms** via `useCallback` + `useRef` em todos os fetches reativos a filtros.
4. **Loading discreto** — barrel só no init; nos refetches usar `serieLoading`/`topLoading` inline (`atualizando…`) com `opacity: 0.5` no chart.
5. **Filtros multi-select** — botão "Limpar" + counter `(N/total)` em cinza `#888`.
6. **`yearTuple = useMemo<[number, number]>`** ref-stable para evitar refetches espúrios disparados por nova identidade de array.
7. **Empty state amigável** (card central) quando tabela vazia ou filtros sem resultado.
8. **Section-title extraído do layout do Plotly** — permite indicador "atualizando…" no header da seção.
9. **Coerência divisor/unidade** — divisor matemático e label de unidade têm que casar (lição: bug de fator 1000 no `anp-daie`).
10. **Locale-aware capitalize** — `toLocaleLowerCase("pt-BR")` para nomes com acento.

## Próximas Fases (roadmap)

### Fase 4 — Extração de componentes compartilhados (proposta, não executar agora)

Os 10 dashboards da Fase 3 evidenciaram duplicação substancial. Estimativa: **~1.500 linhas removidas** após extração. Candidatos:

- `<DashboardHeader>` — encapsula o padrão header (título + sub + hr + period badge).
- `<MultiSelectFilter>` — multi-select com botão Limpar e counter `(N/total)` (substitui boilerplate).
- `<PeriodSlider>` — promover slider de período para componente verdadeiramente compartilhado (hoje há variantes locais).
- `<ChartSection>` — wrapper que extrai o section-title do layout do Plotly e exibe indicador "atualizando…".
- `useDebouncedFetch` — hook que encapsula o padrão `useCallback` + `useRef` + 400ms.
- `plotlyDefaults.ts` — defaults de layout/config do Plotly (cores, fontes, locale, modeBar).
- **Branded types para unidades** (`type Liters = number & { __brand: "Liters" }`) — força conversão explícita; previne o bug de fator 1000.

Antes de iniciar a Fase 4, validar com Designer que o `<DashboardHeader>` cobre 100% das variações visuais já aprovadas.
