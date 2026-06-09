# Sub-PRD — `/anp-prices`

ANP Prices — Producer, Distribution and Retail price surveyor for Brazilian fuels (Fuel Distribution category). Owner: [`worker_dash-anp-prices`](../../.claude/agents/worker_dash-anp-prices.md).

> Single item in the "Prices" sub-group of the "Fuel Distribution" NavBar dropdown.

## Purpose

Compare prices for the same fuel across the **three stages of the Brazilian supply chain** in one chart:

1. **Producer** (wholesale, refinery/importer gate) — source: `anp_precos_produtores`
2. **Distribution** (B2B — distributor → station / industrial) — source: `anp_precos_distribuicao`
3. **Retail** (B2C — pump prices) — source: `anp_lpc`

The visual gap between the three lines surfaces the markup at each supply-chain link without requiring the user to jump between 3 dashboards.

> **Reform — 2026-05-25.** `/anp-prices` replaces the 3 retired dashboards `/anp-precos-produtores`, `/anp-precos-distribuicao` and `/anp-lpc`. Archived sub-PRDs live under [`docs/app/_deprecated/`](_deprecated/). The 3 source tables, ETL pipelines and workflows are preserved — only the frontend was unified.

## Code scope

```
src/app/(dashboard)/anp-prices/
├── page.tsx                ← viewport router (useIsMobile)
├── useAnpPricesData.ts     ← THE BRAIN — RPCs, filters, derivations, types
├── desktop/View.tsx        ← desktop UX (sidebar + 1 chart)
└── mobile/View.tsx         ← mobile UX (product tabs + chart + link cards)
```

RPC wrappers in [`src/lib/rpc.ts`](../../src/lib/rpc.ts) — section "ANP Prices":
- `rpcGetAnpPricesFiltros`
- `rpcGetAnpPricesSerie`
- `getAnpPricesExportCount`

Excel export uses the generic helper `downloadGenericExcel` (no dedicated wrapper). CSV via `downloadCsv`.

## Dual-view structure

`/anp-prices` is a **dual-view** dashboard: `page.tsx` is a device router (`useIsMobile`) that picks `desktop/View.tsx` on PCs (any window width) or `mobile/View.tsx` on real phones/tablets (UA-detected, with iPadOS touch fallback). Both views consume the same hook `useAnpPricesData`, which is the **single source of truth** for analyses, filters and derivations.

### `useAnpPricesData` (hook)

Owns:
- 3 RPC calls (`rpcGetAnpPricesFiltros`, `rpcGetAnpPricesSerie`) + `getAnpPricesExportCount` for the Tier 2 modal.
- Filter state: `product` (single — radio/select/tab), `granularity` (segmented toggle: Brazil / Region / State / City), `locais` (multi-select when granularity ≠ Brazil), `yearRange` (year-slider indices).
- Year → DATE conversion: every fetch maps `[idx0, idx1]` to `${allYears[idx0]}-01-01` / `${allYears[idx1]}-12-31` before hitting the RPC. The slider stays in years for UI consistency with the rest of the platform.
- Debounce 400ms on reactive refetch via `useDebouncedFetch`.
- Trace visibility matrix (`TRACE_MATRIX`) — drives the legend dimming and the missing-link banner copy.
- Derivations: `fontesVisiveis` (3 / 2 / 1 / 0 depending on product × granularity), `faltandoElos` (missing-link banner copy), `chart` (Plotly traces + layout + unit).
- Export modal state (Tier 2): `exportOpen`, `exportProdutos`, `exportGranularidades`, `exportLocais`, `exportRange`, `exportFilters` (memoised snapshot for `useExportSize`), `excelLoading` / `csvLoading` flags.

Contract: both Views consume `{ filtros, product, setProduct, granularity, setGranularity, locais, toggleLocal, yearRange, setYearRange, serieRows, fontesVisiveis, faltandoElos, chart, unit, loading, serieLoading, …export }`. Neither View calls Supabase directly.

### `desktop/View.tsx`

- Sidebar with **Product** (`<select>`), **Granularity** (`SegmentedToggle`), **Locations** (`MultiSelectFilter` — only when granularity ≠ Brazil), **Period** (`PeriodSlider` over years).
- Main: `DashboardHeader` with title / subtitle / period badge / export panel; one `ChartSection` with the comparison chart.
- Trace legend (3 dots) always renders above the chart. Missing fontes are dimmed.
- Missing-link banner below the chart explains why a trace is absent.
- `ExportPanel mode="modal"` → `ExportModal` Tier 2 with `PeriodSlider` + `MultiSelectFilter` (products / granularities) + `SearchableMultiSelect` (locations).

### `mobile/View.tsx`

- `MobileTopBar` (sticky), title block + period badge.
- `MobileTabBar` — 5 product tabs (Gasoline / Diesel / Ethanol / Biodiesel / LPG) drive the active product.
- Sticky chip row: granularity `SegmentedToggle` + Filters button (+ active-filter chip).
- Chart card: `MobileChart` (240px) with the 3 traces, trace legend, missing-link banner.
- Per-link summary cards: latest price + weekly delta for each visible fonte.
- `ExportFAB` → same `ExportModal` Tier 2 as desktop.
- `FilterDrawer` (BottomSheet) with **Period** and **Locations** (granularity-aware chip cloud).

### Binding sync rule

Any meaningful change to `desktop/View.tsx` requires an equivalent change to `mobile/View.tsx` in the SAME commit, OR the commit message must declare `[desktop-only]` / `[mobile-only]` with an explicit reason.

Applies to: new filter, new chart, new KPI, new export option, copy changes. Purely visual tweaks that don't change content can be view-specific without a tag.

## Product

Five fuels are exposed (decided by the user):

| Product | Producer | Distribution | Retail | Notes |
|---|---|---|---|---|
| **Gasoline** | `Gasolina A Comum` (E0, ex-refinery) | `Gasolina Comum` (C, E27 blend) | `GASOLINA COMUM` (C) | Tooltip on Producer trace explains the A vs C technical difference. |
| **Diesel** | `Óleo Diesel S-10` → fallback `S-500` → legacy `Óleo Diesel` | `Diesel S10`, `Diesel S500` | `DIESEL S10`, `DIESEL S500` + legacy `DIESEL` | S10 priority; fallback handled server-side. |
| **Ethanol** | — (not published by ANP) | `Etanol Hidratado` | `ETANOL` (hydrous) | 2 links only. |
| **Biodiesel** | `Biodiesel B-100` (R$/L) | — | — | 1 link only (Producer). |
| **LPG** | `Gás Liquefeito de Petróleo - GLP` (R$/kg → ×13) | `GLP P13` (R$/13kg) | `GLP` (R$/kg → ×13) | All normalized to R$/13kg server-side. |

## Trace visibility matrix (product × granularity)

| Product | Brazil | Region | State | City |
|---|---|---|---|---|
| Gasoline | 3 links | 3 links | 2 (no Producer) | 1 (Distribution) |
| Diesel | 3 links | 3 links | 2 | 1 |
| Ethanol | 2 (no Producer) | 2 | 2 | 1 |
| Biodiesel | 1 (Producer) | 1 | 0 (banner) | 0 (banner) |
| LPG | 3 links | 3 links | 2 | 1 |

When a trace is absent, the missing-link banner explains why (e.g. "Producer prices are only published at Region level"). The trace legend dims (grey dot) for missing fontes — the colour code stays visible so users learn the mapping.

## Periodicity

| Source | Cadence | Notes |
|---|---|---|
| Producer | Weekly (`data_inicio` DATE) | ~2002 → present |
| Distribution (Brazil) | Weekly | Same cadence as Producer |
| Distribution (Region/State/City) | **Monthly** | Rendered as step function (`line.shape = "hv"`) |
| Retail | Weekly (`data_fim` DATE, end-of-Saturday) | ~2013 → present |

The chart preserves native cadence — no resampling. The step shape for monthly Distribution at sub-Brazil granularities visually signals the lower frequency.

## Units (normalized to R$/unit-padrão)

| Product | Y-axis unit | Server-side conversion |
|---|---|---|
| Gasoline / Diesel / Ethanol / Biodiesel | `R$/litro` | None |
| LPG | `R$/13kg` | Producer × 13; Retail × 13; Distribution passes through (already 13kg) |

The Y-axis label is driven by the `unidade` column on the first returned row, never hardcoded in the View.

## RPCs

| RPC | Type | Function |
|---|---|---|
| `get_anp_prices_filtros` | own | Returns `produtos` (5 items), `granularidades` (4 items), `regioes` (5 items), `ufs` (27), `municipios` (~hundreds), `data_min`, `data_max` |
| `get_anp_prices_serie(p_produto, p_granularidade, p_locais, p_data_inicio, p_data_fim)` | own | UNION ALL of the 3 source tables with product/unit/region normalization. Returns `(data, fonte, local, preco, unidade)`. Diesel S10→S500 fallback applied server-side. |
| `get_anp_prices_export_count(p_produtos, p_granularidades, p_locais, p_data_inicio, p_data_fim)` | own | `bigint` row count for the Tier 2 modal size calculator |

All 3 RPCs are `SECURITY DEFINER` with `GRANT EXECUTE TO anon, authenticated`.

## Filter universe contract

| Field | Sample values |
|---|---|
| `produtos` | `['Gasoline', 'Diesel', 'Ethanol', 'Biodiesel', 'LPG']` |
| `granularidades` | `['brasil', 'regiao', 'uf', 'municipio']` |
| `regioes` | `['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul']` (title-case, hyphen) |
| `ufs` | 2-letter codes (`SP`, `RJ`, ...) |
| `municipios` | UPPERCASE ASCII names (`SAO PAULO`, `RIO DE JANEIRO`, ...) |

The RPC returns these values directly — frontend never derives or maps them.

## Source tables

| Table | Volume | Populated by |
|---|---|---|
| `anp_precos_produtores` | ~38k rows | `scripts/pipelines/anp/precos/02_precos_produtores_sync.py` (weekly Mon) |
| `anp_precos_distribuicao` | ~50–100k rows | `scripts/pipelines/anp/precos_distribuicao_sync.py` (monthly 5th + weekly Tue) |
| `anp_lpc` | ~30k rows | `scripts/pipelines/anp/lpc_sync.py` (daily 14:30 UTC since 2026-06-09; ANP publishes weekly on an unstable weekday, scrape is incremental + idempotent) |

The 3 ETL pipelines are unchanged by the reform — they continue to populate their source tables. Only the consumer (frontend) was unified.

## Pipelines (unchanged)

| Workflow | Schedule | Script |
|---|---|---|
| `etl_anp_precos.yml` | Mon 12:00 UTC | `precos/02_precos_produtores_sync.py` + `glp_sync.py` |
| `etl_anp_precos_distribuicao.yml` | 5th of month + Tue 14:30 UTC | `precos_distribuicao_sync.py` |
| `etl_anp_lpc.yml` | Daily 14:30 UTC (was weekly Wed until 2026-06-09) | `lpc_sync.py` (engine `calamine` for XLSX) |

## Charts (1)

1. **Supply-chain prices — Producer / Distribution / Retail.** One Plotly line chart, 1 trace per (fonte × local). Colours fixed: Producer `#FF5000`, Distribution `#3F51B5`, Retail `#009688`. Step function (`shape: 'hv'`) for monthly Distribution at sub-Brazil granularities; linear for the rest. X-axis: date. Y-axis: `R$/litro` or `R$/13kg` (driven by row.unidade). Hover unified by x.

## Components consumed

- `PlotlyChart` (desktop) / `MobileChart` (mobile)
- `DashboardHeader`, `MultiSelectFilter`, `PeriodSlider`, `ChartSection`, `BarrelLoading`, `ExportPanel`, `ExportModal`, `SegmentedToggle`, `SearchableMultiSelect`
- Mobile: `MobileTopBar`, `MobileTabBar`, `FilterDrawer`, `MobileDataCard`, `ExportFAB`, `FilterIcon`, `CloseIcon`
- `NavBar`
- `useModuleVisibilityGuard("anp-prices")`
- `useDebouncedFetch` (reactive refetch)
- `useIsMobile` (viewport router)

## Cross-dept dependencies

| Origin | How it depends |
|---|---|
| ETL pipelines | Populate the 3 source tables; unchanged by the reform |
| `worker_supabase` | Owns the unified RPCs `get_anp_prices_*`; the 3 source tables; RLS + GRANTs |
| `worker_subgerente-app` | Owns NavBar entry + shared infra (`src/lib/rpc.ts` patterns, `exportSizeHeuristics`) |
| Designer | Fixed colours per fonte (`producer = #FF5000`, `distribution = #3F51B5`, `retail = #009688`), Arial typography, step-function pattern for monthly traces |
| `worker_dash-admin` | Module visibility (`module_visibility.anp-prices`) and home image upload |
| `worker_documentador` | Audits this sub-PRD against the code; updates `docs/master.md`, `README.md`, `docs/app/PRD.md` |

## Export (Tier 2 — unified library)

`/anp-prices` is one of the first dashboards plugged into the unified export library at [`src/lib/export/`](../../src/lib/export/). See the binding contract at [`docs/app/export-library-contract.md`](export-library-contract.md) for the architecture.

**Plug surface:** the desktop View renders `<ExportButton spec={anpPricesExport} />` inside `DashboardHeader.rightSlot`. The button opens the universal Tier 2 modal (size estimator + format toggle + Download). Mobile is excluded.

**Spec file:** [`src/lib/export/dashboards/anpPrices.ts`](../../src/lib/export/dashboards/anpPrices.ts).

| Field | Value |
|---|---|
| `filename` | `ANPPrices` (→ `ANPPrices_DD-MM-YY.xlsx` or `.zip`) |
| `tier` | `2` |
| `filterSource` | `modal-editable` |
| Excel sheets | 3 — Producer prices, Distribution prices, Retail prices LPC |
| CSV mode | `zip` (3 files, heterogeneous schemas) |
| Modal filters | Period (date-range, default last 6 months), Products (multi-select), States/UF (multi-select), Regions (multi-select) |
| Modal count RPC | `get_anp_prices_export_counts` (sums Producer + Distribution + Retail) |

**RPC wrappers added in [`src/lib/rpc.ts`](../../src/lib/rpc.ts):**
- `rpcGetAnpPricesExportCounts(supabase, filters)` → `{ producer, distribution, retail }` — feeds the modal SizeEstimator. Falls back to the existing single-count RPC if the new SECURITY DEFINER function is not yet deployed.
- `rpcGetAnpPricesExportProducer(supabase, filters)` → rows for the Producer sheet.
- `rpcGetAnpPricesExportDistribution(supabase, filters)` → rows for the Distribution sheet.
- `rpcGetAnpPricesExportRetail(supabase, filters)` → rows for the Retail (LPC) sheet.
- `loadAnpPricesProductOptions()` / `makeAnpPricesUfOptionsLoader` / `makeAnpPricesRegionOptionsLoader` → async loaders for the modal multi-selects.

**Backend RPCs (owner [`worker_supabase`](../supabase/PRD.md)):**
- `get_anp_prices_export_counts(p_produtos, p_granularidades, p_locais, p_data_inicio, p_data_fim)` → `(producer bigint, distribution bigint, retail bigint)` — `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp`, granted to `anon, authenticated`.
- `get_anp_prices_export_producer(...)` / `_distribution(...)` / `_retail(...)` (optional dedicated raw exports — until they ship, the JS wrappers fan out via the existing `get_anp_prices_serie`).

The pre-existing `get_anp_prices_export_count` (singular) is preserved during the migration window for safe rollback.

**Legacy export path retired here:**
- `<ExportPanel>` + `<ExportModal>` (`src/components/dashboard/`) no longer used by this View. They remain in place until every dashboard migrates — see contract § "Deprecation of the old library".
- `downloadGenericExcel` + `downloadCsv` (legacy `src/lib/exportExcel.ts`) replaced by the spec-driven `downloadExcel` + `downloadCsv` inside `src/lib/export/core/`.

**Filename pattern (unified):** `ANPPrices_DD-MM-YY.xlsx` (Excel) or `ANPPrices_DD-MM-YY.zip` (CSV zip).

## Anti-patterns

- Direct query against `anp_precos_produtores`, `anp_precos_distribuicao` or `anp_lpc` from the frontend — always via RPC.
- Hardcoding Y-axis unit — drive from `row.unidade`.
- Inventing colours for the 3 fontes — they are fixed.
- Multiplying / dividing GLP by 13 in the frontend — server-side already returns R$/13kg.
- Picking S10 vs S500 manually in the frontend for Diesel — server-side fallback handles it.
- Removing the missing-link banner when a trace is absent — must always explain.
- Filtering the full series client-side by period — use `p_data_inicio` / `p_data_fim` on the RPC.
- Refetch without debounce — 400ms via `useDebouncedFetch`.
- Resetting `yearRange` when product changes — slider is set once on mount.
- Editing the 3 retired Views in `docs/app/_deprecated/` — those are archived.

## Default state

On first load: `product = 'Diesel'`, `granularity = 'brasil'`, `locais = []`, `yearRange = last 5 years`. This is the window where all 3 supply-chain links coexist (`anp_precos_distribuicao` starts 2020-08) and shows the densest chart.
