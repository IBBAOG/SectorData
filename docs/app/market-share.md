# Sub-PRD — `/market-share`

Dashboard de Market Share (% de participação). Owner: [`worker_dash-market-share`](../../.claude/agents/worker_dash-market-share.md).

## Dual-view structure (added 2026-05-20)

Follows the canonical dual-view pattern (`docs/app/dual-view-pattern.md`). Shared hook is the single brain; both Views are pure presentation layers.

```
src/app/(dashboard)/market-share/
  page.tsx                     ← viewport router (useIsMobile)
  useMarketShareData.ts        ← THE BRAIN — RPCs, filters, derivations, types
  desktop/
    View.tsx                   ← desktop UX (sidebar + multi-column grid + ExportModal)
  mobile/
    View.tsx                   ← mobile UX (MobileTopBar + chips + hero chart + TopPlayers + FAB)
```

### Analyses preserved in both Views

| Analysis | Desktop | Mobile |
|---|---|---|
| 13 product×segment charts (Diesel B Retail/B2B/TRR/Total, Gasoline C Retail/B2B/Total, Ethanol Retail/B2B/Total, Otto-Cycle Retail/B2B/Total) | Full (all 13 rendered as a 2-column grid) | Overview tab — product `MobileTabBar` (container, 4 products) + segment `MobileTabBar` (underline, Total/Retail/B2B/TRR; TRR only for Diesel B) navigates the same 13 chart variants, one at a time |
| Comparison table (MoM/QTD/YoY/YTD p.p. delta) | Yes (inline table under each chart) | Compare tab — pick up to 3 distributors; shows side-by-side MoM/QTD/YoY/YTD cards for the SAME `(product, segment)` selected on Overview |
| Top players ranking with MoM delta | Implicit via chart | MobileDataCard rows; the top-5 list reflects the currently selected product |
| Export (Tier 2 ExportModal) | Yes | Yes (via ExportFAB) |
| Period / Region / UF / Mode / Competitors filters | Yes (sidebar) | Yes (FilterDrawer bottom sheet) |

### Hook export contract

`useMarketShareData()` returns the full surface consumed by both views:
- `serieRows`, `ottoCycleRows`, `seriesLoading`, `seriesError`
- `opcoes`, `datas`, `regioesAll`, `ufsAll`, `mercadosAll`
- Filter state + setters: `mode`, `sliderRange`, `regioesSelected`, `ufsSelected`, `competidoresSelected`
- `applyFilters()`, `clearFilters()`
- Derived: `charts` (all 13), `compData`, `topPlayers`, `chartColors`, `players`, `big3`, `latestDate`
- Mobile chart-selector state (additive, used by `mobile/View.tsx` only):
  - `selectedProduct: ProductKey` + `setSelectedProduct(p)`
  - `selectedSegment: SegmentKey` + `setSelectedSegment(s)` (auto-falls-back to `Total` when the segment doesn't exist for the chosen product, e.g. TRR + Gasolina C)
  - `selectedChartKey: ChartKey` — derived index into `charts` / `compData`
  - `activeChart: ChartResult | null` — the selected chart variant
  - `activeCompRows: CompRow[]` — comparison rows for the selected variant (fuels mobile Compare tab)
  - `topPlayersForSelected: TopPlayerRow[]` — top-5 ranking for the SELECTED product (so the mobile overview reflects the picker)
- Mobile Compare-set state (additive):
  - `compareSet: string[]` — players currently picked for side-by-side (capped at 3)
  - `setCompareSet(players)` / `toggleCompareMember(player)`
  - On first load with non-empty data, `compareSet` is seeded with the top-3 players from `topPlayers`
- Export state + handlers: `exportOpen`, `openExportModal`, `closeExportModal`, `exportFilters`, `exportSizeEstimate`

Constants also exported from the hook file (consumed by `mobile/View.tsx`):
- `PRODUCT_KEYS: ProductKey[]` — `["Diesel B", "Gasolina C", "Etanol Hidratado", "Otto-Cycle"]`
- `PRODUCT_LABEL: Record<ProductKey, string>` — English display labels (`"Gasolina C" → "Gasoline C"`, `"Etanol Hidratado" → "Hydrous Ethanol"`)
- `SEGMENTS_BY_PRODUCT: Record<ProductKey, SegmentKey[]>` — drives the segment selector (TRR only for Diesel B)
- `CHART_KEY_MATRIX: Record<ProductKey, Partial<Record<SegmentKey, ChartKey>>>` — `(product, segment) → key in MarketShareCharts`

Pure helpers also exported from the hook file:
- `buildMarketShareLine` — builds a single Plotly line chart
- `buildMobileStackedArea` — builds stacked-area traces for the mobile hero chart
- `buildComparisonData` — builds the MoM/QTD/YoY/YTD comparison rows
- `makeOttoCycleRows` — synthesises Otto-Cycle = Gasolina C + Etanol × 0.7

### Shared-RPC coordination note

`get_ms_serie_fast`, `get_ms_serie_others`, `get_others_players` are also consumed by
`/sales-volumes`. Any signature change requires coordination with `worker_dash-sales-volumes`.
Both dashboards import from the same wrappers in `src/lib/rpc.ts` (Market Share section).

## Escopo de código

```
src/app/(dashboard)/market-share/
  page.tsx                     (viewport router)
  useMarketShareData.ts        (hook / brain)
  desktop/View.tsx             (desktop UX)
  mobile/View.tsx              (mobile UX)
```

RPC wrappers: seção "market-share" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

## Produto

Visualização de **% de participação de mercado** entre players de combustíveis, ao longo do tempo. Filtros idênticos ao sales-volumes (período, região, UF, mercado, agentes), mas a narrativa é distinta:
- Não importa o **valor absoluto** — importa **share relativo**.
- "Outros" é tratado como agregado (soma dos pequenos players para não poluir o gráfico).

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_ms_opcoes_filtros` | próprio | Opções de filtros |
| `get_ms_serie_fast` | **compartilhado com sales-volumes** | Série mensal |
| `get_ms_serie_others` | **compartilhado** | Soma de "Outros" |
| `get_others_players` | **compartilhado** | Lista de players em "Outros" |

> **Coordenação obrigatória:** mudança nas 3 RPCs compartilhadas exige alinhamento com `worker_dash-sales-volumes`.

## Tabelas / Views

- `vendas`
- `mv_ms_serie_fast`

## Por que existe separado de `/sales-volumes`?

Ambos consomem mesmas RPCs, mas:
- **Sales Volumes**: eixo Y = volume absoluto (toneladas/m³), narrativa de "quanto cada um vendeu".
- **Market Share**: eixo Y = % do total, narrativa de "quem ganhou/perdeu mercado".
- Mesmo backend, **frontends distintos**. Manter separado permite evolução independente da apresentação.

## Filtros disponíveis (UI)

Idênticos ao sales-volumes. Padronização intencional.

## Dependências cross-dept

Idênticas ao sales-volumes (ETL/`vendas_watch` → `vendas` → MV).

## Anti-padrões

- Calcular % no cliente quando o backend já retorna agregado.
- Misturar metáfora "absoluto" com "share" no mesmo gráfico.
- Mudar `get_ms_*` sem coordenar.

## Export

Tier 2 — `<ExportPanel mode="modal">` abre `<ExportModal>` com filtros + calculadora live de tamanho (ver [`docs/app/PRD.md`](PRD.md) → "Export padronizado").

- RPC count: `get_ms_export_count` (`p_data_inicio`, `p_data_fim`, `p_regioes`, `p_ufs`, `p_mercados`) → `bigint`, em `supabase/migrations/20260507000003_export_count_rpcs.sql`.
- JS wrapper: `getMsExportCount` em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).
- datasetKey heuristic: `vendas` (ver [`src/lib/exportSizeHeuristics.ts`](../../src/lib/exportSizeHeuristics.ts) → `AVG_BYTES_PER_ROW.vendas`).
- Filtros expostos no modal: período (slider de meses), regiões, UFs, mercados/segmentos.
- Excel handler: `downloadMarketShareExcel` em [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts) — workbook single-sheet com título brand orange, header preto, dados Arial 10.
- CSV handler: paginated fetch via `fetchVendasFiltered` (helper em `src/lib/rpc.ts`) + `downloadCsv` em [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts) (RFC4180, UTF-8).
- Filename pattern: `MarketShare_DD-MM-YY.<xlsx|csv>`.
- Warning visual quando estimativa > 200 000 linhas.
- Compartilha o `get_ms_export_count` com `/sales-volumes` — qualquer mudança de assinatura exige coordenação com `worker_dash-sales-volumes`.
