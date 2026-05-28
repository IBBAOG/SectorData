# `/subsidy-tracker` — sub-PRD

Owner: `worker_dash-subsidy-tracker`. Reports to `worker_subgerente-app`.

## Overview

Tracks the impact of the federal diesel road subsidy on Brazilian commercialization prices. The dashboard renders **two** side-by-side (desktop) or stacked (mobile) time-series charts — one per ANP agent type — each showing **4 traces** comparing reference and effective price levels (BRL/Liter):

| Chart | Agent | Traces (4) |
|---|---|---|
| Left — Importador Reference Prices | `importador` (importers & refiners of imported crude) | IPP, IPP (adjusted), ANP Reference, ANP Commercialization |
| Right — Produtor Reference Prices  | `produtor` (refiners of their own domestic crude)     | Petrobras, Petrobras (adjusted), ANP Reference, ANP Commercialization |

**Placement rationale**:

- `IPP_adjusted` shows *only* on the importador grid because it is computed with the importador cap (1.52 BRL/L from 2026-04-07; 0.32 before).
- `Petrobras_adjusted` shows *only* on the produtor grid because it uses the produtor cap (1.12 BRL/L from 2026-04-07; 0.32 before).
- ANP Reference and ANP Commercialization appear in BOTH grids — same trace concept, but per-agent values (the regulator publishes distinct prices for each agent type).

## Formula (server-side)

The 2026-05-27 reform replaced the old (incorrect) `Commercialization = Reference − subsidy_brl_l` shortcut with the correct policy formula. The server-side SQL function `compute_subsidy_reimbursement(p_date, p_tipo_agente)` defined in `supabase/migrations/20260527200000_subsidy_reform.sql` is:

```
reimbursement(date, agent) = AVG over 5 regions of
  MIN(
    MAX(reference[region, date, agent] − commercialization[region, period, agent], 0),
    cap[agent, vigente_at(date)]
  )
```

Per-trace consequences:

- `ipp_adjusted        = ipp        − reimbursement(date, 'importador')`
- `petrobras_adjusted  = petrobras  + reimbursement(date, 'produtor')`

Reference is daily × regional × agent. Commercialization is period-fixed × regional × agent (published per ANP cycle; spans ~2 months at a time). Caps switch on 2026-04-07 from 0.32 unified to 1.52 (importador) / 1.12 (produtor).

The frontend NEVER recomputes the reimbursement. It consumes the already-adjusted values from the RPC.

## Data sources

| Table | Role | Owner |
|---|---|---|
| `price_bands` (Diesel rows) | Raw IPP (`bba_import_parity`) and Petrobras (`petrobras_price`). | `worker_dados-locais` (manual Excel upload) |
| `anp_subsidy_diesel_reference` | Daily regional reference prices, by `tipo_agente`. PK `(data_referencia, regiao, tipo_agente)`. Scraped from ANP PDFs. | `worker_etl-pipelines` (`subsidy_diesel_sync.py`, PDF stage) |
| `anp_subsidy_commercialization` | Period-fixed regional commercialization prices, by `tipo_agente`. PK `(data_inicio, regiao, tipo_agente)`. Scraped from the ANP HTML page. | `worker_etl-pipelines` (`subsidy_diesel_sync.py`, HTML stage) |
| `anp_subsidy_caps` | Cap timeline per `tipo_agente`. PK `(vigente_desde, tipo_agente)`. | `worker_supabase` (seeded by migration `20260527200000`) |

The legacy `anp_subsidy_history` table was **DROPPED** by the 2026-05-27 reform. Any references in this dashboard's older docs are now obsolete.

## RPC contract (locked)

> **2026-05-28 update:** `get_subsidy_tracker_diesel()` was extended from 11 to **13 columns** by adding `reimb_importador` and `reimb_produtor` at the end. The mobile View previously computed reimbursement as `ref − comm`, which inflated values above the per-region cap (e.g. 1.65 when the importer cap is 1.52). Both columns are now consumed directly from the RPC. Cap values: importer 1.52 BRL/L, producer 1.12 BRL/L (from 2026-04-07; unified 0.32 before).

```sql
public.get_subsidy_tracker_diesel() RETURNS TABLE (
  date                              DATE,
  ipp                               NUMERIC,
  ipp_adjusted                      NUMERIC,
  petrobras                         NUMERIC,
  petrobras_adjusted                NUMERIC,
  anp_reference_importador          NUMERIC,
  anp_reference_produtor            NUMERIC,
  anp_commercialization_importador  NUMERIC,
  anp_commercialization_produtor    NUMERIC,
  regions_importador                JSONB,   -- { NORTE, NORDESTE, ... } reference (importador)
  regions_produtor                  JSONB,   -- { NORTE, NORDESTE, ... } reference (produtor)
  reimb_importador                  NUMERIC, -- compute_subsidy_reimbursement(date, 'importador'); NULL outside subsidy period
  reimb_produtor                    NUMERIC  -- compute_subsidy_reimbursement(date, 'produtor');   NULL outside subsidy period
)
```

Behavior:

- FULL OUTER JOIN between `price_bands` (Diesel) and the daily regional averages from `anp_subsidy_diesel_reference` (one CTE per `tipo_agente`), plus a union of the period-fixed `anp_subsidy_commercialization` exploded by date.
- `anp_commercialization_<agent>` is the regional **average** of the period-fixed commercialization price for each date inside the period — NOT a reference-minus-cap derivation.
- `ipp_adjusted` and `petrobras_adjusted` come from `compute_subsidy_reimbursement(date, agent)` applied per row.
- `reimb_importador` / `reimb_produtor` = `compute_subsidy_reimbursement(date, agent)` — AVG over 5 regions of `MIN(MAX(ref − comm, 0), cap)`. NULL for dates before the subsidy started.
- The frontend **must not** recompute reimbursements as `ref − comm` — that formula skips the per-region cap.
- `regions_<agent>` is the per-region breakdown of the reference price for the day, or NULL when no PDF was extracted yet.
- Rows ordered ASC by `date`.
- SECURITY DEFINER + `search_path = public, pg_temp`, granted to `authenticated` only (proprietary data — NOT anon).

TypeScript mirror — `src/lib/rpc.ts`:

```ts
export type SubsidyTrackerRow = {
  date: string;
  ipp: number | null;
  ipp_adjusted: number | null;
  petrobras: number | null;
  petrobras_adjusted: number | null;
  anp_reference_importador: number | null;
  anp_reference_produtor: number | null;
  anp_commercialization_importador: number | null;
  anp_commercialization_produtor: number | null;
  regions_importador: Record<string, number> | null;
  regions_produtor: Record<string, number> | null;
  reimb_importador: number | null;   // cap-aware; NULL outside subsidy period
  reimb_produtor: number | null;     // cap-aware; NULL outside subsidy period
};
```

## Cap timeline (seed in `anp_subsidy_caps`)

| `vigente_desde` | `tipo_agente` | `cap_brl_l` | Notes |
|---|---|---|---|
| 2026-03-13 | importador | 0.32 | Initial unified cap |
| 2026-03-13 | produtor   | 0.32 | Initial unified cap |
| 2026-04-07 | importador | 1.52 | Split: 1.20 + 0.32 (importer leg) |
| 2026-04-07 | produtor   | 1.12 | Split: 0.80 + 0.32 (domestic producer leg) |

## Chart spec

Two independent Plotly charts (one per agent), each with **4 line traces** (`scatter` + `mode='lines'` + `connectgaps: true`):

### Importador grid (`SERIES_IMPORTADOR`)

| Trace | Color | Line | Notes |
|---|---|---|---|
| IPP                   | `#111111` (black)    | solid  | From `price_bands.bba_import_parity` |
| IPP (adjusted)        | `#111111` (black)    | dashed | `ipp − reimbursement_importador` |
| ANP Reference         | `#F59E0B` (orange)   | solid  | `customdata = regions_importador`; hover lists 5 regional values |
| ANP Commercialization | `#B91C1C` (dark red) | solid  | Scraped period-fixed price, averaged across regions |

### Produtor grid (`SERIES_PRODUTOR`)

| Trace | Color | Line | Notes |
|---|---|---|---|
| Petrobras             | `#0F766E` (teal)     | solid  | From `price_bands.petrobras_price` |
| Petrobras (adjusted)  | `#0F766E` (teal)     | dashed | `petrobras + reimbursement_produtor` |
| ANP Reference         | `#F59E0B` (orange)   | solid  | `customdata = regions_produtor` |
| ANP Commercialization | `#B91C1C` (dark red) | solid  | — |

```
              IMPORTADOR grid                 PRODUTOR grid
              ───────────────                 ─────────────
  IPP ━━━━━ (black, solid)        Petrobras  ━━━━━ (teal, solid)
  IPP ╌╌╌╌╌ (black, dashed)       Petrobras  ╌╌╌╌╌ (teal, dashed)
  Ref ━━━━━ (orange, solid)       Ref        ━━━━━ (orange, solid)
  Comm━━━━━ (dark red, solid)     Comm       ━━━━━ (dark red, solid)
```

**Hover tooltip for ANP Reference** (when `regions_<agent>` is non-null):

```
<b>%{x}</b>
ANP Reference: R$ %{y:.2f}/L

<formatted regional breakdown string>
```

When `regions_<agent>` is null on every visible point, the trace falls back to a single-line hover without the breakdown.

**End-of-line annotations** — for each trace, find the last non-null `(x, y)`, then anchor at `xref='x'`, `yref='y'`, `xanchor='left'`, `xshift: 8`, `text: value.toFixed(2)`, `font.color` matching the trace, `showarrow: false`. With 4 traces per chart and potentially close `y` values, a min-gap pushdown algorithm (`buildChart`) prevents label collision.

**Axes & layout**:

- X axis: dates, `tickformat: "%b-%y"`, tick angle `-90`, x-range extended `+30 days` past the last point.
- Y axis title: `"BRL/Liter"`, `tickformat: ".2f"`.
- Legend: horizontal, below the chart.
- Layout: `COMMON_LAYOUT` + `AXIS_LINE` from `src/lib/plotlyDefaults`.
- Height: 420px.
- Empty state: `emptyPlot(420, "No data available")`.

**Period filter**: `PeriodSlider` (dates mode) — default `last 90 days` (or full range if shorter). No standalone filter UI on desktop. On mobile, the FilterDrawer governs both charts uniformly.

## WoW table (desktop)

Each chart is followed by a Bootstrap `table-sm` with **4 rows × 4 columns**. The Importador WoW table shows IPP, IPP (adjusted), ANP Reference, ANP Commercialization. The Produtor table shows Petrobras, Petrobras (adjusted), ANP Reference, ANP Commercialization.

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
5. Render em-dash when `wowPct === null`.

## Desktop layout

```
NavBar
DashboardHeader + ExportPanel
┌────────────────────────────────────────────────────────────────────┐
│  h6: Importador Reference Prices    │  h6: Produtor Reference Prices │
│  PlotlyChart (chartImporter, 4 trc) │  PlotlyChart (chartProducer, 4 trc) │
│  WowTable (currentValuesImporter)   │  WowTable (currentValuesProducer)   │
└────────────────────────────────────────────────────────────────────┘
```

Side-by-side (`col-lg-6`) on ≥lg viewports; stacked on <lg.

## Mobile layout

Stacked vertically:

1. MobileTopBar + Subtitle + Date chips
2. AgentDivider ("Importador Reference Prices")
3. MobileChart (chartImporter) + color-key legend (4 entries — dashed line glyph for IPP adjusted)
4. Active subsidy badge (importador)
5. Latest values cards with WoW % chips (4 rows — importador)
6. Tap-to-show regional breakdown (importador)
7. AgentDivider ("Produtor Reference Prices")
8. MobileChart (chartProducer) + color-key legend (4 entries — dashed line glyph for Petrobras adjusted)
9. Active subsidy badge (produtor)
10. Latest values cards with WoW % chips (4 rows — produtor)
11. Tap-to-show regional breakdown (produtor)
12. FilterDrawer (period slider + 6 trace visibility toggles)
13. ExportFAB

The FilterDrawer exposes **6 unique toggles** (IPP / IPP adjusted / Petrobras / Petrobras adjusted / ANP Reference / ANP Commercialization). The ANP Reference and ANP Commercialization toggles are keyed on the importador field, and `MIRROR_MAP` propagates the same on/off state to the produtor field.

## NavBar location

- Group: **Fuel Distribution** → **Proprietary data** (alongside Price Bands).
- Slug: `subsidy-tracker`.
- NavBar entry maintained by `worker_dash-admin` (this agent does not edit `NavBar.tsx`).

## Export — Tier 1

Direct download (no modal — dataset is small, one row per date). Now carries the two adjusted columns.

| Action | Helper | Filename | Columns |
|---|---|---|---|
| Excel | `downloadGenericExcel` (`src/lib/exportExcel.ts`) | `subsidy_tracker_diesel <DD-MM-YY>.xlsx` | `Date`, `IPP`, `IPP (adjusted)`, `Petrobras`, `Petrobras (adjusted)`, `ANP Reference (Importador)`, `ANP Reference (Produtor)`, `ANP Commercialization (Importador)`, `ANP Commercialization (Produtor)`, `Reimbursement (Importador)`, `Reimbursement (Produtor)` |
| CSV   | `downloadCsv` (`src/lib/exportCsv.ts`)            | `subsidy_tracker_diesel.csv`               | `date, ipp, ipp_adjusted, petrobras, petrobras_adjusted, anp_reference_importador, anp_reference_produtor, anp_commercialization_importador, anp_commercialization_produtor, reimb_importador, reimb_produtor` |

`regions_importador` and `regions_produtor` are intentionally excluded from export — they are UI affordances only. `reimb_importador` / `reimb_produtor` are included (cap-aware values from the RPC).

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
  datas: string[];
  xMin: string | null;
  xMax: string | null;
  chartImporter: { data: PlotData[]; layout: Partial<Layout> };  // 4 traces
  chartProducer: { data: PlotData[]; layout: Partial<Layout> };  // 4 traces
  currentValuesImporter: SubsidyTrackerWowRow[];                  // 4 rows
  currentValuesProducer: SubsidyTrackerWowRow[];                  // 4 rows
  activeSubsidyImporter: number | null;
  activeSubsidyProducer: number | null;
  exportExcel: () => Promise<void>;
  exportCsv: () => void;
  excelLoading: boolean;
  csvLoading: boolean;
}
```

Exports also include `SERIES_IMPORTADOR`, `SERIES_PRODUTOR`, back-compat aliases `SERIES_IMPORTER` / `SERIES_PRODUCER` / `SERIES`, `REGION_ORDER`, `COLOR_*` constants, and `formatRegions` / `fmtDateLabel` / `buildChart` / `buildCurrentValuesWithWoW` helpers.

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

- `NavBar.tsx`, `HomeClient.tsx` → `worker_dash-admin`.
- Tables / RPC / triggers / `compute_subsidy_reimbursement()` / migration `20260527200000_subsidy_reform.sql` → `worker_supabase`.
- `scripts/pipelines/anp/subsidy_diesel_sync.py` (PDF + HTML stages) and `.github/workflows/etl_anp_subsidy_diesel.yml` → `worker_etl-pipelines`.
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
| Per-trace visibility | Plotly legend click | Toggle switches inside `FilterDrawer` (6 unique concepts) | Mobile legend is non-interactive (`showlegend: false`) |
| WoW data | `WowTable` component below each chart | `WowChip` inline on each `MobileDataCard` | Consistent with mobile card UX pattern |
| Dashed-line distinction | Plotly `line.dash = "dash"` is visible in chart + legend | Chart uses dashed line, legend uses a small `ColorLine` dashed glyph next to the label | Mobile legend dots cannot encode dash |

## Gotchas

- **Cap step on 2026-04-07** — the gap between Reference and Commercialization (and the magnitude of the adjusted-vs-raw spread) jumps on that date. Importador goes 0.32 → 1.52; produtor goes 0.32 → 1.12. Correct, not a bug.
- **Importador vs. Produtor price levels** — the two reference price levels differ (e.g., produtor lower than importador). Both ANP Commercialization traces also differ between agents because the HTML page publishes per-agent values.
- **IPP column choice** — use `price_bands.bba_import_parity` (raw parity) for the IPP trace. Do **not** use `bba_import_parity_w_subsidy` here. The adjusted version comes from the RPC's `ipp_adjusted` (server-side, freshly computed each call).
- **`regions_<agent>` may be NULL** — dates without a PDF extraction yet. The chart handles this by falling back to a simpler hover string.
- **`anp_commercialization_<agent>` may be NULL** — dates outside any scraped commercialization period. Plotly's `connectgaps: true` keeps the line visually continuous.
- **WoW = null when no 7-day-prior reading** — early dates in the series will have null WoW.
- **Dataset is small** — Tier 1 export (no modal, no size precount).
- **Period default** — last 90 days.
- **`anp_subsidy_history` is gone** — the migration `20260527200000_subsidy_reform.sql` DROPped it. Any reference-tables editor mention in `/admin-panel` related to that table has been retired; the new `anp_subsidy_caps` and `anp_subsidy_commercialization` tables are managed by ETL + migration seed, not via admin UI.
