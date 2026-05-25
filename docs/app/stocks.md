# Sub-PRD — `/stocks` (Market Watch)

## Dual-view structure (added 2026-05-20)

The dashboard follows the canonical dual-view pattern. Four files under the route:

```
src/app/(dashboard)/stocks/
├── page.tsx                 ← viewport router (useIsMobile → DesktopView or MobileView)
├── useStocksData.ts         ← THE BRAIN — all state, quotes, portfolios, blink, cards
├── desktop/
│   └── View.tsx             ← Bloomberg trading-terminal UX (drag-and-drop grid)
└── mobile/
    └── View.tsx             ← Standard mobile tokens (liquid glass, orange accent)
```

### Hook contract (`useStocksData`)

Returns:

| Field | Type | Description |
|---|---|---|
| `theme / isDark / toggleTheme` | — | Dark/light preference, persisted to localStorage |
| `portfolios / activePortfolio` | `StockPortfolio[]` | Portfolios visible to the current viewer (own rows for Admin/Client; public rows for Anon); active is the one marked `is_active` |
| `portfolioLoading` | boolean | Supabase loading state |
| `readOnly` | boolean | True for anonymous viewers — both Views hide CRUD controls when set; mutation callbacks no-op as defense in depth |
| `createPortfolio / updatePortfolio / deletePortfolio / setActivePortfolio` | functions | PostgREST CRUD (no-op when `readOnly`) |
| `quotes / quoteMap / quotesLoading / refetchQuotes` | — | Live quotes for all portfolio tickers + CHART_SHORTCUTS |
| `isMarketOpen` | boolean | B3 market status (useAutoRefresh) |
| `periodReturns` | `Map<symbol, PeriodReturn>` | YTD / MTD ref prices |
| `blinkMap` | `Map<symbol, "up"\|"down">` | Bloomberg blink state (1.2s window) |
| `cards / layouts / addCard / updateCard / handleLayoutChange / persistCards` | — | Desktop drag-and-drop grid state (localStorage) |
| `mobileTab / setMobileTab` | `MobileTab` | Active bottom tab ("portfolios"\|"watch"\|"compare") |
| `compareTickers / addCompareTicker / removeCompareTicker` | — | Mobile compare set (max 5) |
| `mobileRange / setMobileRange` | `TimeRange` | Shared chart range for mobile expanded + compare views |
| `expandedTicker / setExpandedTicker` | `string\|null` | Which ticker is expanded in mobile list |
| `tickers / groups` | derived | Flattened from activePortfolio |

### Visual theme decision

- **Desktop** keeps `.stocks-dark` / `.stocks-light` Bloomberg terminal theme (uppercase 11px, border-radius 0, accent orange #ff5000).
- **Mobile** uses **standard mobile CSS vars** (`--mobile-*`): liquid glass top/bottom bars, orange #ff5000 accent, 14px text, rounded cards. The trading-terminal scoped classes are NOT applied on mobile — intentional per approved mockup.

### Analyses preserved on both views

| Analysis | Desktop | Mobile |
|---|---|---|
| Portfolio ticker table (price, CHG%, YTD%, MTD%, VOL) | Portfolio card | Portfolios tab card list |
| Live quote polling (useAutoRefresh) | All cards | Both tabs (quotes from hook) |
| Price blink animations | Bloomberg-style | Standard colors (no blink class on mobile) |
| Time-series chart | Chart card (candlestick or line) | Expanded inline chart (MobileChart, line) |
| Multi-asset comparison | Compare card (base100 or percent, date range) | Compare tab (base100, time range pills) |
| Market overview (indices + FX) | Market card | Available via quoteMap / Watch tab |
| Search (StockSearch) | Watchlist / Compare cards, Portfolio modal | Inline search bar (top of every tab) |
| Portfolio CRUD | PortfolioModal | PortfolioEditorSheet (BottomSheet) |
| B3 market status | Top-bar badge | isMarketOpen available (not shown on mobile per mockup) |
| Brent futures curve | FuturesCurveChart card | Not surfaced on mobile [desktop-only: chart card type not present on mobile] |
| News Hunter card | News card | Not surfaced on mobile [desktop-only: card type not present on mobile] |

### Mobile components used

- `MobileTopBar` — sticky liquid-glass top bar, theme toggle, avatar
- `MobileBottomTabBar` — Portfolios / Watch / Compare / Profile bottom nav
- `MobileDataCard` — ticker rows with inline sparkline
- `MobileChart` — Plotly wrapper tuned for mobile (no modebar, fixedrange)
- `MobileTabBar` — time-range pills (container variant) inside expanded detail and compare tab
- `BottomSheet` — portfolio editor sheet

Dashboard de Stocks com tema **dark trading terminal** (Bloomberg-like). Owner: [`worker_dash-stocks`](../../.claude/agents/worker_dash-stocks.md).

> Único módulo do app com identidade visual própria. Mantida intencionalmente distinta.

## Escopo de código (maior que outros dash-*)

```
src/app/(dashboard)/stocks/
  page.tsx                          Página principal

src/components/stocks/              Componentes scoped
  StockChart.tsx                    Gráfico individual
  ComparisonChart.tsx               Comparação multi-ticker
  MarketOverview.tsx                Overview de mercado
  StockSearch.tsx                   Busca de tickers
  FuturesCurveChart.tsx             Curva de futuros

src/hooks/
  useStockQuote.ts                  Quote em tempo real (polling)
  useStockHistory.ts                Histórico via proxy
  useStockPortfolios.ts             CRUD de portfolios

src/app/api/stocks/                 Yahoo Finance proxy (Next.js API)
  quote/                            Cotação atual
  history/                          Série histórica
  search/                           Busca de tickers
  futures-curve/                    Curva de futuros
```

## Tabela

`stock_portfolios`:
- PK: `uuid`
- Colunas: `user_id` (nullable), `name`, `tickers text[]`, `groups jsonb`, `is_active`, `is_public` (default `FALSE`)
- **Acesso**: PostgREST direto via supabase-js (não via RPC).
  - Owner CRUD policy scopes `WHERE auth.uid() = user_id`.
  - Permissive RLS policy `anon and authed read public portfolios` permite SELECT por anon e authenticated quando `is_public = TRUE`.
- **Public seed**: snapshot of every portfolio owned by `ibbaogproject@gmail.com` (all rows, not only `is_active`), cloned into `stock_portfolios` with `user_id = NULL` and `is_public = TRUE`. Visible to every anonymous visitor. Tickers/groups/names are dynamic — they reflect whatever `ibbaogproject@gmail.com` had at the time the snapshot migration was applied. **No automatic re-sync**; to refresh the public set the admin re-runs the seed migration manually. This replaced the previous hardcoded "Brazilian Oil & Gas (default)" portfolio with 6 tickers (`PETR4.SA, VBBR3.SA, BRAV3.SA, UGPA3.SA, RECV3.SA, PRIO3.SA`), which is no longer used.

Migrations: `20260401000000_stock_portfolios.sql`, `20260401000001_stock_portfolio_groups.sql`, `20260522000001_anonymous_access.sql` (section 8 — RLS + nullable `user_id` + `is_public` column), `20260525000001_stocks_seed_from_ibbaogproject.sql` (current public seed — snapshot of `ibbaogproject@gmail.com` portfolios; rerun manually to refresh).

## Anonymous viewer mode (added 2026-05-21)

`/stocks` aceita 3 tiers de visitantes:

| Role | Source | Portfolios visíveis | CRUD |
|---|---|---|---|
| Admin / Client | `useUserProfile().role === 'Admin' \| 'Client'` | `WHERE user_id = auth.uid()` | Full (New / Edit / Delete) |
| Anon | `useUserProfile().role === 'Anon'` | `WHERE is_public = TRUE` (snapshot of `ibbaogproject@gmail.com` portfolios — see "Public seed" above) | Hidden — `readOnly` flag |

Componentes/padrões:

- `useStockPortfolios` lê `role` do `UserProfileContext` (Phase B) e roteia o query path. Retorna `readOnly: true` quando anon.
- `useStocksData` repassa `readOnly` no return type — ambas views consomem.
- `desktop/View.tsx` esconde botões "New", gear (Edit) e o empty-state "Create your first portfolio" quando `readOnly`. Renderiza `<AnonCTA />` acima do grid.
- `mobile/View.tsx` remove a aba "Profile" do `MobileBottomTabBar`, fecha o `PortfolioEditorSheet`, e renderiza `<AnonCTA />` entre a search bar e o tab content.
- `AnonCTA` (em `src/components/AnonCTA.tsx`, owned by Phase B) é um banner com brand-orange invitation pro `/login`. Copy unchanged by the public-seed refactor: still reads "Sign in to create and manage your own portfolios."

## Yahoo Finance Proxy (importante)

Routes em `src/app/api/stocks/*` servem como **proxy CORS** para Yahoo Finance.

| Endpoint | Função |
|---|---|
| `/api/stocks/quote?symbol=PETR4` | Cotação atual |
| `/api/stocks/history?symbol=PETR4&range=1y` | Histórico |
| `/api/stocks/search?q=petr` | Busca |
| `/api/stocks/futures-curve?symbol=BRENT` | Curva de futuros |

**Nunca** chame Yahoo Finance direto do componente — cai em CORS.

Cuidado com **rate limits** do Yahoo. Polling agressivo pode bloquear o IP.

## Tema visual (Market Watch)

`globals.css` tem dois blocos scoped:

### `.stocks-dark` (default)
- Background: `#030814` (quase preto azulado)
- Card: `#070d1c`
- Border: `#131a2e` / `#161d33`
- Verde (alta): `#3fb950`
- Vermelho (baixa): `#f85149`
- Texto: `#e6edf3`
- Muted: `#8b949e`

### `.stocks-light`
- Background: `#f5f5f5`
- Card: `#ffffff`
- Verde: `#16a34a`
- Vermelho: `#dc2626`

### Regra global Market Watch (TODA a árvore)

```css
.stocks-dark, .stocks-dark *,
.stocks-light, .stocks-light * {
  font-family: Arial, Helvetica, sans-serif !important;
  font-size: 11px !important;
  text-transform: uppercase !important;
  letter-spacing: 0 !important;
  border-radius: 0 !important;
}

/* Spinners exception */
.stocks-dark .spinner-border, .stocks-light .spinner-border {
  border-radius: 50% !important;
}
```

Identidade flat, uppercase, no-radius — **propositalmente diferente do resto do app**.

## Componentes/padrões específicos

| Padrão | Uso |
|---|---|
| `.sd-card` | Container padrão |
| `.sd-table` | Tabelas (header uppercase 12px) |
| `.sd-btn`, `.sd-btn-active` | Botões |
| `.sd-input`, `.sd-select` | Forms |
| `.sd-badge` | Badges (active, open, closed) |
| `.sd-modal-glass` | Modais (versão dark e light) |
| `.sd-theme-toggle` | Toggle dark/light |
| `.sd-drag-handle` | Handle do react-grid-layout |
| `.stock-blink-up/down` | Bloomberg-style row blink (3 pulsos verde/vermelho) |
| `.price-flash-up/down` | Texto de preço em flash 1.2s |
| `.navbar-autohide` | Modo full-screen (auto-hide da NavBar) |

## Dependências externas

- **Yahoo Finance** (via proxy próprio).
- **react-grid-layout** — drag & drop de cards.

## Princípios

1. **Tema scoped — nunca vaze pra outros módulos.**
2. **Yahoo via proxy.** Não direto.
3. **Polling** com `useAutoRefresh` (compartilhado).
4. **Portfolios per-user** (RLS).
5. **Animações Bloomberg-style** mantidas.

## Anti-padrões

- YF direto do componente (CORS).
- Vazar `.stocks-dark`/`.stocks-light`.
- Adicionar border-radius no Market Watch.
- Mexer em RPCs do Supabase pra portfolios — eles são PostgREST direto.
- Tabela nova sem RLS por `user_id`.
- Renderizar controles de CRUD de portfolios quando `readOnly === true` (anon). Sempre cheque `readOnly` antes.
- Permitir que mutações (`createPortfolio`/`updatePortfolio`/`deletePortfolio`/`setActivePortfolio`) sejam chamadas em anon. O hook já no-ops, mas a UI não deve nem oferecer a possibilidade.
