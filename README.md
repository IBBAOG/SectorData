# Itau BBA Dashboard (SectorData)

Internal analytics platform for the Brazilian Fuel Distribution and Oil & Gas sectors. Next.js 16 + Supabase + Plotly.js, deployed on Vercel.

> **Internal collaboration docs** (departmental agents, contracts, per-dashboard PRDs) live in [`docs/`](docs/). Start with [`docs/master.md`](docs/master.md).

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js App Router | 16.2.1 (non-standard — see CLAUDE.md) |
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
- **GitHub Actions** as ETL — scrape → CSV/parquet → Supabase upsert.
- **All tables have RLS enabled** — frontend cannot bypass; only service-role pipelines write to ingestion tables.

## Modules

| Route | RPC functions | Export |
|-------|---------------|--------|
| `/home` | — (landing with module cards) | — |
| `/sales-volumes` | `get_sv_opcoes_filtros`, `get_ms_serie_fast`, `get_ms_serie_others`, `get_others_players` | Yes |
| `/market-share` | `get_ms_opcoes_filtros`, `get_ms_serie_fast`, `get_ms_serie_others`, `get_others_players` | Yes |
| `/navios-diesel` | `get_nd_ultima_coleta`, `get_nd_coletas_distintas`, `get_nd_navios`, `get_nd_resumo_portos` | Yes |
| `/diesel-gasoline-margins` | `get_dg_margins_data`, `get_dg_margins_filters` | Yes |
| `/price-bands` | `get_price_bands_data` | Yes |
| `/stocks` | `stock_portfolios` (direct PostgREST) + Yahoo Finance proxy | No |
| `/news-hunter` | `seed_my_news_hunter_keywords` | No |
| `/profile` | `get_my_profile`, `upsert_my_profile` | — |
| `/admin-panel` | `get_module_visibility`, `set_module_visibility`, `get_all_users_with_roles`, `set_user_role` | — |

`template-module/` is a starter template, not a deployed module. RPC wrappers: [`src/lib/rpc.ts`](src/lib/rpc.ts) (by module) and [`src/lib/profileRpc.ts`](src/lib/profileRpc.ts).

## Project Structure

```
dashboard_projeto/
├── .claude/                       # local-only (gitignored) — agent definitions
│   └── agents/                    # worker_* agents per department/dashboard
├── .github/workflows/             # 14 workflows (ETL scrapers + supabase deploy)
├── docs/                          # internal collaboration docs
│   ├── master.md                  # PRD mestre — departments, contracts, conventions
│   ├── app/                       # APP department + per-dashboard sub-PRDs
│   │   ├── PRD.md                 # Subgerente APP — shared infrastructure
│   │   ├── sales-volumes.md       # one file per dashboard
│   │   ├── market-share.md
│   │   ├── navios-diesel.md
│   │   ├── diesel-gasoline-margins.md
│   │   ├── price-bands.md
│   │   ├── stocks.md
│   │   ├── news-hunter.md
│   │   ├── admin.md               # bundle: home + profile + admin-panel
│   │   └── news-hunter-architecture.md  # cross-repo handoff doc
│   ├── design/
│   │   ├── identity.md            # tokens (#ff5000, Arial, liquid glass)
│   │   └── best-practices.md      # UX, responsiveness, accessibility
│   ├── supabase/PRD.md            # schema/RLS/RPC ownership
│   ├── etl-pipelines/PRD.md
│   ├── dados-locais/PRD.md
│   └── alertas/PRD.md
├── scripts/                       # ETL sync scripts + utilities
│   ├── anp_*_sync.py              # ANP-specific scrapers
│   ├── mdic_comex_sync.py
│   ├── sindicom_sync.py
│   ├── import_navios_diesel.mjs
│   ├── upload_price_bands.py
│   └── deploy_*.mjs               # one-off deploy utilities
├── src/                           # Next.js app
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
│   │   ├── NavBar.tsx PlotlyChart.tsx PeriodSlider.tsx CheckList.tsx
│   │   ├── RegionStateFilter.tsx SearchableMultiSelect.tsx
│   │   └── stocks/                # StockChart, ComparisonChart, MarketOverview, ...
│   ├── context/UserProfileContext.tsx
│   ├── hooks/                     # useStockQuote, useAutoRefresh, useModuleVisibilityGuard, ...
│   ├── lib/                       # supabaseClient, rpc.ts, profileRpc, filterUtils, exportExcel
│   └── types/                     # shared TS types
├── supabase/
│   ├── config.toml
│   └── migrations/                # 41 migrations as of 2026-05
├── sql/                           # ⚠ tech debt — DDL applied via Supabase Dashboard, NOT in migrations
├── alertas/                       # local-only (gitignored) — alert subsystem with own PRD_ALERTAS.md
├── DADOS/                         # local-only (gitignored) — consolidated parquet/csv per source
├── data/                          # manual Excels (d_g_margins, price_bands) — gitignored
├── output/                        # local-only (gitignored) — raw extracts
├── ais_*.py navios_esperados.py vessel_*.py anp_watcher.py cabotage_cleanup.py upload_dg_margins.py
└── requirements.txt               # ETL pipelines (root scripts use this)
```

## Database Schema

All tables have RLS; frontend uses anon key. Only service role key (pipelines) writes to ingestion tables.

| Table | PK | Key columns |
|-------|----|-------------|
| `vendas` | id | ano, mes, agente_regulado, nome_produto, regiao_destinatario, uf_destino, segmento, quantidade_produto, classificacao, date |
| `navios_diesel` | id | collected_at, porto, navio, status, produto, quantidade_convertida, eta, inicio_descarga, fim_descarga, origem, imo, mmsi, flag, is_cabotagem (generated) |
| `vessel_registry`, `vessel_positions`, `port_arrivals`, `import_candidates` | — | AIS / port-call tracking |
| `d_g_margins` | id | fuel_type, week, base_fuel, biofuel_component, federal_tax, state_tax, distribution_and_resale_margin, total |
| `price_bands` | id | date, product, bba_import_parity, bba_import_parity_w_subsidy, bba_export_parity, petrobras_price |
| `stock_portfolios` | uuid | user_id, name, tickers text[], groups jsonb, is_active |
| `module_visibility` | module_slug | is_visible_for_clients |
| `news_articles` | url | domain, source_name, title, snippet, published_at, found_at, matched_keywords text[] |
| `news_hunter_keywords` | (user_id, keyword) | created_at — per-user, RLS scoped |
| `profiles` | id (FK auth.users) | role (Admin/Client), full_name, avatar_url |

**Materialized views:** `mv_ms_serie`, `mv_ms_serie_fast` — pre-aggregated monthly sales, refreshed by `classificar_agentes()`.

> **Tech debt:** `price_bands`, `profiles`, `module_visibility` were created via DDL in [`sql/`](sql/) applied directly to the Supabase Dashboard rather than versioned migrations. See [`docs/supabase/PRD.md`](docs/supabase/PRD.md) for conversion plan.

## Data Pipelines (14 workflows + 1 external)

| # | Workflow | Schedule | Script(s) | Target |
|---|----------|----------|-----------|--------|
| 1 | `navios_esperados.yml` | Every 6h | `navios_esperados.py` → `import_navios_diesel.mjs` | `navios_diesel` |
| 2 | `vessel_lookup.yml` | After #1 | `vessel_lookup.py` (VesselFinder + MarineTraffic) | `navios_diesel.imo/mmsi` |
| 3 | `vessel_position_sync.yml` | After #2 | `vessel_position_sync.py` (VF port-call) | `vessel_positions`, `port_arrivals` |
| 4 | `ais_sync.yml` | Every 6h+15min | `ais_sync.py` (AISStream WebSocket) | `vessel_registry`, `vessel_positions`, `port_arrivals` |
| 5 | `ais_discovery.yml` | Every 4h | `ais_discovery.py` (AIS global scan, score 0–100) | `import_candidates` |
| 6 | `extrair-anp.yml` | Monthly 5th | `scripts/anp_auto.py` (Selenium + ddddocr CAPTCHA) | `output/anp/` raw extracts |
| 7 | `anp-watcher.yml` | External trigger (cron-job.org → workflow_dispatch) | `anp_watcher.py --force` | `vendas` (ANP fuel sales) |
| 8 | `anp_fase3_sync.yml` | Monthly 1st, 13:00 UTC | `anp_daie_sync.py`, `anp_desembaracos_sync.py`, `anp_painel_imp_sync.py` | DAIE, Desembaraços, Painel Imp |
| 9 | `anp_lpc_sync.yml` | (verify schedule) | `scripts/anp_lpc_sync.py` | ANP LPC |
| 10 | `anp_precos_sync.yml` | (verify schedule) | `scripts/anp_precos_produtores_sync.py` | ANP preços produtores |
| 11 | `mdic_comex.yml` | (verify schedule) | `scripts/mdic_comex_sync.py` | MDIC Comex |
| 12 | `sindicom_sync.yml` | (verify schedule) | `scripts/sindicom_sync.py` | SINDICOM |
| 13 | `upload-dg-margins.yml` | Weekly Mon | `upload_dg_margins.py` | `d_g_margins` (manual Excel) |
| 14 | `supabase-deploy.yml` | On push to main | `supabase db push` | migrations |
| ext | News Hunter scanner | Every ~5min via cron-job.org | `news_hunter_service.py --once` (in repo `IBBAOG/news-hunter-scanner`) | `news_articles` |

**News Hunter scanner** lives in a separate repo. Uses `SUPABASE_SERVICE_KEY`. Keywords from UNION of all users' rows in `news_hunter_keywords`. Frontend polls `news_articles` every 60s incrementally (`found_at` watermark).

**Cabotage filtering:** `navios_diesel.is_cabotagem` is a generated column (`flag IN {Brazil,BR}` OR `origem` pattern). All navios RPCs filter `WHERE NOT is_cabotagem`.

**Manual data subsystem (`data/`):** `data/d_g_margins.xlsx` and `data/price_bands.xlsx` are edited by hand and uploaded via `upload_dg_margins.py` (weekly automated) and `scripts/upload_price_bands.py` (manual). Both files are gitignored.

**Alert subsystem (`alertas/`):** local-only (gitignored), self-contained. 11 detection bases over Supabase tables/parquet files, sends notifications via Gmail API. See `alertas/PRD_ALERTAS.md`.

## Auth & Roles

- Guard: `(dashboard)/layout.tsx` → `supabase.auth.getSession()` → redirect `/login`
- **Admin**: all modules + `/admin-panel` (role/visibility management)
- **Client**: modules allowed by Admin only; enforced via `useModuleVisibilityGuard(slug)`
- Role stored in `profiles`, loaded via `UserProfileContext`; `useRoleGuard` protects Admin pages

## Adding a New Module (developer quick-start)

1. Copy `src/app/(dashboard)/template-module/` → new route folder
2. Add nav entry in `src/components/NavBar.tsx` (`NAV_ENTRIES`)
3. Create Supabase migration with tables + RPCs + **RLS**
4. Add RPC wrappers in `src/lib/rpc.ts`
5. `INSERT INTO module_visibility VALUES ('<slug>', true);`
6. Use `useModuleVisibilityGuard("<slug>")` in the page component

> **Internal team workflow** (creating a `worker_dash-<slug>` agent, sub-PRD, dispatching `worker_dash-admin` for visibility/home image, etc.) is documented in [`docs/app/PRD.md`](docs/app/PRD.md) under "Workflow Subgerente: adicionar dashboard novo".

## Environment Variables

```env
# .env.local (frontend)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# GitHub Actions secrets
SUPABASE_URL / SUPABASE_SERVICE_KEY              # pipelines
SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN     # migration deploy (supabase-deploy.yml)
AISSTREAM_API_KEY                                # AIS sync
```
