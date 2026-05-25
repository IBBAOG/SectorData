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
- **Tiered auth (login is optional)** — `(dashboard)/layout.tsx` does **not** force `/login`. Anonymous visitors browse modules flagged `is_visible_for_public`; Clients (logged in) browse modules flagged `is_visible_for_clients`; Admins browse everything but must clear MFA (AAL2). Visitor cookie issued by `src/proxy.ts` (Next.js 16 middleware → proxy rename).
- **Role-based visibility (3 axes)** — `module_visibility` carries three independent booleans, loaded via `UserProfileContext`: `is_visible_for_public` (Anon access — default true), `is_visible_for_clients` (Client access — Admin always sees) and `is_visible_on_home` (Home card gallery visibility for **all** users including Admin). Invariant: `is_visible_for_public=true` implies `is_visible_for_clients=true` (CHECK + self-healing trigger).
- **Materialized views** `mv_ms_serie` / `mv_ms_serie_fast` for Market Share / Sales Volumes performance.
- **GitHub Actions** as ETL — scrape → CSV/parquet → Supabase upsert.
- **All tables have RLS enabled** — frontend cannot bypass; only service-role pipelines write to ingestion tables. Anonymous reads use `anon` role; permissive policies open public surface area (`module_visibility`, `news_articles`, public `stock_portfolios`, `news_hunter_default_keywords`).

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
| `/admin-panel` | `get_module_visibility`, `set_module_visibility`, `set_module_home_visibility`, `get_all_users_with_roles`, `set_user_role` | — |

### Statistics (Fase 3 onwards — 12 dashboards)

| Route | Category | RPC functions | Export |
|-------|----------|---------------|--------|
| `/anp-cdp` | Oil & Gas | `get_anp_cdp_poco_serie`, `get_anp_cdp_pocos_json`, `get_anp_cdp_filtros` | Yes |
| `/anp-cdp-bsw` | Oil & Gas | `get_anp_cdp_bsw_scatter`, `get_anp_cdp_bsw_field_aggregate` (X axis: `pct_voip`), `get_anp_cdp_bsw_campos` | No |
| `/anp-cdp-depletion` | Oil & Gas | `get_anp_cdp_depletion_campos`, `get_anp_cdp_depletion_scatter`, `get_anp_cdp_depletion_field_aggregate` | No |
| `/anp-cdp-diaria` | Oil & Gas | `get_anp_cdp_diaria_filtros`, `get_anp_cdp_diaria_serie` | Yes |
| `/anp-ppi` | Fuel Distribution | `get_anp_ppi_media_serie`, `get_anp_ppi_locais_serie`, `get_anp_ppi_filtros` | Yes |
| `/anp-precos-produtores` | Fuel Distribution | `get_anp_precos_produtores_serie`, `get_anp_precos_produtores_filtros` | Yes |
| `/anp-glp` | Fuel Distribution | `get_anp_glp_serie`, `get_anp_glp_filtros` | Yes |
| `/mdic-comex` | Fuel Distribution | `get_mdic_comex_serie`, `get_mdic_comex_top_paises`, `get_mdic_comex_filtros` | Yes |
| `/anp-lpc` | Fuel Distribution | `get_anp_lpc_nacional`, `get_anp_lpc_serie`, `get_anp_lpc_filtros` | Yes |
| `/imports-exports` | Fuel Distribution | `get_imports_exports_filtros`, `get_imports_exports_paises_stacked`, `get_imports_exports_importers_stacked`, `get_imports_exports_yoy_table`, `get_imports_exports_exports_serie` | Yes |
| `/anp-precos-distribuicao` | Fuel Distribution | `get_anp_precos_distribuicao_serie`, `get_anp_precos_distribuicao_top_distribuidoras`, `get_anp_precos_distribuicao_filtros` | Yes |
| `/subsidy-tracker` | Fuel Distribution (Proprietary) | `get_subsidy_tracker_diesel` | Yes |

> **Imports & Exports reform (2026-05-25):** `/imports-exports` replaces the 3 retired dashboards `/anp-daie`, `/anp-desembaracos`, `/anp-painel-importacoes`. Backed by `anp_desembaracos` (enriched with `importador`/`cnpj`/`uf_cnpj`, PK extended with `cnpj`) and `anp_daie`. The dropped table `anp_painel_imp_dist` and its 8 obsolete RPCs are removed. Auxiliary lookup tables seeded by the reform: `imports_product_map`, `importer_group_map` (intentionally empty at seed time — populated post-backfill), `ncm_densidade_kg_m3`. Migration: `supabase/migrations/20260525000010_imports_exports_enrichment.sql`. Archived sub-PRDs live under `docs/app/_deprecated/`.

`template-module/` is a starter template, not a deployed module. RPC wrappers: [`src/lib/rpc.ts`](src/lib/rpc.ts) (by module) and [`src/lib/profileRpc.ts`](src/lib/profileRpc.ts).

**Export pattern (Fase B):** all tabular dashboards export both Excel and CSV. Heavy datasets (`/market-share`, `/sales-volumes`, `/mdic-comex`, `/anp-cdp`, `/anp-lpc`) open a modal with active filters and a live size calculator before downloading (Tier 2). Lighter datasets download directly (Tier 1). `/stocks` and `/news-hunter` have no tabular export by design.

## Project Structure

```
dashboard_projeto/
├── .claude/                       # local-only (gitignored) — agent definitions
│   └── agents/                    # worker_* agents per department/dashboard
├── .github/workflows/             # 17 workflows (ETL scrapers + supabase deploy)
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
│   │   ├── anp-cdp.md anp-cdp-bsw.md anp-cdp-depletion.md anp-cdp-diaria.md
│   │   ├── anp-ppi.md anp-precos-produtores.md anp-glp.md
│   │   ├── mdic-comex.md anp-lpc.md
│   │   ├── imports-exports.md     # consolidates the 3 retired anp-* import/export dashboards (2026-05-25)
│   │   ├── anp-precos-distribuicao.md subsidy-tracker.md admin-analytics.md
│   │   ├── _deprecated/           # archived sub-PRDs: anp-daie, anp-desembaracos, anp-painel-importacoes
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
│   │   └── mdic_comex_sync.py
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
│   │       ├── anp-cdp/ anp-cdp-bsw/ anp-cdp-depletion/ anp-cdp-diaria/
│   │       ├── anp-ppi/ anp-precos-produtores/ anp-glp/
│   │       ├── mdic-comex/ anp-lpc/
│   │       ├── imports-exports/   # consolidates the 3 retired anp-* import/export routes (2026-05-25)
│   │       ├── anp-precos-distribuicao/ subsidy-tracker/ admin-analytics/
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
| `stock_portfolios` | uuid | user_id (nullable for system-owned public rows), name, tickers text[], groups jsonb, is_active, **is_public** (default false; anon SELECT policy opens public portfolios) |
| `module_visibility` | module_slug | is_visible_for_clients, is_visible_on_home (default true), **is_visible_for_public** (default true; CHECK + BEFORE trigger enforce `public=true ⇒ clients=true`) |
| `news_articles` | url | domain, source_name, title, snippet, published_at, found_at, matched_keywords text[] (anon SELECT policy added in `20260522000001`) |
| `news_hunter_keywords` | (user_id, keyword) | created_at — per-user, RLS scoped |
| `news_hunter_default_keywords` | keyword | created_at — 27 seed terms (`petróleo`, `Petrobras`, `Vibra`, etc.); single source of truth read by anon and authed users via `get_default_news_keywords()` |
| `profiles` | id (FK auth.users) | role (Admin/Client), full_name, avatar_url |
| `mdic_comex` | id | ano, mes, tipo (IMP/EXP), ncm, descricao_ncm, pais, uf, produto_combustivel, quantidade_kg, valor_fob_usd |
| `anp_ppi` | id | data_referencia, produto, local, preco_ppi, unidade |
| `anp_precos_produtores` | id | data_referencia, produto, regiao, preco, unidade |
| `anp_glp` | (ano, mes, distribuidora, categoria) | ano, mes, distribuidora, categoria (`P13` / `Outros - GLP` / `Outros - Especiais` / `Outros (total)`), vendas_kg |
| `anp_daie` | (ano, mes, produto, operacao) | ano, mes, produto, operacao (`EXPORTAÇÃO` / `IMPORTAÇÃO` — exact uppercase + diacritic), volume_m3, valor_usd |
| `anp_desembaracos` | (ano, mes, ncm_codigo, pais_origem, **cnpj**) | ano, mes, ncm_codigo, pais_origem, quantidade_kg, **importador**, **cnpj**, **uf_cnpj** (3 columns + cnpj added to PK in `20260525000010`, Imports & Exports reform). Pre-reform rows carry sentinel `cnpj='__legacy__'` until ETL backfill rewrites with real CNPJs. |
| `imports_product_map` | (source, source_key) | unified_product (`Diesel`/`Gasoline`/`Crude Oil`), source (`daie`/`desembaracos`), source_key (DAIE produto string OR NCM code). Aux table for `/imports-exports` |
| `importer_group_map` | cnpj | unified_importer, razao_social_seed. **Intentionally empty at seed time** — populated by follow-up DML migration after ETL backfill exposes real CNPJs (T11) |
| `ncm_densidade_kg_m3` | ncm_codigo | densidade_kg_m3 (840 / 740 / 850 for diesel / gasoline / crude oil), produto_label. Used server-side for kg → m³ conversion in `/imports-exports` |
| `anp_lpc` | id | data_referencia, municipio, estado, produto, preco_medio, preco_minimo, preco_maximo, numero_postos |
| `anp_cdp_producao` | (ano, mes, poco, campo, bacia, local) | ano, mes, poco, campo, bacia, local (PosSal/PreSal/Terra), petroleo_bbl_dia, gas_total_mm3_dia, agua_bbl_dia, operador |
| `anp_precos_distribuicao` | id | data_referencia, distribuidora, produto, uf, preco_distribuicao, unidade |
| `anp_voip` | (ano_publicacao, campo) | bacia, estado, voip_bbl, vgip_m3, petroleo_acumulado_bbl, gas_acumulado_m3, fracao_recuperada, situacao |
| `anp_cdp_diaria` | (data, campo, bacia) | petroleo_bbl_dia, gas_mm3_dia; Field level; histórico desde 2025-11-09 |
| `anp_cdp_diaria_instalacao` | (data, instalacao) | campo (NOT NULL), petroleo_bbl_dia, gas_mm3_dia; Installation level; sem coluna bacia |
| `anp_cdp_diaria_poco` | (data, poco) | campo (nullable), bacia (nullable), instalacao (nullable), petroleo_bbl_dia, gas_mm3_dia; Well level; ~180k rows |
| `anp_subsidy_diesel_reference` | (data_referencia, regiao) | data_referencia, regiao, preco_referencia |
| `anp_subsidy_history` | vigente_desde | vigente_desde, subsidio_brl_l, observacao |

**Materialized views:** `mv_ms_serie`, `mv_ms_serie_fast` — pre-aggregated monthly sales, refreshed by `classificar_agentes()`.

> **Tech debt:** `price_bands`, `profiles`, `module_visibility` were created via DDL in [`sql/`](sql/) applied directly to the Supabase Dashboard rather than versioned migrations (`create_price_bands.sql`, `create_profiles_and_visibility.sql`, `create_user_management.sql`). See [`docs/supabase/PRD.md`](docs/supabase/PRD.md) for conversion plan.

## Data Pipelines (17 workflows + 1 external)

| # | Workflow | Schedule | Script(s) | Target |
|---|----------|----------|-----------|--------|
| 1 | `etl_navios_lineup.yml` | Every 6h | `pipelines/navios/01_lineup_scrape.py` → `02_diesel_import.mjs` | `navios_diesel` |
| 2 | `etl_navios_imo_lookup.yml` | After #1 | `pipelines/navios/03_imo_lookup.py` → `04_pipelines/navios/04_cabotage_cleanup.py` | `navios_diesel.imo/mmsi` |
| 3 | `etl_navios_positions.yml` | After #2 | `pipelines/navios/05_positions_sync.py` (VF port-call) | `vessel_positions`, `port_arrivals` |
| 4 | `etl_ais_positions.yml` | Every 6h+15min | `pipelines/ais/positions_sync.py` (AISStream WebSocket) | `vessel_registry`, `vessel_positions`, `port_arrivals` |
| 5 | `etl_ais_candidates.yml` | Every 4h | `pipelines/ais/candidates_discover.py` (AIS global scan, score 0–100) | `import_candidates` |
| 6 | `etl_anp_cdp.yml` | Internal cron `0 8 5 * *` (monthly fallback) + external cron-job.org `workflow_dispatch` every ~2h (incremental ANP wells) | `pipelines/anp/cdp/01_extract.py` → `02_upload.py` (Selenium + ddddocr CAPTCHA) | `anp_cdp_producao` |
| 7 | `etl_anp_vendas.yml` | External trigger (cron-job.org → workflow_dispatch) | `pipelines/anp/vendas_watch.py --force` | `vendas` (ANP fuel sales) |
| 8 | `etl_anp_fase3.yml` | Monthly 1st, 13:00 UTC | `pipelines/anp/fase3/01_daie_sync.py` → `02_desembaracos_sync.py` (preserves `importador`/`cnpj`/`uf_cnpj` since 2026-05-25) | `anp_daie`, `anp_desembaracos` (enriched). Step `03_painel_imp_sync.py` removed by the Imports & Exports reform (2026-05-25); table `anp_painel_imp_dist` dropped. |
| 9 | `etl_anp_lpc.yml` | Weekly Wed 14:30 UTC | `pipelines/anp/lpc_sync.py` | `anp_lpc` |
| 10 | `etl_anp_precos.yml` | Weekly Mon 12:00 UTC | `precos/01_ppi_sync.py` → `02_precos_produtores_sync.py` + `glp_sync.py` | `anp_ppi`, `anp_precos_produtores`, `anp_glp` |
| 11 | `etl_mdic_comex.yml` | Daily 14:00 UTC | `pipelines/mdic_comex_sync.py` | `mdic_comex` |
| 12 | `manual_dg_margins.yml` | Weekly Mon | `manual/dg_margins_upload.py` | `d_g_margins` (manual Excel) |
| 13 | `supabase_deploy.yml` | On push to main | `supabase db push` | migrations |
| 14 | `etl_anp_precos_distribuicao.yml` | Monthly 5th 14:00 UTC + Weekly Tue 14:30 UTC | `pipelines/anp/precos_distribuicao_sync.py` | `anp_precos_distribuicao` |
| 15 | `etl_anp_cdp_diaria.yml` | 3×/day `0 10,15,20 * * *` UTC | `scripts/extractors/anp_cdp_powerbi.py --level all --upload` (Power BI public API, no Selenium) | `anp_cdp_diaria`, `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco` |
| 16 | `etl_anp_voip.yml` | Annual `0 12 1 5 *` (May 1st 12:00 UTC) | `pipelines/anp/voip_sync.py` | `anp_voip` |
| 17 | `etl_anp_subsidy_diesel.yml` | Daily `30 11 * * *` UTC; `workflow_dispatch` with `mode: incremental\|backfill` | `pipelines/anp/subsidy_diesel_sync.py` (`pdfplumber` primary, OCR fallback opt-in) | `anp_subsidy_diesel_reference` |
| ext | News Hunter scanner | Every ~5min via cron-job.org | `news_hunter_service.py --once` (in repo `IBBAOG/news-hunter-scanner`) | `news_articles` |

**News Hunter scanner** lives in a separate repo. Uses `SUPABASE_SERVICE_KEY`. Keywords from UNION of all users' rows in `news_hunter_keywords`. Frontend polls `news_articles` every 60s incrementally (`found_at` watermark).

**Cabotage filtering:** `navios_diesel.is_cabotagem` is a generated column (`flag IN {Brazil,BR}` OR `origem` pattern). All navios RPCs filter `WHERE NOT is_cabotagem`.

**Manual data subsystem (`data/`):** `data/d_g_margins.xlsx` and `data/price_bands.xlsx` are edited by hand and uploaded via `scripts/manual/dg_margins_upload.py` (weekly automated) and `scripts/manual/price_bands_upload.py` (manual). Both files are gitignored.

**Alert subsystem (`alertas/`):** local-only (gitignored), self-contained. 12 detection bases over Supabase tables/parquet files, sends notifications via Gmail API. See `alertas/PRD_ALERTAS.md`.

## Shared Dashboard Components (Fase 4)

Extracted from the 10 Fase 3 dashboards to prevent visual drift. All live in [`src/components/dashboard/`](src/components/dashboard/).

| Component | Purpose |
|-----------|---------|
| `DashboardHeader.tsx` | Title + subtitle + period badge + `<hr>` separator. Props: `lang`, `extraBadge`, `rightSlot`, `hideDivider` |
| `MultiSelectFilter.tsx` | Checkbox list with Limpar button, `(N/total)` counter and optional color swatch |
| `PeriodSlider.tsx` | rc-slider wrapper; accepts `years: number[]` or `dates: string[]` |
| `ChartSection.tsx` | Section title + "atualizando..." indicator + opacity 0.5 loading state |
| `ExportPanel.tsx` | Declarative `actions[]` array with `kind=excel\|csv`, busy state, loading label. Accepts `mode="modal"` for Tier 2 |
| `ExportModal.tsx` | Bootstrap modal with active-filter slot + live size calculator ("X MB · Y rows") + >200k warning. Tier 2 only |
| `SegmentedToggle.tsx` | Orange-pill toggle for full vs compact view |
| `BarrelLoading.tsx` | Barrel spinner via next/image; supports `bare` mode for inline use |

**Shared hooks/libs:**

| File | Purpose |
|------|---------|
| [`src/hooks/useDebouncedFetch.ts`](src/hooks/useDebouncedFetch.ts) | useCallback + useRef debounce (400ms) with in-flight cancel |
| [`src/hooks/useExportSize.ts`](src/hooks/useExportSize.ts) | Calls `get_*_export_count` RPC with 300ms debounce; returns `{ bytes, rows, label }` for ExportModal |
| [`src/lib/plotlyDefaults.ts`](src/lib/plotlyDefaults.ts) | `COMMON_LAYOUT`, `AXIS_LINE`, `emptyPlot()`, `BRAND_ORANGE`, `PALETTE` |
| [`src/lib/units.ts`](src/lib/units.ts) | `kgToMilTon`, `m3ToMilM3` converters + `LABEL` constants |
| [`src/lib/exportCsv.ts`](src/lib/exportCsv.ts) | `downloadCsv<T>(opts)` — single RFC4180 CSV helper |
| [`src/lib/exportSizeHeuristics.ts`](src/lib/exportSizeHeuristics.ts) | `estimateSize(rows, datasetKey)`, `formatBytes(b)`, `AVG_BYTES_PER_ROW` empirical map |

## Auth & Roles

Three tiers share the same routing infra; the auth guard in `(dashboard)/layout.tsx` no longer forces `/login` — it only checks MFA (AAL2) for Admins who already have a session.

| Tier | Auth state | Visibility | MFA |
|------|-----------|-----------|-----|
| **Anon** | No `supabase.auth` session | Modules with `is_visible_for_public=true` | N/A |
| **Client** | Authenticated, `profiles.role='Client'` | Modules with `is_visible_for_clients=true` | Opt-in (optional) |
| **Admin** | Authenticated, `profiles.role='Admin'` | All modules + `/admin-panel`, `/admin-analytics` | **Required** (AAL2 enforced; enrollment via `/profile/mfa`) |

- Role derived in `UserProfileContext`: `profile?.role==='Admin' ? 'Admin' : profile ? 'Client' : 'Anon'`. Consumers branch on `role` instead of `profile?.role`.
- `useModuleVisibilityGuard(slug)` is 3-tier: Admin always passes; Anon checks `publicVisibility[slug]`; Client checks `moduleVisibility[slug]`. Missing keys default to `true` (safe degradation). Redirect target: `/home`.
- `useRoleGuard("Admin")` continues to protect Admin-only pages (`/admin-panel`, `/admin-analytics`); Admins without an enrolled MFA factor are redirected to `/profile/mfa`.
- `/profile` redirects Anon → `/login` (per-user only, no public fallback).

### Module visibility — three independent axes

All in `module_visibility`, loaded once by `UserProfileContext` from RPC `get_module_visibility()` (granted to `anon` + `authenticated`):

| Axis | Meaning | Managed via | RPC |
|------|---------|-------------|-----|
| `is_visible_for_public` | Whether an anonymous visitor can open the module. Default `true`. **Invariant:** `public=true` implies `clients=true` (CHECK + BEFORE trigger coerce automatically). | Admin Panel → Permissions tab (column "Public") | `set_module_public_visibility` |
| `is_visible_for_clients` | Whether a logged-in Client can open the module (Admin always can). | Admin Panel → Permissions tab (column "Clients") | `set_module_visibility` |
| `is_visible_on_home` | Whether the module card appears in the `/home` gallery for **all** users (including Admin). Default `true`. | Admin Panel → Card Images tab (Show on Home toggle) | `set_module_home_visibility` |

### Anonymous visitor analytics

- `src/proxy.ts` (Next.js 16 — formerly `middleware.ts`) issues an HttpOnly cookie `sd_visitor_id` (UUID v4, SameSite=Lax, Secure, Max-Age 1 year). Bots (UA matches `/bot|crawler|spider|crawling|slurp/i`) get no cookie.
- `GET /api/visitor-id` exposes the cookie to the browser (HttpOnly hides it from `document.cookie`).
- `track_event(event_type, route, payload, visitor_id)` accepts a 4th parameter for anonymous attribution. `app_events.user_id` is now nullable; `app_events.visitor_id` carries the anon UUID. CHECK `(user_id OR visitor_id)` ensures every row has an actor.
- Cookie namespace: always `sd_*` (SectorData). The `sb-*` prefix is reserved by Supabase Auth (`sb-access-token`, `sb-refresh-token`) — never collide.

## Adding a New Dashboard (developer quick-start)

Every dashboard ships as a **dual-view module** (desktop + mobile) — see [`docs/app/dual-view-pattern.md`](docs/app/dual-view-pattern.md) for the full template.

1. Copy `src/app/(dashboard)/template-module/` → new route folder. You get the canonical layout:
   ```
   <slug>/
   ├── page.tsx                 ← viewport router (useIsMobile)
   ├── use<Slug>Data.ts         ← single shared hook (RPCs, filters, derivations)
   ├── desktop/View.tsx         ← desktop UX
   └── mobile/View.tsx          ← mobile UX (mobile-first)
   ```
2. Add nav entry in `src/components/NavBar.tsx` (`NAV_ENTRIES`)
3. Create Supabase migration with tables + RPCs + **RLS**
4. Add RPC wrappers in `src/lib/rpc.ts`
5. `INSERT INTO module_visibility VALUES ('<slug>', true);`
6. Use `useModuleVisibilityGuard("<slug>")` inside both Views (or in the hook)
7. **Implement the data layer in the hook only.** Both Views consume it — they never call Supabase directly. The hook contract: `{ data, loading, error, filters, setFilters }`.
8. **Use shared desktop components** from `src/components/dashboard/` — `DashboardHeader`, `MultiSelectFilter`, `PeriodSlider`, `ChartSection`, `ExportPanel`, `SegmentedToggle`, `BarrelLoading` — inside `desktop/View.tsx`.
9. **Use shared mobile components** from `src/components/dashboard/mobile/` — `MobileNavBar`, `BottomSheet`, `FilterDrawer`, `MobileChart`, `MobileDataCard`, `StickyBreadcrumb`, `ExportFAB`, `MobileTabBar` — inside `mobile/View.tsx`.
10. **Use shared hooks/libs** — `useIsMobile` (the only breakpoint source), `useDebouncedFetch` for RPC calls, `plotlyDefaults` for chart layout, `units.ts` for volume conversions.

> **Binding sync rule:** any meaningful change to one View (new filter, chart, KPI, copy) must land in the OTHER View in the same commit, or the commit message must declare `[desktop-only]` / `[mobile-only]` with an explicit reason. See [`CLAUDE.md` § Dual-view policy](CLAUDE.md).

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
