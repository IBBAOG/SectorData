# `/subsidy-tracker` — sub-PRD

Owner: `worker_dash-subsidy-tracker`. Reports to `worker_subgerente-app`.

## Overview

Tracks the impact of the federal diesel road subsidy on Brazilian commercialization prices. The dashboard renders **two** side-by-side (desktop) or stacked (mobile) time-series charts — one per ANP agent type — each comparing four price reference points (in BRL/Liter) for Diesel:

1. **IPP** — BBA Import Parity (theoretical landed cost). Black trace. Same in both charts.
2. **ANP Reference** — daily average of the 5 regional ANP reference prices (NORTE, NORDESTE, CENTRO-OESTE, SUDESTE, SUL) scraped from ANP PDFs. Orange trace.
3. **ANP Commercialization** — `anp_reference - active_subsidy`. Represents the de-facto price after the federal subsidy is applied. Dark red trace.
4. **Petrobras** — Petrobras reference price. Teal trace. Same in both charts.

### Agent types

| Chart | Agent | RPC fields |
|---|---|---|
| Left (Importer Reference Prices) | `importador` — importers & refiners of imported + domestic oil | `anp_reference_importer`, `anp_commercialization_importer`, `regions_importer` |
| Right (Producer Reference Prices) | `produtor` — producers refining their own domestic crude | `anp_reference_producer`, `anp_commercialization_producer`, `regions_producer` |

The visual gap between **ANP Reference** and **ANP Commercialization** is exactly the federal subsidy vigente at each date — useful to communicate policy impact at a glance.

## Data sources

| Table | Role | Owner |
|---|---|---|
| `price_bands` (Diesel rows) | Provides `ipp` via `bba_import_parity` and `petrobras` via `petrobras_price`. Read-only. | `worker_dados-locais` (manual Excel upload) |
| `anp_subsidy_diesel_reference` | Daily regional reference prices scraped from ANP PDFs. PK `(data_referencia, regiao, tipo_agente)`. | `worker_etl-pipelines` (`subsidy_diesel_sync.py`) |
| `anp_subsidy_history` | Federal subsidy timeline. PK `vigente_desde`. Editable via admin-panel reference-tables. | `worker_dash-admin` (UI) / `worker_supabase` (schema) |

## RPC contract (locked)

```sql
public.get_subsidy_tracker_diesel() RETURNS TABLE (
  date                              DATE,
  ipp                               NUMERIC,
  anp_reference_importer            NUMERIC,
  anp_commercialization_importer    NUMERIC,
  anp_reference_producer            NUMERIC,
  anp_commercialization_producer    NUMERIC,
  petrobras                         NUMERIC,
  regions_importer                  JSONB,  -- { NORTE: x, NORDESTE: y, ... } for importer agent
  regions_producer                  JSONB   -- { NORTE: x, NORDESTE: y, ... } for producer agent
)
```

Behavior:

- FULL OUTER JOIN between `price_bands` (Diesel) and the daily regional averages from `anp_subsidy_diesel_reference` (one CTE per `tipo_agente`), plus a union of all dates across all three sources.
- `anp_commercialization_<agent> = anp_reference_<agent> - active_subsidy` where `active_subsidy` is looked up via `anp_subsidy_history` (largest `vigente_desde <= date`).
- `regions_<agent>` is the per-region breakdown for the day, or NULL when no PDF was extracted yet.
- Rows ordered ASC by `date`.
- SECURITY DEFINER, granted to `authenticated` only (proprietary data — NOT anon).

TypeScript mirror — `src/lib/rpc.ts`:

```ts
export type SubsidyTrackerRow = {
  date: string;
  ipp: number | null;
  anp_reference_importer: number | null;
  anp_commercialization_importer: number | null;
  anp_reference_producer: number | null;
  anp_commercialization_producer: number | null;
  petrobras: number | null;
  regions_importer: Record<string, number> | null;
  regions_producer: Record<string, number> | null;
};
```

## Subsidy timeline (seed data in `anp_subsidy_history`)

| `vigente_desde` | Subsidy (BRL/L) | Notes |
|---|---|---|
| 2026-03-13 | 0.32 | Initial subsidy |
| 2026-04-07 | 1.52 | Added R$ 1.20 — visible as a ~1.20 jump in the Reference–Commercialization gap |

Newer rows replace older ones from their `vigente_desde` onward.

## Chart spec

Two independent Plotly charts (one per agent), each with 4 line traces (`scatter` + `mode='lines'` + `connectgaps: true`):

| Trace | Color | Notes |
|---|---|---|
| IPP                   | `#111111` (black)    | Shared between both charts |
| ANP Reference         | `#F59E0B` (orange)   | `customdata` = `regions_<agent>`; hover lists the 5 regional values when present |
| ANP Commercialization | `#B91C1C` (dark red) | — |
| Petrobras             | `#0F766E` (teal)     | Shared between both charts |

**Hover tooltip for ANP Reference** (when `regions_<agent>` is non-null):

```
<b>%{x}</b>
ANP Reference: R$ %{y:.2f}/L

<formatted regional breakdown string>
```

When `regions_<agent>` is null on every visible point, the trace falls back to a single-line hover without the breakdown.

**End-of-line annotations** — replicate the pattern in `price-bands/page.tsx`:

- For each trace, find the **last non-null** point.
- Add a Plotly annotation at that `(x, y)` with `xref='x'`, `yref='y'`, `xanchor='left'`, `xshift: 8`, `text: value.toFixed(2)`, `font.color` matching the trace, `showarrow: false`.
- To avoid label collision when two annotations end at the same date with close `y` values, offset `yshift` by `±10` per trace index.

**Axes & layout**:

- X axis: dates, `tickformat: "%b-%y"`, tick angle `-90`, x-range extended `+30 days` past the last point to leave room for end-of-line labels.
- Y axis title: `"BRL/Liter"`, `tickformat: ".2f"`.
- Legend: horizontal, below the chart.
- Layout: `COMMON_LAYOUT` + `AXIS_LINE` from `src/lib/plotlyDefaults`.
- Height: 420px (reduced from 480px in original single-chart layout to fit two charts side-by-side).
- Empty state: `emptyPlot(420, "No data available")` when 0 rows after filter.

**Period filter**: `PeriodSlider` (dates mode) — default selection is the **last 90 days** (or full range if shorter). No standalone filter UI on desktop (no filter panel rendered above charts). On mobile, the FilterDrawer governs both charts uniformly.

## WoW table

Each chart is followed by a Bootstrap `table-sm` with 4 rows × 4 columns:

| Column | Content |
|---|---|
| Series | 10×10 colored swatch + series label |
| Last | `R$ X.XX/L`, em-dash when null |
| Date | Formatted via `fmtDateLabel`, em-dash when null |
| WoW % | Green `#15803d` when >0, red `#b91c1c` when <0, em-dash when null; format `+X.XX%` / `-X.XX%` |

### WoW semantics

For each series:
1. Find the latest non-null reading (`latestValue`, `latestDate`) within the filter window.
2. Compute `targetDate = latestDate − 7 calendar days`.
3. Walk rows descending to find the most recent non-null reading where `date ≤ targetDate` — that is `priorValue` / `priorDate`.
4. `wowPct = priorValue != null && priorValue !== 0 ? (latestValue − priorValue) / priorValue × 100 : null`.
5. Render em-dash when `wowPct === null` (prior reading unavailable or zero division).

## Desktop layout

```
NavBar
DashboardHeader + ExportPanel
┌─────────────────────────────────────────────────────────────────┐
│  h6: Importer Reference Prices    │  h6: Producer Reference Prices  │
│  PlotlyChart (chartImporter)      │  PlotlyChart (chartProducer)    │
│  WowTable (currentValuesImporter) │  WowTable (currentValuesProducer)│
└─────────────────────────────────────────────────────────────────┘
```

Side-by-side (`col-lg-6`) on ≥lg viewports; stacked on <lg.

## Mobile layout

Stacked vertically:
1. MobileTopBar + Subtitle + Date chips
2. AgentDivider ("Importer Reference Prices")
3. MobileChart (chartImporter) + color-key legend
4. Active subsidy badge (importer)
5. Latest values cards with WoW % chips (importer)
6. Tap-to-show regional breakdown (importer)
7. AgentDivider ("Producer Reference Prices")
8. MobileChart (chartProducer) + color-key legend
9. Active subsidy badge (producer)
10. Latest values cards with WoW % chips (producer)
11. Tap-to-show regional breakdown (producer)
12. FilterDrawer (period slider + trace visibility toggles — governs both charts)
13. ExportFAB

The trace visibility toggles in the FilterDrawer use SERIES_IMPORTER labels as display names. Toggling `anp_reference_importer` mirrors to `anp_reference_producer`, and similarly for Commercialization. IPP and Petrobras are shared fields.

## NavBar location

- Group: **Fuel Distribution** → **Proprietary data** (alongside Price Bands).
- Slug: `subsidy-tracker`.
- NavBar entry maintained by `worker_dash-admin` (this agent does not edit `NavBar.tsx`).
- Module visibility seeded by the migration that creates `anp_subsidy_*` tables (owned by `worker_supabase`).

## Export — Tier 1

Direct download (no modal — dataset is small, one row per date).

| Action | Helper | Filename | Columns |
|---|---|---|---|
| Excel | `downloadGenericExcel` (`src/lib/exportExcel.ts`) | `subsidy_tracker_diesel <DD-MM-YY>.xlsx` | `Date`, `IPP`, `ANP Reference (Importer)`, `ANP Commercialization (Importer)`, `ANP Reference (Producer)`, `ANP Commercialization (Producer)`, `Petrobras` |
| CSV   | `downloadCsv` (`src/lib/exportCsv.ts`)            | `subsidy_tracker_diesel.csv`               | `date, ipp, anp_reference_importer, anp_commercialization_importer, anp_reference_producer, anp_commercialization_producer, petrobras` |

`regions_importer` and `regions_producer` are intentionally excluded from export — they are UI affordances only.

## Hook contract (`useSubsidyTrackerData.ts`)

```ts
{
  rows: SubsidyTrackerRow[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  filters: { sliderRange: [number, number]; traces: TraceVisibility };
  setFilters: (next: Partial<Filters>) => void;
  resetFilters: () => void;
  datas: string[];                              // unique sorted dates >= MIN_DATE
  xMin: string | null;
  xMax: string | null;
  chartImporter: { data: PlotData[]; layout: Partial<Layout> };
  chartProducer: { data: PlotData[]; layout: Partial<Layout> };
  currentValuesImporter: SubsidyTrackerWowRow[];   // 1 row per series (latest + WoW)
  currentValuesProducer: SubsidyTrackerWowRow[];   // 1 row per series (latest + WoW)
  activeSubsidyImporter: number | null;            // Reference − Commercialization (importer)
  activeSubsidyProducer: number | null;            // Reference − Commercialization (producer)
  exportExcel: () => Promise<void>;
  exportCsv: () => void;
  excelLoading: boolean;
  csvLoading: boolean;
}
```

Exports also include `SERIES_IMPORTER`, `SERIES_PRODUCER`, `SERIES` (alias for `SERIES_IMPORTER`), `REGION_ORDER`, `COLOR_*` constants, and `formatRegions` / `fmtDateLabel` / `buildChart` / `buildCurrentValuesWithWoW` helpers.

### Removed from hook (compared to single-agent v1)

| Old export | Replacement |
|---|---|
| `chart` | `chartImporter` + `chartProducer` |
| `currentValues` | `currentValuesImporter` + `currentValuesProducer` |
| `activeSubsidy` | `activeSubsidyImporter` + `activeSubsidyProducer` |
| `SERIES` | `SERIES_IMPORTER` + `SERIES_PRODUCER` (`SERIES` kept as alias for SERIES_IMPORTER) |

## Files & ownership

```
src/app/(dashboard)/subsidy-tracker/
├── page.tsx                       ← viewport router (useIsMobile)
├── useSubsidyTrackerData.ts       ← single brain (RPC, filters, chart, exports)
├── desktop/
│   ├── View.tsx                   ← desktop UX (2-column dual-chart layout)
│   └── WowTable.tsx               ← WoW table component (used only by desktop)
└── mobile/View.tsx                ← mobile UX (stacked dual-agent blocks + WoW chips)
src/lib/rpc.ts                     ← "MODULE: Subsidy Tracker" section
docs/app/subsidy-tracker.md        ← this PRD
```

Not owned here:

- `NavBar.tsx`, `HomeClient.tsx`, admin-panel reference-tables editor for `anp_subsidy_history` → `worker_dash-admin`.
- Tables/RPCs/RLS for `anp_subsidy_*` → `worker_supabase`.
- `scripts/pipelines/anp/subsidy_diesel_sync.py` and `.github/workflows/etl_anp_subsidy_diesel.yml` → `worker_etl-pipelines`.
- Shared components in `src/components/dashboard/` and `src/components/dashboard/mobile/` → `worker_subgerente-app` / `worker_designer`.

## Dual-view structure

`/subsidy-tracker` ships as a **dual-view module**. Both Views consume `useSubsidyTrackerData` exclusively — neither calls Supabase directly nor derives chart data on its own.

### Sync rule

Per `CLAUDE.md` § Dual-view policy: any new filter, chart, KPI or copy added to one View must land in the other in the **same commit**, OR the commit message must declare `[desktop-only]` / `[mobile-only]` with explicit justification.

Current `[mobile-only]` divergences:

| Concept | Desktop | Mobile | Reason |
|---|---|---|---|
| ANP Reference regional breakdown | Plotly hover tooltip via `customdata` | Tap-to-expand `MobileDataCard` list under each chart block | Touch devices have no hover |
| End-of-line value annotations | Stacked at chart's right edge with min-gap pushdown | Dropped; replaced by `MobileDataCard` "Latest values" section | Annotations overflow narrow viewports |
| Per-trace visibility | Plotly legend click | Toggle switches inside `FilterDrawer` | Mobile legend is non-interactive (`showlegend: false`) |
| WoW data | `WowTable` component below each chart | `WowChip` inline on each `MobileDataCard` | Consistent with mobile card UX pattern |

## Gotchas

- **Subsidy step on 2026-04-07** — the gap between Reference and Commercialization jumps from ~0.32 to ~1.52 on that date. This is correct, not a bug. Verify against `anp_subsidy_history`.
- **Importer vs. Producer price levels** — producer prices are typically lower than importer prices (e.g. 2026-05-26: importer ~5.13, producer ~4.64). Both ANP Commercialization traces will be ~1.52 below their respective References on the same date.
- **IPP column choice** — use `price_bands.bba_import_parity` (raw parity, no subsidy adjustment) for the IPP trace. Do **not** use `bba_import_parity_w_subsidy` here.
- **`regions_<agent>` may be NULL** — dates without a PDF extraction yet. The chart handles this by falling back to a simpler hover string. Don't crash on missing keys.
- **FULL OUTER JOIN** — `price_bands` may have a day that ANP doesn't, and vice versa. The corresponding column is NULL on that date; `connectgaps: true` keeps the line visually continuous.
- **WoW = null when no 7-day-prior reading** — early dates in the series will have null WoW. Render as em-dash.
- **Dataset is small** — Tier 1 export (no modal, no size precount). If this changes (e.g. multi-product extension), revisit and switch to Tier 2 with `useExportSize`.
- **Period default** — last 90 days. If the user expands to the full range, the period slider remembers until Reset is pressed.
- **TraceVisibility keys** — the hook's `TraceVisibility` uses `Partial<Record<SeriesField, boolean>>` where `SeriesField` covers all 6 numeric field names. The mobile FilterDrawer only toggles the 4 importer-side keys; the `traceVisible()` helper maps producer fields to their corresponding importer toggles.
