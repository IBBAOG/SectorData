# Sub-PRD — `/stocks` (Market Watch)

Dashboard de Stocks com tema **dark trading terminal** (Bloomberg-like). Owner: [`dash-stocks`](../../.claude/agents/dash-stocks.md).

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
- Colunas: `user_id, name, tickers text[], groups jsonb, is_active`
- **Acesso**: PostgREST direto via supabase-js (não via RPC). RLS garante user_id scope.

Migrations: `20260401000000_stock_portfolios.sql`, `20260401000001_stock_portfolio_groups.sql`.

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
