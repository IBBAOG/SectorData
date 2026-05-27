# /production — Executive Production Summary

> Monthly oil & gas production with company-level attribution via curated field stakes. The executive companion to `/anp-cdp` (granular well-by-well explorer).

## Purpose

Replicate the monthly Well-by-Well report read by Eduardo: Brazil totals split by environment (Pre-Salt / Post-Salt / Onshore), one company's stake-weighted slice of those totals, the company's top producing fields, FPSO/UEP-level breakdown, and YoY / MoM / YTD deltas — all from a single dashboard, single auth tier, single data layer.

`/production` is the **executive summary** (one company at a time, monthly cadence, KPI-first). `/anp-cdp` remains the **granular explorer** (per-well, no company aggregation). The two coexist; they answer different questions.

## Data sources

| Source | Role |
|---|---|
| `anp_cdp_producao` (~1.8M rows, ANP CDP, monthly per-well) | Production facts |
| `field_stakes` (Fase 1 — admin-curated working interests per field) | Company attribution map |
| `field_stakes_lacunas` (admin view) | Fields whose stakes do NOT yet sum to 100 — silently excluded from `/production` until Eduardo completes them via `/admin-panel` |

All math is done **server-side** in 5 SECURITY DEFINER RPCs (migration `supabase/migrations/20260528000000_production_rpcs.sql`, owned by `worker_supabase`). The browser never re-derives company production — it only renders.

### RPCs consumed

| RPC | Signature | Purpose |
|---|---|---|
| `get_production_brazil_aggregate` | `(date_start date, date_end date, ambientes text[] DEFAULT NULL)` | Brazil-wide monthly totals by environment (NOT stake-weighted). |
| `get_production_company_aggregate` | `(empresa text, date_start date, date_end date, ambientes text[] DEFAULT NULL)` | Stake-weighted monthly totals for one company by environment. Filters to campos whose stakes SUM to 100. |
| `get_production_top_fields` | `(empresa text, date date, top_n int DEFAULT 10)` | Top-N producing fields for one company in one calendar month. |
| `get_production_by_installation` | `(empresa text, date date)` | Installation-level (FPSO/UEP/land plant) production routed through the installation, stake-weighted, one month. |
| `get_production_yoy_table` | `(empresa text, date date)` | YoY/MoM/YTD breakdown at the reference month — 1 TOTAL row + 1 row per environment. |
| `get_production_field_timeseries` | `(p_campo text, p_empresa text, p_date_start date, p_date_end date)` | Stake-weighted monthly oil/gas/water/uptime timeseries for one field × one company. Powers the Field drill-down (Round 2). |
| `get_production_installation_timeseries` | `(p_instalacao text, p_empresa text, p_date_start date, p_date_end date)` | Stake-weighted monthly oil/gas/water/uptime timeseries for one installation (FPSO/UEP/land plant) × one company. Powers the Installation drill-down (Round 3). Returns the SAME row shape as `get_production_field_timeseries`. |

All return `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp` (Pegadinha #18) and are granted to `anon, authenticated`. Frontend wrappers live in `src/lib/rpc.ts` under the "MODULE: Production" section.

Source-of-truth migrations:
- `supabase/migrations/20260528000000_production_rpcs.sql` (Round 1, 5 RPCs).
- `supabase/migrations/20260528100000_production_round2.sql` (Round 2: YoY TOTAL fix + `get_production_field_timeseries`).
- `supabase/migrations/20260528200000_production_installation_timeseries.sql` (Round 3: `get_production_installation_timeseries`).

### Companies (Empresa dropdown)

Populated from `get_field_stakes_empresas()` (Fase 1 RPC). The list is sorted by `n_campos DESC` so the largest portfolios surface first (Petrobras, PRIO, PetroReconcavo, Brava Energia, Shell, Equinor, ...). Default selection: **Petrobras**.

The dropdown is **never** hardcoded — when Eduardo seeds a new company in `field_stakes` via `/admin-panel`, it appears here on next load.

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

## KPI cards (desktop top strip, mobile per-tab)

1. **Brazil oil** — total oil at reference month, kbpd (neutral)
2. **{Company} oil** — stake-weighted total, kbpd (orange accent), Δ MoM badge
3. **{Company} gas** — stake-weighted gas, Mm³/d (orange accent)
4. **{Company} YTD avg** — YTD average kbpd (orange accent), Δ YoY badge

Δ percentages come from the `yoyTable` TOTAL row — no client-side re-derivation.

## Dual-view

- **Desktop (≥769px)** — 2×2 grid: KPI strip → P1 P2 → P3 P4 → YoY table. Topbar filters above the cards. Field drill-down opens as a centered Bootstrap-styled modal.
- **Mobile (≤768px)** — `MobileTabBar` with 4 tabs (Brazil · {Company} · Fields · FPSOs). One chart full-width per tab + relevant KPI tiles. The Fields tab combines a compact comparison chart with a list of tappable `MobileDataCard`s. `FilterDrawer` (BottomSheet) for all filters, opened from the topbar. `ExportFAB` bottom-right with a tiny action sheet (Excel / CSV). Field drill-down opens as a 90vh `BottomSheet`.
- YoY breakdown lives below the active tab as an expandable section on mobile; it's always-visible on desktop.

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

Seed row inserted by Frente A in the same migration as the RPCs:
```sql
INSERT INTO module_visibility (module_slug, is_visible_for_clients, is_visible_on_home, is_visible_for_public)
VALUES ('production', true, true, false)
ON CONFLICT (module_slug) DO NOTHING;
```

Visibility is enforced by `useModuleVisibilityGuard("production")` inside the hook — Anon visitors are redirected to `/home`.

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

- **Worker agent:** `worker_dash-production` (file: `.claude/agents/worker_dash-production.md`, gitignored but persists locally; activated next session per Pegadinha #9).
- **Fase 2 PRD:** `C:/Users/eduar/.claude/plans/production-fase-2.md`.
- **Cross-dept dependencies:**
  - `worker_supabase` owns the 5 RPCs (migration `20260528000000_production_rpcs.sql`).
  - `worker_dash-admin` owns the `field_stakes` CRUD UI (Fase 1) that feeds this dashboard.
- **Shared infrastructure owner:** `worker_subgerente-app` created this dashboard in Fase 2 because Pegadinha #9 prevented mid-session invocation of the brand-new `worker_dash-production` agent.
