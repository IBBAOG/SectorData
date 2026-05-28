# Sub-PRD — `/market-share`

Dashboard consolidado de **Market Share (% de participação)** e **Sales Volumes (volume absoluto em mil m³)**. Owner: [`worker_dash-market-share`](../../.claude/agents/worker_dash-market-share.md).

## Unit Toggle (2026-05-26)

A partir de 2026-05-26 o dashboard serve **dois modos** controlados por um `SegmentedToggle` top-level:

| Mode | Eixo Y dos gráficos | Comparison table | Filename Excel | Filename CSV |
|---|---|---|---|---|
| `% Share` (default) | `(quantidade / total_do_mês) × 100`, clamp [0, 100], suffix `%` | `Market Share Var. (p.p.)` | `FD Market Share DD-MM-YY.xlsx` | `MarketShare_DD-MM-YY.csv` |
| `thousand m³` | `quantidade` absoluta, auto-scale | `Volume Var. (thousand m³)` | `SalesVolumes_DD-MM-YY.xlsx` | `SalesVolumes_DD-MM-YY.csv` |

- Ambos os modos usam o **mesmo backend**: as 4 RPCs `get_ms_*` e a MV `mv_ms_serie_fast`. Não há split de pipeline — a normalização para % acontece **no cliente** em `buildMarketShareLine` quando `unitMode === 'share'`.
- A função pura `buildComparisonData` é parametrizada por `unitMode`: em `share` retorna deltas em pontos percentuais; em `volume` retorna deltas absolutos em mil m³ (mesma fórmula do antigo `buildSvComparisonData`).
- O toggle vive no hook (`unitMode`, `setUnitMode`) e propaga para `charts`, `compData`, `topPlayers`, `topPlayersForSelected`, `onExportExcel`, `onExportCsv`.

### Deep-link `?unit=volume`

A URL `?unit=volume` força o modo `thousand m³` na primeira renderização (lida via `useSearchParams()` uma vez, depois é state-driven). Suporte adicionado para:

1. O 301 redirect `/sales-volumes` → `/market-share?unit=volume` (mantém URLs antigas vivas).
2. Permitir bookmarks/share-links que abrem direto no modo volume.

A URL **não** é sincronizada quando o usuário troca o toggle — é apenas seed inicial.

### `/sales-volumes` retirado

Em 2026-05-26 a rota `/sales-volumes` foi retirada e redireciona (301) para `/market-share?unit=volume`. O hook `useSalesVolumesData.ts`, a View desktop+mobile, e os 4 wrappers `rpcGetSv*` em `src/lib/rpc.ts` foram removidos. Os RPCs PostgreSQL `get_sv_*` continuam no banco (não há migration de drop ainda) — podem ser dropados num follow-up, já que `get_ms_serie_fast` / `get_ms_serie_others` cobrem as duas narrativas.

A entrada "Sales Volumes" do NavBar e o card de `/home` foram removidos em frentes paralelas. Esta tela passa a ser a única superfície para ambas as métricas.

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

### RPC ownership note

`get_ms_serie_fast`, `get_ms_serie_others`, `get_others_players`, and
`get_ms_opcoes_filtros` are now **owned exclusively** by `/market-share`.
The pre-consolidation note about coordinating with `worker_dash-sales-volumes`
no longer applies — that dashboard was retired (see "Unit Toggle (2026-05-26)"
above).

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

Visualização das **duas narrativas** clássicas do mercado brasileiro de combustíveis num único dashboard:

- **% Share** (default): participação relativa por player ao longo do tempo. Narrativa "quem ganhou/perdeu mercado".
- **thousand m³**: volume absoluto vendido por player. Narrativa "quanto cada um vendeu".

O toggle `SegmentedToggle` no topo (desktop) ou na chip-row (mobile) chaveia entre os dois modos sem refetch — mesma RPC, derivação client-side. Filtros (período, região, UF, mercado, agentes/modo) e "Outros" como agregado são preservados em ambos os modos.

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_ms_opcoes_filtros` | próprio | Opções de filtros |
| `get_ms_serie_fast` | próprio | Série mensal (Individual/Big-3) |
| `get_ms_serie_others` | próprio | Soma de "Outros" + breakdown por agente |
| `get_others_players` | próprio | Lista de players em "Outros" |
| `get_ms_export_count` | próprio | Calculadora live de tamanho do export |

> A pré-consolidação tinha 3 dessas RPCs marcadas como "compartilhadas com /sales-volumes". Não mais — agora são exclusivas. A coordenação cross-worker desapareceu junto com o dashboard.

## Tabelas / Views

- `vendas`
- `mv_ms_serie_fast`

## Filtros disponíveis (UI)

- Período (slider mensal)
- Região / UF
- Mercado (no modal de export)
- View Mode: Individual / Big-3 / Others
- Competidores
- **Unit (novo)**: % Share / thousand m³

## Dependências cross-dept

ETL: `vendas_watch` → `vendas` → MV `mv_ms_serie_fast` (refresh via `classificar_agentes()`).

## Anti-padrões

- Mudar `get_ms_*` sem revisar todos os derivados (`charts`, `compData`, `topPlayers`, `topPlayersForSelected`, exports) — eles agora dependem de `unitMode`.
- Esquecer de incluir `unitMode` nas dependências dos `useMemo` que produzem `charts` / `compData` / `topPlayers` — leva a stale render no toggle.
- Hardcodar `ticksuffix: "%"` em novos gráficos sem ramificar por `unitMode`.

## Export

Tier 2 — `<ExportPanel mode="modal">` abre `<ExportModal>` com filtros + calculadora live de tamanho (ver [`docs/app/PRD.md`](PRD.md) → "Export padronizado").

- RPC count: `get_ms_export_count` (`p_data_inicio`, `p_data_fim`, `p_regioes`, `p_ufs`, `p_mercados`) → `bigint`, em `supabase/migrations/20260507000003_export_count_rpcs.sql`.
- JS wrapper: `getMsExportCount` em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).
- datasetKey heuristic: `vendas` (ver [`src/lib/exportSizeHeuristics.ts`](../../src/lib/exportSizeHeuristics.ts) → `AVG_BYTES_PER_ROW.vendas`).
- Filtros expostos no modal: período (slider de meses), regiões, UFs, mercados/segmentos.
- Excel handler: `downloadMarketShareExcel(rows, players, big3, unitMode)` em [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts) — workbook 4-sheet (Diesel B / Gasoline C / Hydrous Ethanol / Otto-Cycle) com chart embarcado por segmento. Ramifica por `unitMode`:
  - `share` → sheet label "Market Share (%)", numFmt `0"%"`, filename `FD Market Share DD-MM-YY.xlsx`.
  - `volume` → sheet label "Volume (thousand m³)", numFmt `0.0`, filename `SalesVolumes_DD-MM-YY.xlsx`.
- CSV handler: paginated fetch via `fetchVendasFiltered` (helper em `src/lib/rpc.ts`) + `downloadCsv` em [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts). Filename ramifica: `MarketShare_DD-MM-YY.csv` (share) ou `SalesVolumes_DD-MM-YY.csv` (volume). Rows são raw `vendas` (não dependem de unitMode).
- Warning visual quando estimativa > 200 000 linhas.
- `get_ms_export_count` agora é exclusivo de `/market-share` (antes era compartilhado).

### Pegadinha: chart numFmt em `buildChartXml` usa atributo XML single-quoted

O `<c:numFmt formatCode=...>` da Y-axis dos gráficos do export é emitido com **atributo XML single-quoted** (`formatCode='0"%"'`), permitindo `"` literal no formato sem entity escape. Tentativas anteriores (post-consolidation /sales-volumes, 2026-05-26) usaram atributo double-quoted com `&quot;` entity, o que é XML válido e funciona na maioria dos clientes — porém algumas versões antigas do Excel não decodificam `&quot;` consistentemente dentro de `formatCode`, podendo descartar silenciosamente o gráfico e retornar ao display "raw" (sem formatação visível). O atributo single-quoted é o padrão pre-consolidação, validado em produção há anos.
