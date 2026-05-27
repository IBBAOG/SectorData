# Sub-PRD — `/navios-diesel`

Dashboard de Navios Diesel (importação por mar). Owner: [`worker_dash-navios-diesel`](../../.claude/agents/worker_dash-navios-diesel.md). Mais complexo do APP.

## Escopo de código

```
src/app/(dashboard)/navios-diesel/
  page.tsx
  (sub-páginas futuras pertencem a este mesmo agente)
```

RPC wrappers: seção "navios-diesel" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

## Produto

Visualização do pipeline de **importação de diesel via navios**. Mostra:
- Navios esperados nos portos (status: Esperado, Atracado, Iniciada Descarga, Despachado, Descarregado)
- Resumo por porto (volumes, ETA, descarga)
- Tracking AIS (posições reais via vessel_positions)
- Identidade de navios (IMO, MMSI, bandeira)
- **Filtragem rigorosa de cabotagem** — `is_cabotagem` (coluna gerada) precisa estar `false` em toda RPC

## Princípio crítico — cabotagem

A coluna `navios_diesel.is_cabotagem` é **generated** por:
- `flag IN ('Brazil', 'BR')` OR
- padrão regex em `origem` (porto brasileiro)

**Toda RPC deve filtrar `WHERE NOT is_cabotagem`.** Cabotagem é tráfego interno; não conta como import. Esquecer este filtro = dados errados no dashboard.

## RPCs

| RPC | Função |
|---|---|
| `get_nd_ultima_coleta` | Timestamp da última coleta (para mostrar ao user) |
| `get_nd_coletas_distintas` | Lista de timestamps distintos de coleta (para filtro de "snapshot") |
| `get_nd_navios` | Lista de navios filtrados (porto, produto, status, período) |
| `get_nd_resumo_portos` | Agregado por porto (totais, contagens) |
| `get_nd_volume_mensal_descarga` | Série mensal (Discharged / Pending / Indeterminate). Recalculada a cada snapshot — sobrescreve meses passados. Preservada por enquanto como fallback. |
| `get_nd_volume_mensal_historico` | **Three temporal categories** (2026-05-27, latest revision in `20260527700000_nd_volume_mensal_historico_past_only_discharged.sql`): (a) **PAST closed months** — anchored at LAST snapshot of the month; **only `discharged_volume` is emitted, both `pending_volume` and `indeterminate_volume` are forced to 0** (per user contract — vessels still pending or indeterminate at month-end are discarded as retrospective noise, since they either never arrived, were redirected, or did not become real imports for that month); (b) **CURRENT month** — uses `p_collected_at` (live), all three buckets meaningful; (c) **FUTURE months** — derived from the live snapshot using ETA-based attribution, Pending-only, marked `is_current=true` so the frontend renders them as live. Baseline `2026-04`. `v_current_ts` is `timestamptz` with a regex-gated CASE handling SP-local-naive vs UTC-with-offset inputs. Wrapper `rpcGetNdVolumeMensalDescarga` em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) chama esta primeiro e cai pra legacy se ela não existir (transição de deploy). |

## Tabelas

| Tabela | Populada por | Notas |
|---|---|---|
| `navios_diesel` | ETL (`pipelines/navios/01_lineup_scrape.py` → `pipelines/navios/02_diesel_import.mjs`) cada 6h | Cresce ~100/semana |
| `vessel_registry` | ETL (`pipelines/ais/positions_sync.py`) | Catálogo de navios via AIS |
| `vessel_positions` | ETL (`pipelines/navios/05_positions_sync.py`, `pipelines/ais/positions_sync.py`) | Posições históricas |
| `port_arrivals` | ETL (`pipelines/ais/positions_sync.py`, `pipelines/navios/05_positions_sync.py`) | Chegadas confirmadas |
| `import_candidates` | ETL (`pipelines/ais/candidates_discover.py`) | Radar de candidatos a import (score 0-100) |

Migrations relevantes:
- `20260328200000_navios_diesel.sql`
- `20260331000000_navios_diesel_brt.sql`
- `20260415000000_navios_diesel_volume_mensal.sql` (+ v2, v3, v4)
- `20260415000004_navios_descarregados.sql`
- `20260416000001_nd_resumo_mensal_portos.sql`
- `20260422000000_ais_tracking.sql`
- `20260423000001_cabotage_filter.sql`
- `20260424000000_import_candidates.sql`

## Dependências cross-dept

Este dashboard tem a **maior dependência de ETL** dentro do APP:

| Workflow | Schedule | O que produz |
|---|---|---|
| `etl_navios_lineup.yml` | cada 6h | Lineup dos portos → `navios_diesel` |
| `etl_navios_imo_lookup.yml` | após `etl_navios_lineup` | Resolve IMO/MMSI das linhas novas |
| `etl_navios_positions.yml` | após `etl_navios_imo_lookup` | Atualiza posições + chegadas |
| `etl_ais_positions.yml` | cada 6h+15min | AIS tempo real |
| `etl_ais_candidates.yml` | cada 4h | Descoberta de candidatos (radar) |

Mudanças no schema vêm geralmente de **necessidade do dashboard** (você pede ao Subgerente que pede ao ETL — ou vice-versa para colunas novas do scraper).

## Status do navio (decoreba)

Valores de `navios_diesel.status`:

| Status | Significado |
|---|---|
| `Esperado` | Anunciado pelo porto, ainda não chegou |
| `Atracado` | Atracado, antes de iniciar descarga |
| `Iniciada Descarga` | Descarregando |
| `Despachado` | Saiu do porto (após descarregar) |
| `Descarregado` | Sinônimo legado de Despachado em alguns contextos — verificar |

## Filtros tipicamente usados (UI)

- Porto (multi-select).
- Produto (Diesel, derivados).
- Status (multi-select).
- Período de ETA / coleta.
- Bandeira.
- Origem (porto de origem).

## Performance

- `navios_diesel` cresce; use índices nas colunas filtradas (verificar migrations para confirmar).
- Tabelas grandes (lista de todos os navios do mês) — considere virtualização.
- Para resumo por porto, use `get_nd_resumo_portos` (agregado server-side) em vez de calcular client-side.

## Anti-padrões

- RPC sem `NOT is_cabotagem`.
- Confiar em MMSI quando IMO está disponível (IMO é mais estável).
- Mexer em `vessel_*` ou `port_arrivals` direto — esses são populados pelo ETL.
- Tentar chamar `ais_candidates_discover` ou `navios_imo_lookup` do frontend — são pipelines do ETL.
- Visualizar lista grande sem paginação/virtualização.

## Dual-view structure

Dashboard migrated to the dual-view pattern (2026-05-20). File layout:

```
src/app/(dashboard)/navios-diesel/
├── page.tsx                    ← viewport router (useIsMobile → desktop or mobile)
├── useNaviosDieselData.ts      ← THE BRAIN: all RPCs, filter state, derived values, types
├── desktop/
│   └── View.tsx                ← full desktop layout (sidebar calendar, map, AIS layer, monthly chart)
└── mobile/
    └── View.tsx                ← mobile-first layout (port scroller, vessel cards, BottomSheet detail)
```

### Hook contract (`useNaviosDieselData`)

The hook is the single source of truth for all data. Both Views import from it and never call Supabase directly. Key exports:

| Export | Type | Description |
|---|---|---|
| `naviosDisplay` | `NavioDieselRow[]` | Active line-up (excludes ERRO_COLETA + Despachado) |
| `portSummaries` | `PortSummary[]` | Per-port aggregates for scroller / map |
| `resumoByPorto` | `Map` | Used by desktop map trace builder |
| `portMonthlySummary` | `object` | ports × months × {vessels, volume} |
| `volumeMensal` | `NdVolumeMensalDescargaRow[]` | Monthly stacked bar chart data |
| `naviosDescarregados` | `NdNavioDescarregadoRow[]` | Delivered vessels table |
| `statusToTone` | `function` | Maps status string → mobile tone token |
| `STATUS_LABELS` | `Record` | Maps status string → English label |

### Mobile view elements

- `MobileTopBar` — sticky glass top bar (SECTORDATA wordmark)
- Status segmented control (Active / Recent / Expected tabs)
- Port summary horizontal scroller — 140px snap cards with volume, vessel count, status dots
- Sticky filter chip row — port filter chip + snapshot date chip + "Add filter" button
- Vessel list — `MobileDataCard` with `status` prop; `expanded` variant
- `BottomSheet` — vessel detail (IMO / MMSI / flag / origin / voyage timeline)
- `BottomSheet` — filter pane (port selection)
- `ExportFAB` — download Excel (falls back to CSV on error)
- `MobileBottomTabBar` — Vessels / Ports / Map / Profile
- Map tab: placeholder (map + AIS is [desktop-only] — desktop renders full Plotly scattergeo + AIS overlay)

### Desktop-only divergences

- AIS layer toggle (AIS On/Off `SegmentedToggle`) — not available on mobile
- Inline sidebar calendar + collection-time picker
- Plotly scattergeo map with port circles + AIS vessel markers
- Monthly Summary cross-tab table (Port × Month) — rendered below the bar chart, no subtitle (the chart's own header carries the section identity)
- Live AIS port arrivals table

These are tagged `[desktop-only]` in `desktop/View.tsx` per the binding sync rule.

### Desktop Line-Up grid (`.nd-main-grid`, 2026-05-27 layout)

The Line-Up tab uses a 2-column grid at ≥768px:

| Row | Col 1 | Col 2 |
|---|---|---|
| 1 | Distribution by Port (Plotly map, `mapHeight` = 500 px ≥1920 / 380 px below) | Monthly Diesel Volume bar chart **+** Monthly Summary by Port table (flex column stretching to map height; table scrolls internally when content overflows via `maxHeight: calc(${mapHeight}px - 280px)` + `overflowY: auto`) |
| 2 | Expected Vessels / Pending Discharge | Delivered Vessels / Discharged |
| 3 | Data Limitations & Disclaimer (full-width via `.nd-row-full`, `grid-column: 1 / -1`) | — |

Below 768px the grid collapses to a single column; the desktop View renders this fallback only when desktop is being strangulated by the viewport (mobile uses `mobile/View.tsx`).

**Chart ↔ table alignment contract** (Row 1 Col 2):

- The Plotly bar chart uses `margin: { l: 110, r: 10 }` and `xaxis: { automargin: false, tickangle: 0, fixedrange: true }`.
- The summary table uses `tableLayout: "fixed"` with a `width: 110` Port column and `marginRight: 10` on the wrapping div.
- Each bar's center column-aligns with the corresponding table-column header center (`110px` left port column = chart's left margin; `10px` right padding = chart's right margin).
- `automargin: false` prevents tick label width (e.g. `"Apr 2026 (live)"`) from expanding the chart margins and breaking alignment.

**Summary-table month source**: `portMonthlySummary.months` in `useNaviosDieselData.ts` is the UNION of `resumoMensal` months (current snapshot's port × month aggregates) and `volumeMensal` months (historical + future series from `get_nd_volume_mensal_historico`). Past months without data render `—` per port. The current month carries a `(live)` suffix on the column header so it matches the chart's x-tick label.

The "Monthly Summary by Port" subtitle and its `<hr>` separator were removed in the same rearrange — the bar chart title above (`Monthly Diesel Volume (m³)`) covers the whole right-column section.

### Monthly Diesel Volume chart (both views — three temporal categories, latest 2026-05-27)

Desktop and mobile both render the monthly stacked-bar series sourced from `volumeMensal` (in turn fed by `get_nd_volume_mensal_historico`). Bars fall into three temporal categories, each with its own semantics:

| Category | Anchor | Buckets emitted | `is_current` |
|---|---|---|---|
| **Past** (month < current) | LAST snapshot of that month (frozen — bars never get recomputed) | **Discharged only.** Both `pending_volume` and `indeterminate_volume` are forced to 0 in the SQL. A closed month has a single retrospective number: what actually discharged. Vessels still pending or indeterminate at month-end are intentionally discarded (they either never arrived, were redirected, or otherwise did not become real imports for that month). | `false` |
| **Current** | `p_collected_at` (the snapshot the user picked, live) | Discharged + Pending + Indeterminate, all meaningful | `true` |
| **Future** (month > current) | LIVE snapshot `p_collected_at`, vessels with ETA past current month-end grouped by attribution month | Pending only — these are scheduled ETAs that haven't happened yet | `true` |

The frontend treats `is_current=true` as **live**, marking those bars with a `(live)` suffix on the x-tick (desktop) or an orange-tinted month label + `live` caption (mobile). Outlines/borders on the bars themselves were tried and rejected as visually noisy — the subtitle copy plus the per-tick `(live)` tag carry the distinction clearly enough. No frontend change was needed for the past-only-discharged contract either: both the desktop Plotly stacked bar and the mobile CSS bars already gate the Pending/Indeterminate segments on `volume > 0`, so past months naturally render as a single Discharged slice with no orange/green segment.

| Slot | Desktop | Mobile |
|---|---|---|
| Container | Plotly stacked bar (`Discharged` / `Pending` / `Indeterminate`) in Row 1 Col 2 (right of map) | CSS-only stacked bars in a glass card on the **Ports** tab, above Port Summary |
| Range | Past + current + future months, in one row | Horizontal scroller, 48px per bar, past + current + future months |
| Live marker | x-tick label carries `(live)` suffix; hover text reads `· live` vs. `· frozen`. No outline on the bar — was tried and rejected as visually noisy. | Month label tinted orange (`#FF5000`) + bold + `live` caption under the bar. No outline on the bar — was tried and rejected as visually noisy. |
| Subtitle | "Past months frozen at last snapshot in the month · current and future months are live" (below title, above hr) | "Past months frozen · current and future are live · m³" (below title) |

Mobile uses CSS bars (not Plotly) for weight and to avoid loading the Plotly bundle on a narrow viewport that already carries the desktop map elsewhere. The data shape is identical, so flipping mobile to Plotly later is a 1-file change.

Anti-regression:
- If a future change ever re-introduces a single RPC that recomputes the whole series from one snapshot (the legacy `get_nd_volume_mensal_descarga` behavior), the frozen-history guarantee breaks silently — closed months will start moving again. Keep the wrapper in `rpc.ts` pointed at `get_nd_volume_mensal_historico` (with the legacy as fallback only).
- The `v_current_ts` derivation must handle **two input formats**: the frontend sends SP-local-naive (`'2026-05-26T16:00:00'`, no offset, because `get_nd_coletas_distintas` serialises `(collected_at AT TIME ZONE 'America/Sao_Paulo')`); ad-hoc SQL callers usually pass UTC-with-offset (`'2026-05-26 19:00:00+00'`). Use the regex-gated CASE preserved in `20260527700000_nd_volume_mensal_historico_past_only_discharged.sql` (`p_collected_at ~ '([+-][0-9]{2}(:?[0-9]{2})?|Z)$'` → `::timestamptz`, else `::timestamp AT TIME ZONE 'America/Sao_Paulo'`). A previous attempt to force `::timestamptz` for everything shifted the SP-local input by 3 hours and silently emptied current/future buckets — symptom: pending vessels appeared as discharged, future months never rendered. The opposite forcing (`::timestamp AT TIME ZONE 'America/Sao_Paulo'` for everything) breaks SQL callers passing UTC offsets.
- "Past = discharged only" is a contract, not a coincidence. It lives in the `past_and_current` CTE: `CASE WHEN ma.month < v_current_mo THEN 0 ELSE COALESCE(p.pending_volume, 0) END` for pending AND `CASE WHEN ma.month < v_current_mo THEN 0 ELSE COALESCE(i.indeterminate_volume, 0) END` for indeterminate. Removing either zero re-introduces noise into closed months. (Note: an earlier iteration tried "Option A" — folding past Pending into Indeterminate — and was rejected by the user. The current contract is stricter: drop both.)

## Export

Tier 1 — download direto via `<ExportPanel>` (desktop) / `ExportFAB` (mobile).

- Excel: `downloadGenericExcel<T>` em [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts) — workbook single-sheet com título brand orange, header preto, dados Arial 10.
- CSV: `downloadCsv<T>` em [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts) (RFC4180, UTF-8).
- Filename pattern: `Navios-Diesel-Lineup.<xlsx|csv>`.
- Dados exportados: linhas correspondentes ao estado `naviosDisplay` (saída de `get_nd_navios` já filtrada + `WHERE NOT is_cabotagem`).
