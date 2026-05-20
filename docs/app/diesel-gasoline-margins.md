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

Also exports week helpers (`parseWeek`, `weekToDateRange`, `weekLastDay`, `weekLastDayShort`, `compLabel`) and constants (`STACK_COLORS`, `ANNOT_COLORS`, `MARGIN_LINE_COLORS`, `STACK_COMPONENTS`, `TABLE_KEYS`) so Views share the same logic and palette.

### Desktop View — `desktop/View.tsx`

Verbatim migration of the previous `page.tsx` body. Layout:
- Sidebar with `WeekSlider` + `WeekPeriodBadge`
- Distribution & Resale Margin comparison line chart (both fuels)
- Weekly variations tables (WoW, −4 Weeks, QTD, YoY) — Diesel B + Gasoline C side-by-side
- Stacked area charts (Diesel B + Gasoline C price composition)
- `ExportPanel` (Tier 1 — Excel + CSV direct download)

### Mobile View — `mobile/View.tsx`

Chart-heavy archetype (matches `mockups/market-share-mobile.html`). Layout:
- `MobileTopBar` with title + `FilterChip` (period label → opens drawer)
- `FuelToggle` segmented control (Diesel B / Gasoline C)
- Latest week badge
- `MobileChart` stacked area (selected fuel only — full-width, height 260)
- `MobileDataCard` breakdown list (one card per margin component, value + % of total)
- `ExportFAB` with expand-on-tap menu (Excel + CSV options) — Tier 1 direct

Filter drawer (`FilterDrawer` + `DrawerWeekSlider`):
- Shows week-range slider with year marks
- Draft-then-apply pattern (changes only committed on "Apply")

### Divergences

| Aspect | Desktop | Mobile |
|---|---|---|
| Fuel selection | Both fuels shown simultaneously | One fuel at a time via FuelToggle |
| Variations table | Full WoW/−4W/QTD/YoY table | [mobile-only] omitted — too wide for phone; breakdown cards replace it |
| Export trigger | `ExportPanel` inline in header | `ExportFAB` + expand menu |
| Period label | `WeekPeriodBadge` in sidebar | `FilterChip` in top bar → `FilterDrawer` |

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

Tier 1 — download direto via `<ExportPanel>` (ver [`docs/app/PRD.md`](PRD.md) → "Export padronizado").

- Excel: `downloadDgMarginsExcel` (handler dedicado pré-existente em [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts)) — workbook single-sheet com título brand orange, header preto, dados Arial 10.
- CSV: `downloadCsv<T>` em [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts) — adicionado nesta rodada (RFC4180, UTF-8).
- Filename pattern: `DieselGasolineMargins_DD-MM-YY.<xlsx|csv>`.
- Dados exportados: linhas atualmente em estado da página (saída de `get_dg_margins_data` aplicada com filtros de fuel_type e período de semanas).
