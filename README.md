# Itau BBA Dashboard (SectorData)

Internal analytics platform for the Brazilian Fuel Distribution and Oil & Gas sectors. Next.js 16 + Supabase + Plotly.js, deployed on Vercel.

> **Internal collaboration docs** live in [`docs/`](docs/). Start with [`docs/master.md`](docs/master.md). Cross-cutting reforms and dashboard consolidations (Subsidy Reform, Mobile reform, Imports & Exports reform, etc.) are archived in [`docs/changelog.md`](docs/changelog.md). Per-dashboard PRDs live in [`docs/app/<dashboard>.md`](docs/app).

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js App Router | 16.2.1 (non-standard — see [CLAUDE.md](CLAUDE.md)) |
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
- **Tiered auth (login is optional)** — `(dashboard)/layout.tsx` does NOT force `/login`. Anonymous visitors browse modules flagged `is_visible_for_public`; Clients browse modules flagged `is_visible_for_clients`; Admins browse everything and must clear MFA (AAL2). Visitor cookie issued by `src/proxy.ts` (Next.js 16 middleware → proxy rename).
- **Role-based visibility (3 axes)** — `module_visibility` carries `is_visible_for_public`, `is_visible_for_clients` and `is_visible_on_home`, loaded once by `UserProfileContext`. Invariant: `public=true ⇒ clients=true` (CHECK + self-healing trigger). Full semantics in [`docs/supabase/PRD.md`](docs/supabase/PRD.md).
- **Materialized views** `mv_ms_serie` / `mv_ms_serie_fast` for `/market-share` performance.
- **GitHub Actions** as ETL — scrape → CSV/parquet → Supabase upsert.
- **RLS on every table** — frontend cannot bypass; only service-role pipelines write to ingestion tables.

## Modules

> Cross-cutting consolidations (`/sales-volumes` → `/market-share`, `/anp-prices`, `/imports-exports`, `/mdic-comex` deprecation, Subsidy Reform, Brazil Production Summary, etc.) are summarized in [`docs/changelog.md`](docs/changelog.md). The list below reflects the state on 2026-06-01.

### Core (Fase 1–2)

| Route | Key RPCs |
|-------|----------|
| `/home` | `get_data_sources_freshness` (desktop-only live Data Sources table) |
| `/market-share` | `get_ms_opcoes_filtros`, `get_ms_serie_fast`, `get_ms_serie_others`, `get_others_players` (% Share ↔ thousand m³ toggle) |
| `/navios-diesel` | `get_nd_ultima_coleta`, `get_nd_coletas_distintas`, `get_nd_navios`, `get_nd_resumo_portos` |
| `/diesel-gasoline-margins` | `get_dg_margins_data`, `get_dg_margins_filters` (read-only). `d_g_margins` is now **computed** by `recompute_dg_margins(week_start, week_end)` (service_role-only) — formerly a manual Excel upload |
| `/price-bands` | `get_price_bands_data` (Gasoline-with-subsidy: fixed BRL 0.44/L delta since 2026-06-01 — Petrobras +0.44, import parity −0.44; the BRL 3.05/L flat line is preserved only for the 2026-05-29 → 2026-05-31 historical window) |
| `/stocks` | `stock_portfolios` (direct PostgREST) + Yahoo Finance proxy |
| `/news-hunter` | `seed_my_news_hunter_keywords` (default keyword seeding for new users) |
| `/profile` | `get_my_profile`, `upsert_my_profile` |
| `/admin-panel` | Visibility / role / Field Stakes / default news keywords / home images RPCs |
| `/admin-analytics` | `get_admin_analytics_views_by_hour` (BRT) + other analytics RPCs |
| `/alerts` | Logged-in-only email subscriptions (rebuilt 2026-06-02): `list_subscribable_bases`, `set_my_subscription[s]`, `list_my_subscriptions`, `list_my_recent_alerts`, `unsubscribe_by_token` (the only anon-callable write). Event-driven by end-of-ETL hooks; delivered via Gmail SMTP. See [`docs/app/alerts.md`](docs/app/alerts.md). |

### Statistics (Fase 3 onwards — 11 dashboards)

| Route | Category | Key RPCs |
|-------|----------|----------|
| `/well-by-well` (Brazil Production Summary) | Oil & Gas | `get_production_brazil_aggregate`, `get_production_company_aggregate`, `get_production_top_fields`, `get_production_by_installation`, `get_production_yoy_table`, `get_production_month_status` (partial-month detection — canary 70% producing-well heuristic, drives the "Partial data" banner) + paginated helpers |
| `/stock-guide` | Equities | `get_stock_guide_comps` (hide-aware; returns **per-forward-year** `npv_tax_credit_y1` / `npv_tax_credit_y2` → when either `> 0` the comps table renders an "{Company} ex-tax credit" companion row whose basis is computed **per year** — 26E multiples off `market cap − npv_tax_credit_y1`, 27E off `market cap − npv_tax_credit_y2`; the row's displayed Market cap = the y1 basis — TP/Recomm/Upside repeated; the normal row uses the raw live market cap. The ex-tax-credit row additionally adjusts the **P/E denominator**: it uses the optional `net_income_ex_y1` / `net_income_ex_y2` (`?? net_income_yN` when NULL) as net income, so market cap AND net income can be adjusted at once (Vibra case, `20260623000000`) — the normal row never uses them. The single scalar `npv_tax_credit` was split into the two per-year columns `20260622000000`; the per-forward-year `mcap_adj_y1/y2` columns had already been dropped `20260621000000`), `get_stock_guide_config`, `get_stock_guide_drivers` (`source` column: static vs dynamic market-computed drivers), `get_stock_guide_sensitivity_tables` (hide-aware first-class sensitivity tables, derived value modes), `get_stock_guide_scenario_grid(p_sensitivity_id, p_limit DEFAULT NULL, p_offset DEFAULT 0)` (hide-aware per-ticker multi-axis × multi-metric mesh; returns `(ticker, metric, x_value, y_value, z_value, primary_value)`, `20260619000000`; paginated via `LIMIT/OFFSET` since `20260624000000` — reads are paged client-side in 40k batches by `rpcGetStockGuideScenarioGrid` because PostgREST caps SETOF responses at the project max-rows of 50k, which silently truncated the 194,481-point mesh) + admin RPCs (comps / drivers / sensitivity tables / config / visibility + `admin_replace_stock_guide_scenario_grid` / `admin_count_stock_guide_scenario_grid` — the scenario-grid mesh is now uploaded in-admin from the browser, `20260619100000`) + Yahoo proxy (live market cap / upside / multiples + dynamic-driver Avg Brent / Avg FX, 2026-2028). **Sensitivity is now a multi-axis × multi-metric scenario grid interpolated live** (1–3 sliders over any registry driver — static or dynamic; the analyst's dense Cartesian mesh per company is interpolated **multilinearly** — 2^d corners — against the live driver levels, then each output is derived live: Target price→Upside, FCFE→FCFE yield, Dividends→Div yield, Net income→P/E) — this replaced the linear `compose` elastic layer on the dashboard (the `compose` block + `_sg_strip_compose` are left dormant in the DB). Legacy per-company `get_stock_guide_sensitivity` kept dormant. |
| `/anp-cdp` (Monthly Production) | Oil & Gas | `get_anp_cdp_poco_serie`, `get_anp_cdp_pocos_json`, `get_anp_cdp_filtros` (canonical-field aware) |
| `/anp-cdp-bsw` | Oil & Gas | `get_anp_cdp_bsw_scatter`, `get_anp_cdp_bsw_field_aggregate` (X axis: `pct_voip`), `get_anp_cdp_bsw_campos` |
| `/anp-cdp-depletion` | Oil & Gas | `get_anp_cdp_depletion_campos`, `get_anp_cdp_depletion_scatter`, `get_anp_cdp_depletion_field_aggregate` |
| `/anp-cdp-diaria` | Oil & Gas | `get_anp_cdp_diaria_empresa_serie`, `get_anp_cdp_diaria_empresa_campos` (company-first net production — `stake_pct` is a per-(field, month) blended effective stake read from the `/well-by-well` MV `mv_production_monthly`, since `20260618000000`), `get_anp_cdp_diaria_filtros`, `get_anp_cdp_diaria_serie` + installation/well variants (`get_anp_cdp_diaria_instalacao_*`, `get_anp_cdp_diaria_poco_*`) |
| `/anp-glp` (LPG Market Share) | Fuel Distribution | `get_anp_glp_ms_filtros`, `get_anp_glp_ms_serie_fast`, `get_anp_glp_ms_serie_others`, `get_anp_glp_ms_others_players`, `get_anp_glp_ms_export_count` (% Share ↔ thousand t toggle; clone of `/market-share` over `anp_glp`) |
| `/anp-prices` | Fuel Distribution | `get_anp_prices_filtros`, `get_anp_prices_serie`, `get_anp_prices_export_count` (consolidates 3 retired ANP price dashboards) |
| `/imports-exports` | Fuel Distribution | `get_imports_exports_filtros`, `get_imports_exports_paises_stacked`, `get_imports_exports_importers_stacked`, `get_imports_exports_yoy_table`, `get_imports_exports_exports_*`, `get_imports_exports_imports_unit_price`, `get_imports_exports_exports_unit_price` (source split: By Origin Country chart + YoY `paises` scope read from `mdic_comex`/ComexStat — published weeks ahead of ANP; By Importer (Brazil) stays on `anp_desembaracos`, the only source with CNPJ/importer) |
| `/subsidy-tracker` | Fuel Distribution (Proprietary) | `get_subsidy_tracker_diesel` (11 columns, dual-agent `_importador` / `_produtor`, regime-aware NULL fallback; reimbursement is a flat **effective** BRL 1.47/L from 2026-06-01 — 1.12 MP nº 1.363 subvention + 0.35 refinery-cut / PIS-COFINS compensation — the cap/commercialization formula applies only to history before that) |

`template-module/` is a starter template, not a deployed module. RPC wrappers: [`src/lib/rpc.ts`](src/lib/rpc.ts) (by module) and [`src/lib/profileRpc.ts`](src/lib/profileRpc.ts).

### Export library

All tabular dashboards export Excel + CSV via the unified library at [`src/lib/export/`](src/lib/export):

- `core/` — `CsvBuilder`, `ExcelBuilder`, `chartXmlBuilder`, `style`
- `dashboards/` — 1 spec per dashboard (11 files: `anpCdp`, `anpCdpDiaria`, `anpGlp`, `anpPrices`, `dgMargins`, `importsExports`, `marketShare`, `naviosDiesel`, `priceBands`, `subsidyTracker`, `wellByWell`)
- `modal/` — `ExportModal`, `FilterEditor`, `FormatToggle`, `SizeEstimator`
- `ui/` — `ExportButton`, `icons`
- Backed by `supabase/migrations/20260530100000_export_rpcs.sql`.

Tech debt: `/market-share` still uses the legacy `ExportPanel` / `ExportModal` in [`src/components/dashboard/`](src/components/dashboard) (+ `useExportSize` / `exportSizeHeuristics`). Migration tracked in `docs/app/market-share.md`. `/stocks` and `/news-hunter` have no tabular export by design.

## Project Structure

```
dashboard_projeto/
├── .claude/                  local-only — agent definitions and worktrees
├── .github/workflows/        20 workflows (ETL scrapers + client-alerts digest + supabase deploy + monitoring)
├── docs/                     internal collaboration docs (start at master.md)
├── scripts/                  pipelines/ (auto), manual/ (human upload), utils/
├── src/                      Next.js app (see below)
├── supabase/migrations/      191 SQL migrations (as of 2026-06-02)
├── sql/                      tech debt — 3 DDL files applied via Dashboard, NOT migrations
├── alertas/                  local-only — alert subsystem (PRD_ALERTAS.md)
├── DADOS/  data/  output/    local-only — parquet/csv/Excel
└── requirements.txt          Python ETL deps
```

Inside `src/`:

```
src/
├── app/(dashboard)/          one folder per route + layout shell switcher
├── app/api/stocks/           Yahoo Finance proxy
├── components/               NavBar, PlotlyChart, dashboard/ (shared), stocks/, home/
├── context/                  UserProfileContext
├── hooks/                    useIsMobile, useDebouncedFetch, useModuleVisibilityGuard, ...
├── lib/                      supabaseClient, rpc, export/ (unified lib), plotlyDefaults, units, ...
├── data/                     dataSources.ts (curation source for the live Data Sources table)
└── proxy.ts                  Next.js 16 middleware — issues sd_visitor_id anon cookie
```

Deep dives in [`docs/etl-pipelines/PRD.md`](docs/etl-pipelines/PRD.md), [`docs/app/PRD.md`](docs/app/PRD.md), [`docs/supabase/PRD.md`](docs/supabase/PRD.md).

## Database Schema

All tables have RLS; frontend uses the anon key. Only service role (pipelines) writes to ingestion tables. Complete schema (columns, RPCs, RLS policies) is owned by [`docs/supabase/PRD.md`](docs/supabase/PRD.md).

| Table | PK | Purpose |
|-------|----|---------|
| `vendas` | id | ANP fuel sales — Market Share / Sales Volumes (consolidated under `/market-share`) |
| `navios_diesel` | id | Diesel cargo lineup; `is_cabotagem` generated column filters cabotage from RPCs |
| `vessel_registry`, `vessel_positions`, `port_arrivals`, `import_candidates` | — | AIS / port-call tracking |
| `d_g_margins` | id | Weekly diesel/gasoline margin decomposition — **computed** by `recompute_dg_margins()` (was manual Excel until 2026-06-05; manual archive in `d_g_margins_manual_bak`) |
| `cepea_etanol_anidro` | week | CEPEA/ESALQ weekly anhydrous-ethanol price (R$/L, 2002→present); biofuel-component input for `recompute_dg_margins` (CC BY-NC, attribution required) |
| `anp_producao_derivados` | (ano, mes, produto) | ANP monthly national refined-product production (m³ — Gasolina A / Óleo Diesel, 1990→present); feeds the import% / production% split in `recompute_dg_margins` |
| `anp_sintese_taxes` | (data_fim, fuel_type) | ANP Síntese de Preços published per-litre tax lines — `federal_rs_litro` (Tributos Federais) + `icms_rs_litro` (ICMS) for `Gasoline C` / `Diesel B` per week-end. **Primary, auto-updating source** of `federal_tax` / `state_tax` in `recompute_dg_margins`; `fuel_tax_reference` is the historical/gap fallback. Ingested by `anp_sintese_taxes_sync.py` (`etl_dg_margins.yml`) |
| `fuel_tax_reference` | (period, agent/fuel) | Federal + ICMS tax (R$/L) by period — ANP Síntese de Preços (federal) + CONFAZ ad-rem (ICMS); **historical/gap fallback** for `federal_tax` / `state_tax` (primary is now `anp_sintese_taxes`) |
| `fuel_blend_ratio` | (period, fuel) | Ethanol / biodiesel blend-mandate % by period; supplies the `(1−blend)` and biofuel-blend factors |
| `price_bands` | id | BBA parity + Petrobras price; `_w_subsidy` columns auto-populated by triggers (since 2026-05-27) |
| `field_stakes` | (campo, empresa) | Admin-curated working-interest per oil field — feeds `/well-by-well` stake-weighted aggregates |
| `field_canonical_names` | field_raw | Override map for `canonical_field_name(text)` — consolidates well-name variants |
| `field_canonical_expansion_cache` | — | Cached expansion of canonical → variants (refresh via pg_cron) |
| `stock_portfolios` | uuid | `is_public` flag opens anon SELECT for system-owned public rows |
| `stock_guide_companies`, `stock_guide_sensitivity`, `stock_guide_config` | ticker / ticker / id=1 | `/stock-guide` equities comps (price-independent fundamentals in BRL mn — `net_debt_y1`/`net_debt_y2` (per forward year), `net_income_y1/y2` (reported), optional `net_income_ex_y1` / `net_income_ex_y2` (BRL mn, nullable — adjusted net income used **only** as the ex-tax-credit row's P/E denominator, `?? net_income_yN` when NULL; `20260623000000`), optional **per-forward-year** `npv_tax_credit_y1` / `npv_tax_credit_y2` (BRL mn — NPV of recognized tax credits per year; the **only** tax-credit mechanism since the per-forward-year `mcap_adj_y1/y2` columns were dropped `20260621000000`; the single scalar `npv_tax_credit` was split into these two columns `20260622000000`), `fcfe_y1/y2`, `dividends_y1/y2`, `ebitda_y1/y2`, `volumes_y1/y2`; the 4 multiples EV/EBITDA · P/E · FCFE Yield · Div Yield are derived live in the browser from the Yahoo price, never stored — the normal comps row uses the **raw** live market cap: `EV(year) = Market cap + Net Debt(year)`, `P/E(year) = Market cap ÷ net_income_yN` (reported earnings), `Upside = target_price ÷ price − 1`. When `npv_tax_credit_y1 > 0` OR `npv_tax_credit_y2 > 0` the comps table renders an **"{Company} ex-tax credit" companion row** whose basis is **per year** — 26E multiples off `market cap − npv_tax_credit_y1`, 27E off `market cap − npv_tax_credit_y2` (so the two years may differ); the row's displayed Market cap = the y1 basis (TP/Recomm/Upside repeated; normal row untouched; included in exports), and its `P/E(year) = adjusted market cap ÷ COALESCE(net_income_ex_yN, net_income_yN)` — so market cap and net income are adjusted together (Vibra case, `20260623000000`)) + global config; RLS-enabled with **no policies** (all reads via hide-aware SECURITY DEFINER RPCs). `stock_guide_sensitivity` (legacy per-company 2D grid) kept dormant since the sensitivity model went table-based (2026-06-06) |
| `stock_guide_drivers`, `stock_guide_sensitivities` | id / id | Redesigned sensitivity model (2026-06-06): `stock_guide_drivers` is the central registry of macro/assumption variables (`name`, `unit`, `current_value`, `source` — e.g. "Brent average 2026E", USD/bbl, 80; **`source` added 2026-06-01 — NULL = Static, admin types `current_value`; a catalog key = Dynamic, value computed live in the browser from the Yahoo proxy via `src/hooks/useMarketDrivers.ts` — catalog (6 metrics since 2026-06-11): `avg_brent_2026`/`avg_brent_2027`/`avg_brent_2028` USD/bbl (realized + forward curve; 2028 = spot-flat fallback when the curve doesn't reach it), `avg_fx_2026`/`avg_fx_2027`/`avg_fx_2028` BRL/USD (spot-flat approx)**); `stock_guide_sensitivities` holds first-class sensitivity tables (`title`, `value_mode` ∈ absolute/yield/pe/ev_ebitda/upside, `companies text[]`, `definition jsonb` with two axes — driver/company/year — plus `cells` + optional `cells_secondary`). Covers cross-company, single-company 2D, by-year and 1D; value modes derived live in the browser. **Scenario-grid tables (multi-axis `20260618200000`, multi-metric `20260619000000`):** `definition` may carry a non-sensitive `grid` block (`{axes: [{driver_id, label, unit, tmin, tmax, tstep}] (1..3, order = x,y,z), outputs: [{key, mode, label}]}` — axis metadata only, names no company) that marks the table as a multi-axis interpolation mesh. v2 (`20260619000000`): each axis references **any registry driver** via `driver_id` (static or dynamic — no longer Brent/FX-only) plus its template range (`tmin/tmax/tstep`); `outputs[]` (`mode ∈ upside|yield|pe|absolute`) replaces the legacy scalar `output` — multiple metrics per table. The per-company values live in the separate `stock_guide_scenario_grid` table (below), read via `get_stock_guide_scenario_grid`. The `20260618200000` migration converted the legacy `{x_driver_key, x_label, x_unit, output}` 1-D shape to the `axes` block; `20260619000000` added per-axis `driver_id` + `outputs[]`. **This superseded the linear `compose` elastic layer** (`definition.compose` + `_sg_strip_compose` are no longer rendered by the frontend, left dormant in the DB). RLS-enabled, **no policies** (reads via hide-aware SECURITY DEFINER RPC `get_stock_guide_sensitivity_tables`) |
| `stock_guide_scenario_grid` | (sensitivity_id, ticker, metric, x_value, y_value, z_value) | Multi-axis (1–3 axes) × multi-metric interpolation mesh for `/stock-guide` sensitivity (1-D `20260612000000`, multi-axis `20260618200000`, multi-metric `20260619000000`). One row per `(sensitivity table, ticker, metric, axis-coordinate combination)` carrying `primary_value` = the metric's value at that scenario (BRL/share for `target_price`, BRL mn for `fcfe`/`dividends`/`net_income`). `metric text NOT NULL DEFAULT 'target_price'` (added `20260619000000`; the DEFAULT backfills the seed + lets single-metric uploads omit the column). `x_value`/`y_value`/`z_value` are the per-axis driver levels (order = the `definition.grid.axes` order); `y_value`/`z_value` are `numeric NOT NULL DEFAULT 0` (an unused axis is permanently 0). The frontend reads the per-`(ticker, metric)` mesh, interpolates **multilinearly** (2^d corners) against the live axis levels, then derives each output (Target price→Upside, FCFE→FCFE yield, Dividends→Div yield, Net income→P/E). FK `sensitivity_id`→`stock_guide_sensitivities` `ON DELETE CASCADE`. RLS-enabled, **no policies** — reads via hide-aware SECURITY DEFINER RPC `get_stock_guide_scenario_grid(p_sensitivity_id, p_limit DEFAULT NULL, p_offset DEFAULT 0)` → `(ticker, metric, x_value, y_value, z_value, primary_value)` (visible tickers only for non-admins; paginated since `20260624000000` — `rpcGetStockGuideScenarioGrid` pages in 40k batches because PostgREST caps SETOF responses at the 50k project max-rows, which had silently truncated the 194,481-point mesh to 50k); writes happen **in the Admin Panel** (since `20260619100000`) — the browser parses the filled Excel via ExcelJS + runs client-side validation (`src/lib/stockGuideGridUpload.ts`, parity with the Python uploader), then sends in ~2000-row chunks via the `is_admin()`-guarded RPCs `admin_replace_stock_guide_scenario_grid(p_sensitivity_id, p_rows, p_first_chunk)` (chunked replace-total: first chunk deletes, rest accumulate; NaN rejected; 6-col `ON CONFLICT` idempotent) + `admin_count_stock_guide_scenario_grid` (post-upload confirmation count); `scripts/manual/stock_guide_brent_grid_upload.py` v2 (service-role, multi-sheet Excel — one sheet per output, positional axis coordinates — replace-total snapshot per `sensitivity_id` across all metrics) is kept as an automation fallback; template downloaded from the Admin Panel, the Python `make_brent_grid_template.py` generator is deprecated) |
| `module_visibility` | module_slug | 3 visibility axes (public / clients / home) |
| `news_articles` | url | Scanned news feed (filled by the external News Hunter scanner repo) |
| `news_hunter_keywords` | (user_id, keyword) | Per-user, RLS-scoped |
| `news_hunter_default_keywords` | keyword | Single source of truth seed list with `match_type` (`substring` / `exact`) |
| `profiles` | id (FK auth.users) | role (`Admin` / `Client`), full_name, avatar_url |
| `mdic_comex` | id | MDIC/ComexStat import/export trade data — feeds `/imports-exports` unit-price RPCs, the By Origin Country stacked chart, and the YoY table `paises` scope (ComexStat publishes month M weeks ahead of ANP Desembaraços) |
| `anp_precos_produtores`, `anp_precos_distribuicao`, `anp_lpc` | — | 3 source tables joined by `get_anp_prices_serie` (UNION ALL) |
| `anp_lpc_brasil` | (data_fim, produto) | ANP-published **national** ("BRASIL" sheet) volume-weighted weekly resale price (R$/L) for `GASOLINA COMUM` / `DIESEL S10`; used directly as the pump price in `recompute_dg_margins` (station-weighted `anp_lpc` fallback on gap weeks). ~146 weeks 2023-05→present, with gaps. Ingested by `lpc_sync.py` (`etl_anp_lpc.yml`) |
| `anp_glp` | (ano, mes, distribuidora, categoria) | GLP sales by category (`P13` / `Outros - *`) |
| `anp_daie` | (ano, mes, produto, operacao) | DAIE imports/exports (operacao: `EXPORTAÇÃO` / `IMPORTAÇÃO`) |
| `anp_desembaracos` | (ano, mes, ncm_codigo, pais_origem, cnpj) | Enriched with `importador`/`cnpj`/`uf_cnpj` since 2026-05-25. Feeds the `/imports-exports` By Importer (Brazil) chart + YoY `importers` scope (only source with CNPJ/importer); the By Origin Country chart migrated to `mdic_comex` on 2026-06-03 |
| `imports_product_map`, `importer_group_map`, `ncm_densidade_kg_m3` | — | Aux lookups for `/imports-exports` (kg → m³ conversion, NCM → unified_product) |
| `anp_cdp_producao` | (ano, mes, poco, campo, bacia, local) | Monthly well-level production (PosSal/PreSal/Terra) |
| `anp_voip` | (ano_publicacao, campo) | Volumes originally in-place / recovered fraction / situacao |
| `anp_cdp_diaria`, `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco` | varies | Daily production at field / installation / well level (since 2025-11-09) |
| `anp_subsidy_diesel_reference` | (data_referencia, regiao, tipo_agente) | Per-region reference price; triggers maintain `price_bands._w_subsidy` columns |
| `anp_subsidy_caps` | (vigente_desde, tipo_agente) | Ceiling of per-region reimbursement (replaces `anp_subsidy_history` since Subsidy Reform). Drives `compute_subsidy_reimbursement` only for dates before 2026-06-01; from 2026-06-01 the diesel reimbursement is a flat **effective** BRL 1.47/L for both agents (1.12 MP nº 1.363 headline subvention + 0.35 compensation for the BRL 0.35 Petrobras refinery-price cut / PIS-COFINS reactivation) |
| `anp_subsidy_commercialization` | (data_inicio, regiao, tipo_agente) | Period × region × agent commercialization prices (HTML scrape stage of `subsidy_diesel_sync.py`) |

**Materialized views:** `mv_ms_serie`, `mv_ms_serie_fast` (Market Share), plus the `/well-by-well` production MV (auto-refreshed via `pg_cron`).

> Tech debt: `price_bands`, `profiles`, `module_visibility` were originally created via DDL in [`sql/`](sql/) applied directly to the Supabase Dashboard rather than versioned migrations. Conversion plan in [`docs/supabase/PRD.md`](docs/supabase/PRD.md).

## Data Pipelines (18 workflows + 1 external)

| # | Workflow | Schedule | Target |
|---|----------|----------|--------|
| 1 | `etl_navios_lineup.yml` | Every 6h | `navios_diesel` |
| 2 | `etl_navios_imo_lookup.yml` | After #1 | `navios_diesel.imo/mmsi` |
| 3 | `etl_navios_positions.yml` | After #2 | `vessel_positions`, `port_arrivals` |
| 4 | `etl_ais_positions.yml` | Every 6h+15min | `vessel_registry`, `vessel_positions`, `port_arrivals` |
| 5 | `etl_ais_candidates.yml` | Every 4h | `import_candidates` |
| 6 | `etl_anp_cdp.yml` | Monthly cron + external dispatch every ~2h | `anp_cdp_producao` (Selenium + ddddocr CAPTCHA) |
| 7 | `etl_anp_vendas.yml` | Internal cron every 30 min (`7,37 * * * *`, PRIMARY since 2026-06-10 — cron-job.org dependency retired) + `workflow_dispatch` for manual/future external triggers (serialized by the `anp-vendas` concurrency group) | `vendas` |
| 8 | `etl_anp_fase3.yml` | Monthly 1st 13:00 UTC | `anp_daie`, `anp_desembaracos` (importador/cnpj/uf_cnpj preserved) |
| 9 | `etl_anp_lpc.yml` | Daily 14:30 UTC | `anp_lpc` (ANP publishes the weekly LPC survey on an unstable weekday — daily scrape is idempotent + incremental, ingests the new week within ~24h) |
| 10 | `etl_anp_precos.yml` | Weekly Mon 12:00 UTC | `anp_precos_produtores`, `anp_glp` |
| 11 | `etl_mdic_comex.yml` | Daily 14:00 UTC + Weekly Sun 06:00 UTC (12-month revision sweep) | `mdic_comex` (feeds `/imports-exports` unit-price RPCs) |
| 12 | `etl_dg_margins.yml` | `workflow_run` after a successful `etl_anp_lpc.yml` (primary) + daily 15:00 UTC fallback + dispatch | `d_g_margins` (computed): runs CEPEA + ANP production + ANP Síntese tax scrapers (the Síntese step ingests `anp_sintese_taxes` — auto-updating federal + ICMS taxes — `continue-on-error`, never gates the recompute) → calls `recompute_dg_margins()` bounded to the last ~12 ISO weeks (full-timeline backfill is `workflow_dispatch full_backfill=true` only) |
| 13 | `supabase_deploy.yml` | On push to main | migrations (`supabase db push`) |
| 14 | `etl_anp_precos_distribuicao.yml` | Monthly 5th + Weekly Tue | `anp_precos_distribuicao` |
| 15 | `etl_anp_cdp_diaria.yml` | 3×/day | `anp_cdp_diaria{_instalacao,_poco}` (Power BI public API) |
| 16 | `etl_anp_voip.yml` | Annual (May 1st) | `anp_voip` |
| 17 | `etl_anp_subsidy_diesel.yml` | Daily 11:30 UTC | `anp_subsidy_diesel_reference` + `anp_subsidy_commercialization` (PDF + HTML stages) |
| 18 | `client_alerts_digest.yml` | Daily 23:30 UTC | Client Alerts daily digest — sweeps `digest`-cadence bases into 1 email/subscriber/day (Gmail SMTP) |
| ext | News Hunter scanner | Every ~5min via cron-job.org | `news_articles` (separate repo `IBBAOG/news-hunter-scanner`) |

**Monitoring & test workflows** (ops coverage + Client Alerts harness — see [`docs/etl-pipelines/PRD.md`](docs/etl-pipelines/PRD.md) § "Monitoring & testing"):

| Workflow | Schedule | Role |
|----------|----------|------|
| `freshness_monitor.yml` | Daily 12:00 UTC | **Freshness guardian** — emails ops if any base's data is overdue vs a per-source cadence threshold (catches a *silent* stall: green workflow, stale data) |
| `workflow_failure_monitor.yml` | Every 6h | **Failure pager** — pages ops on ≥3 consecutive non-cancelled failures of 16 critical workflows (catches a *loud* failure); re-homes the retired `etl_workflow_stuck`. Also a **dispatcher-silence detector**: pages when a critical externally-dispatched workflow (`etl_anp_vendas`, `etl_anp_cdp`) hasn't started a run in >26h — catches a dead external trigger (zero runs), a failure mode invisible to both the failure streak and the freshness guardian |
| `etl_mdic_comex_drift.yml` | Monthly day 5 07:00 UTC | **MDIC ComexStat drift detector** — fetches cheap live monthly aggregates, diffs them against `mdic_comex`, and self-heals only the months that drifted (re-pulls them); catches retroactive ComexStat revisions outside the daily 3-month / weekly 12-month `etl_mdic_comex.yml` window (e.g. the annual *fechamento*). Green = no drift or clean heal; red = a heal failed |
| `cdp_roster_canary.yml` | Daily 12:15 UTC | **CDP roster canary** — runs `scripts/cdp_roster_canary.py`: read-only SQL comparing the well/installation roster of the latest complete month in `anp_cdp_producao` (wells >1 kbpd) against the wells seen in `anp_cdp_diaria_poco` over the last 10 data-days (+ digit-aware fuzzy installation match vs `anp_cdp_diaria_instalacao`); emails ops when the missing wells aggregate >10 kbpd — catches an ANP-side dimension/roster lag in the daily Power BI panel that neither the freshness guardian nor the failure pager can see (e.g. FPSO P-78: 2 Búzios wells ~87 kbpd absent for 5 months). Red only when the check itself breaks; a found gap emails and exits green |
| `client_alerts_poll.yml` | Every 20 min | **Safety-net poll** — `run_base --all-active`; fires alerts for the hook-less Data Input base (`price_bands`) and backstops every ETL hook |
| `client_alerts_test.yml` | `workflow_dispatch` | **Test harness** — `run_base --test --source <slug>`; simulates a base update → SMTP send without touching the data table or watermark. Per-base plan: [`docs/alerts/TEST_PLAN.md`](docs/alerts/TEST_PLAN.md) |
| `alertas_monitor.yml` | **DISABLED** | Legacy local-only Gmail monitor — retired (subsumed by the freshness guardian + failure pager); workflow disabled (reversible), 3 internal recipients migrated to Client Alerts |

> **Client Alerts hook:** workflows #1–#12, #14–#17 (the 15 data ETLs incl. `etl_dg_margins` — the `d_g_margins` hook moved here from the retired `manual_dg_margins`) each end with a `continue-on-error` step `python -m scripts.client_alerts.run_base --source <slug>` that emails subscribers the moment a base gets new data (immediate bases) or queues a digest event. Logged-in-only product; delivery via Gmail SMTP + App Password (`GMAIL_APP_PASSWORD`). Engine: `scripts/client_alerts/`. See [`docs/etl-pipelines/PRD.md`](docs/etl-pipelines/PRD.md) § "Client Alerts" and [`docs/app/alerts.md`](docs/app/alerts.md).

Workflow internals (scripts, retries, self-healing, pegadinhas) in [`docs/etl-pipelines/PRD.md`](docs/etl-pipelines/PRD.md).

**Manual data** (`data/`): `data/price_bands.xlsx` edited by hand and uploaded via `scripts/manual/price_bands_upload.py` (gitignored). `d_g_margins` is no longer manual — it is computed by `etl_dg_margins.yml` (see Data Pipelines #12).

**Alert subsystem** (`alertas/`): legacy local-only (gitignored), self-contained. 12 detection bases over Supabase tables/parquet, Gmail-based. **Retired** — its `alertas_monitor.yml` workflow is disabled (reversible); the stale-canary is subsumed by `freshness_monitor.yml` and its `etl_workflow_stuck` pager re-homed into `workflow_failure_monitor.yml`. See `alertas/PRD_ALERTAS.md` and [`docs/etl-pipelines/PRD.md`](docs/etl-pipelines/PRD.md) § "Legacy `alertas/` monitor retirement".

## Shared Dashboard Components

Live in [`src/components/dashboard/`](src/components/dashboard/) — extracted to prevent visual drift across the 10 statistics dashboards:

`DashboardHeader`, `MultiSelectFilter`, `PeriodSlider`, `MonthRangePicker`, `ChartSection`, `SegmentedToggle`, `BarrelLoading`, `DataErrorBoundary`, plus legacy `ExportPanel` / `ExportModal` / `exportTypes` (still used by `/market-share` — see Export library section). Mobile counterparts in [`src/components/dashboard/mobile/`](src/components/dashboard/mobile/).

Shared hooks/libs: `useIsMobile` (the only breakpoint source), `useDebouncedFetch`, `plotlyDefaults` (BRAND_ORANGE, PALETTE, COMMON_LAYOUT), `units` (kg ↔ m³ converters), `exportCsv` (RFC4180 helper).

## Auth & Roles

| Tier | Auth state | Visibility | MFA |
|------|-----------|-----------|-----|
| **Anon** | No `supabase.auth` session | Modules with `is_visible_for_public=true` | N/A |
| **Client** | Authenticated, `profiles.role='Client'` | Modules with `is_visible_for_clients=true` | Opt-in |
| **Admin** | Authenticated, `profiles.role='Admin'` | All + `/admin-panel`, `/admin-analytics` | **Required** (AAL2; enrollment at `/profile/mfa`) |

- Role derived in `UserProfileContext`: `profile?.role==='Admin' ? 'Admin' : profile ? 'Client' : 'Anon'`.
- `useModuleVisibilityGuard(slug)` branches on tier; missing keys default to `true` (safe degradation); redirects to `/home`.
- `useRoleGuard("Admin")` protects Admin-only pages; Admins without enrolled MFA → `/profile/mfa`.
- `/profile` redirects Anon → `/login` (no public fallback).

**Anonymous visitor analytics:** `src/proxy.ts` issues an HttpOnly `sd_visitor_id` cookie (UUID v4, SameSite=Lax, Secure, 1-year Max-Age). Bots get no cookie. `GET /api/visitor-id` exposes it to the browser. `track_event(event_type, route, payload, visitor_id)` accepts a 4th param; `app_events.user_id` is nullable, `(user_id OR visitor_id)` CHECK ensures every row has an actor. Cookie namespace: always `sd_*` (never `sb-*`, reserved by Supabase Auth).

## Mobile

Mobile is **light-only** and ships per dashboard via a viewport router (`page.tsx` → `useIsMobile()` → `desktop/View.tsx` or `mobile/View.tsx`). Both views consume a single shared hook `use<Slug>Data.ts` — the only source of truth for RPCs, filters and derivations.

Global mobile chrome (`MobileTopBar`, `MobileKebabMenu`, `MobileHomePill`, `MobileToastHost`) is mounted by `(dashboard)/layout.tsx`. Export is desktop-only.

15 mobile-eligible routes as of 2026-06-02: `/home`, `/well-by-well`, `/stock-guide`, `/anp-cdp-bsw`, `/anp-cdp-depletion`, `/anp-cdp-diaria`, `/market-share`, `/anp-glp`, `/price-bands`, `/subsidy-tracker`, `/diesel-gasoline-margins`, `/imports-exports`, `/navios-diesel`, `/news-hunter`, `/alerts` (dual-view since the 2026-06-02 rebuild). Desktop-only routes (`/stocks`, `/admin-panel`, `/admin-analytics`, `/profile`, `/anp-cdp`, `/anp-prices`) mount `<MobileExcludedRedirect slug="..." />` in `page.tsx` and route to `/home?excluded=<slug>` with a toast on mobile.

Full pattern: [`docs/app/dual-view-pattern.md`](docs/app/dual-view-pattern.md). Reform narrative: [`docs/changelog.md`](docs/changelog.md) (2026-05-27).

## Adding a New Dashboard

Every dashboard ships as a dual-view module (desktop + mobile). The canonical template (`page.tsx` + `use<Slug>Data.ts` + `desktop/View.tsx` + `mobile/View.tsx`) and the full 10-step recipe live in [`docs/app/dual-view-pattern.md`](docs/app/dual-view-pattern.md). Internal team workflow (worker agents, sub-PRDs, dispatching `worker_dash-admin` for visibility/home image, etc.) in [`docs/app/PRD.md`](docs/app/PRD.md) under "Workflow Subgerente".

> **Binding sync rule:** any meaningful change to one View (new filter, chart, KPI, copy) must land in the OTHER View in the same commit, or the commit message must declare `[desktop-only]` / `[mobile-only]` with an explicit reason. See [`CLAUDE.md` § Dual-view policy](CLAUDE.md).

## Environment Variables

```env
# .env.local (frontend)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# GitHub Actions secrets
SUPABASE_URL / SUPABASE_SERVICE_KEY              # pipelines
SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN     # migration deploy (supabase_deploy.yml)
AISSTREAM_API_KEY                                # AIS sync
GMAIL_APP_PASSWORD                               # Client Alerts email sender (Gmail SMTP; ibbaogproject@gmail.com)
```
