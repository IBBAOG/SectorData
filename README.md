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

### Core (Fase 1–2)

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

### Estatísticas (Fase 3 — 10 novos dashboards)

| Route | Categoria | RPC functions | Export |
|-------|-----------|---------------|--------|
| `/anp-cdp` | Oil & Gas | `get_anp_cdp_poco_serie`, `get_anp_cdp_pocos_json`, `get_anp_cdp_filtros` | Yes |
| `/anp-ppi` | Fuel Distribution | `get_anp_ppi_media_serie`, `get_anp_ppi_locais_serie`, `get_anp_ppi_filtros` | Yes |
| `/anp-precos-produtores` | Fuel Distribution | `get_anp_precos_produtores_serie`, `get_anp_precos_produtores_filtros` | Yes |
| `/anp-glp` | Fuel Distribution | `get_anp_glp_serie`, `get_anp_glp_filtros` | Yes |
| `/mdic-comex` | Fuel Distribution | `get_mdic_comex_serie`, `get_mdic_comex_top_paises`, `get_mdic_comex_filtros` | Yes |
| `/anp-lpc` | Fuel Distribution | `get_anp_lpc_nacional`, `get_anp_lpc_serie`, `get_anp_lpc_filtros` | Yes |
| `/sindicom` | Fuel Distribution | `get_sindicom_serie`, `get_sindicom_filtros` | Yes |
| `/anp-daie` | Fuel Distribution | `get_anp_daie_serie`, `get_anp_daie_filtros` | Yes |
| `/anp-desembaracos` | Fuel Distribution | `get_anp_desembaracos_serie`, `get_anp_desembaracos_top_paises`, `get_anp_desembaracos_filtros` | Yes |
| `/anp-painel-importacoes` | Fuel Distribution | `get_anp_painel_imp_serie`, `get_anp_painel_imp_top_dist`, `get_anp_painel_imp_filtros` | Yes |

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
│   │   ├── anp-cdp.md anp-ppi.md anp-precos-produtores.md anp-glp.md
│   │   ├── mdic-comex.md anp-lpc.md sindicom.md anp-daie.md
│   │   ├── anp-desembaracos.md anp-painel-importacoes.md
│   │   └── news-hunter-architecture.md  # cross-repo handoff doc
│   ├── design/
│   │   ├── identity.md            # tokens (#ff5000, Arial, liquid glass)
│   │   └── best-practices.md      # UX, responsiveness, accessibility
│   ├── supabase/PRD.md            # schema/RLS/RPC ownership
│   ├── etl-pipelines/PRD.md
│   ├── dados-locais/PRD.md
│   └── alertas/PRD.md
├── scripts/                       # all Python/Node scripts (organized by role)
│   ├── pipelines/                 # automated (run by GitHub Actions)
│   │   ├── ais/                   # candidates_discover.py, positions_sync.py
│   │   ├── anp/                   # vendas_watch.py, glp_sync.py, lpc_sync.py + chains:
│   │   │   ├── cdp/               #   01_extract.py → 02_upload.py
│   │   │   ├── fase3/             #   01_daie_sync.py → 02_desembaracos_sync.py → 03_painel_imp_sync.py
│   │   │   └── precos/            #   01_ppi_sync.py → 02_precos_produtores_sync.py
│   │   ├── navios/                # 5-stage chain: 01_lineup_scrape → ... → 05_positions_sync
│   │   ├── mdic_comex_sync.py
│   │   └── sindicom_sync.py
│   ├── manual/                    # human-in-the-loop uploads (Dados Locais)
│   │   ├── dg_margins_upload.py   # uploads data/d_g_margins.xlsx
│   │   └── price_bands_upload.py  # uploads data/price_bands.xlsx
│   └── utils/                     # one-shot utilities (deploy, capture)
│       ├── deploy_migration.mjs
│       ├── deploy_profiles_visibility.mjs
│       └── capture_previews.mjs
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
│   │       ├── anp-cdp/ anp-ppi/ anp-precos-produtores/ anp-glp/
│   │       ├── mdic-comex/ anp-lpc/ sindicom/ anp-daie/
│   │       ├── anp-desembaracos/ anp-painel-importacoes/
│   │       ├── profile/ admin-panel/ template-module/
│   ├── components/
│   │   ├── NavBar.tsx PlotlyChart.tsx PeriodSlider.tsx CheckList.tsx
│   │   ├── RegionStateFilter.tsx SearchableMultiSelect.tsx
│   │   ├── dashboard/             # Fase 4 shared components (see section below)
│   │   └── stocks/                # StockChart, ComparisonChart, MarketOverview, ...
│   ├── context/UserProfileContext.tsx
│   ├── hooks/                     # useStockQuote, useAutoRefresh, useModuleVisibilityGuard,
│   │   │                          # useDebouncedFetch, ...
│   ├── lib/                       # supabaseClient, rpc.ts, profileRpc, filterUtils,
│   │   │                          # exportExcel, plotlyDefaults, units
│   └── types/                     # shared TS types
├── supabase/
│   ├── config.toml
│   └── migrations/                # 55 migrations as of 2026-05
├── sql/                           # ⚠ tech debt — 3 DDL files applied via Supabase Dashboard, NOT in migrations
│   │                              #   (create_price_bands.sql, create_profiles_and_visibility.sql, create_user_management.sql)
├── alertas/                       # local-only (gitignored) — alert subsystem with own PRD_ALERTAS.md
├── DADOS/                         # local-only (gitignored) — consolidated parquet/csv per source
├── data/                          # manual Excels (d_g_margins, price_bands) — gitignored
├── output/                        # local-only (gitignored) — raw extracts
└── requirements.txt               # ETL pipelines (Python deps for scripts/pipelines/* and scripts/manual/*)
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
| `mdic_comex` | id | ano, mes, tipo (IMP/EXP), ncm, descricao_ncm, pais, uf, produto_combustivel, quantidade_kg, valor_fob_usd |
| `anp_ppi` | id | data_referencia, produto, local, preco_ppi, unidade |
| `anp_precos_produtores` | id | data_referencia, produto, regiao, preco, unidade |
| `anp_glp` | id | data_referencia, estado, preco_produtor, preco_distribuidor, preco_revendedor, unidade |
| `anp_daie` | id | data_referencia, produto, pais_origem, quantidade_m3, quantidade_ton |
| `anp_desembaracos` | id | data_referencia, produto, pais_origem, quantidade_m3, quantidade_ton |
| `anp_painel_imp_dist` | id | data_referencia, distribuidora, produto, quantidade_m3 |
| `anp_lpc` | id | data_referencia, municipio, estado, produto, preco_medio, preco_minimo, preco_maximo, numero_postos |
| `sindicom` | id | data_referencia, produto, regiao, volume_m3 |
| `anp_cdp_producao` | id | poco, campo, bacia, operador, data_producao, prod_oleo_bbl, prod_gas_mm3, prod_agua_m3, tipo_poco, ambiente |

**Materialized views:** `mv_ms_serie`, `mv_ms_serie_fast` — pre-aggregated monthly sales, refreshed by `classificar_agentes()`.

> **Tech debt:** `price_bands`, `profiles`, `module_visibility` were created via DDL in [`sql/`](sql/) applied directly to the Supabase Dashboard rather than versioned migrations (`create_price_bands.sql`, `create_profiles_and_visibility.sql`, `create_user_management.sql`). See [`docs/supabase/PRD.md`](docs/supabase/PRD.md) for conversion plan.

## Data Pipelines (14 workflows + 1 external)

| # | Workflow | Schedule | Script(s) | Target |
|---|----------|----------|-----------|--------|
| 1 | `etl_navios_lineup.yml` | Every 6h | `pipelines/navios/01_lineup_scrape.py` → `02_diesel_import.mjs` | `navios_diesel` |
| 2 | `etl_navios_imo_lookup.yml` | After #1 | `pipelines/navios/03_imo_lookup.py` → `04_pipelines/navios/04_cabotage_cleanup.py` | `navios_diesel.imo/mmsi` |
| 3 | `etl_navios_positions.yml` | After #2 | `pipelines/navios/05_positions_sync.py` (VF port-call) | `vessel_positions`, `port_arrivals` |
| 4 | `etl_ais_positions.yml` | Every 6h+15min | `pipelines/ais/positions_sync.py` (AISStream WebSocket) | `vessel_registry`, `vessel_positions`, `port_arrivals` |
| 5 | `etl_ais_candidates.yml` | Every 4h | `pipelines/ais/candidates_discover.py` (AIS global scan, score 0–100) | `import_candidates` |
| 6 | `etl_anp_cdp.yml` | Monthly 5th | `pipelines/anp/cdp/01_extract.py` → `02_upload.py` (Selenium + ddddocr CAPTCHA) | `anp_cdp_producao` |
| 7 | `etl_anp_vendas.yml` | External trigger (cron-job.org → workflow_dispatch) | `pipelines/anp/vendas_watch.py --force` | `vendas` (ANP fuel sales) |
| 8 | `etl_anp_fase3.yml` | Monthly 1st, 13:00 UTC | `pipelines/anp/fase3/01_daie_sync.py` → `02_desembaracos_sync.py` → `03_painel_imp_sync.py` | `anp_daie`, `anp_desembaracos`, `anp_painel_imp_dist` |
| 9 | `etl_anp_lpc.yml` | Weekly Wed 14:30 UTC | `pipelines/anp/lpc_sync.py` | `anp_lpc` |
| 10 | `etl_anp_precos.yml` | Weekly Mon 12:00 UTC | `precos/01_ppi_sync.py` → `02_precos_produtores_sync.py` + `glp_sync.py` | `anp_ppi`, `anp_precos_produtores`, `anp_glp` |
| 11 | `etl_mdic_comex.yml` | Daily 14:00 UTC | `pipelines/mdic_comex_sync.py` | `mdic_comex` |
| 12 | `etl_sindicom.yml` | Monthly 5th, 15:00 UTC | `pipelines/sindicom_sync.py` (Playwright + Chromium) | `sindicom` |
| 13 | `manual_dg_margins.yml` | Weekly Mon | `manual/dg_margins_upload.py` | `d_g_margins` (manual Excel) |
| 14 | `supabase_deploy.yml` | On push to main | `supabase db push` | migrations |
| ext | News Hunter scanner | Every ~5min via cron-job.org | `news_hunter_service.py --once` (in repo `IBBAOG/news-hunter-scanner`) | `news_articles` |

**News Hunter scanner** lives in a separate repo. Uses `SUPABASE_SERVICE_KEY`. Keywords from UNION of all users' rows in `news_hunter_keywords`. Frontend polls `news_articles` every 60s incrementally (`found_at` watermark).

**Cabotage filtering:** `navios_diesel.is_cabotagem` is a generated column (`flag IN {Brazil,BR}` OR `origem` pattern). All navios RPCs filter `WHERE NOT is_cabotagem`.

**Manual data subsystem (`data/`):** `data/d_g_margins.xlsx` and `data/price_bands.xlsx` are edited by hand and uploaded via `scripts/manual/dg_margins_upload.py` (weekly automated) and `scripts/manual/price_bands_upload.py` (manual). Both files are gitignored.

**Alert subsystem (`alertas/`):** local-only (gitignored), self-contained. 11 detection bases over Supabase tables/parquet files, sends notifications via Gmail API. See `alertas/PRD_ALERTAS.md`.

## Shared Dashboard Components (Fase 4)

Extracted from the 10 Fase 3 dashboards to prevent visual drift. All live in [`src/components/dashboard/`](src/components/dashboard/).

| Component | Purpose |
|-----------|---------|
| `DashboardHeader.tsx` | Title + subtitle + period badge + `<hr>` separator. Props: `lang`, `extraBadge`, `rightSlot`, `hideDivider` |
| `MultiSelectFilter.tsx` | Checkbox list with Limpar button, `(N/total)` counter and optional color swatch |
| `PeriodSlider.tsx` | rc-slider wrapper; accepts `years: number[]` or `dates: string[]` |
| `ChartSection.tsx` | Section title + "atualizando..." indicator + opacity 0.5 loading state |
| `ExportPanel.tsx` | Declarative `actions[]` array with `kind=excel\|csv`, busy state, loading label |
| `SegmentedToggle.tsx` | Orange-pill toggle for full vs compact view |
| `BarrelLoading.tsx` | Barrel spinner via next/image; supports `bare` mode for inline use |

**Shared hooks/libs:**

| File | Purpose |
|------|---------|
| [`src/hooks/useDebouncedFetch.ts`](src/hooks/useDebouncedFetch.ts) | useCallback + useRef debounce (400ms) with in-flight cancel |
| [`src/lib/plotlyDefaults.ts`](src/lib/plotlyDefaults.ts) | `COMMON_LAYOUT`, `AXIS_LINE`, `emptyPlot()`, `BRAND_ORANGE`, `PALETTE` |
| [`src/lib/units.ts`](src/lib/units.ts) | `kgToMilTon`, `m3ToMilM3` converters + `LABEL` constants |

## Auth & Roles

- Guard: `(dashboard)/layout.tsx` → `supabase.auth.getSession()` → redirect `/login`
- **Admin**: all modules + `/admin-panel` (role/visibility management)
- **Client**: modules allowed by Admin only; enforced via `useModuleVisibilityGuard(slug)`
- Role stored in `profiles`, loaded via `UserProfileContext`; `useRoleGuard` protects Admin pages

## Adding a New Dashboard (developer quick-start)

1. Copy `src/app/(dashboard)/template-module/` → new route folder
2. Add nav entry in `src/components/NavBar.tsx` (`NAV_ENTRIES`)
3. Create Supabase migration with tables + RPCs + **RLS**
4. Add RPC wrappers in `src/lib/rpc.ts`
5. `INSERT INTO module_visibility VALUES ('<slug>', true);`
6. Use `useModuleVisibilityGuard("<slug>")` in the page component
7. **Use shared components** from `src/components/dashboard/` — `DashboardHeader`, `MultiSelectFilter`, `PeriodSlider`, `ChartSection`, `ExportPanel`, `SegmentedToggle`, `BarrelLoading` — to avoid visual drift from the Fase 3 standard
8. **Use shared hooks/libs** — `useDebouncedFetch` for RPC calls, `plotlyDefaults` for chart layout, `units.ts` for volume conversions

> **Internal team workflow** (creating a `worker_dash-<slug>` agent, sub-PRD, dispatching `worker_dash-admin` for visibility/home image, etc.) is documented in [`docs/app/PRD.md`](docs/app/PRD.md) under "Workflow Subgerente: adicionar dashboard novo".

## Environment Variables

```env
# .env.local (frontend)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# GitHub Actions secrets
SUPABASE_URL / SUPABASE_SERVICE_KEY              # pipelines
SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN     # migration deploy (supabase_deploy.yml)
AISSTREAM_API_KEY                                # AIS sync
```
