# Sub-PRD — `/price-bands`

Dashboard de Price Bands (paridade de preços). Owner: [`worker_dash-price-bands`](../../.claude/agents/worker_dash-price-bands.md).

## Escopo de código

```
src/app/(dashboard)/price-bands/
  page.tsx                 ← viewport router (useIsMobile → desktop/mobile)
  usePriceBandsData.ts     ← single brain: RPC, filters, derived charts, current values
  desktop/View.tsx         ← sidebar layout, side-by-side charts (≥769px)
  mobile/View.tsx          ← MobileTopBar + MobileTabBar + chip strip + charts (≤768px)
```

RPC wrappers: seção "price_bands" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

## Produto

Visualização temporal de **paridade de preços** para Diesel e Gasolina:
- Paridade de **importação** calculada pelo BBA (com e sem subsídio para diesel)
- Paridade de **exportação**
- Preço **Petrobras** (refinaria)

Output típico: linhas temporais sobrepostas, por produto.

## RPC

`get_price_bands_data(p_product text DEFAULT NULL)` — retorna todas as linhas para um produto (ou todos), ordenadas por `date`.

## Tabela

`price_bands`:
- PK: `id`
- Chave de upsert: `(product, date)`
- Colunas:
  - `date DATE NOT NULL`
  - `product TEXT NOT NULL` ∈ {`Gasoline`, `Diesel`}
  - `bba_import_parity NUMERIC(10,4)` — IBBA pra Gasoline, BBA pra Diesel
  - `bba_import_parity_w_subsidy NUMERIC(10,4)` — Diesel only; auto-filled by trigger SQL (see below)
  - `bba_export_parity NUMERIC(10,4)`
  - `petrobras_price NUMERIC(10,4)`
  - `petrobras_price_w_subsidy NUMERIC(10,4)` — Diesel only; auto-filled by trigger SQL (see below)

## Tech debt

`price_bands` foi criada via [`sql/create_price_bands.sql`](../../sql/create_price_bands.sql) aplicado direto no Supabase Dashboard, **não em migration versionada**. Documentado em [PRD.md](PRD.md#tech-debt-sql-fora-das-migrations).

## Auto-filled subsidy columns (migration `20260527200000_subsidy_reform.sql`)

Both `bba_import_parity_w_subsidy` and `petrobras_price_w_subsidy` are **no longer entered manually** — they are auto-calculated server-side by PostgreSQL triggers applied as part of the subsidy reform (migration `20260527200000_subsidy_reform.sql`).

**Calculation logic:**
- `bba_import_parity_w_subsidy = bba_import_parity − reimbursement_importador`
- `petrobras_price_w_subsidy   = petrobras_price + reimbursement_produtor`
- `reimbursement = MIN(MAX(anp_reference_daily − anp_commercialization_period, 0), cap_agente)`
- Average of 5 regional reimbursements (Norte/Nordeste/Centro-Oeste/Sudeste/Sul).
- Caps from `anp_subsidy_caps` table; pre-2026-03-13 = no subsidy (NULL).

**Trigger chain:**
- `recompute_pb_on_reference_change` — fires on `anp_subsidy_diesel_reference` INSERT/UPDATE → updates `price_bands` for that date.
- `recompute_pb_on_comm_change` — fires on `anp_subsidy_commercialization` INSERT/UPDATE → updates `price_bands` for all dates in `[data_inicio, data_fim]`.
- `recompute_pb_on_caps_change` — fires on `anp_subsidy_caps` INSERT/UPDATE → updates all Diesel `price_bands` rows ≥ `vigente_desde`.
- `populate_pb_w_subsidy_on_insert` — fires BEFORE INSERT/UPDATE on `price_bands` (product='Diesel') → populates both `_w_subsidy` columns if data is available.

**User workflow change:** the admin form (Data Input → Price Bands) and the Excel upload script no longer accept `bba_import_parity_w_subsidy` / `petrobras_price_w_subsidy`. Users enter only: Date, Product, Import Parity (IPP), Export Parity (EPP), Petrobras Price. The subsidy adjustment is applied automatically and refreshed daily as ANP reference prices are updated by `etl_anp_subsidy_diesel.yml`.

## Como o dado chega

**Two paths — both use the same upsert conflict key `(product, date)` and are fully interchangeable.**

### UI path (preferred for small additions/edits)

Admins open `/admin-panel → Data Input → Price Bands` and add or update rows directly. The form POSTs via PostgREST upsert on `(product, date)`. No file required.

See [`docs/app/admin.md`](admin.md) for the full Data Input section spec.

### Bulk path (fallback for large imports)

```
CEO edits data/price_bands.xlsx → scripts/manual/price_bands_upload.py → upsert into price_bands
```

Run locally. **Data owner:** `worker_dados-locais`.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| Dados Locais | Excel manual + script de upload |
| Subgerente APP | Schema (legado em `sql/`, idealmente migrar) |
| Designer | Cores das séries (paridade vs Petrobras) |

## Dual-view structure (added 2026-05-20)

### Hook contract (`usePriceBandsData`)

Returns: `{ rows, loading, error, filters, setFilters, datas, xMin, xMax, gasolineRows, dieselRows, gasolineChart, dieselChart, gasolineYtd, dieselYtd, ytdYears, ytdYear, setYtdYear, currentValues, exportExcel, exportCsv, excelLoading, csvLoading, resetFilters }`.

Key derivations done in the hook (never in Views):
- `buildPriceBandsChart` — price bands multi-trace with end-of-line annotations + deconfliction
- `buildYtdChart` — cumulative YTD average + dotted year-end projection
- `buildCurrentValues` — Petrobras vs. IPP/EPP percentage badges per product
- `SUBSIDY_CUTOFF = "2026-03-12"` — subsidy lines visible only from this date

### Mobile specifics (v2 — mobile reform Onda 3, 2026-05-27)

Layout per plan § 4.4 (`o-modo-mobile-da-tranquil-giraffe.md`):

1. **MobileTopBar** — sticky wordmark (no filter trigger).
2. **MobileTabBar** (Diesel | Gasoline, Diesel default) — sticky below topbar.
3. **Period preset pills** (1M / 3M / 6M / 1Y / All, 6M default) — inline scroll row.
4. **Hero chart** — 3 simultaneous lines (Import / Export / Petrobras). Diesel shows the `bba_import_parity_w_subsidy` dashed line under the Import chip by default.
5. **Legend chips** — 3 colored chips below chart (Import / Export / Petrobras). Tap to hide/show each series (minimum 1 always visible).
6. **Petrobras Price Gap section** — stacked cards mirroring the badges shown above the desktop chart. One card per gap: Petrobras vs. IPP, Petrobras vs. EPP, and (Diesel only) Petrobras vs. IPP w/ sub. Each card shows the comparison label (top), the reference series name (subtitle), and the percentage gap (right, large). Sign coloring: positive = red (priced above reference), negative = green (priced below reference).
7. **MobileHomePill** — global floating home button (mobile reform v2).

**Removed vs v1:**
- YTD section (removed — focus on parity, not cumulative average on mobile).
- ExportFAB / export mini-menu (policy § 3.4 — no export on mobile).
- FilterDrawer (replaced by inline period chips; no other filter needed on mobile).
- MobileBottomTabBar (replaced by global MobileHomePill).

**Mobile vs Desktop divergence (`[mobile-only]`, 2026-05-28):** the v1 mobile "Comparison" table with `Latest | MoM | YoY` columns per series was replaced by the **Petrobras Price Gap** section described above. Rationale: the desktop view already exposes those gaps as colored badges directly above each chart (via `PctBadge`), which mobile cannot fit on a single line. The mobile view consolidates the same information into stacked cards. MoM/YoY data is not currently surfaced on mobile by design — users who need historical change tables consult the desktop view. The hook already exposed `currentValues.{Gasoline,Diesel}.pctVsIpp / pctVsEpp / pctVsIppSubsidy / pctPetroSubVsIppSub`, so no hook changes were required.

**End-of-line data labels on mobile chart (`[mobile-only]`, 2026-05-28):** the desktop view surfaces the latest R$ value of each series through the `PctBadge` row above each chart; mobile lacks that horizontal room. To preserve the "price-on-the-tip" information that briefly lived in a mobile comparison table, the mobile chart now renders a small annotation per visible series anchored to the last non-null point (`X.XX`, colored to match the trace).
- Implementation: Plotly annotations (Option A) — `xref:"x"`, `yref:"y"`, `xanchor:"left"`, `xshift: 6`, no arrow. Color matches the trace; white-with-alpha background for readability over gridlines.
- Label format: **bare number, no "R$" prefix** (e.g. `5.10`, not `R$ 5.10`). Currency context already lives on the Y-axis tickprefix; repeating it on every label clutters the chart, especially when 5 labels stack at the right edge.
- Stacking: helper `deconflictLabels` sorts labels by raw y and walks the list pushing any neighbour within `MIN_LABEL_DELTA` upward just enough to maintain separation. `MIN_LABEL_DELTA` is **computed dynamically** from the visible Y range and the empirical chart geometry: `MIN_LABEL_DELTA = (yMax − yMin) × 1.12 × (LABEL_HEIGHT_PX / PLOT_HEIGHT_PX)` where `LABEL_HEIGHT_PX=14` (annotation font) and `PLOT_HEIGHT_PX = 260 − 12 − 36 = 212` (chart height minus top/bottom margins). The 1.12 factor accounts for Plotly's automatic ~6 % Y-axis padding on each side. This makes the threshold scale with the chart's current zoom (1M / 3M / 6M / 1Y / All have wildly different Y spans) — a fixed R$ 0.18 threshold was too small at 1Y / All zooms where 1 cm in data space < 14 px on screen.
- X axis: `margin.r = 8` (minimal — plot area fills the full card width). Room for the end-of-line label text is created by extending `xaxis.range` exactly **45 days** past the last data point in the current period window. This keeps the plot area flush to the card edge while leaving a narrow date-space gutter where annotation text renders. Traces set `cliponaxis: false` defensively. The previous `margin.r = 70` approach allocated a large pixel gutter that appeared as dead white space (~30–40% of the card width at 426px), because the annotations use `xref:"x"` (data coordinates) and render inside the plot area, not in the margin.
- Mobile/desktop pattern summary: **mobile = end-of-line data labels on chart + Petrobras Price Gap cards below**; **desktop = `PctBadge` row above chart + MoM/YoY comparison table**. Both carry the same underlying information (`currentValues.*`).

**Color encoding (same as desktop):**
- Import chip → orange `#E8611A` (solid + dashed subsidy variant)
- Export chip → black `#1a1a1a`
- Petrobras chip → teal `#4ECDC4`

### Series colors (shared via `usePriceBandsData`)

| Constant | Color | Used for |
|---|---|---|
| `COLOR_IMPORT` | `#E8611A` orange | Import Parity (solid) + Import Parity w/ subsidy (dashed) |
| `COLOR_EXPORT` | `#1a1a1a` black  | Export Parity |
| `COLOR_PETRO`  | `#4ECDC4` teal   | Petrobras Price (solid) + Petrobras Price w/ subsidy (dashed) |

`DSL_SERIES` (Diesel) renders 5 traces: Import Parity, Import Parity w/ subsidy, Export Parity, Petrobras Price, **Petrobras Price w/ subsidy**. The last two are drawn from March 2026 onwards (SUBSIDY_CUTOFF). Both `_w_subsidy` traces are auto-filled by trigger and will show as gaps (NULL) for dates where `anp_subsidy_commercialization` has no data yet.

### Binding sync rule

Any filter, chart, or KPI change in one View must land in the other in the **same commit**, or the commit must declare `[desktop-only]` / `[mobile-only]` with explicit justification.

## Anti-padrões

- Editar `data/price_bands.xlsx` direto.
- Hard-codar `product` em inglês na UI — traduza pra "Gasolina" / "Diesel".
- Misturar séries com unidades diferentes sem tooltip claro.
- Chamar Supabase diretamente de `desktop/View.tsx` ou `mobile/View.tsx` — toda lógica de dados fica em `usePriceBandsData.ts`.
