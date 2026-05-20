# Sub-PRD — `/sales-volumes`

Dashboard de Volumes de Venda. Owner: [`worker_dash-sales-volumes`](../../.claude/agents/worker_dash-sales-volumes.md).

## Escopo de código

```
src/app/(dashboard)/sales-volumes/
  page.tsx
```

RPC wrappers: seção "sales-volumes" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

## Produto

Visualização de **volume absoluto** de combustíveis por agente regulado, ao longo do tempo, filtrável por:
- Período (slider)
- Região / UF de destino
- Mercado / segmento
- Agente regulado (multi-select)

Output principal: gráfico de linhas / barras com séries por agente. Tabela com totais. Export Excel.

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_sv_opcoes_filtros` | próprio | Retorna opções de filtros (datas, regiões, UFs, mercados) |
| `get_sv_serie_fast` | próprio | Série mensal pré-agregada via `mv_ms_serie` (agregada por classificacao) |
| `get_sv_serie_others` | próprio | Série por `agente_regulado` para players não-Big3 |
| `get_sv_others_players` | próprio | Lista de agentes não-Big3 para dropdown (~50 rows) |

Wrappers em `src/lib/rpc.ts`: `rpcGetSvOpcoesFiltros`, `rpcGetSvSerieFast`, `rpcGetSvSerieOthers`, `rpcGetSvOthersPlayers`.

> **Nota histórica:** a migration `20260402000000_sales_volumes.sql` falhou silenciosamente (funções não foram criadas). A migration `20260505000006_restore_sv_rpcs.sql` restaurou as 4 funções. O `page.tsx` estava usando as RPCs compartilhadas de market-share (`get_ms_*`) — corrigido para usar as próprias `get_sv_*`.

## Tabelas / Views

- `vendas` — granular (não usar em consultas grandes; preferir mv).
- `mv_ms_serie_fast` — materialized view pré-agregada por mês, refresh via função SQL `classificar_agentes()`.

## Filtros disponíveis (UI)

- `PeriodSlider` (rc-slider, range de meses).
- `RegionStateFilter` (cascata Região → UF).
- `CheckList` para mercados/segmentos.
- `SearchableMultiSelect` para agentes regulados.

## Componentes consumidos

- `PlotlyChart` (gráfico).
- `exportExcel` (tabela → xlsx).

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| ETL (`vendas_watch`) | Popula `vendas` periodicamente |
| Subgerente APP | Migration de `vendas` e RPCs base |
| Designer | Identidade visual de séries, cores, tooltip |
| dash-market-share | RPCs compartilhadas |

## Performance

- **`vendas`** tem volume grande. Sempre usar `mv_ms_serie_fast` para agregações mensais.
- **Refresh do MV**: função `classificar_agentes()` é chamada após upload em `vendas`.
- **Filtros do lado do servidor** (RPC) — não tente filtrar em memória depois.

## Anti-padrões

- Query direta em `vendas` para visualizações temporais. Use o MV.
- Modificar `get_ms_*` sem avisar `worker_dash-market-share`.
- Plotly importado direto (use `PlotlyChart`).

## Dual-view structure (Fase 2 — 2026-05)

`/sales-volumes` implements the canonical dual-view pattern. See [`CLAUDE.md` § Dual-view policy](../../CLAUDE.md) and [`docs/app/dual-view-pattern.md`](dual-view-pattern.md) for the cross-dashboard template.

### 4-file layout

```
src/app/(dashboard)/sales-volumes/
├── page.tsx                 ← viewport router (useIsMobile → DesktopView | MobileView)
├── useSalesVolumesData.ts   ← SINGLE brain: RPCs, filters, derivations, types
├── desktop/View.tsx         ← desktop UX (sidebar + multi-column grid + ComparisonTable)
└── mobile/View.tsx          ← mobile UX (MobileTopBar + product tabs + chart/ranking toggle)
```

`page.tsx` is SSR-safe: renders `DesktopView` during server/first-paint, flips to `MobileView` after hydration if `useIsMobile()` returns true (no hydration mismatch).

### Hook contract — `useSalesVolumesData`

`useSalesVolumesData()` is the only place that calls Supabase. Both Views import and destructure it; neither View imports `rpc.ts` directly.

**Returns (abridged):**

| Field | Type | Description |
|---|---|---|
| `serieRows` | `MsSerieRow[]` | Raw series from fast or others RPC |
| `ottoCycleRows` | `MsSerieRow[]` | Derived rows: Gasolina C + (Etanol × 0.7) |
| `players` | `string[]` | Active player list for current mode |
| `chartColors` | `Record<string,string>` | Color map for active mode + players |
| `groupBy` | `"classificacao" \| "agente_regulado"` | Driven by `mode` |
| `big3` | `boolean` | True when mode === "Big-3" |
| `latestDate` | `string \| null` | ISO date of last data point |
| `regioesAll`, `ufsAll`, `mercadosAll` | `string[]` | Filter option lists from `get_sv_opcoes_filtros` |
| `sliderRange`, `mode`, `competidoresSelected`, `regioesSelected`, `ufsSelected` | staged filter state | Consumed by both filter UIs |
| `appliedFilters` | `Partial<SalesVolumesFilters>` | Applied on `applyFilters()` |
| `applyFilters`, `clearFilters` | `() => void` | Actions |
| `exportOpen`, `openExportModal`, `closeExportModal` | export modal state | Shared between both Views |
| `exportRange`, `exportRegioes`, `exportUfs`, `exportMercados`, `exportFilters` | export-modal filter state | Independent from chart filters |
| `fetchExportCount` | `() => Promise<number>` | Calls `getMsExportCount` for modal size calculator |
| `onExportExcel`, `onExportCsv` | `() => Promise<void>` | Export handlers |
| `excelLoading`, `csvLoading` | `boolean` | Loading state for buttons |
| `showToast` | `boolean` | Desktop-only success toast (2.5 s) |

**Helper exports** (used by both Views):

| Export | Purpose |
|---|---|
| `makeOttoCycleRows(rows)` | Derives Otto-Cycle series from Gasolina C + Etanol Hidratado |
| `computeTopPlayers(rows, produto, segmento, latestDate, big3, groupBy)` | Ranking cards in mobile Ranking tab |
| `BIG3_MEMBERS`, `COLORS_IND`, `COLORS_BIG3`, `ALL_PLAYERS_IND`, `ALL_PLAYERS_BIG3` | Constants shared by both Views |
| `SvMode`, `SV_MODE_OPTIONS`, `SalesVolumesFilters`, `UseSalesVolumesData` | Types |

### RPC ownership and shared-RPC coordination

| RPC | Wrapper | Ownership | Notes |
|---|---|---|---|
| `get_sv_opcoes_filtros` | `rpcGetSvOpcoesFiltros` | own | Returns filter options (datas, regiões, UFs, mercados) |
| `get_sv_serie_fast` | `rpcGetSvSerieFast` | own | Reads `mv_ms_serie_fast`; used for Individual + Big-3 modes |
| `get_sv_serie_others` | `rpcGetSvSerieOthers` | own | Reads `vendas` via aggregation; used for Others mode |
| `get_sv_others_players` | `rpcGetSvOthersPlayers` | own | Pre-fetches Others player list (~50 rows) |
| `get_ms_export_count` | `getMsExportCount` | **shared with `/market-share`** | Row count for ExportModal size calculator — changes require coordination with `worker_dash-market-share` |
| `fetchVendasFiltered` | `fetchVendasFiltered` | **shared with `/market-share`** | Paginated SELECT on `vendas` for CSV export |

> **Pegadinha #5** (from `CLAUDE.md`): `/sales-volumes` uses `get_sv_*` for series data. Both `/sales-volumes` and `/market-share` share `get_ms_export_count` and `fetchVendasFiltered`. Do not conflate the two families.

### Mobile components (`src/components/dashboard/mobile/`)

`mobile/View.tsx` imports from the barrel `src/components/dashboard/mobile`:

| Component | Role in this view |
|---|---|
| `MobileTopBar` | Sticky top bar with SectorData brand title |
| `MobileBottomTabBar` | Bottom navigation: Chart / Ranking / Filters |
| `FilterDrawer` | BottomSheet with Period, View Mode, Competitors, Region/State |
| `MobileChart` | Plotly wrapper tuned for mobile (compact margins, touch-friendly) |
| `MobileDataCard` | Ranking row: rank badge + player name + volume + 12-month sparkline |
| `ExportFAB` | Floating action button that opens the ExportModal |
| `MobileTabBar` | Product tab bar (Diesel B / Gasoline / Ethanol / Otto-Cycle), `variant="container"` |

Desktop uses `NavBar`, `BrandLogo`, `DashboardHeader`, `ExportPanel`, `ExportModal`, `PeriodSlider`, `SegmentedToggle`, `BarrelLoading`, `CheckList`, `SearchableMultiSelect`, `RegionStateFilter` from the desktop shared-component set.

### Desktop-only / mobile-only divergences

| Feature | Desktop | Mobile | Tag |
|---|---|---|---|
| Sidebar filter panel (persistent) | Yes — col-md-3 sidebar | No — `FilterDrawer` (BottomSheet on demand) | `[desktop-only]` layout |
| Segment breakdown (Retail / B2B / TRR / Total) | All 13 charts rendered simultaneously | Single product tab; segments collapsed to "All Segments" stacked area | `[desktop-only]` segment detail |
| `ComparisonTable` (MoM / QTD / YoY / YTD) | Below each chart | Not rendered | `[desktop-only]` comparison table |
| Volume Ranking cards | Not rendered | `Ranking` bottom tab — `MobileDataCard` rows with sparklines | `[mobile-only]` ranking tab |
| "Chart / Ranking" bottom tab bar | Not rendered | `MobileBottomTabBar` | `[mobile-only]` |
| Filter chip row (active filter pills) | Not rendered | Sticky chip row above title block | `[mobile-only]` |
| "Filters applied!" toast | Yes (`showToast`) | No (drawer closes itself; no toast) | `[desktop-only]` |
| Export Panel in header | `ExportPanel` in `rightSlot` of `DashboardHeader` | `ExportFAB` floating button | layout difference |

**Rationale for segment collapse on mobile:** rendering 13 simultaneous Plotly charts on mobile (as desktop does) is both a performance and UX problem. The mobile view trades segment granularity for a cleaner stacked-area summary per product. The data is unchanged — users who need segment breakdown should use desktop.

## Export

Tier 2 — `<ExportPanel mode="modal">` abre `<ExportModal>` com filtros + calculadora live de tamanho (ver [`docs/app/PRD.md`](PRD.md) → "Export padronizado").

- RPC count: `get_ms_export_count` (`p_data_inicio`, `p_data_fim`, `p_regioes`, `p_ufs`, `p_mercados`) → `bigint`, em `supabase/migrations/20260507000003_export_count_rpcs.sql`. **Compartilhada com `/market-share`** — mudanças exigem coordenação com `worker_dash-market-share`.
- JS wrapper: `getMsExportCount` em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).
- datasetKey heuristic: `vendas` (ver [`src/lib/exportSizeHeuristics.ts`](../../src/lib/exportSizeHeuristics.ts) → `AVG_BYTES_PER_ROW.vendas`).
- Filtros expostos no modal: período (slider de meses), regiões, UFs, mercados/segmentos.
- Excel handler: `downloadSalesVolumesExcel` em [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts) — workbook single-sheet com título brand orange, header preto, dados Arial 10.
- CSV handler: paginated fetch via `fetchVendasFiltered` (helper em `src/lib/rpc.ts`) + `downloadCsv` em [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts) (RFC4180, UTF-8).
- Filename pattern: `SalesVolumes_DD-MM-YY.<xlsx|csv>`.
- Warning visual quando estimativa > 200 000 linhas.
