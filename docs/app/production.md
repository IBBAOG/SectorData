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

All return `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp` (Pegadinha #18) and are granted to `anon, authenticated`. Frontend wrappers live in `src/lib/rpc.ts` under the "MODULE: Production" section.

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

## KPI cards (desktop top strip, mobile per-tab)

1. **Brazil oil** — total oil at reference month, kbpd (neutral)
2. **{Company} oil** — stake-weighted total, kbpd (orange accent), Δ MoM badge
3. **{Company} gas** — stake-weighted gas, Mm³/d (orange accent)
4. **{Company} YTD avg** — YTD average kbpd (orange accent), Δ YoY badge

Δ percentages come from the `yoyTable` TOTAL row — no client-side re-derivation.

## Dual-view

- **Desktop (≥769px)** — 2×2 grid: KPI strip → P1 P2 → P3 P4 → YoY table. Topbar filters above the cards.
- **Mobile (≤768px)** — `MobileTabBar` with 4 tabs (Brazil · {Company} · Fields · FPSOs). One chart full-width per tab + relevant KPI tiles. `FilterDrawer` (BottomSheet) for all filters, opened from the topbar. `ExportFAB` bottom-right with a tiny action sheet (Excel / CSV).
- YoY breakdown lives below the active tab as an expandable section on mobile; it's always-visible on desktop.

Both Views consume `useProductionData`. Neither calls Supabase directly. The hook owns: filter state, RPC orchestration (5 separate debounced fetches), KPI math, export plumbing.

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
- **Per-FPSO drill-down** — tap an installation row to see its constituent wells (would link into `/anp-cdp-diaria-instalacao`).
- **Multi-company comparison** — overlay two companies' aggregate curves (would need a secondary empresa selector).

## Owner

- **Worker agent:** `worker_dash-production` (file: `.claude/agents/worker_dash-production.md`, gitignored but persists locally; activated next session per Pegadinha #9).
- **Fase 2 PRD:** `C:/Users/eduar/.claude/plans/production-fase-2.md`.
- **Cross-dept dependencies:**
  - `worker_supabase` owns the 5 RPCs (migration `20260528000000_production_rpcs.sql`).
  - `worker_dash-admin` owns the `field_stakes` CRUD UI (Fase 1) that feeds this dashboard.
- **Shared infrastructure owner:** `worker_subgerente-app` created this dashboard in Fase 2 because Pegadinha #9 prevented mid-session invocation of the brand-new `worker_dash-production` agent.
