# Itau BBA Dashboard (SectorData)

Internal analytics platform for the Brazilian Fuel Distribution and Oil & Gas sectors. Next.js 16 + Supabase + Plotly.js, deployed on Vercel.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js App Router | 16.2.1 |
| UI | React + Bootstrap | 19.2.4 / 5.3.8 |
| Charts | Plotly.js (react-plotly.js) | 3.4.0 |
| Database & Auth | Supabase (PostgreSQL + PostgREST) | supabase-js 2.100.1 |
| Excel Export | ExcelJS + JSZip | 4.4.0 / 3.10.1 |
| Market Data | Yahoo Finance (via Next.js proxy) | — |
| Data Pipelines | Python 3.12 (pandas, selenium, bs4) | — |
| Deployment | Vercel (auto on push to main) | — |

## Key Architecture

- **No API routes for Supabase data** — all backend logic in PostgreSQL RPC functions, called directly from browser via supabase-js anon key.
- **Yahoo Finance proxied** through `/api/stocks/*` to avoid CORS.
- **Auth guard** in `(dashboard)/layout.tsx` — redirects to `/login` if no session.
- **Role-based visibility** — Admins toggle module access for Clients; state in `module_visibility` table, loaded via `UserProfileContext`.
- **Materialized views** `mv_ms_serie` / `mv_ms_serie_fast` for Market Share / Sales Volumes performance.
- **GitHub Actions** as ETL — scrape → CSV commit → Supabase upsert.

## Modules

| Route | File | RPC functions | Export |
|-------|------|---------------|--------|
| `/home` | `(dashboard)/home/page.tsx` | — | — |
| `/sales-volumes` | `(dashboard)/sales-volumes/page.tsx` | `get_sv_opcoes_filtros`, `get_ms_serie_fast`, `get_ms_serie_others`, `get_others_players` | Yes |
| `/market-share` | `(dashboard)/market-share/page.tsx` | `get_ms_opcoes_filtros`, `get_ms_serie_fast`, `get_ms_serie_others`, `get_others_players` | Yes |
| `/navios-diesel` | `(dashboard)/navios-diesel/page.tsx` | `get_nd_ultima_coleta`, `get_nd_coletas_distintas`, `get_nd_navios`, `get_nd_resumo_portos` | Yes |
| `/diesel-gasoline-margins` | `(dashboard)/diesel-gasoline-margins/page.tsx` | `get_dg_margins_data`, `get_dg_margins_filters` | Yes |
| `/price-bands` | `(dashboard)/price-bands/page.tsx` | `get_price_bands_data` | Yes |
| `/stocks` | `(dashboard)/stocks/page.tsx` | stock_portfolios table (direct PostgREST) | No |
| `/news-hunter` | `(dashboard)/news-hunter/page.tsx` | `seed_my_news_hunter_keywords` | No |
| `/profile` | `(dashboard)/profile/page.tsx` | `get_my_profile`, `upsert_my_profile` | — |
| `/admin-panel` | `(dashboard)/admin-panel/page.tsx` | `get_module_visibility`, `set_module_visibility`, `get_all_users_with_roles`, `set_user_role` | — |

All RPC wrappers: `src/lib/rpc.ts` (by module) and `src/lib/profileRpc.ts`.

## Project Structure

```
dashboard_projeto/
├── .github/workflows/
│   ├── navios_esperados.yml       # Every 6h: port scrape → navios_diesel
│   ├── extrair-anp.yml            # Monthly 5th: ANP well extraction
│   ├── upload-dg-margins.yml      # Weekly Mon: D&G margins upload
│   ├── supabase-deploy.yml        # On push: run migrations
│   ├── ais_sync.yml               # Every 6h+15min: AIS positions
│   ├── vessel_lookup.yml          # After navios: resolve IMO/MMSI
│   ├── vessel_position_sync.yml   # After lookup: VesselFinder position sync
│   └── ais_discovery.yml          # Every 4h: import candidates radar
├── scripts/
│   ├── import_navios_diesel.mjs   # CSV → Supabase importer
│   ├── upload_price_bands.py
│   └── capture-previews.mjs
├── src/
│   ├── app/
│   │   ├── layout.tsx             # Root shell (Bootstrap CSS, lang=pt-BR)
│   │   ├── globals.css
│   │   ├── login/page.tsx
│   │   ├── api/stocks/            # Yahoo Finance proxy (quote, history, search, futures-curve)
│   │   └── (dashboard)/
│   │       ├── layout.tsx         # Session guard → /login
│   │       ├── home/ market-share/ sales-volumes/ navios-diesel/
│   │       ├── diesel-gasoline-margins/ price-bands/ stocks/
│   │       ├── news-hunter/       # page.tsx + page.module.css
│   │       ├── profile/ admin-panel/ template-module/
│   ├── components/
│   │   ├── NavBar.tsx             # NAV_ENTRIES config, user avatar dropdown
│   │   ├── PlotlyChart.tsx        # react-plotly.js wrapper
│   │   ├── PeriodSlider.tsx       # rc-slider date range
│   │   ├── CheckList.tsx          # Multi-select with Select All / Clear
│   │   ├── RegionStateFilter.tsx  # Cascading region → UF filter
│   │   ├── SearchableMultiSelect.tsx
│   │   └── stocks/                # StockChart, ComparisonChart, MarketOverview, StockSearch, FuturesCurveChart
│   ├── context/
│   │   └── UserProfileContext.tsx # profile + moduleVisibility
│   ├── hooks/
│   │   ├── useStockQuote/History/Portfolios.ts
│   │   ├── useAutoRefresh.ts
│   │   ├── useModuleVisibilityGuard.ts
│   │   ├── useRoleGuard.ts
│   │   └── useDebounce.ts
│   ├── lib/
│   │   ├── supabaseClient.ts
│   │   ├── rpc.ts                 # All module RPCs
│   │   ├── profileRpc.ts
│   │   ├── filterUtils.ts         # REGIAO_UF_MAP, date helpers
│   │   └── exportExcel.ts         # ExcelJS export for all modules
│   └── types/
│       ├── stocks.ts
│       └── profile.ts
├── supabase/migrations/
│   ├── 20260327174919_remote_schema.sql      # vendas + views + base RPCs
│   ├── 20260328200000_navios_diesel.sql
│   ├── 20260329000000_create_d_g_margins.sql
│   ├── 20260401000000_stock_portfolios.sql
│   ├── 20260402000000_sales_volumes.sql
│   ├── 20260424000008_news_hunter.sql
│   └── 20260424000009_news_hunter_keywords.sql
├── navios_esperados.py            # Port vessel scraper
├── upload_dg_margins.py
└── requirements.txt
```

## Database Schema

All tables have RLS; frontend uses anon key (cannot bypass RLS). Only service role key (pipelines) can write to ingestion tables.

| Table | PK | Key columns |
|-------|----|-------------|
| `vendas` | id | ano, mes, agente_regulado, nome_produto, regiao_destinatario, uf_destino, segmento, quantidade_produto, classificacao, date |
| `navios_diesel` | id | collected_at, porto, navio, status, produto, quantidade_convertida, eta, inicio_descarga, fim_descarga, origem, imo, mmsi, flag, is_cabotagem (generated) |
| `d_g_margins` | id | fuel_type, week, base_fuel, biofuel_component, federal_tax, state_tax, distribution_and_resale_margin, total |
| `price_bands` | id | date, product, bba_import_parity, bba_import_parity_w_subsidy, bba_export_parity, petrobras_price |
| `stock_portfolios` | uuid | user_id, name, tickers text[], groups jsonb, is_active |
| `module_visibility` | module_slug | is_visible_for_clients |
| `news_articles` | url | domain, source_name, title, snippet, published_at, found_at, matched_keywords text[] |
| `news_hunter_keywords` | (user_id, keyword) | created_at — per-user, RLS scoped |

**Materialized views:** `mv_ms_serie`, `mv_ms_serie_fast` — pre-aggregated monthly sales, refreshed by `classificar_agentes()`.

## Data Pipelines

| # | Workflow | Schedule | Script | Target |
|---|----------|----------|--------|--------|
| 1 | navios_esperados.yml | Every 6h | navios_esperados.py → import_navios_diesel.mjs | `navios_diesel` |
| 2 | extrair-anp.yml | Monthly 5th | scripts/anp_auto.py (Selenium + ddddocr CAPTCHA) | output/anp/ |
| 3 | upload-dg-margins.yml | Weekly Mon | upload_dg_margins.py | `d_g_margins` |
| 4 | supabase-deploy.yml | On push to main | supabase db push | migrations |
| 5 | ais_sync.yml | Every 6h+15min | ais_sync.py (AISStream WebSocket) | `vessel_registry`, `vessel_positions`, `port_arrivals` |
| 6 | vessel_lookup.yml | After #1 | vessel_lookup.py (VesselFinder + MarineTraffic) | `navios_diesel.imo/mmsi` |
| 7 | vessel_position_sync.yml | After #6 | vessel_position_sync.py (VF port-call API) | `vessel_positions`, `port_arrivals` |
| 8 | ais_discovery.yml | Every 4h | ais_discovery.py (AIS global scan → score 0–100) | `import_candidates` |
| 9 | news-hunter-scanner repo | ~5min via cron-job.org | news_hunter_service.py --once | `news_articles` |

**News Hunter scanner** is in a separate repo (`IBBAOG/news-hunter-scanner`) — uses `SUPABASE_SERVICE_KEY` to bypass RLS. Keywords sourced from `news_hunter_keywords` (UNION of all users). Frontend polls Supabase every 60s incrementally (`found_at` watermark).

**Cabotage filtering:** `navios_diesel.is_cabotagem` is a generated column (`flag IN {Brazil,BR}` OR origem pattern). All navios RPCs filter `WHERE NOT is_cabotagem`.

## Auth & Roles

- Guard: `(dashboard)/layout.tsx` → `supabase.auth.getSession()` → redirect `/login`
- **Admin**: all modules + `/admin-panel` (role/visibility management)
- **Client**: modules allowed by Admin only; enforced via `useModuleVisibilityGuard(slug)`
- Role stored in `user_profiles`, loaded via `UserProfileContext`; `useRoleGuard` protects Admin pages

## Adding a New Module

1. Copy `src/app/(dashboard)/template-module/` → new route folder
2. Add nav entry in `NavBar.tsx` (`NAV_ENTRIES`)
3. Create Supabase migration + RPC functions
4. Add RPC wrappers in `src/lib/rpc.ts`
5. Insert into `module_visibility`: `INSERT INTO module_visibility VALUES ('slug', true)`
6. Use `useModuleVisibilityGuard("slug")` in the page component

## Environment Variables

```env
# .env.local (frontend)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# GitHub Actions secrets
SUPABASE_URL / SUPABASE_SERVICE_KEY   # pipelines
SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN  # migration deploy
AISSTREAM_API_KEY                     # AIS sync
```
