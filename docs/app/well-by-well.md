# /well-by-well — Brazil Production Summary

> Monthly oil & gas production with company-level attribution via curated field stakes. The executive companion to `/anp-cdp` (granular well-by-well explorer).
>
> **Route rename (Round 4, 2026-05-28):** previously `/production`. The old URL is preserved via a permanent 301 redirect in `next.config.ts`. Backing RPC names (`get_production_*`) and DB-level identifiers were kept as-is — the rename is URL- and UI-only.
>
> **Layout reform (Round 9, 2026-05-27):** the empresa `<select>` dropdown was replaced by FIVE mutually-exclusive view pills (`Brasil` · `Petrobras` · `PRIO` · `PetroReconcavo` · `Brava Energia`) at the top of the page. The pills toggle the entire dashboard between Brazil-wide (100% WI, no stake math) and a stake-weighted view of one company. The chart count dropped from 4 to 3 because the dedicated Brazil-vs-Company comparison row was redundant under the new model — when the user wants Brazil context, they tap the Brasil pill; when they want a company, they tap that company pill.
>
> **Sidebar refactor (Round 10, 2026-05-27, `[desktop-only]`):** the desktop View was migrated to the project's canonical left-sidebar pattern (`#sidebar` · `sidebar-section-label` · `sidebar-filter-section`) shared with `/anp-cdp`, `/imports-exports`, `/market-share`, and 7 other dashboards. Filters (Period · Reference month · Environment) moved from the in-content horizontal block into the sticky left column. HeaderTable now occupies the full width of the main content area below the pills row — the inline `wbw-top-split` 2-column grid is gone. Pills stay at the TOP of main content (not in the sidebar) because they are view-mode selectors, semantically distinct from the in-view subsetters in the sidebar. Mobile View is unchanged — phones keep the `FilterDrawer` (BottomSheet) pattern.
>
> **Period preset buttons (Round 13, 2026-05-27):** the rc-slider `PeriodSlider` was replaced by FIVE mutually-exclusive preset buttons (**Last 12M** *(default)* · **Last 24M** · **Last 36M** · **All** · **YTD**) in both the desktop sidebar's Period section and the mobile FilterDrawer's Period section. State still lives in `dateRange` (unchanged shape) — clicks call the existing `setDateRange` setter; active state is detected by comparing the current `dateRange` against each preset's computed range (helpers `computePresetRange` + `detectPeriodPreset` exported from `useProductionData.ts`). Default lookback dropped from 13 → 12 months so "Last 12M" highlights as active on first paint. Shared `PeriodSlider` component is untouched (still used by 9+ other dashboards).
>
> **Environment filter removed + English labels (Round 14, 2026-05-27):** the `MultiSelectFilter` for `ambientes` was dropped from the desktop sidebar and the mobile `FilterDrawer`. All three environments are always shown — `get_production_brazil_aggregate` and `get_production_company_aggregate` are invoked with `p_ambientes = NULL`. The hook's `ambientes` state, setter, toggle and exports were removed. Concurrently, ambiente display labels were translated to English (`PreSal → Pre-Salt`, `PosSal → Post-Salt`, `Terra → Onshore`) via a new `AMBIENTE_LABEL` map + `labelAmbiente(raw)` helper in `useProductionData.ts`, applied to the Chart 1 stacked-bar trace `name` and `hovertemplate` in both views (legend + hover). Underlying RPC payload values stay raw (`ambiente: 'PreSal'` etc.) so exported rows remain comparable to the `anp_cdp_producao.local` column. HeaderTable was already English (RPC-side translation in `get_well_by_well_header`) — untouched.
>
> **Drill KPI strip → KPI summary table (Round 16, 2026-05-28):** the field-drill and installation-drill modals/sheets dropped the legacy 4-card KPI strip (Current oil / Δ MoM / Δ YoY / YTD avg) at the top and gained a 5-column **KPI summary table** rendered BELOW the chart. Columns: **Current month** · **Previous month** · **MoM %** · **Same month prev. year** · **YoY %**. The new table is sourced from a **period-independent** 14-month series anchored to `latestMonth` (see `drillKpiSeries` + `drillInstalacaoKpiSeries` in the hook, fetched in dedicated effects that depend on `latestMonth` but NOT on `dateRange`). This fixes the "ΔYoY = —" bug screenshotted on FRADE — PRIO with "Last 12M" selected: the same month one year ago sat just outside the chart's window so the legacy YoY column was blank even though the underlying datapoint exists. Builder `buildKpiTable` is shared across both drills and hoisted to module scope. Desktop renders the table as a horizontal 5-column layout (`DrillKpiTable`); mobile renders a 5-row stacked layout (`MobileDrillKpiTable`) since phones don't fit 5 legible columns. Both color the MoM/YoY cells green for positive, red for negative, gray for null/zero.

## Purpose

Replicate the monthly Well-by-Well report read by Eduardo: Brazil-wide totals or one company's stake-weighted slice (toggled via view pill), split by environment (Pre-Salt / Post-Salt / Onshore), with the active view's top producing fields, FPSO/UEP-level breakdown, and YoY / MoM / YTD deltas — all from a single dashboard, single auth tier, single data layer.

`/well-by-well` is the **executive summary** (one company at a time, monthly cadence, KPI-first). `/anp-cdp` remains the **granular explorer** (per-well, no company aggregation). The two coexist; they answer different questions.

## Data sources

| Source | Role |
|---|---|
| `anp_cdp_producao` (~1.8M rows, ANP CDP, monthly per-well) | Production facts |
| `field_stakes` (Fase 1 — admin-curated working interests per field) | Company attribution map |
| `field_stakes_lacunas` (admin view) | Fields whose stakes do NOT yet sum to 100 — silently excluded from `/well-by-well` until Eduardo completes them via `/admin-panel` |
| `field_canonical_names` (Round 4, 2026-05-28) | Variant → canonical map for fields with operational sub-units (e.g. Búzios + AnC_Búzios + Búzios_ECO → "Búzios"). Owned by `worker_supabase`. Drives canonical grouping in `get_production_top_fields` + canonical expansion in `get_production_field_timeseries`. |

All math is done **server-side** in SECURITY DEFINER RPCs (migration `supabase/migrations/20260528000000_production_rpcs.sql` + follow-up rounds, owned by `worker_supabase`). The browser never re-derives company production — it only renders.

### RPCs consumed

| RPC | Signature | Purpose |
|---|---|---|
| `get_production_brazil_aggregate` | `(date_start date, date_end date, ambientes text[] DEFAULT NULL)` | Brazil-wide monthly totals by environment (NOT stake-weighted). Powers Chart 1 in **Brasil** view. |
| `get_production_company_aggregate` | `(empresa text, date_start date, date_end date, ambientes text[] DEFAULT NULL)` | Stake-weighted monthly totals for one company by environment. Filters to campos whose stakes SUM to 100. Powers Chart 1 in **company** view. |
| `get_production_top_fields` | `(empresa text, date date, top_n int DEFAULT 10)` | Top-N producing fields for one company in one calendar month. **Round 4:** groups by `canonical_field_name(p.campo)` server-side; returned `campo` is the canonical label. Powers Chart 2 in **company** view. |
| `get_production_brazil_top_fields` *(Round 9)* | `(date date, top_n int DEFAULT 10)` | Top-N producing fields nationwide (100% WI, no stake math). Same canonical grouping as the company variant. Powers Chart 2 in **Brasil** view. |
| `get_production_by_installation` | `(empresa text, date date)` | Installation-level (FPSO/UEP/land plant) production stake-weighted for one company, one month. Powers Chart 3 in **company** view. |
| `get_production_brazil_installation` *(Round 9)* | `(date date)` | Installation-level production nationwide (100% WI). Powers Chart 3 in **Brasil** view. |
| `get_production_yoy_table` | `(empresa text, date date)` | YoY/MoM/YTD breakdown at the reference month — 1 TOTAL row + 1 row per environment. Consumed only by the mobile YoY drawer (company view only — hidden in Brasil mode). |
| `get_production_field_timeseries` | `(p_campo text, p_empresa text, p_date_start date, p_date_end date)` | Stake-weighted monthly oil/gas/water/uptime timeseries for one field × one company. Powers the Field drill-down in **company** view. **Round 4:** `p_campo` interpreted as canonical; server expands to all variants. |
| `get_production_brazil_field_timeseries` *(Round 9)* | `(p_campo text, p_date_start date, p_date_end date)` | Same as above but Brazil-wide (100% WI). Powers the Field drill-down in **Brasil** view. Canonical expansion preserved. |
| `get_field_stakes_overview` | (admin-only) | **Round 4:** now returns an extra `canonical text` column alongside `campo` so the admin variant editor can group variants by their canonical roll-up. Owned by `worker_supabase`, consumed by `worker_dash-admin`. |
| `get_production_installation_timeseries` | `(p_instalacao text, p_empresa text, p_date_start date, p_date_end date)` | Stake-weighted monthly timeseries for one installation × one company. Powers the Installation drill-down in **company** view. Returns the SAME row shape as `get_production_field_timeseries`. |
| `get_production_brazil_installation_timeseries` *(Round 9)* | `(p_instalacao text, p_date_start date, p_date_end date)` | Same as above but Brazil-wide. Powers the Installation drill-down in **Brasil** view. |
| `get_well_by_well_header` | `(p_empresa text, p_year int, p_month int)` | PDF-style page-2 header table (Round 8). Always returns BOTH a Brazil section AND a company section (24 rows total since Round 12 — 12 BRAZIL rows + 12 empresa rows with Oil + Gas + Main fields per empresa). The HeaderTable component renders ONLY the rows for the active pill's section: Brasil → `section === 'BRAZIL'`, empresa pill → `section === UPPER(p_empresa)`. In **Brasil** view the wrapper still passes a fallback empresa (`Petrobras`) to satisfy the non-null param; the company rows from the response are discarded by the filter. |

All return `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp` (Pegadinha #18) and are granted to `anon, authenticated`. Frontend wrappers live in `src/lib/rpc.ts` under the "MODULE: Brazil Production Summary" section.

### Drill-down popup RPC wrappers (Phase 2, 2026-05-30)

The BSW and Depletion tabs of the field drill-down modal consume the existing `/anp-cdp-bsw` and `/anp-cdp-depletion` RPCs through 4 thin wrappers in `src/lib/rpc.ts` that pass `p_expand_canonical=true` — every other call site (the dedicated `/anp-cdp-bsw` and `/anp-cdp-depletion` dashboards) keeps the strict default (`false`).

| Wrapper | Underlying RPC | Purpose |
|---|---|---|
| `rpcGetAnpCdpBswScatterCanonical` | `get_anp_cdp_bsw_scatter(p_campos, p_expand_canonical=true)` | Per-well BSW scatter for canonical drill (aggregates all variants) |
| `rpcGetAnpCdpBswFieldAggregateCanonical` | `get_anp_cdp_bsw_field_aggregate(p_campos, p_expand_canonical=true)` | Field-average BSW vs % VOIP, canonical-expanded |
| `rpcGetAnpCdpDepletionScatterCanonical` | `get_anp_cdp_depletion_scatter(p_campos, p_expand_canonical=true)` | Per-well NP rolling depletion, canonical-expanded |
| `rpcGetAnpCdpDepletionFieldAggregateCanonical` | `get_anp_cdp_depletion_field_aggregate(p_campos, p_expand_canonical=true)` | Field-average NP rolling depletion vs % VOIP, canonical-expanded |

Server-side support: migration [`supabase/migrations/20260530000000_cdp_rpcs_canonical_expansion.sql`](../../supabase/migrations/20260530000000_cdp_rpcs_canonical_expansion.sql) added the optional `p_expand_canonical bool DEFAULT false` parameter to the 4 underlying RPCs. Chart builders are shared with the standalone dashboards via [`src/lib/charts/bsw.ts`](../../src/lib/charts/bsw.ts) and [`src/lib/charts/depletion.ts`](../../src/lib/charts/depletion.ts) — any visual change to the builders affects both call sites and must be coordinated with `worker_dash-anp-cdp-bsw` / `worker_dash-anp-cdp-depletion`.

Source-of-truth migrations:
- `supabase/migrations/20260528000000_production_rpcs.sql` (Round 1, 5 RPCs).
- `supabase/migrations/20260528100000_production_round2.sql` (Round 2: YoY TOTAL fix + `get_production_field_timeseries`).
- `supabase/migrations/20260528200000_production_installation_timeseries.sql` (Round 3: `get_production_installation_timeseries`).
- `supabase/migrations/20260528300000_well_by_well_round4.sql` (Round 4: `module_visibility` slug rename `production → well-by-well`, new `field_canonical_names` table, canonical-aware bodies for `get_production_top_fields` + `get_production_field_timeseries`, new `canonical` column in `get_field_stakes_overview`).
- `supabase/migrations/20260528500000_well_by_well_header.sql` (Round 8: `get_well_by_well_header` RPC — PDF-style page-2 header table).
- `supabase/migrations/20260528600000_well_by_well_brazil_rpcs.sql` (Round 9: 4 Brazil-wide RPCs + 2 MVs + updated refresh function — `get_production_brazil_top_fields`, `get_production_brazil_installation`, `get_production_brazil_field_timeseries`, `get_production_brazil_installation_timeseries`).

### View pills (5)

Replaced the empresa `<select>` in Round 9 (2026-05-27). Five mutually-exclusive pills sit at the top of both Views:

| Pill | Mode | Data source |
|---|---|---|
| **Brasil** *(default)* | Brazil-wide, 100% WI | `get_production_brazil_*` family — no stake math |
| Petrobras | Stake-weighted | Existing `get_production_*` empresa RPCs |
| PRIO | Stake-weighted | Existing `get_production_*` empresa RPCs |
| PetroReconcavo | Stake-weighted | Existing `get_production_*` empresa RPCs |
| Brava Energia | Stake-weighted | Existing `get_production_*` empresa RPCs |

Single source of truth: `src/data/wellByWellEmpresas.ts` exports `WELL_BY_WELL_VIEWS` (5 strings, ordered). The companion `WELL_BY_WELL_EMPRESAS` constant (just the 4 company names) is derived via the `isCompanyView` helper and kept for back-compat — used by the hook's bootstrap filter and by the admin panel via a different code path.

The pill order is the executive-report opening order: country first, then largest IR-relevant companies. Default = **Brasil** (was Petrobras pre-Round 9).

If a user lands on `/well-by-well` with stale state pointing outside the 5-pill whitelist, the hook snaps `view` back to **Brasil** on bootstrap.

The **admin panel's Field Stakes autocomplete is NOT affected** — it continues to consume the full `rpcGetFieldStakesEmpresas` list (63+ companies). Only this dashboard's view selector is narrowed.

To add a company pill: append it to `WELL_BY_WELL_VIEWS` in `src/data/wellByWellEmpresas.ts` (after the 4 existing companies). The name must match the canonical normalized form used in `field_stakes.empresa` — e.g. "Brava Energia" (not "Brava"); "PetroReconcavo" (no accent, no space).

## Filter model

| Filter | Type | Default |
|---|---|---|
| View (Brasil or company) | 5 pill row (mutually exclusive) | `Brasil` |
| Period (`dateRange`) | Period preset buttons (Last 12M / 24M / 36M / All / YTD) — 5 mutually-exclusive buttons; clicks call the hook's `setDateRange` (Round 13) | `Last 12M` — `[latestMonth − 11mo, latestMonth]` (12 months inclusive) |
| Reference month | single-select `<select>` (restricted to current period window) | Most recent month in window (snaps when range changes) |

> **Environment filter removed (Round 14, 2026-05-27):** the old `MultiSelectFilter` for `ambientes` (Pre-Salt / Post-Salt / Onshore) was dropped from both the desktop sidebar and the mobile `FilterDrawer`. All three environments are now ALWAYS shown — the hook passes `p_ambientes = NULL` to both `get_production_brazil_aggregate` and `get_production_company_aggregate`, which the RPCs treat as "no filter". Display labels for the three buckets were also translated to English (`PreSal → Pre-Salt`, `PosSal → Post-Salt`, `Terra → Onshore`) via the new `labelAmbiente` helper in `useProductionData.ts`; underlying RPC payload values stay raw so export rows and analyst diffs remain comparable to the `anp_cdp_producao.local` column.

All filters live in `useProductionData` — single source of truth. Period preset clicks debounce all RPCs at 150ms via `useDebouncedFetch` (Round 5 perf tune). The view state machine drives which RPC family fires; the hook returns `view`, `setView`, `isCompanyView`, and `viewEmpresa` (null in Brasil view, company name otherwise).

### Period preset semantics (Round 13)

All presets anchor their `end` to `latestMonth` (the most recent `(ano, mes)` in `anp_cdp_producao`, exposed by the hook). Presets are exported from `useProductionData.ts` so both Views share a single source of truth.

| Button | Start anchor | End anchor |
|---|---|---|
| Last 12M *(default)* | `latestMonth − 11mo` | `latestMonth` |
| Last 24M | `latestMonth − 23mo` | `latestMonth` |
| Last 36M | `latestMonth − 35mo` | `latestMonth` |
| All | `2010-01-01` (safe lower bound; `setDateRange` snaps to the first available month, typically `2018-01-01`) | `latestMonth` |
| YTD | `{latestMonth.year}-01-01` | `latestMonth` |

Active state is detected by `detectPeriodPreset(dateRange, latestMonth, firstAvailableMonth)`: each candidate preset's computed range is compared against the current `dateRange` end-anchor + start-anchor; first exact match wins. Returns `null` if no preset matches (defensive — no UI path currently produces a custom range).

## Panels (Round 9 — 3 charts)

The 4-chart layout (P1 Brazil + P2 Company side-by-side, P3 Top Fields + P4 Installations) was reduced to 3 in Round 9. The dedicated Brazil-vs-Company comparison row is gone — the active pill decides what Chart 1 shows. Chart 2 and Chart 3 also branch on the pill.

| # | Panel | Source RPC (Brasil view) | Source RPC (company view) | Notes |
|---|---|---|---|---|
| 1 | {View} — Oil Production (kbpd) | `get_production_brazil_aggregate` | `get_production_company_aggregate` | Stacked bars, x=month, y=oil kbpd, stack=ambiente. Both views share the PDF palette (Pre-Salt dark navy, Post-Salt brand orange, Onshore mint green — see [Color palette](#color-palette)). Full-width on desktop, full-width tab on mobile. |
| 2 | Top {View} Fields — {Reference month} (kbpd) | `get_production_brazil_top_fields` | `get_production_top_fields` | Horizontal bar, top 10, oil+water stacked. Click a bar to drill into the field's timeseries over the active period preset (the drill RPC also branches on view). |
| 3 | Installations (FPSO/UEP) — {View} — {Reference month} | `get_production_brazil_installation` | `get_production_by_installation` | Scrollable table on desktop / tappable card list on mobile. Click a row to drill into the installation's timeseries over the active period preset. **Mobile display limits (2026-05-28 [mobile-only]):** company views show ALL platforms (any single company has ≤ ~10 FPSOs); Brazil aggregate shows top 30 by oil production desc. The horizontal bar chart that previously appeared above the card list was removed — it was redundant with the already-sorted list below it. |
| YoY drawer (mobile, company view only) | {Company} — YoY / MoM / YTD | — | `get_production_yoy_table` | Collapsible drawer below the active tab. Hidden in Brasil mode (no per-ambiente YoY rows from the Brazil-wide RPCs). |

## Header table (PDF-style) — Round 8 (2026-05-27)

A self-contained HTML table that replicates page 2 of the monthly Well-by-Well PDF report. Sits at the top of both Views — desktop puts it next to the filters (left ~35% filters, right ~65% table), mobile stacks it above the tab bar with horizontal scroll for the wider columns.

### What it shows

| Section | Categories | Sub-rows |
|---|---|---|
| **Brazil** (no stake weighting) | Oil (kbpd), Gas (kboed), Main fields (kbpd) | Pre-Salt / Post-Salt / Onshore (Oil & Gas); top fields by name (Main fields) |
| **{Empresa}** (stake-weighted) | Oil (kbpd), Main fields (kbpd) | Pre-Salt / Post-Salt / Onshore (Oil); company's main fields (Main fields) |

### Columns

`(empty)` | `{currentMonth-YY}` | `{prevMonth-YY}` | `Δ MoM` | `{sameMonthPrevYear-YY}` | `Δ YoY` | `YTD`

- Numeric cells: right-aligned, pt-BR thousand separator (e.g. `4.337`).
- Δ MoM / Δ YoY: integer percent with sign (e.g. `+2%`, `-1%`); blank if the prior value is NULL or zero.
- YTD: average of all months in the current year up to and including the reference month.

### Data source

`get_well_by_well_header(p_empresa text, p_year int, p_month int)` (slot `20260528500000`) — single RPC, server-side aggregation, returns one row per renderable line. Row shape: `(display_order, section, category, subcategory, is_total, current_val, prev_month_val, mom_pct, prev_year_val, yoy_pct, ytd_avg)`.

- Section header rows (`subcategory IS NULL` AND `category IS ''`): rendered as a wide dark-navy banner spanning all 7 columns (e.g. "BRAZIL" / "PETROBRAS").
- Category header rows (`subcategory IS NULL` AND `category != ''`): light-gray band, bold, carries the category-total numbers (e.g. "Oil (kbpd)" row).
- Sub-rows (`subcategory IS NOT NULL`): white background, indented ~28px, normal weight (or bold if `is_total=true`).

### Loading / empty / error states

- `loading && rows.length === 0` → 4 skeleton lines with a shimmering gradient.
- `loading && rows.length > 0` → existing rows render with `opacity: 0.7`.
- `rows.length === 0 && !loading` → "No header data for this reference month." caption.
- RPC error → wrapper throws; the fetch effect inside `useProductionData` catches and sets `headerData = []` (the empty caption shows).

### Layout split

- **Desktop (≥769px, Round 10)**: canonical project pattern — `NavBar` then `container-fluid g-0 > row g-0` with `col-xxl-2 col-md-3` sidebar (`#sidebar` with `BrandLogo variant="sidebar"`, `sidebar-section-label "Filters"`, then two `sidebar-filter-section` blocks for Period → Reference month — Round 14 dropped the Environment block) and `col-xxl-10 col-md-9` main content (`#page-content` with `DashboardHeader`, then pills row, then HeaderTable full-width, then Chart 1 full-width, then Charts 2+3 side-by-side). Sidebar is sticky (`top: 56px`, `height: calc(100vh - 56px)`, scrolls independently) and uses the liquid-glass background from `globals.css` (`#sidebar` rule). Reuses the exact pattern from `/anp-cdp` / `/imports-exports` / `/market-share` / 7 other dashboards — no inline overrides, no bespoke grid.
- **Mobile (≤768px)**: pills row at the top (horizontally scrollable, ~5 pills wider than a phone viewport — the active pill auto-scrolls into view on tap), then HeaderTable, then tab bar, then tab content. A "Swipe left to see more columns ›" caption confirms the table's horizontal-scroll affordance. Filters stay in the `FilterDrawer` (BottomSheet) opened from the topbar — Round 9 dropped the empresa `<select>` from the drawer; Round 14 dropped the Environment multi-select too, leaving only Period + Reference month.

### Pill-scoped section filter (Round 12, 2026-05-27)

`HeaderTable` renders **ONLY the rows belonging to the active pill's section** — never Brazil + empresa together.

| Active pill | Filter | Rows rendered |
|---|---|---|
| `Brasil`           | `section === 'BRAZIL'`         | 12 rows: Oil (kbpd) + Pre-Salt/Post-Salt/Onshore + Gas (kboed) + Pre-Salt/Post-Salt/Onshore + Main fields + top campos |
| `Petrobras`        | `section === 'PETROBRAS'`      | 12 rows for Petrobras: Oil + Gas + Main fields (stake-weighted) |
| `PRIO`             | `section === 'PRIO'`           | 12 rows for PRIO (NULL cells permitted where PRIO has no Pre-Salt/Onshore presence — the RPC emits row stubs anyway so the structure stays consistent across pills) |
| `PetroReconcavo`   | `section === 'PETRORECONCAVO'` | 12 rows for PetroReconcavo |
| `Brava Energia`    | `section === 'BRAVA ENERGIA'`  | 12 rows for Brava Energia |

Implementation details:

- `viewMode === "Brasil"` is special-cased — `"Brasil".toUpperCase()` is `"BRASIL"` (Portuguese), but the RPC body emits the English-language section label `"BRAZIL"`. The filter maps `Brasil → BRAZIL` explicitly; every other pill name passes through `.toUpperCase()` (e.g. `Petrobras → PETROBRAS`, `Brava Energia → BRAVA ENERGIA`).
- The underlying `get_well_by_well_header(p_empresa, p_year, p_month)` RPC is still called even in Brasil mode — the wrapper passes `HEADER_TABLE_FALLBACK_EMPRESA = "Petrobras"` to satisfy the non-null `p_empresa` contract. The RPC returns 24 rows total (12 Brazil + 12 empresa); the HeaderTable filter discards the empresa half.
- In company view the RPC returns the empresa-specific 12-row section directly (rows where `section === UPPER(p_empresa)`).
- This is an intentional tradeoff: one extra unused RPC slice in exchange for not having to build a separate Brazil-only header RPC.

The caption above the table reflects the active scope: `Headline — Apr 2026 — BRAZIL` (Brasil pill) or `Headline — Apr 2026 — PRIO` (PRIO pill), etc. Both desktop and mobile render the same caption pattern.

#### Why a single-section view (not split)

Earlier rounds (Round 8 → Round 10) rendered Brazil + the selected empresa together in a single table. That was great for context but added 12 rows of "background noise" every time the user picked a company to focus on. With the pill-scoped filter:

- The table shrinks from 24 rows to 12 in company views — fits a single laptop viewport without scroll.
- The active pill and the visible content always agree — no mental mapping needed ("the pill says PRIO but I'm looking at Brazil rows on top, then PRIO at the bottom").
- View-change transitions are instant: stale rows from the previous pill simply don't match the new filter and disappear on the next render, even before the RPC payload lands. This makes the **Round 10 defensive clear effect redundant** — it was removed in Round 12 in favour of the filter alone.

If the user wants Brazil totals while drilled into PRIO, they tap the Brasil pill. The five pills are the navigation primitive; the table reflects whichever pill is active.

### Why this section displaced the old YoY table (desktop only)

The original `/well-by-well` desktop layout had a YoY/MoM/YTD breakdown table at the bottom (TOTAL + per-ambiente rows for the selected company, sourced from `get_production_yoy_table`). The new HeaderTable's company section is a strict superset of that data (same TOTAL + per-ambiente rows, same MoM/YoY/YTD semantics, plus Brazil-wide context, gas, and main fields). Keeping both would have duplicated the same numbers in two places. **Removed the bottom YoY table from desktop; mobile keeps its YoY collapsible drawer in company view** because the HeaderTable on mobile lives behind horizontal scroll and the drawer surfaces the company numbers without requiring a swipe.

Round 9 update: the YoY drawer is also **hidden in Brasil mode** since `get_production_yoy_table` requires a company name and the Brazil-wide RPCs don't produce per-ambiente YoY rows. Brasil users get the HeaderTable's Brazil section instead.

The hook still fetches `yoyTable` (skipped in Brasil view via early return) because the mobile View consumes it in company view. If mobile ever drops the YoY drawer, the `get_production_yoy_table` RPC and its hook state can be retired in a follow-up.

## Field drill-down (Round 2, 2026-05-27; Brasil-aware since Round 9; 3-tab popup since Phase 2, 2026-05-30)

A secondary view that opens on demand when the user wants to dig into one of the Top Fields. The same hook owns its state; both Views render the same content through different surfaces. Round 9: the drill auto-closes when the user switches the view pill (so a "BÚZIOS — Petrobras" modal doesn't linger as the user toggles to "Brasil").

**Trigger:**
- **Desktop:** click any bar in the Chart 2 Top Fields chart, or click the helper caption beneath it.
- **Mobile:** tap any field card in the Top Fields tab (the chart stays for at-a-glance comparison; cards are added below for drill-in).

**Surfaces:**
- **Desktop:** Bootstrap-styled modal (`FieldDrillModal` inline in `desktop/View.tsx`) — **900px wide** (was 820px pre-Phase 2 to fit the tab bar comfortably), brand-orange accent bar, Esc / scrim / × all close.
- **Mobile:** `BottomSheet` (`height="90vh"`) — same content reflowed to a single column, with a `MobileTabBar` at the top of the sheet.

### Tabs (Phase 2, 2026-05-30)

The popup hosts **three mutually-exclusive tabs**: Production (default), BSW, Depletion. Switching tabs does **not** close the drill and does **not** re-fetch the Production data — each tab caches its rows until `drillCampo` changes. The dashboard's period preset (Last 12M / 24M / 36M / All / YTD) affects ONLY the Production tab; BSW and Depletion are lifecycle analyses spanning the entire history of the field.

| Tab | Data source | Chart builder | X axis | Sub-toggle |
|---|---|---|---|---|
| **Production** *(default)* | `get_production_field_timeseries` (company view) or `get_production_brazil_field_timeseries` (Brasil view) | inline in `desktop/View.tsx` (4 KPIs + stacked bars + hours-rate line, see below) | calendar month over active period preset | — |
| **BSW** | `rpcGetAnpCdpBswScatterCanonical` (Per well) or `rpcGetAnpCdpBswFieldAggregateCanonical` (Field average) — both wrap the same `/anp-cdp-bsw` RPCs with `p_expand_canonical=true` | `buildPerWellChart` / `buildFieldAverageChart` from [`src/lib/charts/bsw.ts`](../../src/lib/charts/bsw.ts) | months since first production (Per well) or % VOIP recovered (Field average) | **Field average** *(default)* / **Per well** |
| **Depletion** | `rpcGetAnpCdpDepletionScatterCanonical` (Per well) or `rpcGetAnpCdpDepletionFieldAggregateCanonical` (Field average) — both wrap the same `/anp-cdp-depletion` RPCs with `p_expand_canonical=true` | `buildPerWellChart` / `buildFieldAverageChart` from [`src/lib/charts/depletion.ts`](../../src/lib/charts/depletion.ts) | **% VOIP recovered** (fixed — Calendar/VOIP toggle of the standalone dashboard is not exposed here) | **Field average** *(default)* / **Per well** |

**Canonical expansion.** BSW and Depletion tabs call the 4 CDP RPCs with `p_expand_canonical=true`, so a click on the canonical "TUPI" row of Top Fields aggregates `{TUPI, SUL DE TUPI, AnC_TUPI}` — every variant rolled up under the canonical label. Pre-Phase-2 `/anp-cdp-bsw` and `/anp-cdp-depletion` call sites continue to use the strict (default `false`) variant. Backed by the optional parameter introduced in [`supabase/migrations/20260530000000_cdp_rpcs_canonical_expansion.sql`](../../supabase/migrations/20260530000000_cdp_rpcs_canonical_expansion.sql).

**Empty state per tab.** BSW and Depletion show "BSW/Depletion data unavailable for this field — no VOIP reference published yet." when the field has no `anp_voip` row; the field-aggregate RPCs inner-join VOIP and return zero rows in that case.

### Production tab (default)

**Data:**
- **Brasil view:** `get_production_brazil_field_timeseries(p_campo, p_date_start, p_date_end)` — Brazil-wide (100% WI). Modal title reads "BÚZIOS — Brasil".
- **Company view:** `get_production_field_timeseries(p_campo, p_empresa, p_date_start, p_date_end)` — stake-weighted for the active company. Modal title reads "BÚZIOS — Petrobras".

The CHART fetch uses the dashboard's current `dateRange` (no separate filter). Both RPC variants return identical row shapes (`ProductionFieldTimeseriesRow`) so the chart builder is shared.

**Layout (Round 16, 2026-05-28):** the Production tab is structured as **chart on top, KPI summary table below**. The legacy 4-card KPI strip at the top of the tab is gone.

**KPI summary table.** A second fetch — separate from the chart — runs against the same RPC family with a **fixed 14-month window anchored to `latestMonth`** (the most recent month in `anp_cdp_producao`). It's deliberately INDEPENDENT of the dashboard's `dateRange` so the table always has access to current month, previous month, and same month one year ago, regardless of what period preset the user picked. Cache state in the hook: `drillKpiSeries` (field) and `drillInstalacaoKpiSeries` (installation). The builder `buildKpiTable` is shared.

| Column | Source | Format |
|---|---|---|
| **Current month** | last `(ano, mes)` point in `drillKpiSeries` | kbpd, 1 decimal; em-dash if series empty |
| **Previous month** | immediately preceding `(ano, mes)` point | kbpd, 1 decimal; em-dash if absent |
| **MoM %** | `(current - prev) / prev` | signed pct, 1 decimal; green positive, red negative, gray null |
| **Same month prev. year** | `current.ano - 1, current.mes` lookup | kbpd, 1 decimal; em-dash if row missing |
| **YoY %** | `(current - prev_year) / prev_year` | signed pct, 1 decimal; green positive, red negative, gray null |

Each column header carries a sub-line with the corresponding month label (e.g. "Apr 2026", "Mar 2026", "Apr 2025"). The same-month-prev-year sub-line is always shown (it's derived from `last.ano - 1, last.mes`) even when the underlying row is missing — keeps the column header meaningful.

**Bug that motivated Round 16.** With `Last 12M` selected, picking April 2026 gave a chart window of May 2025 → April 2026, which doesn't include April 2025 — the legacy ΔYoY card therefore displayed "—" even though April 2025 data is in the database. Round 16's separate 14-month KPI fetch fixes this; the YoY cell is now populated whenever the data point exists, independent of the chart's preset.

**Chart:** vertical stacked bars (oil dark `#1a1a1a` + water light blue `#7BB6DD`) on the left y-axis in kbpd over the active period preset window, **plus** a hours-rate line (`BRAND_ORANGE`, `#ff5000`) on the right y-axis in `%` (0..105). Identical visual logic on both Views, layered via Plotly's `yaxis: "y2"` overlay.

**X-axis ticks pinned to data months** (fix 2026-05-28). The date axis uses `tickmode: "array"` with `tickvals` set to the exact `YYYY-MM-01` anchors of the plotted bars — one tick per data point. Without this, Plotly's auto-tick algorithm on a short series (e.g. WAHOO, which came online in early 2026 and only has 3-4 months of history) picks ~4-5 evenly-spaced positions that round to the same month label twice, rendering the axis as "Feb 26 · Mar 26 · Mar 26 · Apr 26". Same pattern as the hero chart's tickvals pinning. Builder also defensively collapses any duplicate `(ano, mes)` rows the RPC might emit (sums oil/water/gas, averages hours_rate) so the chart never stacks two bars on top of each other at the same x position.

**Empty state:** fields whose stakes don't sum to 100 (i.e. listed in `field_stakes_lacunas`) return zero rows server-side. The modal/sheet still opens; the KPI table renders all em-dashes and a centered "No data for this field in the current period." caption replaces the chart.

**Error handling:** RPC failures on the chart fetch bubble up as `drillError` (string) and render as a yellow warning banner inside the modal/sheet body. RPC failures on the KPI series fetch are non-fatal — the table simply shows em-dashes (so a single transient error doesn't blank the whole popup; the chart's error already surfaces the issue). The drill stays open so the user can dismiss; closing clears the error. BSW and Depletion tabs surface their own `drillBswError` / `drillDepletionError` independently — switching tabs swaps the rendered banner.

## FPSO/Installation drill-down (Round 3, 2026-05-27)

Mirrors the Field drill-down pattern at the installation (FPSO/UEP/land plant) level — same hook owns the state, same dual-surface architecture, same client-side KPI math.

**Trigger:**
- **Desktop:** click any row in the Chart 3 Installations table (cursor pointer + warm-orange hover bg `#fff5ef`). The helper caption below the table confirms the affordance.
- **Mobile:** tap any FPSO `MobileDataCard` in the FPSOs tab (each card now shows a "Tap to drill ›" hint, matching the Top Fields tab pattern).

**Data:**
- **Brasil view:** `get_production_brazil_installation_timeseries(p_instalacao, p_date_start, p_date_end)` — Brazil-wide (100% WI). Modal title reads "FPSO P-79 — Brasil".
- **Company view:** `get_production_installation_timeseries(p_instalacao, p_empresa, p_date_start, p_date_end)` — stake-weighted. Modal title reads "FPSO P-79 — Petrobras".

**Row shape is identical to `get_production_field_timeseries`** — the TypeScript layer expresses this with `type ProductionInstallationTimeseriesRow = ProductionFieldTimeseriesRow`. The CHART fetch uses the dashboard's current `dateRange` (no separate filter).

**Surfaces:**
- **Desktop:** Bootstrap-styled modal (`InstallationDrillModal` inline in `desktop/View.tsx`) — same 820px wide chrome, brand-orange accent bar, Esc / scrim / × all close. The chart builder (`buildFieldDrillChart`) is reused since the row shape is identical.
- **Mobile:** `BottomSheet` (`height="90vh"`) — same chart + KPI table as the field drill (Round 16 stacked layout).

**Layout (Round 16, 2026-05-28):** chart on top, **KPI summary table** below — same 5-column / 5-row pattern as the field drill (`Current month` / `Previous month` / `MoM %` / `Same month prev. year` / `YoY %`). KPI data is sourced from a separate, period-independent 14-month series anchored to `latestMonth` (`drillInstalacaoKpiSeries`); the chart series remains period-filtered. See the field-drill section above for full column semantics + the bug-fix rationale.

**Chart:** identical to the field drill — vertical stacked bars (oil `#1a1a1a` + water `#7BB6DD`) on the left y-axis (kbpd) over the active period preset window, plus a hours-rate line (`BRAND_ORANGE`) on the right y-axis (%, 0..105).

**Empty state:** installations whose constituent campos are all in `field_stakes_lacunas` return zero rows server-side. The modal/sheet still opens; the KPI table renders em-dashes and a centered "No data for this installation in the current period." caption replaces the chart.

**Error handling:** RPC failures on the chart fetch bubble up as `drillInstalacaoError` and render the same yellow warning banner. KPI-series fetch errors are non-fatal — the table simply shows em-dashes.

**Mutual exclusivity:** the field drill and installation drill are mutually exclusive at the hook level — opening one auto-closes the other (clearing its timeseries + KPI series + error). Rationale: simpler UX with only one modal/BottomSheet on screen at a time; avoids stacked overlays on mobile in particular.

## Round 4 — canonical field grouping (2026-05-28)

The big offshore fields are split in ANP CDP into operational variants (Búzios + AnC_Búzios + Búzios_ECO; Tupi + AnC_Tupi; Lula + Lula Nordeste; etc.). Before Round 4, the dashboard surfaced each variant as a separate row in the Top Fields panel — splitting Petrobras's biggest field across three rows none of which matched what bankers/research analysts call "Búzios". Round 4 introduces server-side canonical grouping while keeping variants individually editable.

**Server-side (Frente A, migration `20260528300000_well_by_well_round4.sql`):**
- New lookup table `field_canonical_names(variant text PK, canonical text)` + helper function `canonical_field_name(text) → text` that defaults to the input when no mapping exists (so plain unique fields like "Frade" pass through unchanged).
- `get_production_top_fields` now `GROUP BY canonical_field_name(p.campo)` and returns the canonical label in the `campo` column. The 10-row top list collapses Búzios variants into one canonical "Búzios" row whose oil/water/hours sum the contributing variants stake-weighted.
- `get_production_field_timeseries` reinterprets `p_campo` as a canonical label and `JOIN`s in the variants from `field_canonical_names`, expanding the WHERE clause to every variant under that canonical (so the timeseries returned for "Búzios" is the stake-weighted sum across Búzios, AnC_Búzios, and Búzios_ECO).
- `get_field_stakes_overview` (admin-only) gains a new `canonical text` column so the Field Stakes editor can show "Búzios" as a parent row containing the three variant children.

**Frontend (this worktree — Frente B):**
- Route rename `/production` → `/well-by-well` (with 301 redirect in `next.config.ts`).
- `useModuleVisibilityGuard("well-by-well")` (was `"production"`).
- Hook's `drillCampo` state and `openFieldDrill(campo)` now carry/accept a canonical label. The value handed in from the Top Fields chart click / mobile card tap is whatever the server returned, so no client-side mapping is required — drilling "Búzios" sums all three variants.
- RPC wrapper signatures are unchanged; only comments were updated to reflect the canonical-aware server behaviour.

**Admin UI (Frente C, owned by `worker_dash-admin`):**
- Field Stakes section in `/admin-panel` will group rows by their canonical roll-up. Variants remain individually editable (each Búzios variant keeps its own stake row), but the parent canonical row shows the combined coverage.

**Docs / branding (Frente D, owned by `worker_documentador`):**
- README + docs/master.md updated to reflect the rename.

**Why server-side and not client-side?** Putting the canonical mapping in the database means BSW, depletion, and any future analytical RPC can reuse the same `canonical_field_name()` helper without duplicating the rules in JS. It also keeps the Top Fields ordering correct in pagination edge cases (top 10 by canonical, not top 10 variants).

**Backwards compatibility:** the `field_canonical_names` table starts seeded only with the most commonly-confused fields. Anything not in the table passes through unchanged via the helper's default behaviour, so existing dashboards see no regression.

## Color palette

Chart colors across all `/well-by-well` panels are sourced from the monthly Itaú BBA "Well-by-Well" PDF report — Eduardo's reference document is the single source of truth for the dashboard's visual identity. The canonical tokens live in [`src/data/wellByWellColors.ts`](../../src/data/wellByWellColors.ts) (Round 15, 2026-05-27); the legacy hook exports (`AMBIENTE_COLOR`, `BRAND_ORANGE`, `TOP_FIELDS_OIL_COLOR`, `TOP_FIELDS_WATER_COLOR` in `useProductionData.ts`) are thin re-aliases that exist for back-compat with import sites.

| Token | Hex | Applied to |
|---|---|---|
| `WBW_COLORS.ambiente.PreSal` | `#1f2937` (dark navy) | First (bottom) segment of Chart 1's stacked bars (Aggregate by ambiente) |
| `WBW_COLORS.ambiente.PosSal` | `#ff5000` (brand orange) | Second segment of Chart 1's stacked bars |
| `WBW_COLORS.ambiente.Terra` | `#9bd9a9` (mint green / Onshore) | Third (top) segment of Chart 1's stacked bars |
| `WBW_COLORS.oil` | `#1f2937` (dark navy) | Chart 2 (Top Fields) oil bars + drill modal oil bars (single-color, non-stacked context) |
| `WBW_COLORS.water` | `#ff5000` (brand orange) | Chart 2 (Top Fields) water bars + drill modal water bars (PDF p4 Petrobras Búzios sample) |
| `WBW_COLORS.hoursRate` | `#73C6A1` (mint green — PALETTE pos 7) | Drill modal operating-hours line on dual-axis (PDF p11+ field detail charts). Changed from `#ff5000` to avoid blending with the Water bars which also use brand orange. |
| `WBW_COLORS.currentMonth` | `#ff5000` (brand orange) | Reserved for future current-vs-prior comparison bars (PDF p3) |
| `WBW_COLORS.priorMonth` | `#1f2937` (dark navy) | Reserved for future current-vs-prior comparison bars (PDF p3) |

Cross-reference samples in the PDF:
- p2 "Brazil – Oil Production (kbpd)" stacked bar (navy / orange / green ascending)
- p4 "Petrobras – Largest Oil Producing Fields" (dark navy oil + orange water)
- p11+ field detail charts (dark navy bar + mint-green hours-rate line)

The `HeaderTable` component (PDF page-2 replica) uses neutral table styling and is NOT ambiente-coded — its colors live in the component file and are unrelated to this palette. Other dashboards have their own palettes; these tokens are scoped to `/well-by-well` only.

## KPI cards (drill modal only) — superseded by Round 16 KPI table

The top KPI strip on the dashboard page was removed in Round 6 (broken Δ MoM/YoY against the partial reference month).

**Round 16 (2026-05-28) update:** the 4-card KPI strip inside the field- and installation-drill modals was likewise retired and replaced by a 5-column **KPI summary table** rendered BELOW the chart. The `KpiCard` (desktop) and `MobileKpi` (mobile) components are removed; the new shared component pair is `DrillKpiTable` (desktop) + `MobileDrillKpiTable` (mobile), both consuming the shared `DrillKpiTableData` shape exported from `useProductionData.ts`. See the Field drill-down → Production tab section for the full table column spec, fetch semantics, and the bug fix that motivated the change.

## Dual-view

- **Desktop (≥769px, Round 10)** — Canonical left sidebar (`#sidebar`, ~280px, sticky, liquid-glass bg) containing Period · Reference month · Environment. Main content (right): `DashboardHeader`, then View pills row, then HeaderTable full-width, then Chart 1 (oil production) full-width, then Charts 2 & 3 (Top Fields + Installations) side-by-side. Field/installation drill-downs open as centered Bootstrap-styled modals. The old bottom YoY table was removed in Round 8; the in-content 2-column filter+HeaderTable split was removed in Round 10 in favor of the project's canonical sidebar pattern.
- **Mobile (≤768px, mobile reform 2026-05-27 + follow-up 2026-05-28)** — Sticky filter bar (scope pills + period pills) under the global `MobileTopBar`. Content scrolls as a vertical card stack: (1) Hero stacked bar by environment (Pre-Salt/Post-Salt/Onshore); (2) Top 10 fields ranked list (tap to open field drill-down BottomSheet); (3) Production by FPSO/UEP card list — **company views: all platforms, Brazil view: top 30 by oil production desc** (horizontal bar chart removed 2026-05-28 — redundant with sorted list); (4) MoM/YoY/YTD summary table with sticky first column. Period pills restricted to 12M/24M/YTD (the 36M and All presets were dropped mobile-only — visually cluttered on small screens). No `ExportFAB`, no `MobileTabBar` — these legacy components were retired in the mobile reform. Drill-downs open as 90vh `BottomSheet`.

Both Views consume `useProductionData`. Neither calls Supabase directly. The hook owns: view state machine, period/refMonth state, RPC orchestration (7 separate debounced/intent-driven fetches that branch on view), drill KPI math, and export plumbing. (Round 14 removed the `ambientes` state and filter — `get_production_brazil_aggregate` and `get_production_company_aggregate` are now always called with `p_ambientes = null`.)

## Export tier

**Tier 1** (direct download, no precount modal — dataset is small by construction: monthly × ≤120 months × ≤3 ambientes ≈ <500 rows for Brazil/Company, ≤10 rows for Top Fields, ≤50 rows for Installations).

In **Brasil view**, the Company sheet/CSV is omitted (it would be empty under the no-stake-weighting model).

| Format | What | Filename |
|---|---|---|
| Excel `.xlsx` | Brazil aggregate · (Company aggregate, company view only) · Top Fields · Installations | `Production {View} DD-MM-YY.xlsx` |
| CSV `.zip` | Same datasets, one CSV each, bundled | `Production {View} DD-MM-YY.zip` |

Both exports honor the active filter scope (period + reference month). They do NOT re-fetch unfiltered data. The ambiente axis is always all-three (Round 14 removed the filter); the per-environment split is preserved in the exported rows.

ExcelJS and JSZip are dynamically imported on demand to avoid bloating the initial bundle.

## Visibility

| Tier | Visible? |
|---|---|
| Anon (public) | `is_visible_for_public = false` — hidden from public surface area |
| Client (logged-in) | `is_visible_for_clients = true` — visible after login |
| Admin | Always visible |
| Home gallery | `is_visible_on_home = true` — module card appears on `/home` |

Seed row inserted by Frente A in the original Round 1 migration:
```sql
INSERT INTO module_visibility (module_slug, is_visible_for_clients, is_visible_on_home, is_visible_for_public)
VALUES ('production', true, true, false)
ON CONFLICT (module_slug) DO NOTHING;
```

Round 4 (2026-05-28) migrated the slug to `'well-by-well'`:
```sql
-- supabase/migrations/20260528300000_well_by_well_round4.sql
UPDATE module_visibility SET module_slug = 'well-by-well' WHERE module_slug = 'production';
```

Visibility is enforced by `useModuleVisibilityGuard("well-by-well")` inside the hook — Anon visitors are redirected to `/home`.

## Known gaps

- **Incomplete fields are silently filtered.** Campos in `field_stakes_lacunas` (PSA unitization, exploration, ceased — ~240 rows at Fase 2 start) do NOT contribute to the Company aggregate. The server filters them out via `HAVING SUM(stake_pct) = 100`. Eduardo backfills them via `/admin-panel` → "Field Stakes" CRUD; once complete, they appear automatically.
- **Stale-MV bug resolved (2026-06-01).** Until `20260601100000_field_stakes_auto_refresh.sql`, admin edits to `field_stakes` did NOT trigger `refresh_mv_production()` — the dashboard kept showing the previous snapshot until the next CDP ETL run. Now a STATEMENT-level `AFTER` trigger on `field_stakes` calls the refresh function automatically (synchronous; few-seconds latency acceptable for the rare admin edit cadence).
- **No per-well drill-down here.** Use `/anp-cdp` for that.
- **No daily granularity.** Use `/anp-cdp-diaria` (sourced from ANP Power BI feed) for daily readings.
- **Operator override is not modelled.** ANP's `operador` column is ignored — the company list comes 100% from `field_stakes`. This is deliberate: working interest > operatorship for production attribution.

## Future enhancements

- **Reserves certificate comparison** — overlay PRIO's reserves report against actual production curves.
- **Per-FPSO well drill-down** — drill from an installation timeseries into its constituent wells (would link into `/anp-cdp-diaria-instalacao` for daily resolution). The current Round 3 drill-down is at the installation-aggregate level.
- **Multi-company comparison** — overlay two companies' aggregate curves (would need a secondary empresa selector).

## Owner

- **Worker agent:** `worker_dash-well-by-well` (renamed from `worker_dash-production` in Round 4, 2026-05-28 — file: `.claude/agents/worker_dash-well-by-well.md`, gitignored but persists locally; activated next session per Pegadinha #9).
- **Fase 2 PRD:** `C:/Users/eduar/.claude/plans/production-fase-2.md`.
- **Cross-dept dependencies:**
  - `worker_supabase` owns the 5 production RPCs (migration `20260528000000_production_rpcs.sql`) and the Round 4 canonical layer (`20260528300000_well_by_well_round4.sql`).
  - `worker_dash-admin` owns the `field_stakes` CRUD UI (Fase 1) that feeds this dashboard.
- **Shared infrastructure owner:** `worker_subgerente-app` created this dashboard in Fase 2 because Pegadinha #9 prevented mid-session invocation of the brand-new `worker_dash-production` agent. Round 4's parallel rollout was orchestrated across four worktrees (supabase / well-by-well / dash-admin / documentador), with this worktree responsible for the frontend rename.
