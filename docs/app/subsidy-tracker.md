# `/subsidy-tracker` — sub-PRD

Owner: `worker_dash-subsidy-tracker`. Reports to `worker_subgerente-app`.

## Overview

Tracks the impact of the federal diesel road subsidy on Brazilian commercialization prices. The dashboard renders a single time-series chart comparing four price reference points (in BRL/Liter) for Diesel:

1. **IPP** — BBA Import Parity (theoretical landed cost). Black trace.
2. **ANP Reference** — daily average of the 5 regional ANP reference prices (NORTE, NORDESTE, CENTRO-OESTE, SUDESTE, SUL) scraped from ANP PDFs. Orange trace.
3. **ANP Commercialization** — `anp_reference - active_subsidy`. Represents the de-facto price after the federal subsidy is applied. Dark red trace.
4. **Petrobras** — Petrobras reference price. Teal trace.

The visual gap between **ANP Reference** and **ANP Commercialization** is exactly the federal subsidy vigente at each date — useful to communicate policy impact at a glance.

## Data sources

| Table | Role | Owner |
|---|---|---|
| `price_bands` (Diesel rows) | Provides `ipp` via `bba_import_parity` and `petrobras` via `petrobras_price`. Read-only. | `worker_dados-locais` (manual Excel upload) |
| `anp_subsidy_diesel_reference` | Daily regional reference prices scraped from ANP PDFs. PK `(data_referencia, regiao)`. | `worker_etl-pipelines` (`subsidy_diesel_sync.py`) |
| `anp_subsidy_history` | Federal subsidy timeline. PK `vigente_desde`. Editable via admin-panel reference-tables. | `worker_dash-admin` (UI) / `worker_supabase` (schema) |

## RPC contract (locked)

```sql
public.get_subsidy_tracker_diesel() RETURNS TABLE (
  date                  date,
  ipp                   numeric,
  anp_reference         numeric,
  anp_commercialization numeric,
  petrobras             numeric,
  regions               jsonb  -- { NORTE: x, NORDESTE: y, "CENTRO-OESTE": z, SUDESTE: w, SUL: k }
)
```

Behavior:

- FULL OUTER JOIN between `price_bands` (Diesel) and the daily regional average from `anp_subsidy_diesel_reference`, so a date with only one side present still renders (other columns are NULL).
- `anp_commercialization = anp_reference - active_subsidy` where `active_subsidy` is looked up via `anp_subsidy_history` (largest `vigente_desde <= date`).
- `regions` is the per-region breakdown for the day, or NULL when no PDF was extracted yet.
- Rows ordered ASC by `date`.

TypeScript mirror — `src/lib/rpc.ts`:

```ts
export type SubsidyTrackerRow = {
  date: string;
  ipp: number | null;
  anp_reference: number | null;
  anp_commercialization: number | null;
  petrobras: number | null;
  regions: Record<string, number> | null;
};

export async function rpcGetSubsidyTrackerDiesel(
  supabase: SupabaseClient,
): Promise<SubsidyTrackerRow[]>;
```

## Subsidy timeline (seed data in `anp_subsidy_history`)

| `vigente_desde` | Subsidy (BRL/L) | Notes |
|---|---|---|
| 2026-03-13 | 0.32 | Initial subsidy |
| 2026-04-07 | 1.52 | Added R$ 1.20 — visible as a ~1.20 jump in the Reference–Commercialization gap |

Newer rows replace older ones from their `vigente_desde` onward.

## Chart spec

Single Plotly chart, 4 line traces (`scatter` + `mode='lines'` + `connectgaps: true`):

| Trace | Color | Notes |
|---|---|---|
| IPP                   | `#111111` (black)    | — |
| ANP Reference         | `#F59E0B` (orange)   | `customdata` = `regions`; hover lists the 5 regional values when present |
| ANP Commercialization | `#B91C1C` (dark red) | — |
| Petrobras             | `#0F766E` (teal)     | — |

**Hover tooltip for ANP Reference** (when `regions` is non-null):

```
<b>%{x}</b>
ANP Reference: R$ %{y:.2f}/L

NORTE: %{customdata.NORTE:.2f}
NORDESTE: %{customdata.NORDESTE:.2f}
CENTRO-OESTE: %{customdata['CENTRO-OESTE']:.2f}
SUDESTE: %{customdata.SUDESTE:.2f}
SUL: %{customdata.SUL:.2f}
```

When `regions` is null on every visible point, the trace falls back to a single-line hover without the breakdown.

**End-of-line annotations** — replicate the pattern in `price-bands/page.tsx`:

- For each trace, find the **last non-null** point.
- Add a Plotly annotation at that `(x, y)` with `xref='x'`, `yref='y'`, `xanchor='left'`, `xshift: 8`, `text: value.toFixed(2)`, `font.color` matching the trace, `showarrow: false`.
- To avoid label collision when two annotations end at the same date with close `y` values, offset `yshift` by `±10` per trace index. (For the heavier deconfliction algorithm in `price-bands`, we kept the simpler index-based offset because there are only 4 traces.)

**Axes & layout**:

- X axis: dates, `tickformat: "%b-%y"`, tick angle `-90`, x-range extended `+30 days` past the last point to leave room for end-of-line labels.
- Y axis title: `"BRL/Liter"`, `tickformat: ".2f"`.
- Legend: horizontal, below the chart.
- Layout: `COMMON_LAYOUT` + `AXIS_LINE` from `src/lib/plotlyDefaults`.
- Empty state: `emptyPlot(420, "No data available")` when 0 rows after filter.

**Period filter**: `PeriodSlider` (dates mode) — default selection is the **last 90 days** (or full range if shorter).

## NavBar location

- Group: **Fuel Distribution** → **Proprietary data** (alongside Price Bands).
- Slug: `subsidy-tracker`.
- NavBar entry maintained by `worker_dash-admin` (this agent does not edit `NavBar.tsx`).
- Module visibility seeded by the migration that creates `anp_subsidy_*` tables (owned by `worker_supabase`).

## Export — Tier 1

Direct download (no modal — dataset is small, one row per date).

| Action | Helper | Filename | Columns |
|---|---|---|---|
| Excel | `downloadGenericExcel` (`src/lib/exportExcel.ts`) | `subsidy_tracker_diesel <DD-MM-YY>.xlsx` | `Date`, `IPP`, `ANP Reference`, `ANP Commercialization`, `Petrobras` |
| CSV   | `downloadCsv` (`src/lib/exportCsv.ts`)            | `subsidy_tracker_diesel.csv`               | `date, ipp, anp_reference, anp_commercialization, petrobras` |

`regions` is intentionally excluded from the export — it is a UI affordance only.

## Files & ownership

```
src/app/(dashboard)/subsidy-tracker/
├── page.tsx                       ← viewport router (useIsMobile)
├── useSubsidyTrackerData.ts       ← single brain (RPC, filters, chart, exports)
├── desktop/View.tsx               ← desktop UX (single Plotly chart, full annotations)
└── mobile/View.tsx                ← mobile UX (chart + cards + tap-to-show regions)
src/lib/rpc.ts                     ← "MODULE: Subsidy Tracker" section
docs/app/subsidy-tracker.md        ← this PRD
```

Not owned here:

- `NavBar.tsx`, `HomeClient.tsx`, admin-panel reference-tables editor for `anp_subsidy_history` → `worker_dash-admin`.
- Tables/RPCs/RLS for `anp_subsidy_*` → `worker_supabase`.
- `scripts/pipelines/anp/subsidy_diesel_sync.py` and `.github/workflows/etl_anp_subsidy_diesel.yml` → `worker_etl-pipelines`.
- Shared components in `src/components/dashboard/` and `src/components/dashboard/mobile/` → `worker_subgerente-app` / `worker_designer`.

## Dual-view structure

`/subsidy-tracker` ships as a **dual-view module** (Phase 2 / Wave 3). Both Views consume `useSubsidyTrackerData` exclusively — neither calls Supabase directly nor derives chart data on its own.

### Shared hook contract (`useSubsidyTrackerData.ts`)

```ts
{
  rows: SubsidyTrackerRow[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  filters: { sliderRange: [number, number]; traces: TraceVisibility };
  setFilters: (next: Partial<Filters>) => void;
  resetFilters: () => void;
  datas: string[];                      // unique sorted dates >= MIN_DATE
  xMin: string | null;
  xMax: string | null;
  chart: { data: PlotData[]; layout: Partial<Layout> };
  currentValues: SubsidyTrackerCurrent[];     // 1 row per series (latest non-null)
  activeSubsidy: number | null;               // Reference − Commercialization
  exportExcel: () => Promise<void>;
  exportCsv: () => void;
  excelLoading: boolean;
  csvLoading: boolean;
}
```

Exports also include `SERIES`, `REGION_ORDER`, `COLOR_*` constants and `formatRegions` / `fmtDateLabel` helpers, so both Views can decorate cards / legends without duplicating logic.

### Desktop View

Single-section layout (NavBar + DashboardHeader + ExportPanel + Plotly chart). Verbatim port of the original page.tsx — no analyses dropped:

- 4-trace line chart (IPP / ANP Reference / ANP Commercialization / Petrobras).
- ANP Reference hover lists the 5 regional values from `customdata`.
- End-of-line value annotations with min-gap pushdown to avoid label collisions.
- X range extended +30 days past last data point for label clearance.

### Mobile View

Archetype: **chart-heavy single-product** (mockup neighbour: market-share-mobile / price-bands-mobile). Same analyses as desktop, redesigned for touch:

- `MobileTopBar` with filter trigger.
- Subtitle + date-chip strip (30 D / 90 D / 6 M / 1 Y / All).
- `MobileChart` with all 4 traces and a compact 2-column color-key legend.
- "Active subsidy" badge derived from `activeSubsidy` (Reference − Commercialization).
- `MobileDataCard` per trace under "Latest values" with hidden-state indicator.
- Tap-to-show **regional breakdown card** that mirrors the desktop hover tooltip (`[mobile-only]` divergence — touch devices have no hover).
- `FilterDrawer` with period slider + per-trace visibility toggles.
- `ExportFAB` with Excel / CSV mini-menu (Tier 1).

### Sync rule

Per `CLAUDE.md` § Dual-view policy: any new filter, chart, KPI or copy added to one View must land in the other in the **same commit**, OR the commit message must declare `[desktop-only]` / `[mobile-only]` with explicit justification.

Current `[mobile-only]` divergences:

| Concept | Desktop | Mobile | Reason |
|---|---|---|---|
| ANP Reference regional breakdown | Plotly hover tooltip via `customdata` | Tap-to-expand `MobileDataCard` list under the chart | Touch devices have no hover; collapsible card preserves the same data |
| End-of-line value annotations | Stacked at chart's right edge with min-gap pushdown | Dropped; replaced by `MobileDataCard` "Latest values" section below | Annotations overflow narrow viewports |
| Per-trace visibility | Plotly legend click | Toggle switches inside `FilterDrawer` | Mobile legend is non-interactive (`showlegend: false`) |

## Gotchas

- **Subsidy step on 2026-04-07** — the gap between Reference and Commercialization jumps from ~0.32 to ~1.52 on that date. This is correct, not a bug. Verify against `anp_subsidy_history`.
- **IPP column choice** — use `price_bands.bba_import_parity` (raw parity, no subsidy adjustment) for the IPP trace. Do **not** use `bba_import_parity_w_subsidy` here — that column is reserved for the Price Bands dashboard's "w/ subsidy" series.
- **`regions` may be NULL** — dates without a PDF extraction yet. The chart handles this by falling back to a simpler hover string. Don't crash on missing keys.
- **FULL OUTER JOIN** — `price_bands` may have a day that ANP doesn't, and vice versa. The corresponding column is NULL on that date; `connectgaps: true` keeps the line visually continuous.
- **Dataset is small** — Tier 1 export (no modal, no size precount). If this changes (e.g. multi-product extension), revisit and switch to Tier 2 with `useExportSize`.
- **Period default** — last 90 days. If the user expands to the full range, the period slider remembers until Reset is pressed.
