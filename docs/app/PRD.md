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
  api/visitor-id/                   GET handler — expõe cookie HttpOnly sd_visitor_id ao client-side
  (dashboard)/
    layout.tsx                      Tiered auth guard — login opcional; MFA gate Admin-only
    template-module/                Template para criar módulos novos (não é módulo)

src/proxy.ts                        Visitor cookie middleware (Next.js 16 — renomeado de middleware.ts)

src/components/                     Componentes COMPARTILHADOS
  NavBar.tsx                        Config NAV_ENTRIES, dropdown de avatar, Sign in CTA para Anon
  AnonCTA.tsx                       Banner "Sign in to ..." reutilizável para branches read-only
  PlotlyChart.tsx                   Wrapper react-plotly.js
  PeriodSlider.tsx                  rc-slider para range de datas
  CheckList.tsx                     Multi-select com Select All / Clear
  RegionStateFilter.tsx             Filtro cascata Região → UF
  SearchableMultiSelect.tsx         Multi-select com busca
  (Componentes scoped por dashboard NÃO ficam aqui — ficam com o dash-*)

src/context/
  UserProfileContext.tsx            Profile + moduleVisibility + publicVisibility + visitorId + derived role tier

src/hooks/                          Hooks COMPARTILHADOS
  useAutoRefresh.ts
  useModuleVisibilityGuard.ts       3-tier guard (Admin / Client / Anon)
  useRoleGuard.ts
  useDebounce.ts
  (useStockQuote/History/Portfolios.ts são scoped — pertencem a dash-stocks)

src/lib/                            Helpers compartilhados (JS — chamando o que o dept supabase expõe)
  supabaseClient.ts                 Setup do cliente JS (anon key)
  rpc.ts                            Agregador de wrappers JS (cada seção pertence a um dash-*)
  profileRpc.ts                     Wrappers JS de perfil (compartilhado com dash-admin); inclui rpcSetModulePublicVisibility
  tracking.ts                       trackEvent — lê visitorId do context, propaga para track_event RPC
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
| `getAnpCdpExportCount` | `get_anp_cdp_export_count` | `/anp-cdp` |
| `getAnpLpcExportCount` | `get_anp_lpc_export_count` | `/anp-lpc` |

### Tier 1 vs Tier 2 — critério de decisão

| Tier | Critério | UX | Quando usar |
|---|---|---|---|
| **Tier 1** | Dataset < ~50k linhas | Botões diretos no `ExportPanel` | `/navios-diesel`, `/anp-glp`, `/imports-exports`, `/anp-precos-produtores`, `/anp-precos-distribuicao`, `/diesel-gasoline-margins`, `/price-bands` |
| **Tier 2** | Dataset >= ~50k linhas | `ExportPanel mode="modal"` + ExportModal | `/market-share`, `/sales-volumes`, `/anp-cdp`, `/anp-lpc` |

### Como ajustar `AVG_BYTES_PER_ROW` para dataset novo

Adicionar chave em `AVG_BYTES_PER_ROW` em [`exportSizeHeuristics.ts`](../../src/lib/exportSizeHeuristics.ts) com valor empírico (bytes médios por row do dataset). Medir exportando ~1k rows e dividindo pelo tamanho do arquivo resultante.

## Dual-view foundation (Fase 1 — 2026-05)

A partir de 2026-05-20, todo dashboard passa a ter **duas views** — desktop (≥769px) e mobile (≤768px) — dirigidas por um **único hook compartilhado** que detém toda a lógica de dados, filtros e derivações.

> Mobile é **"mesma análise, roupagem adaptada"** — nunca um cérebro diferente. Se uma View precisa de um valor que a outra não tem, primeiro você adiciona ao hook; ambas as Views passam a enxergar.

A política completa está em [`CLAUDE.md` § Dual-view (web + mobile) policy](../../CLAUDE.md). O template copiável para `worker_dash-*` está em [`docs/app/dual-view-pattern.md`](dual-view-pattern.md). Os 6 mockups mobile aprovados estão em `mockups/*-mobile.html`.

### Estrutura canônica por dashboard

```
src/app/(dashboard)/<slug>/
├── page.tsx                 ← viewport router (useIsMobile → desktop ou mobile)
├── use<Slug>Data.ts         ← O CÉREBRO — RPCs, filtros, derivações, types
├── desktop/View.tsx         ← UX desktop (existente migra pra cá)
└── mobile/View.tsx          ← UX mobile (mobile-first, redesenhada do zero)
```

### Contrato do hook compartilhado

Toda `use<Slug>Data` exporta exatamente esta forma:

```ts
{
  data: <RowShape>[],
  loading: boolean,
  error: Error | null,
  filters: <Filters>,
  setFilters: (next: Partial<<Filters>>) => void,
}
```

TypeScript propaga essa shape para as duas Views — drift estrutural de dados entre desktop e mobile é **impossível por construção**.

### Regra de sync (enforcement)

Toda mudança significativa em uma View exige mudança equivalente na OUTRA no **mesmo commit**, OU o commit message declara `[desktop-only]` / `[mobile-only]` com justificativa explícita. Detalhe da matriz em [`dual-view-pattern.md` § 6](dual-view-pattern.md#6-binding-sync-rule-enforcement).

Três camadas de enforcement:
1. **TypeScript** — hook propaga tipos pras duas Views; drift estrutural é erro de compilação.
2. **`worker_revisor-qa`** — audita diff pré-commit das Views.
3. **`worker_documentador`** — audita `docs/app/<slug>.md` ↔ ambas as Views periodicamente.

### Infra compartilhada construída na Fase 1 (deste departamento)

| Arquivo | Propósito |
|---|---|
| [`src/hooks/useIsMobile.ts`](../../src/hooks/useIsMobile.ts) | Detector de viewport (SSR-safe, threshold 768px). **Fonte única do breakpoint do app.** |
| [`public/manifest.json`](../../public/manifest.json) | PWA manifest — name SectorData, theme `#ff5000`, display standalone, start_url `/home`, ícones 192×192 e 512×512. |
| [`public/sw.js`](../../public/sw.js) | Service worker mínimo — habilita Add-to-Home-Screen. **NÃO faz cache de dados de negócio** (sem offline mode por design). |
| [`src/components/PWAInstallPrompt.tsx`](../../src/components/PWAInstallPrompt.tsx) | Banner dismissível "Install SectorData on your phone" — mobile-only, dismissal persistido em localStorage. Wired em `(dashboard)/layout.tsx`. |
| [`src/components/ServiceWorkerRegister.tsx`](../../src/components/ServiceWorkerRegister.tsx) | Registra `/sw.js` após mount (só em produção). Mounted no root `app/layout.tsx`. |
| [`src/app/(dashboard)/template-module/`](../../src/app/(dashboard)/template-module/) | Template canônico dual-view (`page.tsx` + `useTemplateModuleData.ts` + `desktop/View.tsx` + `mobile/View.tsx`). |

### Infra compartilhada construída em paralelo pelo `worker_designer`

`src/components/dashboard/mobile/` — 8 componentes mobile compartilhados:
- `MobileNavBar`, `BottomSheet`, `FilterDrawer`, `MobileChart`, `MobileDataCard`, `StickyBreadcrumb`, `ExportFAB`, `MobileTabBar`.

Esses componentes ficam no domínio do `worker_designer` e são montados pelos `worker_dash-*` quando refatoram cada dashboard na Fase 2.

### Fase 2 — refactor por dashboard (não executar agora)

Cada `worker_dash-*` é responsável por refatorar o seu próprio dashboard para o pattern dual-view. Receita em [`dual-view-pattern.md` § 8](dual-view-pattern.md#8-migration-recipe-existing-dashboard--dual-view). Ordem sugerida: priorizar primeiro os 6 dashboards com mockup mobile aprovado (`home`, `market-share`, `navios-diesel`, `news-hunter`, `stocks`, `anp-cdp`).

## Anonymous access — login opcional, 3-tier visibility (2026-05-22)

A partir da migration `20260522000001_anonymous_access.sql`, o app aceita visitantes anônimos. Três tiers compartilham a mesma infra do APP:

| Tier | Auth state | Visibilidade controlada por |
|---|---|---|
| **Anon** | Sem `supabase.auth.session()` | `module_visibility.is_visible_for_public` |
| **Client** | `profiles.role='Client'` | `module_visibility.is_visible_for_clients` |
| **Admin** | `profiles.role='Admin'` + AAL2 (MFA) | sempre visível |

**Infra compartilhada construída para suportar anon:**

| Arquivo | Função |
|---|---|
| [`src/proxy.ts`](../../src/proxy.ts) | Next.js 16 renomeou `middleware.ts` → `proxy.ts`. Emite cookie HttpOnly `sd_visitor_id` (UUID v4, SameSite=Lax, Secure, Max-Age 1 ano) para visitantes não-bot. Echo no header `x-sd-visitor-id` para SSR ler sem re-parse. Matcher exclui `/api`, `/_next`, `/favicon`, `/icon`, `/.well-known`. UA regex `/bot\|crawler\|spider\|crawling\|slurp/i` não recebe cookie. |
| [`src/app/api/visitor-id/route.ts`](../../src/app/api/visitor-id/route.ts) | GET handler retornando `{ visitorId }` do cookie HttpOnly — única forma do client-side ler o valor (HttpOnly = `document.cookie` invisível). |
| [`src/components/AnonCTA.tsx`](../../src/components/AnonCTA.tsx) | Banner compartilhado "Sign in to ..." com props `message`, `ctaText`, link para `/login`. Consumido por `/stocks` (read-only public portfolio), `/news-hunter` (default keywords) e qualquer dashboard futuro com branch anon. **Owned pelo `worker_subgerente-app`** — `worker_dash-*` apenas consomem. |
| [`src/context/UserProfileContext.tsx`](../../src/context/UserProfileContext.tsx) | Aceita `profile=null` (anon). Campos novos: `role: 'Admin' \| 'Client' \| 'Anon'` (derivado), `publicVisibility: Record<string, boolean>` (do RPC atualizado), `visitorId: string \| null` (lido via `/api/visitor-id` no mount). |
| [`src/hooks/useModuleVisibilityGuard.ts`](../../src/hooks/useModuleVisibilityGuard.ts) | 3 branches: Admin → sempre `visible=true`; Anon → checa `publicVisibility[slug]`; Client → checa `moduleVisibility[slug]`. Default `true` em chave ausente (safe degradation). Redirect target: `/home`. |
| [`src/app/(dashboard)/layout.tsx`](../../src/app/(dashboard)/layout.tsx) | Auth guard reescrito: **sem redirect mandatório** para Anon. MFA gate (`getAuthenticatorAssuranceLevel()`) só roda quando há `session` E `profile.role='Admin'`. Page-view tracking passa `visitorId` quando Anon. |
| [`src/components/NavBar.tsx`](../../src/components/NavBar.tsx) | Items filtrados por role: Anon → só `is_visible_for_public`; Client → só `is_visible_for_clients`; Admin → tudo. Canto superior direito: `<Link href="/login">Sign in</Link>` quando Anon; avatar/dropdown quando logado. "My Profile" / "Admin Panel" só renderizam para logados. |
| [`src/lib/tracking.ts`](../../src/lib/tracking.ts) | `trackEvent` lê `visitorId` do context e passa como 4o arg do RPC `track_event`. Fire-and-forget — falha silenciosa se ambos `auth.uid()` e `visitorId` são NULL (acontece em SSR/bot — não quebra UX). |
| [`src/app/(dashboard)/profile/page.tsx`](../../src/app/(dashboard)/profile/page.tsx) | `useEffect` — se `role==='Anon'` → `router.replace('/login')`. Profile é per-user only; visitantes não têm onde editar. |

**Componente compartilhado para CTA de upgrade** — `AnonCTA.tsx` é a única forma de mostrar "Sign in to ..." dentro de um dashboard. Não duplique inline.

**Regra G (CLAUDE.md) — coordenação de paralelismo:** `worker_subgerente-app` cria `AnonCTA.tsx` na Fase B; `worker_dash-stocks` e `worker_dash-news-hunter` NÃO criam o arquivo na Fase C — apenas importam como dependência futura.

**Cookie namespacing:** sempre `sd_*` para cookies do app. `sb-*` é reservado pelo Supabase Auth — colidir confunde a chain de SSR auth. Ver `docs/supabase/PRD.md` § "Pegadinhas — anonymous access".

**3-tier guard checklist para dashboard novo:**

1. `useModuleVisibilityGuard("<slug>")` já cobre os 3 tiers automaticamente — não precisa de branches por role no dash.
2. Se o dashboard tem branch anon-leve (ex: portfolio default público, keywords default), o hook expõe `readOnly: boolean` e a View renderiza `<AnonCTA />` em vez de UI de CRUD.
3. `/profile` redirect anon → `/login` é o padrão para qualquer dashboard per-user (sem fallback público).
4. Page-view tracking via `trackEvent` continua transparente — `tracking.ts` resolve visitor_id automaticamente.

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
| `/anp-precos-produtores` | `worker_dash-anp-precos-produtores` | [anp-precos-produtores.md](anp-precos-produtores.md) |
| `/anp-glp` | `worker_dash-anp-glp` | [anp-glp.md](anp-glp.md) |
| `/anp-lpc` | `worker_dash-anp-lpc` | [anp-lpc.md](anp-lpc.md) |
| `/imports-exports` | `worker_dash-imports-exports` (substitui os 3 retirados em 2026-05-25: `/anp-daie`, `/anp-desembaracos`, `/anp-painel-importacoes`) | [imports-exports.md](imports-exports.md) |
| `/anp-precos-distribuicao` | `worker_dash-anp-precos-distribuicao` | [anp-precos-distribuicao.md](anp-precos-distribuicao.md) |
| `/anp-cdp-diaria` | `worker_dash-anp-cdp-diaria` | [anp-cdp-diaria.md](anp-cdp-diaria.md) |

### Dashboards adicionados na Fase 3 (categoria NavBar / tabela alvo)

| Slug | Categoria NavBar | Tabela alvo (linhas) |
|---|---|---|
| `anp-cdp` | Oil & Gas | `anp_cdp_producao` (~1.8M) |
| `anp-precos-produtores` | Fuel Distribution | `anp_precos_produtores` (~38k) |
| `anp-glp` | Fuel Distribution | `anp_glp` (~3k) |
| `anp-lpc` | Fuel Distribution | `anp_lpc` (~30k) |
| `imports-exports` | Fuel Distribution | `anp_desembaracos` (enriquecida com `importador`/`cnpj`/`uf_cnpj` em 2026-05-25 — `~6k` + backfill pós-reforma) + `anp_daie` (`~7k`). Aux tables: `imports_product_map`, `importer_group_map` (vazia até T11), `ncm_densidade_kg_m3`. Migration: `20260525000010_imports_exports_enrichment.sql`. Consolida os 3 retirados: `/anp-daie`, `/anp-desembaracos`, `/anp-painel-importacoes` (tabela `anp_painel_imp_dist` DROPPED). |
| `anp-precos-distribuicao` | Fuel Distribution | `anp_precos_distribuicao` (volume a crescer) |
| `anp-cdp-diaria` | Oil & Gas | `anp_cdp_diaria` (~16.5k — Field), `anp_cdp_diaria_instalacao` (~16.3k — Installation), `anp_cdp_diaria_poco` (~180.7k — Well). 3 níveis de granularidade via `SegmentedToggle` (Field / Installation / Well). Histórico desde 2025-11-09. |

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
| 4 (Fase 3) | `anp-cdp`, `anp-precos-produtores`, `anp-glp`, `anp-lpc`, `imports-exports` | Dashboards mais novos — já têm padrões consolidados; aplicar incrementalmente. `imports-exports` substitui o trio `anp-daie` + `anp-desembaracos` + `anp-painel-importacoes` retirado em 2026-05-25 e absorveu `/mdic-comex` no mesmo dia via Panel C. |

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

## Hardenings de segurança P0 (2026-05-14)

Três hardenings P0 aplicados antes do go-live para clientes externos (plano completo em `C:\Users\eduar\.claude\plans\o-app-est-em-unified-wilkinson.md`).

### F1.1 — Next.js 16.2.1 → 16.2.6

Bump via `npm audit fix --force`. Resolve 14 CVEs do Next.js (entre eles GHSA-c4j6-fc7j-m34r SSRF, GHSA-gx5p-jg67-6x7h XSS, GHSA-h64f-5h5j-jqjh DoS de Image Optimization). `npm audit` agora não reporta nenhum issue high/critical (sobram 2 moderate em `postcss` interno do Next — não acionáveis sem downgrade catastrófico).

### F1.2 — Security headers HTTP

Função `async headers()` em `next.config.ts` aplica a todas as respostas (`source: '/(.*)'`):

- `Content-Security-Policy` — `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.plot.ly` (Plotly injeta inline scripts + Function() — `unsafe-inline`/`unsafe-eval` são necessários). TODO futuro: migrar para nonces.
- `Strict-Transport-Security` — `max-age=63072000; includeSubDomains; preload` (2 anos).
- `X-Frame-Options: DENY` + `frame-ancestors 'none'` — clickjacking impossível.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` — desabilita camera, microphone, geolocation, payment.

Allowlist do `connect-src` cobre `*.supabase.co` (REST + WS) e `query1/query2.finance.yahoo.com` (proxy do `/api/stocks/*`).

### F1.3 — Rate limit em API routes próprias

Helper em `src/lib/rateLimit.ts` exporta três limiters (`stocksLimiter`, `scrapeLimiter`, `uploadLimiter`) baseados em `@upstash/ratelimit` + `@upstash/redis`. Fallback gracioso: se `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` não estiverem setadas, os limiters viram `null` e o rate limit é skipado (dev local). Em produção (Vercel), CTO cria as env vars.

| Rota | Limiter | Identifier |
|---|---|---|
| `/api/stocks/quote` | 60/min | IP (`x-forwarded-for`) |
| `/api/stocks/history` | 60/min | IP |
| `/api/stocks/search` | 60/min | IP |
| `/api/stocks/futures-curve` | 60/min | IP |
| `/api/stocks/period-returns` | 60/min | IP |
| `/api/clipping/scrape` | 10/min | `user.id` (auth obrigatório; fallback IP) |
| `/api/upload-card-preview` | 20/hora | `user.id` (auth obrigatório; fallback IP) |

Resposta 429 inclui `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

### F2.1 — Password policy (12 chars + zxcvbn)

Política centralizada em [`src/lib/passwordPolicy.ts`](../../src/lib/passwordPolicy.ts):

- `MIN_LENGTH = 12` — mínimo absoluto de caracteres.
- `MIN_SCORE = 3` — entropia mínima via `zxcvbn` (escala 0–4; 3 = "Good", 4 = "Strong").
- `checkStrength(password)` retorna `{ ok, score, message, suggestions[] }` — consumido por qualquer formulário que defina/altere senha.
- `scoreLabel(score)` mapeia `0..4` → `"Very weak" | "Weak" | "Fair" | "Good" | "Strong"`.

Consumidores atuais:
- `src/app/reset-password/page.tsx` — bloqueia submit se `!strength.ok`; exibe meter visual (`progress-bar` vermelho/amarelo/verde) + sugestões do zxcvbn em tempo real (`useMemo` recalcula a cada keystroke).

> **Enforcement backend (CTO action item):** a validação client-side é UX, não enforcement. O backend tem que repetir a regra. CTO deve configurar manualmente em **Supabase Dashboard → Authentication → Policies → Password Requirements**:
> - Min Length: 12
> - Require lowercase / uppercase / digits / special chars (recomendado)
> - Reject common passwords (built-in)
>
> Sem isso, um atacante via API direta consegue setar senha fraca.

### F3.1 — TOTP MFA (Admin mandatório, Client opcional)

App passou a aceitar clientes externos; Admin tem blast radius alto (promoção de roles e visibility de módulos). Por isso, MFA TOTP é exigido para Admin e oferecido como opt-in para Client.

#### Pre-requisito (CTO)

Supabase Dashboard → Authentication → Multi-Factor Auth → ligar TOTP provider. Sem isso, `supabase.auth.mfa.enroll` falha em runtime.

#### Frontend

| Arquivo | Função |
|---|---|
| [`src/components/MfaChallenge.tsx`](../../src/components/MfaChallenge.tsx) | Componente de challenge — recebe `factorId`, chama `mfa.challenge` + `mfa.verify` |
| [`src/app/(dashboard)/profile/mfa/page.tsx`](../../src/app/(dashboard)/profile/mfa/page.tsx) | Página de enrollment (QR + secret + verify) e disable |
| [`src/app/login/page.tsx`](../../src/app/login/page.tsx) | Após `signInWithPassword`, se há factor verificado e a sessão não está em AAL2, renderiza `MfaChallenge` antes de redirecionar |
| [`src/app/(dashboard)/layout.tsx`](../../src/app/(dashboard)/layout.tsx) | Auth guard agora checa `getAuthenticatorAssuranceLevel()`; se `nextLevel='aal2'` && `currentLevel!='aal2'` → redirect `/login` |
| [`src/hooks/useRoleGuard.ts`](../../src/hooks/useRoleGuard.ts) | Admin sem factor → `/profile/mfa`; Admin com factor mas sem AAL2 → `/login` |
| [`src/app/(dashboard)/profile/page.tsx`](../../src/app/(dashboard)/profile/page.tsx) | Seção "Security" linkando para `/profile/mfa` |

#### Backend (migration `20260514120000_mfa_admin_required.sql`)

- `public.has_verified_mfa(uuid)` — boolean helper (SECURITY DEFINER, lê `auth.mfa_factors`).
- `public.require_admin_mfa()` — raise `28000` se caller é Admin sem factor verificado.
- `set_user_role`, `set_module_visibility`, `set_module_home_visibility` — chamam `require_admin_mfa()` antes de qualquer mutation. Audit trail F2.2 preservado.

Clients **não** são bloqueados em nenhum RPC; MFA é apenas defesa adicional opcional.

## Padrões consolidados na Fase 3 (referência para futuros dashboards)

A Fase 3 entregou 9 dashboards (ANP CDP, PPI, Preços Produtores, GLP, MDIC Comex, ANP LPC, DAIE, Desembaraços, Painel Importações) e cristalizou os seguintes padrões. Use como checklist ao criar dashboard novo. (Nota: o trio DAIE / Desembaraços / Painel Importações foi consolidado em `/imports-exports` em 2026-05-25, e `/mdic-comex` foi absorvido pelo mesmo dashboard via Panel C "Import Price" no mesmo dia — os 4 sub-PRDs antigos foram movidos para `docs/app/_deprecated/`.)

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
