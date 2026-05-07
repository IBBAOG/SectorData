# Sub-PRD — `/admin-analytics`

> Owner: `worker_dash-admin` (bundled — não tem `worker_dash-admin-analytics` separado).
> Stack: Next.js 16 + Plotly.js + Bootstrap.
> Auth: **Admin-only** via `useRoleGuard("Admin")`.
> Status: Fase 5 (telemetria) — instrumentação + painel.

## 1. Escopo

Painel interno de telemetria: quem usa o quê, quando, com qual frequência. Cobre 3 famílias de eventos coletados pelo helper `src/lib/tracking.ts` em `app_events`:

| event_type | Disparado por | Fonte |
|---|---|---|
| `login` | `(dashboard)/layout.tsx` (1 vez por sessão Supabase) | sessionStorage gate |
| `page_view` | `(dashboard)/layout.tsx` (a cada `usePathname()` change) | exclui `/login`, `/profile`, `/admin-panel`, `/admin-analytics` |
| `export` | `ExportPanel` (Tier 1) e `ExportModal` (Tier 2) | callback automático após download bem-sucedido; payload inclui `format`, `rows`, `bytes` |

## 2. Decisões de design

- **NÃO está em `module_visibility`.** É Admin-only sempre. Não tem toggle por cliente.
- **NÃO tem imagem na home.** A regra "todo módulo novo precisa de visibility + home image" não se aplica porque a página não é exibida a Clients (eles são redirecionados para `/home` em `useRoleGuard("Admin")`).
- **NÃO está em `NAV_ENTRIES`.** O acesso é via:
  1. Dropdown do usuário no NavBar (item "Admin Panel" leva ao `/admin-panel`).
  2. Banner "Analytics dashboard" no topo de `/admin-panel`.
- **Excluído do próprio tracking** — `(dashboard)/layout.tsx` lista a rota em `TRACKING_EXCLUDED_ROUTES` para que admins não poluam as métricas que estão analisando.

## 3. Layout

| # | Seção | UI |
|---|---|---|
| 1 | Filtro de período (topo) | Toggle pílula `7 dias` / `30 dias` / `90 dias` + dropdown de janelas longas (`180 dias` / `365 dias` / `730 dias` / `1825 dias`). Default 30. As pílulas e o dropdown controlam um único estado `periodDays int`. Ao selecionar uma opção do dropdown a pílula fica inativa (nenhuma ativa); ao clicar numa pílula o dropdown volta ao placeholder. |
| 2 | KPIs | 4 cards grandes (DAU, WAU, MAU, Active no período) + 3 cards pequenos (Page views, Exports, Logins do período). |
| 3 | Engajamento por dashboard | Tabela sortable. Default DESC por `page_views`. Colunas: Rota, Page views, Usuários únicos, Exports, Bytes baixados (`formatBytes`). |
| 4 | Engajamento por usuário | Search debounced + tabela. Colunas: Nome, Role badge, Último login, Page views, Exports, Top 3 dashboards (badges). Click em row → expande timeline (até 50 linhas + "mostrar mais"). |
| 5 | Heatmap horário | Plotly heatmap 7×24 (Dom..Sáb × 0..23h). Colorscale custom: `#fff5ee` → `#ffb088` → `#ff5000`. |

## 4. RPCs consumidas

Todas SECURITY DEFINER, com check de role server-side. Wrappers em [`src/lib/rpc.ts`](../../src/lib/rpc.ts), seção `MODULE: Admin Analytics`.

| RPC SQL | Wrapper JS | Retorno |
|---|---|---|
| `get_analytics_kpis(period_days int)` | `rpcGetAnalyticsKpis` | jsonb com `dau, wau, mau, total_users, active_users_period, exports_period, page_views_period, logins_period` |
| `get_analytics_by_dashboard(period_days int)` | `rpcGetAnalyticsByDashboard` | `{ route, page_views, unique_users, exports, bytes_total }[]` |
| `get_analytics_by_user(period_days int, p_search text)` | `rpcGetAnalyticsByUser` | `{ user_id, full_name, role, last_login, page_views, exports, top_routes }[]` |
| `get_analytics_user_timeline(target_user_id uuid, period_days int)` | `rpcGetAnalyticsUserTimeline` | `{ event_type, route, payload, created_at }[]` (até 500) |
| `get_analytics_heatmap(period_days int)` | `rpcGetAnalyticsHeatmap` | `{ dow 0..6, hour 0..23, event_count }[]` |

RPC de escrita (write-side): `track_event(p_event_type text, p_route text, p_payload jsonb)` — chamada apenas via `src/lib/tracking.ts`. Fire-and-forget; nunca trava UI.

## 5. Tabela `app_events` (referência — owner é `worker_supabase`)

Colunas esperadas:

```
id            uuid pk
user_id       uuid references auth.users (preenchido pela RPC via auth.uid())
event_type    text  ('login' | 'page_view' | 'export')
route         text  null
payload       jsonb default '{}'
created_at    timestamptz default now()
```

Indexes esperados: `(created_at desc)`, `(user_id, created_at desc)`, `(event_type, created_at desc)`, `(route, created_at desc)`.

RLS:
- INSERT: bloqueado para anon/authenticated (somente RPC `track_event` SECURITY DEFINER escreve).
- SELECT: bloqueado para Clients. Apenas RPCs `get_analytics_*` (também SECURITY DEFINER, com check de role) leem.

## 6. Dependências cross-dept

- **`worker_supabase`** — dono da tabela `app_events`, das RPCs `track_event` + 5 leitoras, das RLS policies. A migration deve estar aplicada antes do dashboard funcionar.
- **APP / `worker_subgerente-app`** — dono dos hooks de instrumentação (`(dashboard)/layout.tsx`, `ExportPanel`, `ExportModal`) e do helper `src/lib/tracking.ts`.
- **`worker_dash-admin`** — bundled owner desta página + da página `/admin-panel` que linka para ela.

## 7. Pegadinhas conhecidas

- `event_type='page_view'` filtrado **no cliente**: a lista `TRACKING_EXCLUDED_ROUTES` está em `src/app/(dashboard)/layout.tsx`. Mudar lá se adicionar nova rota meta.
- `useDebounce` no search da seção 4 fica em 350ms — bem abaixo do `useExportSize` (300ms) e do `useDebouncedFetch` (400ms) que são padrão do app.
- O timeline carrega até 500 eventos por chamada (limite no SQL), e a UI mostra os primeiros 50 com botão "mostrar mais".
- O heatmap usa `dow=0` para domingo (alinhado com `extract(dow from ts)` do Postgres). Labels em português começam por "Dom".
- A `colorscale` do Plotly é hard-coded em laranja (consistência visual). Não use a paleta padrão verde-azul.

## 8. Validação

- **TS**: `tsc --noEmit` clean.
- **Lint**: `react-hooks/set-state-in-effect` warnings emitidos no padrão `useEffect(() => { if (allowed) loadX(); }, [allowed, loadX])` — mesmo padrão do `admin-panel/page.tsx` existente. Não bloqueia build.
- **Smoke test runtime**: pendente — requer `npm install` no worktree (Turbopack 16 rejeita junctions cross-fs-root no Windows). Validar pós-merge em main, ou no preview Vercel automático.

## 9. Arquivos

- `src/app/(dashboard)/admin-analytics/page.tsx` — página completa (sem `page.module.css`).
- `src/lib/tracking.ts` — helper `trackEvent(type, route?, payload?)`.
- `src/lib/rpc.ts` — seção "MODULE: Admin Analytics" com 5 wrappers.
- `src/app/(dashboard)/layout.tsx` — fires login + page_view.
- `src/components/dashboard/ExportPanel.tsx` — fires export (Tier 1).
- `src/components/dashboard/ExportModal.tsx` — fires export (Tier 2, com rows/bytes).
- `src/app/(dashboard)/admin-panel/page.tsx` — banner "Analytics dashboard" linkando para `/admin-analytics`.
