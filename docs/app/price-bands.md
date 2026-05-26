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

### Mobile specifics

- **Product switch**: `MobileTabBar` (Diesel | Gasolina). Diesel is the default.
- **Date chips**: 3 M / 6 M / 1 Y / 2 Y / All shortcut strip. Syncs with `filters.sliderRange`.
- **FilterDrawer**: `PeriodSlider` + subsidy-line toggle (Diesel only). Toggle hides `bba_import_parity_w_subsidy` from chart.
- **MobileChart**: single product at a time. Legend below chart.
- **MobileDataCard rows**: latest value per band with % vs reference.
- **YTD section**: same chart pattern, year pills (current / -1 / -2).
- **ExportFAB**: tapping opens an inline mini-menu (Excel | CSV).

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
