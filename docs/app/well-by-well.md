# /well-by-well — Executive Production Summary

> Monthly oil & gas production with company-level attribution via curated field stakes. The executive companion to `/anp-cdp` (granular well-by-well explorer).
>
> **Route rename (Round 4, 2026-05-28):** previously `/production`. The old URL is preserved via a permanent 301 redirect in `next.config.ts`. Backing RPC names (`get_production_*`) and DB-level identifiers were kept as-is — the rename is URL- and UI-only.

## Purpose

Replicate the monthly Well-by-Well report read by Eduardo: Brazil totals split by environment (Pre-Salt / Post-Salt / Onshore), one company's stake-weighted slice of those totals, the company's top producing fields, FPSO/UEP-level breakdown, and YoY / MoM / YTD deltas — all from a single dashboard, single auth tier, single data layer.

`/well-by-well` is the **executive summary** (one company at a time, monthly cadence, KPI-first). `/anp-cdp` remains the **granular explorer** (per-well, no company aggregation). The two coexist; they answer different questions.

## Data sources

| Source | Role |
|---|---|
| `anp_cdp_producao` (~1.8M rows, ANP CDP, monthly per-well) | Production facts |
| `field_stakes` (Fase 1 — admin-curated working interests per field) | Company attribution map |
| `field_stakes_lacunas` (admin view) | Fields whose stakes do NOT yet sum to 100 — silently excluded from `/well-by-well` until Eduardo completes them via `/admin-panel` |
| `field_canonical_names` (Round 4, 2026-05-28) | Variant → canonical map for fields with operational sub-units (e.g. Búzios + AnC_Búzios + Búzios_ECO → "Búzios"). Owned by `worker_supabase`. Drives canonical grouping in `get_production_top_fields` + canonical expansion in `get_production_field_timeseries`. |

All math is done **server-side** in 5 SECURITY DEFINER RPCs (migration `supabase/migrations/20260528000000_production_rpcs.sql`, owned by `worker_supabase`). The browser never re-derives company production — it only renders.

### RPCs consumed

| RPC | Signature | Purpose |
|---|---|---|
| `get_production_brazil_aggregate` | `(date_start date, date_end date, ambientes text[] DEFAULT NULL)` | Brazil-wide monthly totals by environment (NOT stake-weighted). |
| `get_production_company_aggregate` | `(empresa text, date_start date, date_end date, ambientes text[] DEFAULT NULL)` | Stake-weighted monthly totals for one company by environment. Filters to campos whose stakes SUM to 100. |
| `get_production_top_fields` | `(empresa text, date date, top_n int DEFAULT 10)` | Top-N producing fields for one company in one calendar month. **Round 4:** groups by `canonical_field_name(p.campo)` server-side; returned `campo` is the canonical label. |
| `get_production_by_installation` | `(empresa text, date date)` | Installation-level (FPSO/UEP/land plant) production routed through the installation, stake-weighted, one month. |
| `get_production_yoy_table` | `(empresa text, date date)` | YoY/MoM/YTD breakdown at the reference month — 1 TOTAL row + 1 row per environment. |
| `get_production_field_timeseries` | `(p_campo text, p_empresa text, p_date_start date, p_date_end date)` | Stake-weighted monthly oil/gas/water/uptime timeseries for one field × one company. Powers the Field drill-down (Round 2). **Round 4:** `p_campo` is interpreted as a canonical label; the server expands the WHERE clause to all variants under that canonical (so drilling "Búzios" sums Búzios + AnC_Búzios + Búzios_ECO stake-weighted). |
| `get_field_stakes_overview` | (admin-only) | **Round 4:** now returns an extra `canonical text` column alongside `campo` so the admin variant editor can group variants by their canonical roll-up. Owned by `worker_supabase`, consumed by `worker_dash-admin` (Frente C). |
| `get_production_installation_timeseries` | `(p_instalacao text, p_empresa text, p_date_start date, p_date_end date)` | Stake-weighted monthly oil/gas/water/uptime timeseries for one installation (FPSO/UEP/land plant) × one company. Powers the Installation drill-down (Round 3). Returns the SAME row shape as `get_production_field_timeseries`. |
| `get_well_by_well_header` | `(p_empresa text, p_year int, p_month int)` | PDF-style page-2 header table (Round 8, 2026-05-27). Returns one row per renderable line of the report: Brazil section (oil kbpd + gas kboed + main fields kbpd, split by Pre-Salt / Post-Salt / Onshore) and the {empresa} section (stake-weighted oil kbpd + main fields). Each row carries `(display_order, section, category, subcategory, is_total, current_val, prev_month_val, mom_pct, prev_year_val, yoy_pct, ytd_avg)`. The UI just renders; aggregation and MoM/YoY/YTD math are entirely server-side. Owned by `worker_supabase`. |

All return `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp` (Pegadinha #18) and are granted to `anon, authenticated`. Frontend wrappers live in `src/lib/rpc.ts` under the "MODULE: Well by Well" section.

Source-of-truth migrations:
- `supabase/migrations/20260528000000_production_rpcs.sql` (Round 1, 5 RPCs).
- `supabase/migrations/20260528100000_production_round2.sql` (Round 2: YoY TOTAL fix + `get_production_field_timeseries`).
- `supabase/migrations/20260528200000_production_installation_timeseries.sql` (Round 3: `get_production_installation_timeseries`).
- `supabase/migrations/20260528300000_well_by_well_round4.sql` (Round 4: `module_visibility` slug rename `production → well-by-well`, new `field_canonical_names` table, canonical-aware bodies for `get_production_top_fields` + `get_production_field_timeseries`, new `canonical` column in `get_field_stakes_overview`).
- `supabase/migrations/20260528500000_well_by_well_header.sql` (Round 8: `get_well_by_well_header` RPC — PDF-style page-2 header table).

### Companies (Empresa dropdown)

Populated from `get_field_stakes_empresas()` (Fase 1 RPC) and then **filtered client-side** against a 4-name whitelist (`src/data/wellByWellEmpresas.ts`): **Petrobras → PRIO → PetroReconcavo → Brava Energia**. The dropdown renders exactly those four options in that fixed order (most-coverage-first IR view, NOT `n_campos DESC`). Default selection: **Petrobras**.

The whitelist exists because `get_field_stakes_empresas()` returns 63+ companies (including many small onshore operators like Origem Energia, Petrosynergy, Eneva, Alvopetro) which are useful for stake input in the admin panel but visually noisy in the executive dashboard. Eduardo's covered universe is the 4 listed names.

If a user lands on `/well-by-well` with stale state (query param, restored session) pointing to an empresa outside the whitelist, the hook snaps `empresa` back to `Petrobras` on bootstrap.

The **admin panel's Field Stakes autocomplete is NOT affected** — it continues to consume the full `rpcGetFieldStakesEmpresas` list so Eduardo can edit stakes for any of the 63+ companies. Only this dashboard's company selector is narrowed.

To add a company: edit `src/data/wellByWellEmpresas.ts` (names must match the canonical normalized forms used in `field_stakes.empresa` — e.g. "Brava Energia", not "Brava"; "PetroReconcavo", no accent, no space).

## Filter model

| Filter | Type | Default |
|---|---|---|
| Company | single-select `<select>` | `Petrobras` |
| Period (`dateRange`) | month-granularity slider (rc-slider via `PeriodSlider dates={...}`) | Last 13 months ending at the most-recent month present in `anp_cdp_producao` |
| Environment (`ambientes`) | multi-select with colour swatch | `[PreSal, PosSal, Terra]` |
| Reference month | single-select `<select>` (restricted to current period window) | Most recent month in window (snaps when slider changes) |

All filters live in `useProductionData` — single source of truth. Slider changes debounce all RPCs at 300ms via `useDebouncedFetch`.

## Panels

| # | Panel | Source RPC | Notes |
|---|---|---|---|
| P1 | Brazil — Oil Production (kbpd) | `get_production_brazil_aggregate` | Stacked bars, x=month, y=oil kbpd, stack=ambiente. Greyscale palette (PreSal darkest). |
| P2 | {Company} — Oil Production (kbpd, stake-weighted) | `get_production_company_aggregate` | Same shape as P1; PreSal accented in brand orange. |
| P3 | Top {Company} Fields — {Reference month} (kbpd) | `get_production_top_fields` | Horizontal bar, top 10, oil+water stacked (oil dark, water light blue). |
| P4 | Installations (FPSO/UEP) — {Reference month} | `get_production_by_installation` | Scrollable table: Installation · Oil kbpd · Gas Mm³/d · Hours rate %. Top 12. |
| YoY | {Company} — YoY / MoM / YTD ({Reference month}) | `get_production_yoy_table` | TOTAL row bolded + per-ambiente rows. Δ MoM and Δ YoY coloured green/red. |

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

- **Desktop (≥1100px)**: 2-column grid (`grid-template-columns: minmax(260px, 35%) 1fr`) — filters stacked left (Company → Period → Reference month → Environment), HeaderTable right. Collapses to 1-column below 1100px so the table never gets squished.
- **Mobile (≤768px)**: table sits at the top above the tab bar, wrapped in a horizontally scrollable container (`overflow-x: auto`; the table itself sets `min-width: 480px`). A "Swipe left to see more columns ›" caption confirms the affordance. Filters stay in the `FilterDrawer` (BottomSheet) opened from the topbar FAB — nothing changes there.

### Why this section displaced the old YoY table (desktop only)

The original `/well-by-well` desktop layout had a YoY/MoM/YTD breakdown table at the bottom (TOTAL + per-ambiente rows for the selected company, sourced from `get_production_yoy_table`). The new HeaderTable's company section is a strict superset of that data (same TOTAL + per-ambiente rows, same MoM/YoY/YTD semantics, plus Brazil-wide context, gas, and main fields). Keeping both would have duplicated the same numbers in two places. **Removed the bottom YoY table from desktop; mobile keeps its YoY collapsible drawer** because the HeaderTable on mobile lives behind horizontal scroll and the drawer surfaces the company numbers without requiring a swipe.

The hook still fetches `yoyTable` because the mobile View consumes it. If mobile ever drops the YoY drawer, the `get_production_yoy_table` RPC and its hook state can be retired in a follow-up.

## Field drill-down (Round 2, 2026-05-27)

A secondary view that opens on demand when the user wants to dig into one of the Top Fields. The same hook owns its state; both Views render the same content through different surfaces.

**Trigger:**
- **Desktop:** click any bar in the P3 Top Fields chart, or click the helper caption beneath it.
- **Mobile:** tap any field card in the Fields tab (the chart stays for at-a-glance comparison; cards are added below for drill-in).

**Data:** `get_production_field_timeseries(p_campo, p_empresa, p_date_start, p_date_end)` — returns one row per (year, month) with `oil_bbl_dia`, `gas_mm3_dia`, `water_bbl_dia`, `hours_rate`, stake-weighted for the selected company. The fetch uses the dashboard's current `dateRange` + `empresa` (no separate filter).

**Surfaces:**
- **Desktop:** Bootstrap-styled modal (`FieldDrillModal` inline in `desktop/View.tsx`) — 820px wide, brand-orange accent bar, Esc / scrim / × all close.
- **Mobile:** `BottomSheet` (`height="90vh"`) — same content reflowed to a single column with a 2×2 KPI grid.

**KPIs (derived client-side from the timeseries, not from a separate RPC):**
1. **Current oil** — last month in the series, kbpd
2. **Δ MoM** — `(current - prev) / prev` (null if the series has 1 row or `prev == 0`)
3. **Δ YoY** — `(current - same_month_last_year) / same_month_last_year` (null if the previous year's row isn't in the visible window or is zero)
4. **YTD avg** — average of months in the same calendar year as the most-recent month (so for "Apr 2026" it averages Jan..Apr 2026)

**Chart:** 13-month vertical stacked bars (oil dark `#1a1a1a` + water light blue `#7BB6DD`) on the left y-axis in kbpd, **plus** a hours-rate line (`BRAND_ORANGE`, `#ff5000`) on the right y-axis in `%` (0..105). Identical visual logic on both Views, layered via Plotly's `yaxis: "y2"` overlay.

**Empty state:** fields whose stakes don't sum to 100 (i.e. listed in `field_stakes_lacunas`) return zero rows server-side. The modal/sheet still opens; KPIs show `—` and a centered "No data for this field in the current period." caption replaces the chart.

**Error handling:** RPC failures bubble up as `drillError` (string) and render as a yellow warning banner inside the modal/sheet body. The drill stays open so the user can dismiss; closing clears the error.

## FPSO/Installation drill-down (Round 3, 2026-05-27)

Mirrors the Field drill-down pattern at the installation (FPSO/UEP/land plant) level — same hook owns the state, same dual-surface architecture, same client-side KPI math.

**Trigger:**
- **Desktop:** click any row in the P4 Installations table (cursor pointer + warm-orange hover bg `#fff5ef`). The helper caption below the table confirms the affordance.
- **Mobile:** tap any FPSO `MobileDataCard` in the FPSOs tab (each card now shows a "Tap to drill ›" hint, matching the Fields tab pattern).

**Data:** `get_production_installation_timeseries(p_instalacao, p_empresa, p_date_start, p_date_end)` — returns one row per (year, month) with `oil_bbl_dia`, `gas_mm3_dia`, `water_bbl_dia`, `hours_rate`, stake-weighted for the selected company. **Row shape is identical to `get_production_field_timeseries`** — the TypeScript layer expresses this with `type ProductionInstallationTimeseriesRow = ProductionFieldTimeseriesRow` in `src/types/production.ts`. The fetch uses the dashboard's current `dateRange` + `empresa` (no separate filter).

**Surfaces:**
- **Desktop:** Bootstrap-styled modal (`InstallationDrillModal` inline in `desktop/View.tsx`) — same 820px wide chrome, brand-orange accent bar, Esc / scrim / × all close. The chart builder (`buildFieldDrillChart`) is reused since the row shape is identical.
- **Mobile:** `BottomSheet` (`height="90vh"`) — same 2×2 KPI grid + `MobileChart` wrapper as the field drill.

**KPIs (derived client-side from the timeseries, not from a separate RPC):**
1. **Current oil** — last month in the series, kbpd
2. **Δ MoM** — `(current - prev) / prev` (null if the series has 1 row or `prev == 0`)
3. **Δ YoY** — `(current - same_month_last_year) / same_month_last_year` (null if the previous year's row isn't in the visible window or is zero)
4. **YTD avg** — average of months in the same calendar year as the most-recent month

**Chart:** identical to the field drill — 13-month vertical stacked bars (oil `#1a1a1a` + water `#7BB6DD`) on the left y-axis (kbpd), plus a hours-rate line (`BRAND_ORANGE`) on the right y-axis (%, 0..105).

**Empty state:** installations whose constituent campos are all in `field_stakes_lacunas` return zero rows server-side. The modal/sheet still opens; KPIs show `—` and a centered "No data for this installation in the current period." caption replaces the chart.

**Error handling:** RPC failures bubble up as `drillInstalacaoError` and render the same yellow warning banner.

**Mutual exclusivity:** the field drill and installation drill are mutually exclusive at the hook level — opening one auto-closes the other (clearing its timeseries + error). Rationale: simpler UX with only one modal/BottomSheet on screen at a time; avoids stacked overlays on mobile in particular.

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

## KPI cards (desktop top strip, mobile per-tab)

1. **Brazil oil** — total oil at reference month, kbpd (neutral)
2. **{Company} oil** — stake-weighted total, kbpd (orange accent), Δ MoM badge
3. **{Company} gas** — stake-weighted gas, Mm³/d (orange accent)
4. **{Company} YTD avg** — YTD average kbpd (orange accent), Δ YoY badge

Δ percentages come from the `yoyTable` TOTAL row — no client-side re-derivation.

## Dual-view

- **Desktop (≥769px)** — Top split: filters (~35%) + HeaderTable (~65%). Below: 2×2 grid (P1 P2 → P3 P4). Field drill-down opens as a centered Bootstrap-styled modal. The old bottom YoY table was removed in Round 8 since the HeaderTable absorbs its data.
- **Mobile (≤768px)** — HeaderTable at the top (horizontally scrollable). Then `MobileTabBar` with 4 tabs (Brazil · {Company} · Fields · FPSOs); one chart full-width per tab. The Fields tab combines a compact comparison chart with a list of tappable `MobileDataCard`s. `FilterDrawer` (BottomSheet) for all filters, opened from the topbar. `ExportFAB` bottom-right with a tiny action sheet (Excel / CSV). Field drill-down opens as a 90vh `BottomSheet`. YoY breakdown lives below the active tab as a collapsible drawer (kept as a fallback surface for users who don't horizontally scroll the HeaderTable).

Both Views consume `useProductionData`. Neither calls Supabase directly. The hook owns: filter state, RPC orchestration (6 separate debounced/intent-driven fetches), KPI math (top-level + drill-down), and export plumbing.

## Export tier

**Tier 1** (direct download, no precount modal — dataset is small by construction: monthly × ≤120 months × ≤3 ambientes ≈ <500 rows for Brazil/Company, ≤10 rows for Top Fields, ≤50 rows for Installations).

| Format | What | Filename |
|---|---|---|
| Excel `.xlsx` | 4 sheets: Brazil aggregate · {Company} aggregate · Top Fields · Installations | `Production {Company} DD-MM-YY.xlsx` |
| CSV `.zip` | Same 4 datasets, one CSV each, bundled | `Production {Company} DD-MM-YY.zip` |

Both exports honor the active filter scope (period + ambientes + reference month). They do NOT re-fetch unfiltered data.

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
- **No per-well drill-down here.** Use `/anp-cdp` for that.
- **No daily granularity.** Use `/anp-cdp-diaria` (sourced from ANP Power BI feed) for daily readings.
- **Operator override is not modelled.** ANP's `operador` column is ignored — the company list comes 100% from `field_stakes`. This is deliberate: working interest > operatorship for production attribution.

## Future enhancements

- **BSW overlay** — surface water-cut trends from `/anp-cdp-bsw` next to the Top Fields chart.
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
