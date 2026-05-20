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
  - `bba_import_parity_w_subsidy NUMERIC(10,4)` — só Diesel
  - `bba_export_parity NUMERIC(10,4)`
  - `petrobras_price NUMERIC(10,4)`
  - `petrobras_price_w_subsidy NUMERIC(10,4)` — reservado, não usado

## Tech debt

`price_bands` foi criada via [`sql/create_price_bands.sql`](../../sql/create_price_bands.sql) aplicado direto no Supabase Dashboard, **não em migration versionada**. Documentado em [PRD.md](PRD.md#tech-debt-sql-fora-das-migrations).

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
| `COLOR_IMPORT` | `#E8611A` orange | Import Parity |
| `COLOR_EXPORT` | `#1a1a1a` black | Export Parity |
| `COLOR_PETRO`  | `#4ECDC4` teal  | Petrobras Price |

### Binding sync rule

Any filter, chart, or KPI change in one View must land in the other in the **same commit**, or the commit must declare `[desktop-only]` / `[mobile-only]` with explicit justification.

## Anti-padrões

- Editar `data/price_bands.xlsx` direto.
- Hard-codar `product` em inglês na UI — traduza pra "Gasolina" / "Diesel".
- Misturar séries com unidades diferentes sem tooltip claro.
- Chamar Supabase diretamente de `desktop/View.tsx` ou `mobile/View.tsx` — toda lógica de dados fica em `usePriceBandsData.ts`.
