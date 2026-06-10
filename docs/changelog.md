# Changelog

Centralized history of cross-cutting reforms, dashboard consolidations and platform-wide changes. Day-to-day commits live in `git log`; this file captures *narrative* milestones that previously cluttered the root `README.md` callout boxes. Pure UI tweaks and per-dashboard internal refactors are NOT logged here — see the relevant sub-PRD in `docs/app/<dashboard>.md` or `git log` instead.

Entries newest first.

---

## 2026-06-10 — `/anp-cdp-diaria` blended company stakes (Petrobras net oil ~185 kbpd overstatement fixed)

- **Bug**: the company-level daily RPCs joined `field_stakes.campo = anp_cdp_diaria.campo` by raw name. Contract-split fields (BÚZIOS / ATAPU / SÉPIA, which have separate `*_ECO` tranche rows in `field_stakes`) matched only the 100% ToR row, because the daily Power BI panel merges tranches into one field row — the whole field was weighted at 100%. Petrobras net oil overstated **~185 kbpd** (Apr-2026: 2808.3 shown vs ≈2623.5 correct).
- **Fix**: `get_anp_cdp_diaria_empresa_serie` / `get_anp_cdp_diaria_empresa_campos` now return a per-(canonical field, month) **effective blended stake** — production-weighted tranche blend read from `mv_production_monthly.stake_pct_weighted`, carried forward to daily months not yet in monthly CDP, raw-stake fallback for fields with no blend. Signatures / return columns unchanged.
- **New cross-RPC dependency**: the `/anp-cdp-diaria` company RPCs now READ `mv_production_monthly` (the `/well-by-well` Round 5 MV — `20260528400000_well_by_well_perf_mv.sql`, originally MCP-applied as `20260527133039`). Changing or dropping that MV now affects both dashboards — see `docs/supabase/PRD.md` § "Blended company stakes for `/anp-cdp-diaria`".
- **Known residual (not a bug)**: `/anp-cdp-diaria` genuinely sits ~75–90 kbpd below `/well-by-well` — ANP's daily panel roster is missing 2 new Búzios wells + ~19 small onshore fields (source limitation; documented in `docs/app/anp-cdp-diaria.md`).
- Migration `20260618000000_anp_cdp_diaria_blended_stakes.sql`. See `docs/app/anp-cdp-diaria.md` § "Blended effective stakes" and `docs/supabase/PRD.md`.

## 2026-06-05 — Diesel & Gasoline Margins Automation (manual → computed)

- The `/diesel-gasoline-margins` base table `d_g_margins` stopped being filled **manually** (Excel `dg_margins_upload.py` + `manual_dg_margins.yml` + admin Data Input form) and is now **computed automatically** by the SQL function `recompute_dg_margins(p_week_start text, p_week_end text)` (`SECURITY DEFINER`, `EXECUTE` only `service_role`).
- **New workflow** `etl_dg_margins.yml` (weekly Tue 15:00 UTC + dispatch): runs 2 new scrapers → calls `recompute_dg_margins()`.
- **New scrapers**: `scripts/pipelines/cepea/cepea_etanol_anidro_sync.py` (CEPEA/ESALQ weekly anhydrous-ethanol price, 2002→present) and `scripts/pipelines/anp/producao/anp_producao_derivados_sync.py` (ANP monthly refined-product production — Gasolina A / Óleo Diesel, 1990→present).
- **New tables**: `cepea_etanol_anidro` (weekly R$/L anhydrous ethanol), `anp_producao_derivados` (monthly national production m³), `fuel_tax_reference` (federal + ICMS R$/L by period — ANP Síntese + CONFAZ ad-rem), `fuel_blend_ratio` (ethanol/biodiesel mandate % by period).
- **Decomposition formula** (R$/L, per ISO week): `base_fuel = (import-parity × import% + Petrobras × production%) × (1 − blend)`; `biofuel_component` = anhydrous ethanol (week−1 lag) × ethanol_blend for gasoline / Biodiesel B-100 (same week) × biodiesel_blend for diesel; `federal_tax` + `state_tax` (ICMS) from `fuel_tax_reference`; `distribution_and_resale_margin` = pump − all components (residual); `total` = pump = `anp_lpc` station-weighted national avg (`'GASOLINA COMUM'` / `'DIESEL S10'`). `import%` = imports (`anp_desembaracos`/`mdic_comex`, kg→m³ via density) / (imports + `anp_producao_derivados`).
- **Tax correction**: replaces the old manual figures with ANP Síntese de Preços (federal) + CONFAZ ad-rem (ICMS).
- **Cutover**: the ad-rem-ICMS era is computed (gasoline from Jun-2023, diesel from May-2023); pre-ad-rem weeks (2021→mid-2023, ad-valorem ICMS era) are **preserved** from the original manual series. `d_g_margins` is 566 rows; manual archive kept in `d_g_margins_manual_bak`.
- **Sources** shown on the dashboard: "ANP · CEPEA/ESALQ · CONFAZ" (CEPEA/ESALQ is CC BY-NC, attribution required).
- **Retired**: `scripts/manual/dg_margins_upload.py` + `.github/workflows/manual_dg_margins.yml` (deleted) + the `d-g-margins` admin Data Input registry entry (removed). The Client Alerts hook for the `d_g_margins` base moved from `manual_dg_margins.yml` to `etl_dg_margins.yml`. Owner shifts from `worker_dados-locais` to `worker_etl-pipelines`.
- See `docs/app/diesel-gasoline-margins.md`, `docs/etl-pipelines/PRD.md` (workflow `etl_dg_margins.yml`), `docs/supabase/PRD.md` (4 tables + `recompute_dg_margins` RPC).

## 2026-06-03 — `/imports-exports` By Origin Country sourced from ComexStat (source split)

- The **By Origin Country** stacked chart and the YoY table `paises` scope were migrated from `anp_desembaracos` (ANP Desembaraços) to `mdic_comex` (ComexStat, `flow='import'`). **Rationale**: ComexStat publishes month M several weeks ahead of ANP Desembaraços, and the user tracks ComexStat — so the origin-country view now reflects the freshest available month.
- **Source split is intentional and permanent**: the **By Importer (Brazil)** chart and the YoY `importers` scope stay on `anp_desembaracos` — it is the only source carrying CNPJ / importer identity. The Exports tab already read ComexStat.
- **Affected RPCs** (signatures + return columns kept verbatim): `get_imports_exports_paises_stacked` and `get_imports_exports_yoy_table` (only the `p_scope='paises'` branch). Both flipped to `SECURITY DEFINER` (MDIC scope, no user-aware RLS). `total_kg` now sums `mdic_comex.volume_kg`. Country labels emitted as canonical PT (`mdic_comex.pais` matches the existing frontend pin map — no SQL normalization).
- **A month not yet published never renders as zero** — the chart omits absent months instead of drawing a false zero line.
- Migration `20260608400000_imports_exports_paises_from_comexstat.sql`. See `docs/app/imports-exports.md` and `docs/supabase/PRD.md` § Imports & Exports RPCs.

## 2026-06-01 — Fixed fuel subsidy regime (diesel 1.47 / gasoline 0.44)

- Regulatory change effective **2026-06-01**: the fuel subsidy became a **flat value** for both agents (`importador` and `produtor`). History before 2026-06-01 is untouched.
- **Diesel — DB side**: `compute_subsidy_reimbursement(date, tipo_agente)` now returns a fixed **1.47 BRL/L** for dates ≥ 2026-06-01 (both agents); earlier dates keep the historical AVG-over-5-regions of `MIN(MAX(ref − comm, 0), cap)` formula. The **effective** subsidy is 1.47 = **1.12** (MP nº 1.363 headline subvention) + **0.35** (compensation for Petrobras' refinery-price cut of BRL 0.35, 3.65 → 3.30 already reflected in `price_bands.petrobras_price`, plus the equivalent PIS/COFINS reactivation): 3.30 (price) + 1.47 (subsidy) = 4.77 = the pre-reform realization (3.65 + 1.12). The dashboard reflects the **effective** economics (1.47), not the MP's headline (1.12). Migration `20260613000000_subsidy_fixed_diesel_1_47.sql` (applied in production) supersedes the earlier `20260608200000_subsidy_fixed_diesel_1_12.sql`. The flat value flows automatically into `price_bands._w_subsidy` (via `_pb_refresh_w_subsidy_from_date`) and therefore into `/price-bands` and `/subsidy-tracker`. `anp_subsidy_caps` / `anp_subsidy_commercialization` now only drive the < 2026-06-01 leg.
- **Gasoline — client side** in `/price-bands`: fixed **0.44 BRL/L** delta since 2026-06-01 (Petrobras +0.44, import parity −0.44, new import-parity series). The historical flat **3.05 BRL/L** line is preserved for the 2026-05-29 → 2026-05-31 window only.
- Commits `a1b81c74` (diesel) + `b9b7356b` (gasoline). See `docs/supabase/PRD.md` § "Fixed subsidy regime since 2026-06-01" and `docs/app/price-bands.md`.

## 2026-06-01 — `/anp-glp` rebuilt as LPG Market Share

- The `/anp-glp` route was repurposed (same URL/slug) from "Vendas de GLP por Recipiente" (volume-only, desktop-only reference dashboard) into **"LPG Market Share"** — a faithful dual-view clone of `/market-share` over the `anp_glp` table.
- **Domain mapping**: player = `distribuidora`; product = `categoria` (P13 / Outros - GLP / Outros - Especiais) + synthetic **Total (All LPG)**. Unit toggle **% Share / thousand t** (`vendas_kg / 1e6`). View modes Individual / Big-3 (dynamic top-3 distributors by volume, NOT hardcoded) / Others. MoM/QTD/YoY/YTD comparison table.
- **Dropped vs `/market-share`**: no region/UF filters (table has no geo), no Retail/B2B/TRR segments (constant segment `'GLP'`), no hardcoded fuel Big-3.
- **Promoted to dual-view** — was mobile-excluded; the `MobileExcludedRedirect` was removed, `mobile/View.tsx` added, and the slug dropped from the mobile-excluded lists. Mobile-eligible routes now 14 (was 13).
- **New RPCs** (`20260605000000_anp_glp_market_share_rpcs.sql`, all SECURITY DEFINER over `anp_glp`): `get_anp_glp_ms_filtros`, `get_anp_glp_ms_serie_fast`, `get_anp_glp_ms_serie_others`, `get_anp_glp_ms_others_players`, `get_anp_glp_ms_export_count`. No materialized view (`anp_glp` is ~3k rows). The legacy `get_anp_glp_serie` / `get_anp_glp_filtros` remain in the DB but are no longer used by the dashboard.
- **Export**: unified `<ExportButton>` (Tier 1, `filterSource: "none"`) — full history, filename `LPGMarketShare_DD-MM-YY`, sheet "LPG Market Share", thousand-tons column. Desktop-only.
- Commits `696be79a` (migration) + `b16a9388` (frontend). See `docs/app/anp-glp.md`.

## 2026-06 — `/well-by-well` server pagination

- New paginated RPCs + count helpers (`20260603000000_well_by_well_pagination.sql`).
- PostgREST `db_max_rows` raised to 50000 (`20260603100000_postgrest_max_rows.sql`).
- See `docs/app/well-by-well.md`.

## 2026-06 — `/admin-analytics` views-by-hour panel

- RPC `get_admin_analytics_views_by_hour` (BRT) + GRANT to `anon` (Pegadinha #18 fix).
- Migrations: `20260602000000`, `20260602200000_..._brt.sql`, `20260602300000_..._pegadinha18.sql`.

## 2026-06 — Field Stakes / Production maintenance

- `field_canonical_expansion_cache` cache table (`20260601000000`).
- Field stakes auto-refresh + drop of the sync-refresh trigger (`20260601100000`, `20260601200000`).
- `pg_cron` auto-refresh of MV production (`20260601300000_pg_cron_refresh_mv_production.sql`).
- Restore anon grants on canonical CDP RPCs (`20260601400000`).
- Brava + Parque das Conchas stakes seed (`20260602100000`).
- Consolidate / refine Petroreconcavo stakes (`20260528980000`, `20260528990000`).
- See `docs/app/well-by-well.md`.

## 2026-05-30 — Unified export library

- New library at `src/lib/export/`: `core/` (CsvBuilder, ExcelBuilder, chartXmlBuilder, style), `dashboards/` (1 spec per dashboard — 11 files), `modal/` (ExportModal + FilterEditor + FormatToggle + SizeEstimator), `ui/` (ExportButton + icons).
- Backing RPCs in `20260530100000_export_rpcs.sql`.
- Migration status: 10 of 11 dashboards consumed `<ExportButton spec={...} />` as of 2026-06-01. `/market-share` still on legacy `ExportPanel` / `ExportModal` from `src/components/dashboard/` (tracked tech debt — `useExportSize`, `exportSizeHeuristics`, `ExportPanel.tsx`, `ExportModal.tsx`, `exportTypes.ts` remain in tree for this case).

## 2026-05-30 — CDP RPCs canonical expansion

- `get_anp_cdp_*` RPCs now honor `canonical_field_name()` / `field_canonical_names` like `/well-by-well`. Migration `20260530000000_cdp_rpcs_canonical_expansion.sql`.

## 2026-05-29 — News Hunter seeding & matching

- Default keywords seeded for existing users (`20260529000000`, `20260529100000`).
- "Brava" pinned to exact-match (`20260529400000_news_hunter_brava_exact_match.sql`).
- `match_type` realigned with Eduardo's seed (`20260529200000`).

## 2026-05-29 — Subsidy fallback regime-aware + `/price-bands` polish

- `/subsidy-tracker`: regime-aware NULL fallback (`20260529500000_subsidy_fallback_regime_aware.sql`), inaugural-period handling (`20260528900000`), synthetic PR-March (`20260528950000`), expose reimbursement column (`20260528970000`).
- `/price-bands`: fixed Gasoline-with-subsidy line at BRL 3.05/L since 2026-05-29 (no PIS/COFINS pass-through projection). Multiple corrections to the YTD subsidy blend / projection (leading vs trailing gaps, pre-cutoff null treatment, pre-subsidy-year suppression).
- See `docs/app/subsidy-tracker.md` and `docs/app/price-bands.md`.

## 2026-05-28 — `/imports-exports` Panel C removal + price summary tables

- Panel C ("Import Price USD/bbl" single-line chart) removed as redundant with Panel D.
- New Import Price Summary (top-2 origins + volume-weighted Others) and Export Price Summary (all destinations) tables. Latest unit syncs with chart toggle (USD/ton ↔ ¢/gal for imports; USD/bbl for exports).
- Unit-price RPCs now return `vol_m3`; orphan `get_imports_exports_fob_price_serie` dropped. Migration `20260528960000_imports_exports_unit_price_with_volume.sql`.

## 2026-05-28 — Round 5 dashboard renames

- *Well by Well* → **Brazil Production Summary** (`/well-by-well` URL unchanged).
- *Production by Well* → **Monthly Production** (`/anp-cdp` URL unchanged).
- Pure UI-string rename — no migration / RPC / schema impact.

## 2026-05-28 — Round 4 — `/well-by-well` rename + canonical field grouping

- Route `/production` renamed to `/well-by-well`.
- Field grouping canonical at the dashboard layer via SQL helper `canonical_field_name(text)` + override table `field_canonical_names(field_raw, field_canonical)`. Variants (Búzios, AnC_Búzios, Búzios_ECO, etc.) consolidate server-side; charts, top-fields ranks and YoY math see one row per physical field.
- Admin Field Stakes UI keeps source-level granularity (variants stay separate).
- Admin field list is live — read from last 2 months of `anp_cdp_producao` directly (no MV refresh needed).
- Migration `20260528300000_well_by_well_round4.sql`.

## 2026-05-28 — Brazil Production Summary (Fase 2 of Field Stakes & Production)

- New dashboard `/well-by-well` (introduced as *Well by Well*, renamed in Round 5). Mirrors the monthly Well-by-Well report: Brazil aggregate, stake-weighted company aggregate (default Petrobras), top fields, FPSO/UEP breakdown, MoM/YoY/YTD table.
- 5 RPCs (`get_production_brazil_aggregate`, `get_production_company_aggregate`, `get_production_top_fields`, `get_production_by_installation`, `get_production_yoy_table`) JOIN `anp_cdp_producao` × `field_stakes`.
- Company aggregate only includes campos whose `field_stakes` sum to 100 — campos pending fill are silently excluded so partial stakes never inflate totals (`docs/dados-locais/field_stakes_lacunas.md`).
- Coexists with `/anp-cdp` (analyst view); `/well-by-well` is the C-suite view.
- Dual-view (desktop 2×2 panels + mobile tab bar). Visible to Client + Admin only.
- Migration `20260528000000_production_rpcs.sql`.

## 2026-05-27 — Mobile reform

Cross-cutting reform of the mobile experience, delivered in 3 waves (Designer Liquid Glass v2 → mobile shell + `/home v2` → 10 dashboard refactors + excluded-route cleanup).

- Mobile is **light-only** — `--mobile-*` token system in `src/app/globals.css` has no dark variants.
- Single floating Home pill (`MobileHomePill`) replaced the legacy 4-icon bottom tab bar. Drill-up is contextual via the dashboard header chevron.
- Kebab menu top-right (`MobileKebabMenu`) is the only logout surface; `/profile` is desktop-only.
- `(dashboard)/layout.tsx` is the shell switcher — `DesktopShell` vs `MobileShell` via `useIsMobile()`. Desktop `NavBar` hidden on mobile.
- Export is desktop-only — no `ExportFAB`, no download buttons in any `mobile/View.tsx`.
- Cross-component toast channel: `window.dispatchEvent(new CustomEvent("app-toast", { detail: { message, tone, source } }))` rendered by `MobileToastHost`.
- Last-visited memory: `useTrackLastVisited` writes a FIFO of 4 dashboard slugs to `localStorage["sd_last_visited"]`; `/home v2` mobile view consumes it.
- Mobile-eligible routes (13 as of 2026-06-01): `/home`, `/well-by-well`, `/anp-cdp-bsw`, `/anp-cdp-depletion`, `/anp-cdp-diaria`, `/market-share`, `/price-bands`, `/subsidy-tracker`, `/diesel-gasoline-margins`, `/imports-exports`, `/navios-diesel`, `/news-hunter` (added 2026-05-29), and `/home`.
- Desktop-only routes mount `<MobileExcludedRedirect slug="..." />` in `page.tsx`; on mobile they route to `/home?excluded=<slug>` and fire an `app-toast`.
- See `docs/app/PRD.md` § "Mobile reform 2026-05-27 — light-only paradigm" and `docs/app/dual-view-pattern.md`.

## 2026-05-27 — Diesel Subsidy Reform

- The value previously stored in `anp_subsidy_history.subsidio_brl_l` is actually the **cap** of the per-region reimbursement, not the difference.
- `anp_subsidy_history` dropped, replaced by `anp_subsidy_caps` (by `(vigente_desde, tipo_agente)`) + `anp_subsidy_commercialization` (period × region × agent commercialization prices, populated by an HTML scrape stage added to `subsidy_diesel_sync.py`).
- SQL function `compute_subsidy_reimbursement(date, tipo_agente)` returns the average across the 5 regions of `MIN(MAX(ref − comm, 0), cap)`.
- 4 triggers on `price_bands` / `anp_subsidy_diesel_reference` / `anp_subsidy_commercialization` / `anp_subsidy_caps` keep `price_bands.bba_import_parity_w_subsidy` and `price_bands.petrobras_price_w_subsidy` in sync — Excel upload no longer carries those columns.
- `get_subsidy_tracker_diesel()` rewritten: 11 columns including `ipp_adjusted` / `petrobras_adjusted` and dual-agent `_importador` / `_produtor` suffixes.
- Migrations: `20260527200000_subsidy_reform.sql` + `20260527300000_data_sources_freshness_subsidy_fix.sql`.

## 2026-05-26 — Sales Volumes consolidation

- `/sales-volumes` retired and folded into `/market-share` via a top-level unit toggle (% Share ↔ thousand m³). URL `/sales-volumes` now 301-redirects to `/market-share?unit=volume`.
- Both modes share `get_ms_serie_fast` / `get_ms_serie_others` / `get_others_players` and `get_ms_opcoes_filtros`. Legacy `get_sv_*` dropped by `20260526400000_drop_sv_rpcs.sql`.
- Archived sub-PRD: `docs/app/_deprecated/sales-volumes.md`.

## 2026-05-26 — Home Data Sources live table (desktop-only)

- `/home` desktop layout splits 50/50 — module cards on the left, live Data Sources table on the right. Mobile view unchanged (cards only).
- RPC `get_data_sources_freshness()` returns `(source_key, last_update, row_count)` for 23 ETL-fed entries (22 tables + Yahoo Finance). `LANGUAGE sql STABLE SECURITY DEFINER`, granted to `anon` + `authenticated`. Polled every 60s.
- Source-of-truth curation: `src/data/dataSources.ts`. UI: `src/components/home/DataSourcesTable/`.
- Visible to all tiers; download per row gated by session.
- Migrations: `20260526200000_data_sources_freshness.sql` + `20260527300000_data_sources_freshness_subsidy_fix.sql`.

## 2026-05-26 — ANP Prices consolidation

- `/anp-prices` replaces the 3 retired dashboards `/anp-precos-produtores`, `/anp-precos-distribuicao`, `/anp-lpc`.
- Backed by 3 source tables joined server-side via `get_anp_prices_serie` (UNION ALL with normalization, Diesel S10→S500 fallback, GLP normalized to R$/13kg). 10 legacy RPCs dropped. ETL pipelines untouched.
- Archived sub-PRDs in `docs/app/_deprecated/`. Migrations: `20260526000000_anp_prices_consolidation.sql` + `20260526000001_anp_prices_uf_fix.sql`.

## 2026-05-26 — Field Stakes admin input (Fase 1)

- Admin-curated table `field_stakes(campo, empresa, stake_pct)` — used to estimate company-attributable production.
- CRUD in `/admin-panel` (Field Stakes section). Writes via `admin_upsert_field_stakes` (atomic replace-all per campo, enforces `SUM(stake_pct) = 100`).
- Reads via `get_field_stakes_overview`, `get_field_stakes`, `get_field_stakes_empresas`. Migration `20260527600000_field_stakes.sql`.

## 2026-05-25 — Imports & Exports reform

- `/imports-exports` replaces `/anp-daie`, `/anp-desembaracos`, `/anp-painel-importacoes`.
- `anp_desembaracos` enriched with `importador`/`cnpj`/`uf_cnpj` and PK extended with `cnpj`. Pre-reform rows carry sentinel `cnpj='__legacy__'` until ETL backfill.
- `anp_painel_imp_dist` and 8 obsolete RPCs dropped.
- Aux tables: `imports_product_map`, `importer_group_map` (empty at seed), `ncm_densidade_kg_m3`.
- Exports tab moved to stacked-area-by-destination-country + YoY top-10 (sourced from `mdic_comex` flow=export). Old `get_imports_exports_exports_serie` dropped, replaced by `*_paises_stacked` + `*_yoy_table`.
- Archived sub-PRDs in `docs/app/_deprecated/`. Migrations: `20260525000010_imports_exports_enrichment.sql` + `20260525000110_imports_exports_exports_by_country.sql`.

## 2026-05-25 — `/mdic-comex` deprecation

- Standalone dashboard retired. MDIC Comex data feeds `/imports-exports` Panel D + Import/Export Price Summary tables via `get_imports_exports_imports_unit_price` and `get_imports_exports_exports_unit_price`.
- `mdic_comex` table and `etl_mdic_comex.yml` workflow remain active. 5 `get_mdic_comex_*` RPCs dropped.
- Archived sub-PRD: `docs/app/_deprecated/mdic-comex.md`.
