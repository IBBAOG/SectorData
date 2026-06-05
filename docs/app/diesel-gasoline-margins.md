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
| `get_dg_margins_data` | Linhas (filtráveis) — read-only, consumida pela UI |
| `get_dg_margins_filters` | Opções de filtros |
| `recompute_dg_margins(p_week_start text, p_week_end text)` | **Recompute job** — `SECURITY DEFINER`, `EXECUTE` only `service_role`. Recalcula `d_g_margins` para o range de semanas ISO informado a partir das tabelas-fonte (preços, produção, ethanol, impostos, blend). Chamada pelo workflow `etl_dg_margins.yml`. Não callable pelo anon/authenticated. |

## Tabela

`d_g_margins`:
- PK: `id`
- Chave de upsert: `(fuel_type, week)`
- Colunas: `fuel_type, week, base_fuel, biofuel_component, federal_tax, state_tax, distribution_and_resale_margin, total`
- 566 rows (cutover state). O arquivo manual antigo está arquivado em `d_g_margins_manual_bak`.

### Reference / source tables (lidas pelo `recompute_dg_margins`)

| Tabela | Conteúdo | Origem |
|---|---|---|
| `cepea_etanol_anidro` | Preço semanal R$/L do etanol anidro | CEPEA/ESALQ |
| `anp_producao_derivados` | Produção mensal nacional (m³) de Gasolina A / Óleo Diesel | ANP |
| `fuel_tax_reference` | Imposto federal + ICMS (R$/L) por período | ANP Síntese de Preços (federal) + CONFAZ (ICMS ad-rem) |
| `fuel_blend_ratio` | % de mandato de etanol / biodiesel por período | ANP / regulação |
| `price_bands` | Paridade de importação + preço Petrobras | Dados Locais (`price_bands`) |
| `anp_lpc` | Preço de bomba (station-weighted national avg) | ANP LPC |
| `anp_desembaracos` / `mdic_comex` | Volume de importação (kg→m³ via densidade NCM) | ANP / MDIC |

## Como o dado chega

**Fully automated (computed) since 2026-06-05.** A tabela `d_g_margins` deixou de ser preenchida manualmente (Excel + admin Data Input) e passou a ser **calculada** por um job SQL a partir de fontes públicas.

### Pipeline

```
etl_dg_margins.yml (weekly Tue 15:00 UTC + workflow_dispatch)
  ├─ scripts/pipelines/cepea/cepea_etanol_anidro_sync.py    → cepea_etanol_anidro
  ├─ scripts/pipelines/anp/producao/anp_producao_derivados_sync.py → anp_producao_derivados
  └─ recompute_dg_margins(week_start, week_end)             → d_g_margins (upsert por (fuel_type, week))
```

### Fórmula de decomposição (R$/L, por semana ISO)

Cada componente é em R$/L; `total` reconstrói o preço de bomba.

| Componente | Cálculo |
|---|---|
| `base_fuel` | `(import_parity × import% + petrobras_price × production%) × (1 − blend)`. `import_parity`/`petrobras_price` vêm de `price_bands`. |
| `biofuel_component` | **Gasolina:** etanol anidro (lag de 1 semana, `week−1`) × `ethanol_blend`. **Diesel:** Biodiesel B-100 (mesma semana) × `biodiesel_blend`. |
| `federal_tax` | de `fuel_tax_reference` (ANP Síntese de Preços). |
| `state_tax` | ICMS de `fuel_tax_reference` (CONFAZ ad-rem). |
| `distribution_and_resale_margin` | **residual** = `pump − (todos os componentes acima)`. |
| `total` | = preço de bomba = `anp_lpc` station-weighted national avg (`'GASOLINA COMUM'` / `'DIESEL S10'`). |

- **`import%`** = `imports / (imports + production)`, onde `imports` vem de `anp_desembaracos`/`mdic_comex` (kg→m³ via densidade NCM) e `production` de `anp_producao_derivados`. `production% = 1 − import%`.

### Fontes (exibidas no dashboard)

"Sources: ANP · CEPEA/ESALQ · CONFAZ".

- **ANP** — produção de derivados, preços LPC/produtor, Síntese de Preços (composição de impostos federais).
- **CEPEA/ESALQ** — preço do etanol anidro (licença **CC BY-NC, atribuição obrigatória**).
- **CONFAZ** — ICMS ad-rem.
- **`price_bands`** — paridade de importação / preço Petrobras.

### Escopo do cutover

| Janela | Origem |
|---|---|
| Era ad-rem ICMS (Gasolina a partir de Jun/2023; Diesel a partir de Mai/2023) | **Computado** via `recompute_dg_margins`. |
| Pré-ad-rem (2021 → meados de 2023, era ICMS ad-valorem) | **Preservado** da série manual original. |

A série manual completa fica arquivada em `d_g_margins_manual_bak`.

**Data owner:** `worker_etl-pipelines` (automated ETL). Este dashboard é read-only.

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
| ETL / Pipelines | `etl_dg_margins.yml` + 2 scrapers (CEPEA, ANP produção) + chamada `recompute_dg_margins` |
| Supabase / DB | Schema/migration de `d_g_margins` + 4 tabelas de referência + RPC `recompute_dg_margins` (grant `service_role`) |
| Dados Locais | `price_bands` (paridade / Petrobras) é input do cálculo |
| Designer | Stacked chart pattern, cores dos componentes |

## Filtros tipicamente usados (UI)

- `fuel_type` (Diesel, Gasolina) — geralmente como tabs ou toggle.
- Período (slider de semanas).

## Anti-padrões

- Tentar reativar o upload manual (`scripts/manual/dg_margins_upload.py`) ou o editor admin Data Input — ambos foram **retirados** na reforma de automação. A tabela agora é computada.
- Sobrescrever as semanas pré-ad-rem (2021→meados de 2023) com o recompute — elas são preservadas da série manual.
- Esquecer a atribuição CEPEA/ESALQ (CC BY-NC) ao exibir o componente de etanol anidro.
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
