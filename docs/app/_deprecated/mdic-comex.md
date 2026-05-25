# Sub-PRD — `/mdic-comex`

> **Deprecated 2026-05-25.** Functionality merged into `/imports-exports` Panel C ("Import Price"). See `docs/app/imports-exports.md`. `mdic_comex` table and `etl_mdic_comex.yml` workflow remain active — they feed Panel C via `get_imports_exports_fob_price_serie`.

Dashboard MDIC Comex Stat — Imports and Exports of Fuels (Oil & Gas / Fuel Distribution). Owner: [`worker_dash-mdic-comex`](../../.claude/agents/worker_dash-mdic-comex.md).

> NavBar item.

## Code scope

```
src/app/(dashboard)/mdic-comex/
  page.tsx                  ← viewport router (useIsMobile)
  useMdicComexData.ts       ← single shared hook (RPCs, filters, derivations)
  desktop/View.tsx          ← desktop UX (sidebar + 2 charts + 24-month table)
  mobile/View.tsx           ← mobile UX (MobileTopBar + flow tabs + chart + summary cards)
```

RPC wrappers: "MDIC Comex" section in [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (~lines 800–897 and ~2494–2630).

## Product

Visualisation of **monthly import and export volumes** of the 3 main petroleum/fuel NCMs published by **MDIC Comex Stat** (Ministério do Desenvolvimento, Indústria, Comércio e Serviços). Allows the user to:

- Select via checkboxes which **NCMs** to compare in the time-series charts (Crude Oil, Gasoline, Diesel) — at least 1 always checked.
- Filter by **country** — multi-select dropdown with search (155 options), default = all selected. Minimum 1 country always required.
- Restrict the **period** via range slider (default: last 10 years), applied server-side via RPC.
- Toggle between **Consolidated** view (3 NCM lines, summed across selected countries) and **Individual** view (1 line per country, summed across selected NCMs).
- Read a **24-month summary table** with MoM% and YoY% for Imports and Exports.

Header: `MDIC Comex Stat — Imports and Exports` + sub `Monthly import and export volumes of crude oil, gasoline, and diesel by NCM and origin/destination country` + period badge when data exists.

A **metric toggle** (6 options) sits just below the header and drives all charts and the table simultaneously:

| Value | Label | Y-axis unit | Formula |
|---|---|---|---|
| `volume` | Volume (kt) | kt | `volume_kg / 1e6` |
| `volume_m3` | Volume (k m³) | k m³ | `volumeM3(r) / 1000` — derived via ANP density |
| `fob` | FOB (USD M) | USD M | `valor_fob_usd / 1e6` |
| `fob_per_ton` | FOB / ton | USD/ton | `valor_fob_usd / (volume_kg / 1000)` |
| `fob_per_m3` | FOB / m³ | USD/m³ | `valor_fob_usd / volumeM3(r)` — derived via ANP density |
| `fob_per_bbl` | FOB / bbl | USD/bbl | `valor_fob_usd / (volumeM3(r) * 6.28981)` — derived via ANP density |

Conversion constant: `M3_TO_BBL = 6.28981` (industry standard: 1 m³ = 6.28981 bbl). Defined inline in `page.tsx`.

**Volume derivation from weight:** `volume_kg` is present on 100% of rows. Volume in m³ is derived using standard ANP densities:

| NCM | Product | Density (kg/m³) |
|---|---|---|
| `27090010` | Crude oil | 870 |
| `27101259` | Gasoline | 745 |
| `27101921` | Diesel | 832 |

The helper `volumeM3(r)` in `page.tsx` performs this conversion. The `quantidade_estatistica` column from the Comex Stat API is **not used in the UI** — it is sparse and caused visible discontinuities.

Difference from `/anp-cdp`: this is **international trade flow** (import/export) reported by customs, not domestic production. Difference from `/navios-diesel`: monthly aggregation by NCM/country, not individual vessel tracking in real time.

## RPCs

| RPC | Type | Purpose |
|---|---|---|
| `get_mdic_comex_filtros` | own | Returns `anos[]`, `ncms[{ncm_codigo, ncm_nome}]`, `paises: text[]` (155 countries) |
| `get_mdic_comex_serie` | own | Monthly series aggregated by NCM (no country breakdown). Kept for backward compatibility. |
| `get_mdic_comex_aggregated` | own | Dynamic aggregator with `p_group_by`. Accepts `p_paises text[]`. Used for all chart and table fetches. |
| `get_mdic_comex_top_paises` | own | Top N countries by volume for 1 flow+NCM+period. **Not used in UI** (bar charts removed) — kept for future use / export. |
| `get_mdic_comex_export_count` | own | Row count for Tier 2 export modal. |

## Tables

| Object | Volume | Populated by |
|---|---|---|
| `mdic_comex` | ~1,238 rows | ETL `scripts/pipelines/mdic_comex_sync.py` |

### Columns of `mdic_comex`

`ano (smallint), mes (smallint), flow (text), ncm_codigo (text), ncm_nome (text), pais (text), volume_kg (float8), valor_fob_usd (float8), quantidade_estatistica (float8, nullable), unidade_estatistica (text, nullable)`.

PK: `(ano, mes, flow, ncm_codigo, pais)`. Indexes: `(ano, mes)`, `(ncm_codigo)`, `(flow)`.

### Relevant migrations

- `20260504000012_mdic_comex.sql` — original schema + indexes + RLS + 3 RPCs + INSERT into `module_visibility('mdic-comex', true)`.
- `20260512000001` — Stage 1: adds `quantidade_estatistica` and `unidade_estatistica`; updates `get_mdic_comex_filtros` to return `paises: text[]`; updates `get_mdic_comex_serie`, `get_mdic_comex_top_paises`, `get_mdic_comex_aggregated` to SELECT/SUM the new columns.

## Pipeline

| Workflow | Schedule | Scripts |
|---|---|---|
| `.github/workflows/etl_mdic_comex.yml` | Daily 14:00 UTC (11:00 BRT) | `scripts/pipelines/mdic_comex_sync.py` |

Scraper behaviour:
- Default: re-downloads last 3 months (`--meses 3`) + idempotent upsert.
- Manual: `--desde YYYY-MM` for backfill from a specific month.
- Retries: 4 attempts with backoff `[2, 5, 12, 30]s` per chunk.
- Batch upsert: 500 rows per request via supabase-py.
- The 3 NCMs `_NCMS = ["27090010", "27101259", "27101921"]` are fixed — adding an NCM requires changes to the scraper AND `NCM_INFO` in the page.

## Fixed NCMs (3)

| NCM | Label | Color |
|---|---|---|
| `27090010` | Crude Oil | `#1a1a1a` |
| `27101259` | Gasoline | `#FF5000` |
| `27101921` | Diesel | `#2196F3` |

> List is **closed client-side** — `get_mdic_comex_filtros` returns `ncms[]` but the UI uses the constant to guarantee color + label + fixed order.

## Filters (UI — 3 filters)

| Filter | Component | Behaviour |
|---|---|---|
| Product | `MultiSelectFilter` (3 fixed, with color swatch) | client-side; minimum 1 always selected; "Clear" button restores all; counter `(N/3)` |
| Countries | `SearchableMultiSelect` (155 options, search by name) | server-side via `p_paises` in `get_mdic_comex_aggregated`; minimum 1; debounced 400ms |
| Period | `rc-slider` range | server-side in `get_mdic_comex_aggregated` (debounced 400ms) |

## View modes

| Mode | Toggle option | Chart behaviour |
|---|---|---|
| Consolidated (default) | `SegmentedToggle` — "Consolidated" | 2 line charts: 1 trace per NCM, summed across selected countries. `groupBy = ['ano','mes','flow','ncm_codigo']` |
| Individual | `SegmentedToggle` — "Individual" | 2 line charts: 1 trace per country, summed across selected NCMs. `groupBy = ['ano','mes','flow','pais']`. PALETTE colors cycle. |

**UX guard for Individual mode**: if the user switches to Individual with >20 countries selected, a dismissible amber banner is shown: *"Individual mode shows 1 series per country. Narrow your country filter to compare more clearly."* — advisory only, does not block.

## Charts (2)

1. **Imports ({unit} / month)** — multi-line chart.
   - Consolidated: 1 trace per selected NCM.
   - Individual: 1 trace per selected country. Title appends "— by country".
2. **Exports ({unit} / month)** — same structure as Imports.

Y-axis unit and chart title driven by the active metric toggle.

## 24-month summary table

Located below the 2 charts. Columns:

| Month | Imports (unit) | Exports (unit) | IMP MoM% | EXP MoM% | IMP YoY% | EXP YoY% |

Specifications:
- 24 rows: most recent 24 months, descending order (newest on top).
- Values: sum of IMP/EXP for the active filters (country + NCM + period) and active metric.
- **MoM%** = (current / previous month − 1) × 100. Color-coded: green positive, red negative.
- **YoY%** = (current / same month 1 year ago − 1) × 100. Same formatting.
- To compute YoY% for all 24 shown rows, the table fetch uses `anoInicio − 2` (36-month window), displays 24.
- If MoM% / YoY% cannot be computed (base is zero or missing), shows "—".
- Table header unit responds to the active metric (e.g., "Imports (USD/bbl)").
- Uses Bootstrap `table table-sm table-hover` — no custom table component needed.

## Components consumed

- `PlotlyChart` — 2 line charts.
- `SearchableMultiSelect` — country filter (155 options, search).
- `MultiSelectFilter` — product filter (3 fixed).
- `PeriodSlider` — period range slider.
- `ChartSection` — chart title + loading opacity.
- `SegmentedToggle` — metric toggle (6 options) + view mode toggle (Consolidated / Individual).
- `BarrelLoading` — initial full-page loader.
- `ExportPanel` + `ExportModal` — Tier 2 export.
- `NavBar`, `BrandLogo`, `DashboardHeader`.
- `useModuleVisibilityGuard("mdic-comex")`.
- `useDebouncedFetch` — 400ms debounce on country/period changes.

## Dual-view structure

Refactored 2026-05-20 into the canonical dual-view pattern (CLAUDE.md § "Dual-view policy").

### Hook — `useMdicComexData.ts`

Single source of truth for all data, filters, derivations, and export logic. Both Views consume it; neither calls Supabase directly. Exports:

- All state: `anos`, `allPaises`, `yearRange`, `selectedNCMs`, `selectedPaises`, `metric`, `viewMode`, `showIndividualWarn`
- Setters: `setYearRange`, `toggleNcm`, `resetNcms`, `setSelectedPaises`, `setMetric`, `setViewMode`, `setShowIndividualWarn`
- Derived: `hasYears`, `yMin`, `yMax`, `paisesFilter`, `chartRows`, `tableRows`, `chartLoading`, `tableLoading`, `tableData`, `chartGroupBy`
- Export pipeline: `exportOpen`, `openExportModal`, `handleExportExcel`, `handleExportCsv` + all modal state
- Pure helpers (also exported for reuse): `volumeM3`, `NCM_INFO`, `ALL_NCMS`, `METRIC_CONFIG`, `METRIC_OPTIONS`, `buildTableRows`, `formatPct`, `NCM_DENSITY_KG_PER_M3`, `M3_TO_BBL`

### Desktop view — `desktop/View.tsx`

Verbatim behaviour of the previous `page.tsx`:
- Sidebar (Product filter + Countries SearchableMultiSelect + View mode toggle + Period slider)
- 2 Plotly line charts (Imports / Exports, consolidated or individual mode)
- 24-month summary table (MoM% + YoY%, color-coded)
- ExportModal (Tier 2, granularity selector)

### Mobile view — `mobile/View.tsx`

Same analyses, mobile-first layout:
- `MobileTopBar` (sticky glass header)
- `MobileTabBar` (Imports / Exports flow selection)
- Metric pills (horizontal scrollable row — 6 options)
- `MobileTabBar` (product tabs, underline variant — only in Consolidated mode)
- `MobileChart` (240px Plotly line, consolidated or individual)
- `MobileDataCard` list (top 3 months, MoM% + YoY% for active flow)
- View mode (Consolidated / Individual) pill toggle
- Filter FAB → `FilterDrawer` (country chips + PeriodSlider + MultiSelectFilter)
- `ExportFAB` → `ExportModal` (identical Tier 2 modal as desktop)

### Binding sync rule

Any change to `desktop/View.tsx` (new filter, chart, metric) must land in `mobile/View.tsx` in the same commit, or the commit message must declare `[desktop-only]` / `[mobile-only]` with explicit reason.

## Cross-dept dependencies

| Origin | Dependency |
|---|---|
| ETL (`mdic_comex_sync`) | Populates `mdic_comex` daily; defines the 3 NCMs |
| Subgerente APP | Schema/migrations for `mdic_comex` and RPCs |
| Designer | NCM colors fixed client-side, Arial, line chart style |
| Supabase | RLS enabled on `mdic_comex` (read-only via anon authenticated); RPCs SECURITY DEFINER |
| `worker_dash-admin` | Module visibility (`module_visibility.mdic-comex`) and home image |

## Performance

- **`mdic_comex` is small (~1.2k rows)** — aggregation via `get_mdic_comex_aggregated` reduces to a few hundred rows. Period filter via `p_ano_inicio/p_ano_fim` reduces further.
- **Country filter**: when all 155 countries are selected, `p_paises = null` is passed (no IN clause) for efficiency.
- **Debounce 400ms** on country filter and period slider changes.
- **Two parallel fetches on load**: chart data + table data (`Promise.all`).
- **Table fetch requests extra 2 years** (for YoY calculation) but is still bounded to `mdic_comex` aggregate size.

## Anti-patterns

- Direct query on `mdic_comex` from the frontend — always via RPC.
- Fetch without debounce — use 400ms.
- Filter full series client-side by period — push to RPC via `p_ano_inicio/p_ano_fim`.
- Allow `selectedNCMs.length === 0` — always keep at least 1.
- Allow `selectedPaises.length === 0` — always keep at least 1.
- Reset `yearRange` on NCM/country change — slider is set once on mount.
- Full-page barrel in `chartLoading` / `tableLoading` — barrel is only for the initial `loading`; subsequent updates use inline indicator + opacity 0.5.
- Adding a new NCM only in `NCM_INFO` without coordinating with ETL to include it in `_NCMS` — will have no data.
- Touching `scripts/pipelines/mdic_comex_sync.py` — belongs to ETL.
- Using `quantidade_estatistica` to derive volume in m³ — sparse field, abandoned. Always use `volumeM3(r)` with standard ANP densities.
- Adding `connectgaps: true` as a workaround — after the density fix, there are no gaps.
- Rendering bar charts for Top Countries — removed in Stage 2 refactor. The RPC `get_mdic_comex_top_paises` and its wrapper remain in `rpc.ts` for potential future use.

## Export

Tier 2 — `<ExportPanel mode="modal">` opens `<ExportModal>` with filters + live size calculator.

- RPC count: `get_mdic_comex_export_count` (`p_ano_inicio`, `p_ano_fim`, `p_flow`, `p_ncms`) → `bigint`.
- JS wrapper: `getMdicComexExportCount` in [`src/lib/rpc.ts`](../../src/lib/rpc.ts).
- datasetKey heuristic: `mdic_comex`.
- Filters in modal: period (year slider), flow (IMP/EXP), NCMs (3 fixed).
- Excel handler: `downloadMdicComexRawExcel` / `downloadMdicComexAggregatedExcel` in [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts).
- CSV handler: `fetchMdicComexRawFiltered` + `downloadCsv` in [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts).
- Filename pattern: `MdicComex_DD-MM-YY.<xlsx|csv>`.
- Warning when estimate > 200,000 rows.
