# Sub-PRD — `/diesel-gasoline-margins`

Dashboard de Margens Diesel/Gasolina. Owner: [`worker_dash-margins`](../../.claude/agents/worker_dash-margins.md).

## Escopo de código

```
src/app/(dashboard)/diesel-gasoline-margins/
  page.tsx                           ← viewport router (useIsMobile)
  useDieselGasolineMarginsData.ts    ← single brain hook
  desktop/View.tsx                   ← desktop UX (sidebar + charts)
  mobile/View.tsx                    ← mobile UX (MobileTopBar + stacked chart + cards)
```

RPC wrappers: seção "d_g_margins" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

## Dual-view structure

Dashboard follows the canonical dual-view pattern from `docs/app/dual-view-pattern.md` (Phase 2 / Wave 2).

### Hook — `useDieselGasolineMarginsData.ts`

Single source of truth for both Views. Exports:

| Export | Type | Purpose |
|---|---|---|
| `allRows` | `DgMarginsRow[]` | Full unfiltered data (needed by VariationsTable for YoY/QTD) |
| `filteredRows` | `DgMarginsRow[]` | Rows matching current week-range |
| `weeks` | `string[]` | Ordered week strings from `get_dg_margins_filters` |
| `weekRange` | `[number, number]` | Index pair into `weeks` |
| `setWeekRange` | setter | Updates week-range filter |
| `visibleWeeks` | `string[]` | `weeks.slice(weekRange[0], weekRange[1]+1)` |
| `latestVisibleWeek` | `string \| null` | Last element of visibleWeeks |
| `loading / error` | — | Fetch state |
| `excelLoading / setExcelLoading` | — | Excel export busy state (shared) |

Also exports week helpers (`parseWeek`, `weekToDateRange`, `weekLastDay`, `weekLastDayShort`, `weekLastDayFormatted`, `compLabel`) and constants (`STACK_COLORS`, `ANNOT_COLORS`, `MARGIN_LINE_COLORS`, `STACK_COMPONENTS`, `TABLE_KEYS`) so Views share the same logic and palette.

`weekLastDayFormatted` produces `dd-mmm-yy` labels (e.g. `09-Jan-21`, `02-May-26`, en-US month abbreviation). Used exclusively for chart x-axis tick values. `weekLastDay` / `weekLastDayShort` remain for non-chart UI (badges, slider tooltips, table headers).

### Desktop View — `desktop/View.tsx`

Verbatim migration of the previous `page.tsx` body. Layout:
- Sidebar with `WeekSlider` + `WeekPeriodBadge`
- Distribution & Resale Margin comparison line chart (both fuels)
- Weekly variations tables (WoW, −4 Weeks, QTD, YoY) — Diesel B + Gasoline C side-by-side
- Stacked area charts (Diesel B + Gasoline C price composition)
- `<ExportButton spec={dgMarginsExport} />` (unified library — Tier 1, 2 sheets, no filters; see Export section below)

### Mobile View — `mobile/View.tsx`

Wave 3 reform (2026-05-27) — full desktop content parity, re-layout mobile-first. Layout:
- **Sticky sub-bar**: `FuelTab` segmented control (Diesel B / Gasoline C) + `FilterChip` (period → opens drawer). Sits below the global `MobileTopBar` rendered by `MobileLayout`.
- Latest week badge
- `MobileChart` stacked area (selected fuel only — full-width, height 260) — all 5 components
- **Comparison table** (`ComparisonTable`): WoW / −4 Wks / QTD / YoY deltas for all components, color-coded cells, horizontal scroll with first column sticky.
- **No ExportFAB** (§ 3.4 mobile reform policy — export disabled on mobile).

> **[mobile-only] 2026-05-28:** KPI delta block ("Current Week vs Prior Week" horizontal-scroll cards) removed. Mobile layout now shows only the stacked area chart + comparison table below the sticky sub-bar.

Filter drawer (`FilterDrawer` + `DrawerWeekSlider`):
- Week-range slider with year marks
- Draft-then-apply pattern (changes only committed on "Apply")

### Divergences

| Aspect | Desktop | Mobile |
|---|---|---|
| Fuel selection | Both fuels shown simultaneously | One fuel at a time via `FuelTab` |
| Variations table | Full WoW/−4W/QTD/YoY table | Same data — `ComparisonTable` with horizontal scroll |
| KPI delta block | N/A (inline in table) | Removed (2026-05-28) — WoW delta visible via Variation Table |
| Export trigger | `ExportPanel` inline in header | None (§ 3.4 policy) |
| Period label | `WeekPeriodBadge` in sidebar | `FilterChip` in sticky sub-bar → `FilterDrawer` |

## Produto

Visualização semanal da **decomposição da margem** de venda de Diesel e Gasolina:
- `base_fuel`
- `biofuel_component`
- `federal_tax`
- `state_tax`
- `distribution_and_resale_margin`
- `total` (soma dos componentes)

Visualização típica: **stacked bar/area chart** ao longo de semanas, com filtros por tipo de combustível.

## RPCs

| RPC | Função |
|---|---|
| `get_dg_margins_data` | Linhas (filtráveis) |
| `get_dg_margins_filters` | Opções de filtros |

## Tabela

`d_g_margins`:
- PK: `id`
- Chave de upsert: `(fuel_type, week)`
- Colunas: `fuel_type, week, base_fuel, biofuel_component, federal_tax, state_tax, distribution_and_resale_margin, total`

## Como o dado chega

**Two paths — both use the same upsert conflict key `(fuel_type, week)` and are fully interchangeable.**

### UI path (preferred for small additions/edits)

Admins open `/admin-panel → Data Input → D&G Margins` and add or update rows directly. The form POSTs via PostgREST upsert on `(fuel_type, week)`. No file required.

See [`docs/app/admin.md`](admin.md) for the full Data Input section spec.

### Bulk path (fallback for large imports)

```
CEO edits data/d_g_margins.xlsx → scripts/manual/dg_margins_upload.py → upsert into d_g_margins
```

GitHub Action: `.github/workflows/manual_dg_margins.yml` runs weekly (Monday).

**Data owner:** `worker_dados-locais` (not an automated ETL). This dashboard is read-only.

## Palette

| Constant | Key | Color | Used in |
|---|---|---|---|
| `MARGIN_LINE_COLORS` | `"Diesel B"` | `#FF5000` (brand orange) | Dist. & Resale Margin line chart |
| `MARGIN_LINE_COLORS` | `"Gasoline C"` | `#1a1a1a` (black) | Dist. & Resale Margin line chart |
| `STACK_COLORS` | `distribution_and_resale_margin` | `#FF5000` | Stacked area charts (both fuels) |

Both views share `MARGIN_LINE_COLORS` via the hook — no per-view color override exists.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| Dados Locais | Excel manual + script de upload |
| Subgerente APP | Schema/migration de `d_g_margins` |
| Designer | Stacked chart pattern, cores dos componentes |

## Filtros tipicamente usados (UI)

- `fuel_type` (Diesel, Gasolina) — geralmente como tabs ou toggle.
- Período (slider de semanas).

## Anti-padrões

- Tentar editar `data/d_g_margins.xlsx` direto — é manual do CEO.
- Inferir colunas a partir do Excel — sempre cruze com o schema da tabela.
- Mostrar `fuel_type` em inglês na UI — traduza pra "Diesel" / "Gasolina".

## Export

Tier 1 — download direto via `<ExportButton spec={dgMarginsExport} />` na unified library (ver [`docs/app/export-library-contract.md`](export-library-contract.md)).

- **Spec file:** [`src/lib/export/dashboards/dgMargins.ts`](../../src/lib/export/dashboards/dgMargins.ts) (owner `worker_dash-margins`).
- **`filename`:** `"DGMargins"` → `DGMargins_DD-MM-YY.<xlsx|csv>`.
- **`tier`:** 1 (no modal — two buttons, direct download).
- **`filterSource`:** `"none"` — sempre exporta histórico completo, ambos os fuel types, sem filtros aplicados (decidido pelo CTO).
- **Excel:** 2 sheets — `Diesel B` e `Gasoline C`. Colunas por sheet (mesma ordem, headers per-fuel override no biofuel e base_fuel):

  | key | Diesel B header | Gasoline C header | numFmt |
  |---|---|---|---|
  | `week` | Week | Week | (text) |
  | `distribution_and_resale_margin` | Distribution & Resale Margin | Distribution & Resale Margin | `0.00` |
  | `state_tax` | State Tax | State Tax | `0.00` |
  | `federal_tax` | Federal Tax | Federal Tax | `0.00` |
  | `biofuel_component` | **Biodiesel** | **Anhydrous Ethanol** | `0.00` |
  | `base_fuel` | **Diesel A** | **Gasoline A** | `0.00` |
  | `total` | Total | Total | `0.00` |

  Per-sheet `rowsAsync` chama `rpcGetDgMarginsData(fuel_type)` — uma chamada por sheet, sem filtros.
- **CSV:** `mode: "single-with-discriminator"`, `discriminatorColumn: "fuel_type"`. Um único `.csv` com a coluna `fuel_type` distinguindo Diesel B e Gasoline C (valores idênticos aos da coluna do banco).
- **Charts (Excel):** nenhum (stacked bar descartado pelo CTO — só dados tabulares).
- **Mobile:** export desabilitado por política da reforma mobile v2 (§ 3.4) — `ExportButton` retorna `null` em `useIsMobile()`.
