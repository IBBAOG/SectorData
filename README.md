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

> **Round 5 — Dashboard renames (2026-05-28):** the dashboard previously named *Well by Well* is now **Brazil Production Summary** (`/well-by-well` URL unchanged), and *Production by Well* is now **Monthly Production** (`/anp-cdp` URL unchanged). Pure UI-string rename — no migration, RPC or schema impact.

### Core (Fase 1–2)

| Route | RPC functions | Export |
|-------|---------------|--------|
| `/home` | `get_data_sources_freshness` (desktop only — Data Sources live table) | — |
| `/market-share` | Market share % and absolute volumes via top-level toggle (% Share ↔ thousand m³). `get_ms_opcoes_filtros`, `get_ms_serie_fast`, `get_ms_serie_others`, `get_others_players` | Yes |
| `/navios-diesel` | `get_nd_ultima_coleta`, `get_nd_coletas_distintas`, `get_nd_navios`, `get_nd_resumo_portos` | Yes |
| `/diesel-gasoline-margins` | `get_dg_margins_data`, `get_dg_margins_filters` | Yes |
| `/price-bands` | `get_price_bands_data` | Yes |
| `/stocks` | `stock_portfolios` (direct PostgREST) + Yahoo Finance proxy | No |
| `/news-hunter` | `seed_my_news_hunter_keywords` | No |
| `/profile` | `get_my_profile`, `upsert_my_profile` | — |
| `/admin-panel` | `get_module_visibility`, `set_module_visibility`, `set_module_home_visibility`, `set_module_public_visibility`, `get_all_users_with_roles`, `set_user_role`, `admin_list_default_news_keywords`, `admin_add_default_news_keyword`, `admin_set_default_news_keyword_match_type`, `admin_remove_default_news_keyword`, `get_field_stakes_overview`, `get_field_stakes`, `get_field_stakes_empresas`, `admin_upsert_field_stakes`, `admin_delete_field_stakes` | — |

### Statistics (Fase 3 onwards — 11 dashboards)

| Route | Category | RPC functions | Export |
|-------|----------|---------------|--------|
| `/well-by-well` | Oil & Gas | `get_production_brazil_aggregate`, `get_production_company_aggregate`, `get_production_top_fields`, `get_production_by_installation`, `get_production_yoy_table` | Yes |
| `/stock-guide` | Oil & Gas (Equities) | `get_stock_guide_comps` (hide-aware), `get_stock_guide_sensitivity`, `get_stock_guide_config` + 7 admin RPCs (`admin_get_stock_guide_companies`, `admin_get_stock_guide_sensitivity`, `admin_upsert_stock_guide_company`, `admin_upsert_stock_guide_sensitivity`, `admin_set_stock_guide_visibility`, `admin_upsert_stock_guide_config`, `admin_delete_stock_guide_company`) + Yahoo Finance proxy (live market cap / upside) | Yes (desktop only) |
| `/anp-cdp` | Oil & Gas | `get_anp_cdp_poco_serie`, `get_anp_cdp_pocos_json`, `get_anp_cdp_filtros` | Yes |
| `/anp-cdp-bsw` | Oil & Gas | `get_anp_cdp_bsw_scatter`, `get_anp_cdp_bsw_field_aggregate` (X axis: `pct_voip`), `get_anp_cdp_bsw_campos` | No |
| `/anp-cdp-depletion` | Oil & Gas | `get_anp_cdp_depletion_campos`, `get_anp_cdp_depletion_scatter`, `get_anp_cdp_depletion_field_aggregate` | No |
| `/anp-cdp-diaria` | Oil & Gas | `get_anp_cdp_diaria_filtros`, `get_anp_cdp_diaria_serie` | Yes |
| `/anp-glp` | Fuel Distribution | `get_anp_glp_serie`, `get_anp_glp_filtros` | Yes |
| `/anp-prices` | Fuel Distribution | `get_anp_prices_filtros`, `get_anp_prices_serie`, `get_anp_prices_export_count` | Yes |
| `/imports-exports` | Fuel Distribution | `get_imports_exports_filtros`, `get_imports_exports_paises_stacked`, `get_imports_exports_importers_stacked`, `get_imports_exports_yoy_table`, `get_imports_exports_exports_paises_stacked`, `get_imports_exports_exports_yoy_table`, `get_imports_exports_imports_unit_price`, `get_imports_exports_exports_unit_price` | Yes |
| `/subsidy-tracker` | Fuel Distribution (Proprietary) | `get_subsidy_tracker_diesel` (rewritten 2026-05-27: 11 columns including `ipp_adjusted` / `petrobras_adjusted` and dual-agent `_importador` / `_produtor` suffixes) | Yes |

> **Stock Guide dashboard (2026-06-01):** `/stock-guide` is the equities-research module for the Brazilian Oil & Gas + Fuel Distribution coverage universe. Two analyses share one brain (`useStockGuideData.ts`): a wide **comps table** (one row per covered company — target price, recommendation OP/MP/UP, and six forward multiple pairs EV/EBITDA · P/E · FCFE Yield · Div Yield · EBITDA · Volumes, each split into `config.y1_label`/`config.y2_label`, e.g. 2026E/2027E) and a per-company **freeform 2D sensitivity grid**. **Market cap and upside are computed live in the browser** from the existing Yahoo proxy (`/api/stocks/quote`, reusing `useStockQuote`) — never stored — via one batched quote for visible tickers (fetch-once-on-load + manual refresh, no polling). All comps numbers, sensitivity grids, the per-company hide toggle and the global config are **admin-only inputs** in a new `/admin-panel` → Stock Guide section. Backed by migration `supabase/migrations/20260603200000_stock_guide.sql` — **3 tables** (`stock_guide_companies`, `stock_guide_sensitivity`, `stock_guide_config`, all RLS-enabled with **no policies** so every read flows through SECURITY DEFINER RPCs) and **10 RPCs** (3 public + 7 admin). `get_stock_guide_comps()` is **hide-aware** — for a hidden company seen by a non-admin it nulls every financial field and the `yahoo_symbol`, keeping only the name for a "Currently restricted" footnote, so restricted financials never reach a non-admin browser. Seeds 10 companies (6 visible: PETR4, PRIO3, RECV3, OPCT3, VBBR3, UGPA3; 4 restricted: BRAV3, RAIZ4, CSAN3, BRKM4). Dual-view (desktop wide sticky table + sensitivity panel; mobile cards + BottomSheet). Tier 1 export (Excel + CSV of the computed visible table, **desktop only**). NavBar: new "Equities" group under the "Oil & Gas" module. Visible to Client + Admin, hidden from Anon (`is_visible_for_public=false`). Owner: `worker_dash-stock-guide`.

> **Brazil Production Summary dashboard (2026-05-28, Fase 2 of Field Stakes & Production; historically introduced as *Well by Well*, renamed in Round 5):** the executive-summary dashboard `/well-by-well` mirrors the monthly *Well-by-Well* report — Brazil aggregate + stake-weighted company aggregate (default Petrobras) + top fields + FPSO/UEP breakdown + MoM/YoY/YTD table. Backed by 5 new RPCs (`get_production_brazil_aggregate`, `get_production_company_aggregate`, `get_production_top_fields`, `get_production_by_installation`, `get_production_yoy_table`) that JOIN `anp_cdp_producao` × `field_stakes` (admin-curated, Fase 1). The company aggregate is stake-weighted and **only includes campos whose `field_stakes` sum to 100** — campos still pending manual fill (see `docs/dados-locais/field_stakes_lacunas.md`, 240 lacunas + 2 unmatched as of 2026-05-26) are silently excluded so partial stakes never inflate company totals. Coexists with `/anp-cdp` (granular *Monthly Production* explorer, renamed from *Production by Well* in Round 5); `/well-by-well` is the C-suite view, `/anp-cdp` is the analyst view. Dual-view (desktop 2×2 panels + mobile tab bar), Tier 1 export. Visible to Client + Admin, hidden from Anon (`is_visible_for_public=false`). Migration: `supabase/migrations/20260528000000_production_rpcs.sql`.

> **Round 4 — `/well-by-well` rename + canonical field grouping + live admin field list (2026-05-28):** the `/production` route was renamed to `/well-by-well` to align with the underlying *Well-by-Well* report terminology. Field grouping is now canonical at the dashboard layer — variant well names that map to the same physical field (Búzios, AnC_Búzios, Búzios_ECO, etc.) are consolidated server-side via the new SQL helper `canonical_field_name(text)` + override table `field_canonical_names(field_raw text, field_canonical text)` so charts, top-fields ranks and YoY math see one row per physical field. The admin Field Stakes UI keeps the source-level granularity (variants stay separate) so Eduardo can register working-interest per ANP raw field name. The admin field list is now **live** — populated from the last 2 months of `anp_cdp_producao` directly (no MV refresh needed), so newly producing fields appear without an ETL recycle. Migration: `supabase/migrations/20260528300000_well_by_well_round4.sql`. **Round 5 follow-up (same day):** the user-facing label "Well by Well" was renamed to **"Brazil Production Summary"** and `/anp-cdp`'s label "Production by Well" became **"Monthly Production"** — pure UI-string rename, slugs/RPCs untouched.

> **Diesel Subsidy Reform (2026-05-27):** `/subsidy-tracker` and `/price-bands` were rewired around the correct subsidy mechanic — the value previously stored in `anp_subsidy_history.subsidio_brl_l` is actually the **cap** of the per-region reimbursement, not the difference. The table `anp_subsidy_history` was dropped and replaced by `anp_subsidy_caps` (by `(vigente_desde, tipo_agente)`) plus `anp_subsidy_commercialization` (period × region × agent commercialization prices, populated by an HTML scrape stage added to `subsidy_diesel_sync.py`). New SQL function `compute_subsidy_reimbursement(date, tipo_agente)` returns the average across the 5 regions of `MIN(MAX(ref − comm, 0), cap)`. Four triggers on `price_bands` / `anp_subsidy_diesel_reference` / `anp_subsidy_commercialization` / `anp_subsidy_caps` keep `price_bands.bba_import_parity_w_subsidy` and `price_bands.petrobras_price_w_subsidy` in sync automatically — the Excel upload no longer carries those columns. `get_subsidy_tracker_diesel()` was rewritten with an 11-column signature including `ipp_adjusted` / `petrobras_adjusted` and dual-agent `_importador` / `_produtor` aggregates. Migrations: `supabase/migrations/20260527200000_subsidy_reform.sql` + hotfix `20260527300000_data_sources_freshness_subsidy_fix.sql` (rebuilds `get_data_sources_freshness` for the new tables; 23 sources, up from 22).

> **Sales Volumes consolidation (2026-05-26):** `/sales-volumes` retired and folded into `/market-share` via a top-level unit toggle (% Share ↔ thousand m³). URL `/sales-volumes` now 301-redirects to `/market-share?unit=volume`. Both modes share `get_ms_serie_fast` / `get_ms_serie_others` / `get_others_players` and `get_ms_opcoes_filtros`; the legacy `get_sv_*` family was dropped by `20260526400000_drop_sv_rpcs.sql` after frontend migration. Archived sub-PRD: `docs/app/_deprecated/sales-volumes.md`.

> **Home Data Sources live table (2026-05-26, `[desktop-only]`):** `/home` desktop layout splits 50/50 — module cards on the left, live "Data Sources" table on the right. Mobile view is unchanged (cards only). Backed by RPC `get_data_sources_freshness()` (migration `20260526200000_data_sources_freshness.sql` + hotfix `20260527300000_data_sources_freshness_subsidy_fix.sql`), which returns `(source_key, last_update, row_count)` for **23 ETL-fed tables** as of 2026-05-27 (the Diesel Subsidy Reform replaced `anp_subsidy_history` with `anp_subsidy_caps` + `anp_subsidy_commercialization`). `LANGUAGE sql STABLE SECURITY DEFINER` + `search_path = public, pg_temp`, granted to `anon` + `authenticated`. Polled every 60s by `useDataSourcesFreshness`. Source-of-truth curation lives in `src/data/dataSources.ts` (23 entries — 22 tables + Yahoo Finance, which has no Supabase table). UI components: `src/components/home/DataSourcesTable/` (8 files). Visible to all tiers (Anon + Client + Admin) — serves as product transparency/robustness showcase. Download per row gated by session (Anon sees disabled "Sign in to download"). New design tokens added to `src/app/globals.css` (`--ds-cat-*`, `--ds-status-*`, `--ds-glass-*`, `--ds-pulse-*` + keyframe `ds-pulse-dot` + `.ds-pulse` utility class).

> **ANP Prices consolidation (2026-05-26):** `/anp-prices` replaces the 3 retired dashboards `/anp-precos-produtores`, `/anp-precos-distribuicao`, `/anp-lpc`. Backed by the 3 source tables (`anp_precos_produtores`, `anp_precos_distribuicao`, `anp_lpc`) joined server-side via `get_anp_prices_serie` (UNION ALL with product/unit/region normalization, Diesel S10→S500 fallback, GLP normalized to R$/13kg). 10 legacy RPCs dropped. ETL pipelines untouched. Archived sub-PRDs live under `docs/app/_deprecated/`. Migration: `supabase/migrations/20260526000000_anp_prices_consolidation.sql` + `20260526000001_anp_prices_uf_fix.sql`.

> **Imports & Exports reform (2026-05-25):** `/imports-exports` replaces the 3 retired dashboards `/anp-daie`, `/anp-desembaracos`, `/anp-painel-importacoes`. Backed by `anp_desembaracos` (enriched with `importador`/`cnpj`/`uf_cnpj`, PK extended with `cnpj`) and `anp_daie`. The dropped table `anp_painel_imp_dist` and its 8 obsolete RPCs are removed. Auxiliary lookup tables seeded by the reform: `imports_product_map`, `importer_group_map` (intentionally empty at seed time — populated post-backfill), `ncm_densidade_kg_m3`. Migration: `supabase/migrations/20260525000010_imports_exports_enrichment.sql`. Archived sub-PRDs live under `docs/app/_deprecated/`.

> **Exports tab rewire (2026-05-25, migration `20260525000110_imports_exports_exports_by_country.sql`):** the Exports tab moved from a single-line ANP DAIE chart to a stacked-area-by-destination-country chart plus a YoY top-10 table, sourced from `mdic_comex` filtered by `flow='export'`. Volume (mil m³) / Value (USD) toggle is preserved. The old `get_imports_exports_exports_serie(text[], int, int)` was DROPPED and replaced by `get_imports_exports_exports_paises_stacked(p_unified_product text, p_ano_inicio int, p_ano_fim int, p_metric text, p_top_n int)` and `get_imports_exports_exports_yoy_table(p_unified_product text, p_ano_inicio int, p_ano_fim int, p_metric text, p_top_n int)`. Importer-level breakdown for exports remains unavailable (MDIC does not carry importer identity). Panel C ("Import Price") is unchanged and still uses `get_imports_exports_fob_price_serie`.

> **`/imports-exports` Panel C removal + price summary tables (2026-05-28):** Panel C ("Import Price USD/bbl" single-line chart) was removed as redundant with Panel D. Two new summary tables were added — **Import Price Summary** (3 rows: top-2 origin countries by volume in window + volume-weighted "Others") below the Imports unit-price chart, and **Export Price Summary** (all top-N destinations, no Others collapse) below the Crude Oil exports chart. Tables expose `Country | Latest | MoM% | YoY%`, with the Latest unit synced to the chart toggle (USD/ton ↔ ¢/gal for Imports; USD/bbl fixed for Exports). The 2 unit-price RPCs (`get_imports_exports_imports_unit_price`, `get_imports_exports_exports_unit_price`) now also return `vol_m3 numeric` (used as the weight for the Imports "Others" row). The orphaned `get_imports_exports_fob_price_serie` was dropped. Migration: `supabase/migrations/20260528960000_imports_exports_unit_price_with_volume.sql`.

> **`/mdic-comex` deprecation (2026-05-25, updated 2026-05-28):** standalone dashboard retired; its function was originally absorbed by `/imports-exports` Panel C ("Import Price"). After Panel C removal on 2026-05-28, MDIC Comex data feeds `/imports-exports` Panel D ("Import Unit Price by Origin Country") and the Crude Oil Export Unit Price chart instead, via `get_imports_exports_imports_unit_price` and `get_imports_exports_exports_unit_price`. The two new summary tables (Imports = top-2 + Others; Exports = all destinations) consume the same RPCs. The `mdic_comex` table and the `etl_mdic_comex.yml` workflow remain active. The 5 `get_mdic_comex_*` RPCs were dropped on 2026-05-25. Archived sub-PRD: `docs/app/_deprecated/mdic-comex.md`.

> **Field Stakes admin input (2026-05-26, Fase 1 of Field Stakes & Production):** new admin-only-curated table `field_stakes(campo, empresa, stake_pct)` lets the Admin register the working-interest breakdown of each oil field — used to estimate company-attributable production (e.g. Petrobras stake in Búzios = 88.99%). CRUD lives in a new section of `/admin-panel` (Field Stakes). Migration: `supabase/migrations/20260527600000_field_stakes.sql`. Writes via `admin_upsert_field_stakes` (atomic replace-all per campo, enforces `SUM(stake_pct) = 100`) and `admin_delete_field_stakes`; reads via `get_field_stakes_overview`, `get_field_stakes`, `get_field_stakes_empresas`. A future `/well-by-well` dashboard (Fase 2, separate PRD) will join `anp_cdp_producao` x `field_stakes` to render company-level production charts mirroring the monthly Well-by-Well report.

`template-module/` is a starter template, not a deployed module. RPC wrappers: [`src/lib/rpc.ts`](src/lib/rpc.ts) (by module) and [`src/lib/profileRpc.ts`](src/lib/profileRpc.ts).

**Export pattern (Fase B):** all tabular dashboards export both Excel and CSV. Heavy datasets (`/market-share` — both % Share and absolute volume modes, `/anp-cdp`, `/anp-lpc`) open a modal with active filters and a live size calculator before downloading (Tier 2). Lighter datasets download directly (Tier 1). `/stocks` and `/news-hunter` have no tabular export by design.

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
│   │   ├── market-share.md        # absorbs /sales-volumes (% Share ↔ thousand m³ toggle, 2026-05-26)
│   │   ├── navios-diesel.md
│   │   ├── diesel-gasoline-margins.md
│   │   ├── price-bands.md
│   │   ├── stocks.md
│   │   ├── news-hunter.md
│   │   ├── admin.md               # bundle: home + profile + admin-panel
│   │   ├── anp-cdp.md anp-cdp-bsw.md anp-cdp-depletion.md anp-cdp-diaria.md
│   │   ├── anp-glp.md
│   │   ├── anp-prices.md          # consolidates /anp-precos-produtores + /anp-precos-distribuicao + /anp-lpc (2026-05-26)
│   │   ├── imports-exports.md     # consolidates the 3 retired anp-* import/export dashboards + /mdic-comex (Panel C, 2026-05-25)
│   │   ├── subsidy-tracker.md admin-analytics.md
│   │   ├── _deprecated/           # archived sub-PRDs: anp-daie, anp-desembaracos, anp-painel-importacoes, mdic-comex, anp-precos-produtores, anp-precos-distribuicao, anp-lpc, sales-volumes
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
│   │   │   └── precos/            #   02_precos_produtores_sync.py
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
│   │       ├── home/ market-share/ navios-diesel/
│   │       ├── diesel-gasoline-margins/ price-bands/ stocks/
│   │       ├── news-hunter/       # page.tsx + page.module.css
│   │       ├── anp-cdp/ anp-cdp-bsw/ anp-cdp-depletion/ anp-cdp-diaria/
│   │       ├── anp-glp/
│   │       ├── anp-prices/        # consolidates /anp-precos-produtores + /anp-precos-distribuicao + /anp-lpc (2026-05-26)
│   │       ├── imports-exports/   # consolidates the 3 retired anp-* import/export routes + Panel C absorbs /mdic-comex (2026-05-25)
│   │       ├── subsidy-tracker/ admin-analytics/
│   │       ├── stock-guide/        # equities comps + sensitivity (live mkt cap/upside via Yahoo proxy, 2026-06-01)
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
│   └── migrations/                # 57+ migrations as of 2026-05 (includes 20260527200000_subsidy_reform and 20260527300000_data_sources_freshness_subsidy_fix)
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
| `field_stakes` | (campo, empresa) | campo, empresa, stake_pct (numeric(6,3) CHECK >0 AND <=100), updated_at, updated_by. Admin-curated working-interest per oil field x per company; SUM(stake_pct) per campo = 100 enforced by RPC `admin_upsert_field_stakes`. Read by anon + authenticated; writes only via SECURITY DEFINER RPCs guarded by `is_admin()`. |
| `stock_guide_companies` | ticker | company_name, yahoo_symbol, sector (`oil_gas`/`fuel_distribution`), volume_unit (`kbpd`/`thousand_m3`), shares_outstanding, last_update, target_price, recommendation (`OP`/`MP`/`UP`/NULL), six forward pairs `{ev_ebitda,pe,fcfe_yield,div_yield,ebitda,volumes}_{y1,y2}`, is_visible (default true), display_order, updated_at, updated_by. Admin-curated equities comps. **RLS enabled with NO policies** — direct PostgREST returns `[]`; all reads flow through hide-aware SECURITY DEFINER RPCs (`get_stock_guide_comps` nulls hidden companies' financials for non-admins). Market cap / upside computed live in the browser, not stored. |
| `stock_guide_sensitivity` | ticker (FK→`stock_guide_companies` ON DELETE CASCADE) | grid jsonb (`{row_axis_title, col_axis_title, value_label, row_labels[], col_labels[], cells[][]}`) — freeform 2D matrix per company. RLS enabled, no policies. |
| `stock_guide_config` | id (singleton, CHECK id=1) | y1_label (default '2026E'), y2_label (default '2027E'), assumptions_note, updated_at, updated_by. RLS enabled, no policies. |
| `price_bands` | id | date, product, bba_import_parity, **bba_import_parity_w_subsidy** (auto-populated by trigger since 2026-05-27), bba_export_parity, petrobras_price, **petrobras_price_w_subsidy** (auto-populated by trigger since 2026-05-27) |
| `stock_portfolios` | uuid | user_id (nullable for system-owned public rows), name, tickers text[], groups jsonb, is_active, **is_public** (default false; anon SELECT policy opens public portfolios) |
| `module_visibility` | module_slug | is_visible_for_clients, is_visible_on_home (default true), **is_visible_for_public** (default true; CHECK + BEFORE trigger enforce `public=true ⇒ clients=true`) |
| `news_articles` | url | domain, source_name, title, snippet, published_at, found_at, matched_keywords text[] (anon SELECT policy added in `20260522000001`) |
| `news_hunter_keywords` | (user_id, keyword) | created_at — per-user, RLS scoped |
| `news_hunter_default_keywords` | keyword | match_type (`substring` default \| `exact`, added 2026-05-25), created_at — 27 seed terms (`petróleo`, `Petrobras`, `Vibra`, etc.); single source of truth. Read by anon and authed users via `get_default_news_keywords()` (returns `text[]`, retrocompat) and `get_default_news_keywords_with_flags()` (returns `(keyword, match_type)`, consumed by scanner repo). Schema mirrors per-user `news_hunter_keywords`. |
| `profiles` | id (FK auth.users) | role (Admin/Client), full_name, avatar_url |
| `mdic_comex` | id | ano, mes, tipo (IMP/EXP), ncm, descricao_ncm, pais, uf, produto_combustivel, quantidade_kg, valor_fob_usd. Consumed by `/imports-exports` via `get_imports_exports_imports_unit_price` (Panel D + Import Price Summary) and `get_imports_exports_exports_unit_price` (Crude Oil Export Unit Price + Export Price Summary). The standalone `/mdic-comex` dashboard was retired 2026-05-25; Panel C ("Import Price USD/bbl") that originally absorbed it was removed 2026-05-28. |
| `anp_precos_produtores` | id | data_referencia, produto, regiao, preco, unidade |
| `anp_glp` | (ano, mes, distribuidora, categoria) | ano, mes, distribuidora, categoria (`P13` / `Outros - GLP` / `Outros - Especiais` / `Outros (total)`), vendas_kg |
| `anp_daie` | (ano, mes, produto, operacao) | ano, mes, produto, operacao (`EXPORTAÇÃO` / `IMPORTAÇÃO` — exact uppercase + diacritic), volume_m3, valor_usd |
| `anp_desembaracos` | (ano, mes, ncm_codigo, pais_origem, **cnpj**) | ano, mes, ncm_codigo, pais_origem, quantidade_kg, **importador**, **cnpj**, **uf_cnpj** (3 columns + cnpj added to PK in `20260525000010`, Imports & Exports reform). Pre-reform rows carry sentinel `cnpj='__legacy__'` until ETL backfill rewrites with real CNPJs. |
| `imports_product_map` | (source, source_key) | unified_product (`Diesel`/`Gasoline`/`Crude Oil`), source (`daie`/`desembaracos`), source_key (DAIE produto string OR NCM code). Aux table for `/imports-exports` |
| `importer_group_map` | cnpj | unified_importer, razao_social_seed. **Intentionally empty at seed time** — populated by follow-up DML migration after ETL backfill exposes real CNPJs (T11) |
| `ncm_densidade_kg_m3` | ncm_codigo | densidade_kg_m3 (840 / 740 / 850 for diesel / gasoline / crude oil), produto_label. Used server-side for kg → m³ conversion in `/imports-exports` |
| `anp_lpc` | id | data_referencia, municipio, estado, produto, preco_medio, preco_minimo, preco_maximo, numero_postos |
| `anp_cdp_producao` | (ano, mes, poco, campo, bacia, local) | ano, mes, poco, campo, bacia, local (PosSal/PreSal/Terra), petroleo_bbl_dia, oleo_bbl_dia, gas_total_mm3_dia, agua_bbl_dia, tempo_prod_hs_mes, operador |
| `anp_precos_distribuicao` | id | data_referencia, distribuidora, produto, uf, preco_distribuicao, unidade |
| `anp_voip` | (ano_publicacao, campo) | bacia, estado, voip_bbl, vgip_m3, petroleo_acumulado_bbl, gas_acumulado_m3, fracao_recuperada, situacao |
| `anp_cdp_diaria` | (data, campo, bacia) | petroleo_bbl_dia, gas_mm3_dia; Field level; histórico desde 2025-11-09 |
| `anp_cdp_diaria_instalacao` | (data, instalacao) | campo (NOT NULL), petroleo_bbl_dia, gas_mm3_dia; Installation level; sem coluna bacia |
| `anp_cdp_diaria_poco` | (data, poco) | campo (nullable), bacia (nullable), instalacao (nullable), petroleo_bbl_dia, gas_mm3_dia; Well level; ~180k rows |
| `anp_subsidy_diesel_reference` | (data_referencia, regiao, tipo_agente) | data_referencia, regiao, tipo_agente (`importador`/`produtor`), preco_referencia |
| `anp_subsidy_caps` | (vigente_desde, tipo_agente) | cap_brl_l NUMERIC(10,4), observacao, inserted_at — **ceiling** of the per-region reimbursement (replaces the wrongly-modeled `anp_subsidy_history` since 2026-05-27). Maintained manually. |
| `anp_subsidy_commercialization` | (data_inicio, regiao, tipo_agente) | data_fim, preco_comercializacao NUMERIC(10,4), ordinal, pdf_url, inserted_at — period × region × agent commercialization prices, populated by the HTML scrape stage of `subsidy_diesel_sync.py` (since 2026-05-27). |

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
| 10 | `etl_anp_precos.yml` | Weekly Mon 12:00 UTC | `precos/02_precos_produtores_sync.py` + `glp_sync.py` | `anp_precos_produtores`, `anp_glp` |
| 11 | `etl_mdic_comex.yml` | Daily 14:00 UTC | `pipelines/mdic_comex_sync.py` | `mdic_comex` (feeds `/imports-exports` Panel D + Import/Export Price Summary tables via the unit-price RPCs; standalone `/mdic-comex` retired 2026-05-25, Panel C "Import Price" removed 2026-05-28) |
| 12 | `manual_dg_margins.yml` | Weekly Mon | `manual/dg_margins_upload.py` | `d_g_margins` (manual Excel) |
| 13 | `supabase_deploy.yml` | On push to main | `supabase db push` | migrations |
| 14 | `etl_anp_precos_distribuicao.yml` | Monthly 5th 14:00 UTC + Weekly Tue 14:30 UTC | `pipelines/anp/precos_distribuicao_sync.py` | `anp_precos_distribuicao` |
| 15 | `etl_anp_cdp_diaria.yml` | 3×/day `0 10,15,20 * * *` UTC | `scripts/extractors/anp_cdp_powerbi.py --level all --upload` (Power BI public API, no Selenium) | `anp_cdp_diaria`, `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco` |
| 16 | `etl_anp_voip.yml` | Annual `0 12 1 5 *` (May 1st 12:00 UTC) | `pipelines/anp/voip_sync.py` | `anp_voip` |
| 17 | `etl_anp_subsidy_diesel.yml` | Daily `30 11 * * *` UTC; `workflow_dispatch` with `mode: incremental\|backfill` | `pipelines/anp/subsidy_diesel_sync.py` (PDF flow via `pdfplumber` + **HTML commercialization scrape stage** since 2026-05-27; CLI also accepts `--skip-commercialization` / `--commercialization-only`) | `anp_subsidy_diesel_reference` + `anp_subsidy_commercialization` (the HTML stage runs before the PDF flow so triggers on `reference` see populated commercialization data) |
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

## Mobile reform (2026-05-27)

Cross-cutting reform of the mobile experience, delivered in 3 waves (Designer Liquid Glass v2 → mobile shell + `/home v2` → 10 dashboard refactors + excluded-route cleanup). Highlights:

- **Mobile is light-only** — no dark mode. The `--mobile-*` token system in `src/app/globals.css` has no dark variants.
- **Single floating Home pill** (`MobileHomePill`) replaced the legacy 4-icon bottom tab bar. Drill-up is contextual via the dashboard header chevron.
- **Kebab menu top-right** (`MobileKebabMenu`) is the only logout surface on mobile; `/profile` is a desktop-only route (mobile redirects to `/home`).
- **`(dashboard)/layout.tsx` is the shell switcher** — `DesktopShell` vs `MobileShell` via `useIsMobile()`. The desktop `NavBar` is hidden on mobile (`NavBar.tsx` early-returns when `isMobile`).
- **Export is desktop-only** — no `ExportFAB`, no download buttons in any `mobile/View.tsx`.
- **13 mobile-eligible routes:** `/home`, `/well-by-well`, `/stock-guide`, `/anp-cdp-bsw`, `/anp-cdp-depletion`, `/anp-cdp-diaria`, `/market-share`, `/price-bands`, `/subsidy-tracker`, `/diesel-gasoline-margins`, `/imports-exports`, `/navios-diesel`, `/news-hunter`.
- **8 desktop-only routes:** `/stocks`, `/admin-panel`, `/admin-analytics`, `/alerts`, `/profile`, `/anp-cdp`, `/anp-prices`, `/anp-glp`. Each mounts `<MobileExcludedRedirect slug="..." />` in `page.tsx`; on mobile, it routes to `/home?excluded=<slug>` and fires an `app-toast` event picked up by the global `MobileToastHost`.
- **Cross-component toast channel:** any client component dispatches `window.dispatchEvent(new CustomEvent("app-toast", { detail: { message, tone, source } }))` and `MobileToastHost` (mounted by `MobileShell`) renders it.
- **Last-visited memory:** `useTrackLastVisited` (mounted once in `DashboardShell`) writes a FIFO of 4 dashboard slugs to `localStorage["sd_last_visited"]`. The `/home v2` mobile view consumes this for its "Last visited" pill row.

See [`docs/app/PRD.md`](docs/app/PRD.md) § "Mobile reform 2026-05-27 — light-only paradigm" and [`docs/app/dual-view-pattern.md`](docs/app/dual-view-pattern.md) for the full pattern and migration recipe.

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
9. **Use shared mobile components** from `src/components/dashboard/mobile/` — `BottomSheet`, `FilterDrawer`, `MobileChart`, `MobileDataCard`, `StickyBreadcrumb`, `MobileHomeIconTile` (paired with `getTileMeta` from `mobileHomeTiles.tsx` — only used by `/home`) — inside `mobile/View.tsx`. The global chrome (`MobileTopBar`, `MobileKebabMenu`, `MobileHomePill`, `MobileToastHost`) is mounted by `(dashboard)/layout.tsx`, NOT by individual Views. **Legacy components** (`MobileNavBar`, `MobileTabBar`, `ExportFAB`) are kept in the directory for reference but are not mounted in any post-reform dashboard — see the Mobile reform section above. If the dashboard is mobile-excluded, skip this step and mount `<MobileExcludedRedirect slug="..." />` in `page.tsx` instead.
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
