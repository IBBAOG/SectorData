# Sub-PRD — `/diesel-gasoline-margins`

Dashboard de Margens Diesel/Gasolina. Owner: [`worker_dash-margins`](../../.claude/agents/worker_dash-margins.md).

## Escopo de código

```
src/app/(dashboard)/diesel-gasoline-margins/
  page.tsx
```

RPC wrappers: seção "d_g_margins" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

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
