# Sub-PRD — `/market-share`

Dashboard consolidado de **Market Share (% de participação)** e **Sales Volumes (volume absoluto em mil m³)**. Owner: [`worker_dash-market-share`](../../.claude/agents/worker_dash-market-share.md).

## "Total" aggregate product (2026-06-01)

Um quinto produto **sintético** — `Total` (label de UI: **"Total (All Fuels)"**) — agrega a soma de todos os combustíveis **reais** retornados pela RPC (Diesel B + Gasolina C + Etanol Hidratado + quaisquer outros).

- Helper `makeTotalRows(rows)` no hook, análogo a `makeOttoCycleRows`: para cada row crua de `serieRows`, emite uma cópia com `nome_produto:"Total"`, mantendo `quantidade`, `segmento`, `date`, `classificacao`, `agente_regulado`. A soma por chave `(date, player, segmento)` acontece downstream em `buildMarketShareLine` / `getMsAtDate` (`groupMap.set(key, prev + qty)`).
- **Otto-Cycle é excluído da soma** — é sintético (Gasolina C + Etanol×0.7) e somá-lo causaria double-counting. `serieRows` nunca contém Otto-Cycle, mas `makeTotalRows` filtra defensivamente mesmo assim.
- **TRR é excluído** — TRR só existe para Diesel B; somar TRR entre produtos não faz sentido. Segmentos do Total: `Total`, `Retail`, `B2B`.
- Funciona automaticamente nos dois `unitMode`: **% Share** (`player_total / market_total × 100`) e **thousand m³** (soma absoluta), porque `buildMarketShareLine` / `buildComparisonData` já ramificam por `unitMode` — nenhuma lógica de unidade adicional.
- Sem impacto em RPC / migration / schema / RLS — mudança puramente frontend no hook + nas duas Views.
- Ordem: `Total` é o **primeiro** item de `PRODUCT_KEYS` (visão executiva agregada antes do detalhe por produto). Tipos estendidos: `ProductKey` ganha `"Total"`; `MarketShareCharts` / `MarketShareCompData` / `ChartKey` / `CHART_KEY_MATRIX` / `SEGMENTS_BY_PRODUCT` ganham as chaves `totalTotal` / `totalRetail` / `totalB2B`.
- **Desktop**: novo bloco "Total (All Fuels)" como primeira seção do grid de charts (Retail + B2B + Total, cada um com `ComparisonTable`).
- **Mobile**: aparece automaticamente como primeira aba do Product `MobileTabBar` (deriva de `PRODUCT_KEYS`); o segment selector mostra Total/Retail/B2B (deriva de `SEGMENTS_BY_PRODUCT`); hero chart e comparison table refletem a seleção.
- **Export Excel** (workbook 4-sheet legacy) **não** inclui o Total — é uma config estática de 4 produtos sobre `serieRows` cru e não foi tocada. Total é uma análise on-screen; um follow-up pode adicionar a sheet se desejado.

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

## Dual-view structure (added 2026-05-20; v2 mobile reform 2026-05-27)

Follows the canonical dual-view pattern (`docs/app/dual-view-pattern.md`). Shared hook is the single brain; both Views are pure presentation layers.

```
src/app/(dashboard)/market-share/
  page.tsx                     ← viewport router (useIsMobile)
  useMarketShareData.ts        ← THE BRAIN — RPCs, filters, derivations, types
  desktop/
    View.tsx                   ← desktop UX (sidebar + multi-column grid + ExportModal)
  mobile/
    View.tsx                   ← mobile UX v2 (thumb-scroll layout per Onda 3 reform)
```

### Mobile layout v2 (Onda 3, 2026-05-27; updated 2026-05-28) — top → bottom

1. `MobileTopBar` + `MobileKebabMenu` (account actions)
2. Title block (h1 + subtitle + period badge)
3. Sticky `SegmentedToggle` (% Share / Volume) — top-level unit switch
4. Product `MobileTabBar` — container variant (Total (All Fuels) / Diesel B / Gasoline C / Hydrous Ethanol / Otto-Cycle)
5. Segment `MobileTabBar` — underline variant (Total / Retail / B2B / TRR; TRR only for Diesel B)
6. Hero stacked-area chart card (active product × segment, 12M rolling, `MobileChart`)
7. 2-column legend below chart
8. Comparison table inline (player picker pills capped at 3 + MoM/QTD/YoY/YTD cards)
9. Filter chip row (Period info chip + Region/UF active chips + `+ Filters` trigger)
    `FilterDrawer` (Period slider + Region multi-select + UF multi-select + View Mode)
    `MobileHomePill` (floating, replaces old bottom tab bar)

**Removed from mobile in v2:**
- `MobileBottomTabBar` (Overview/Compare/Filters/Profile) — replaced by single `MobileHomePill` + filter chip row
- `ExportFAB` + `ExportModal` — policy § 3.4: no export on mobile
- Placeholder tabs (Map/Compare as isolated screens)
- Top Distributors section (rank badge + progress bar + MoM delta per player) — removed [mobile-only] 2026-05-28; chart legend still identifies players

### Analyses preserved in both Views

| Analysis | Desktop | Mobile |
|---|---|---|
| 16 product×segment charts (Total Retail/B2B/Total, Diesel B Retail/B2B/TRR/Total, Gasoline C Retail/B2B/Total, Ethanol Retail/B2B/Total, Otto-Cycle Retail/B2B/Total) | Full (all 16 rendered as a 2-column grid; Total is the first section) | Product `MobileTabBar` + Segment `MobileTabBar` navigates the same 16 chart variants, one at a time. Hero stacked-area chart reflects active combination. |
| Comparison table (MoM/QTD/YoY/YTD p.p. delta) | Yes (inline table under each chart) | Inline section (always visible) below Top Distributors — player picker pills (up to 3) + MoM/QTD/YoY/YTD metric cards |
| Top players ranking with MoM delta | Implicit via chart | Removed from mobile [mobile-only] 2026-05-28 — chart legend still shows players |
| Export (Tier 2 ExportModal) | Yes | No — policy § 3.4 |
| Period / Region / UF / Mode filters | Yes (sidebar) | Yes (FilterDrawer bottom sheet triggered from chip row) |

### Hook export contract

`useMarketShareData()` returns the full surface consumed by both views:
- `serieRows`, `ottoCycleRows`, `seriesLoading`, `seriesError`
- `opcoes`, `datas`, `regioesAll`, `ufsAll`, `mercadosAll`
- Filter state + setters: `mode`, `sliderRange`, `regioesSelected`, `ufsSelected`, `competidoresSelected`
- `applyFilters()`, `clearFilters()`
- Derived: `charts` (all 16), `compData`, `topPlayers`, `chartColors`, `players`, `big3`, `latestDate`
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
- `PRODUCT_KEYS: ProductKey[]` — `["Total", "Diesel B", "Gasolina C", "Etanol Hidratado", "Otto-Cycle"]`
- `PRODUCT_LABEL: Record<ProductKey, string>` — English display labels (`"Total" → "Total (All Fuels)"`, `"Gasolina C" → "Gasoline C"`, `"Etanol Hidratado" → "Hydrous Ethanol"`)
- `SEGMENTS_BY_PRODUCT: Record<ProductKey, SegmentKey[]>` — drives the segment selector (TRR only for Diesel B)
- `CHART_KEY_MATRIX: Record<ProductKey, Partial<Record<SegmentKey, ChartKey>>>` — `(product, segment) → key in MarketShareCharts`

Pure helpers also exported from the hook file:
- `buildMarketShareLine` — builds a single Plotly line chart. Also runs an
  anti-overlap pass on the right-side end-of-line annotations: when two or
  more labels would land at nearly the same Y, they are stacked with a
  minimum vertical separation derived from the chart's pixel geometry
  (≈ `axisSpan * 16/210` ≈ 7.6 % of axis range — accounting for the ~210 px
  plot area at 300 px chart height and 12 px Arial labels). A hard floor of
  **1.6 pp** is enforced in `share` mode so wide ranges (e.g. Big-3 mode
  with 80 pp span) still get a sane minimum gap; in `volume` mode the floor
  is 4 % of axis span. Algorithm: sort labels by original Y ascending, then
  iterate up to 4 passes — bottom-up greedy packing (`y = max(originalY,
  prevY + minGap)`), and if the top exceeds `yHi`, clamp top and sweep
  top-down. Handles 3–4 label clusters reliably. Strengthened on 2026-05-28
  after end-of-line labels were still kissing on Retail / TRR / B2B panels
  with the previous 3 % threshold.
- `buildMobileStackedArea` — builds stacked-area traces for the mobile hero chart
- `buildComparisonData` — builds the MoM/QTD/YoY/YTD comparison rows
- `makeOttoCycleRows` — synthesises Otto-Cycle = Gasolina C + Etanol × 0.7
- `makeTotalRows` — synthesises Total = sum of all raw fuels (Diesel B + Gasoline C + Ethanol + …), excluding Otto-Cycle (double-count) and TRR rows (Diesel-B-only). Segments: Total/Retail/B2B.

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

### Migration strategy (2026-05-28) — **fallback / legacy preserved**

The unified export library wave (`src/lib/export/`, owners `worker_subgerente-app` + `worker_designer`) ships a declarative `ExportSpec` + a single `<ExportButton spec={...}/>` entry point. Most dashboards plug straight into it.

**`/market-share` is the deliberate exception.** Strategy chosen for Phase 1 of the wave: **fallback** (see [`src/lib/export/dashboards/marketShare.ts`](../../src/lib/export/dashboards/marketShare.ts) for the in-code anchor).

Why:

- The Excel workbook embeds OOXML line charts (4 sheets × 3–4 segment blocks, cores fixas Vibra `#f26522` / Raizen `#1a1a1a` / Ipiranga `#73C6A1` / Big-3 `#FF5000` / Others `#A9A9A9`).
- The `<c:numFmt formatCode='0"%"'>` single-quoted-attribute trick (see Pegadinha at the bottom of this section) has been validated in production for years; the new core's chart support has not yet been verified end-to-end against this corner case.
- The OOXML showcase is too valuable to risk during the migration wave — recovering from a regression would mean re-implementing the chart builder under time pressure.

What actually changed in this commit:

- New tiny placeholder file `src/lib/export/dashboards/marketShare.ts` declares `marketShareExportStrategy = "fallback"` + a structured `marketShareExport` object pointing at the legacy handlers. It is **not** a real `ExportSpec` and is **not** consumed by `<ExportButton>`.
- `desktop/View.tsx` keeps the existing `<ExportPanel actions={...} />` in `<DashboardHeader rightSlot={...}>` and the existing `<ExportModal ...>` mounted at the page root. A header comment + a `void`-discarded import of the placeholder make the deliberate choice discoverable to the next reader and to lint/dead-code tooling.
- Legacy handlers `downloadMarketShareExcel` and `downloadSalesVolumesExcel` in [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts) are untouched. **Do not delete them.**

Phase 2 of the export wave (post-migration) will swap the placeholder for a full `ExportSpec` once the new ExcelBuilder demonstrably round-trips an OOXML chart with cores fixas + the single-quoted `numFmt` attribute. At that point `desktop/View.tsx` flips to `<ExportButton spec={marketShareExport}/>` in a single commit and the legacy ExportPanel/ExportModal can be removed alongside the cleanup of other dashboards.

### Legacy (still active) export behavior

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
