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
| 13 product×segment charts (Diesel B Retail/B2B/TRR/Total, Gasoline C Retail/B2B/Total, Ethanol Retail/B2B/Total, Otto-Cycle Retail/B2B/Total) | Full | Overview tab: hero Diesel B Total (12M stacked area); Compare tab: stub (full table planned) |
| Comparison table (MoM/QTD/YoY/YTD p.p. delta) | Yes | Compare tab stub |
| Top players ranking with MoM delta | Implicit via chart | MobileDataCard rows |
| Export (Tier 2 ExportModal) | Yes | Yes (via ExportFAB) |
| Period / Region / UF / Mode / Competitors filters | Yes (sidebar) | Yes (FilterDrawer bottom sheet) |

### Hook export contract

`useMarketShareData()` returns the full surface consumed by both views:
- `serieRows`, `ottoCycleRows`, `seriesLoading`, `seriesError`
- `opcoes`, `datas`, `regioesAll`, `ufsAll`, `mercadosAll`
- Filter state + setters: `mode`, `sliderRange`, `regioesSelected`, `ufsSelected`, `competidoresSelected`
- `applyFilters()`, `clearFilters()`
- Derived: `charts` (all 13), `compData`, `topPlayers`, `chartColors`, `players`, `big3`, `latestDate`
- Export state + handlers: `exportOpen`, `openExportModal`, `closeExportModal`, `exportFilters`, `exportSizeEstimate`

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
