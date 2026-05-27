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
| `get_nd_volume_mensal_historico` | **Three temporal categories** (2026-05-27, evolved from frozen-history variant): (a) **PAST months** — anchored at LAST snapshot of the month; Pending bucket is reclassified into Indeterminate (Option A) since a closed month cannot have pending vessels; (b) **CURRENT month** — uses `p_collected_at` (live), all three buckets meaningful; (c) **FUTURE months** — derived from the live snapshot using ETA-based attribution, Pending-only, marked `is_current=true` so the frontend renders them as live. Baseline `2026-04`. `v_current_ts` is `timestamptz` (previous `::timestamp AT TIME ZONE 'America/Sao_Paulo'` chain shifted the anchor by 3h and silently emptied current-month buckets). Wrapper `rpcGetNdVolumeMensalDescarga` em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) chama esta primeiro e cai pra legacy se ela não existir (transição de deploy). |

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
- Monthly Summary by Port cross-tab table
- Live AIS port arrivals table

These are tagged `[desktop-only]` in `desktop/View.tsx` per the binding sync rule.

### Monthly Diesel Volume chart (both views — three temporal categories, 2026-05-27)

Desktop and mobile both render the monthly stacked-bar series sourced from `volumeMensal` (in turn fed by `get_nd_volume_mensal_historico`). Bars fall into three temporal categories, each with its own semantics:

| Category | Anchor | Buckets emitted | `is_current` |
|---|---|---|---|
| **Past** (month < current) | LAST snapshot of that month (frozen — bars never get recomputed) | Discharged + Indeterminate. **Pending is reclassified into Indeterminate** (Option A) — a closed month cannot meaningfully have pending vessels; the honest answer is "we don't know if those ETAs eventually landed". | `false` |
| **Current** | `p_collected_at` (the snapshot the user picked, live) | Discharged + Pending + Indeterminate, all meaningful | `true` |
| **Future** (month > current) | LIVE snapshot `p_collected_at`, vessels with ETA past current month-end grouped by attribution month | Pending only — these are scheduled ETAs that haven't happened yet | `true` |

The frontend treats `is_current=true` as **live**, applying the same outline + `(live)` suffix to both the current month and every future month. No frontend change was needed to surface future months — they reuse the live styling path.

| Slot | Desktop | Mobile |
|---|---|---|
| Container | Plotly stacked bar (`Discharged` / `Pending` / `Indeterminate`) in Row 1 Col 2 (right of map) | CSS-only stacked bars in a glass card on the **Ports** tab, above Port Summary |
| Range | Past + current + future months, in one row | Horizontal scroller, 48px per bar, past + current + future months |
| Live marker | Each live bar gets a contrasting outline + `(live)` suffix on the x-tick; hover text reads `· live` vs. `· frozen` | Each live bar gets an orange outline + `live` caption under the month label |
| Subtitle | "Past months frozen at last snapshot in the month · current and future months are live" (below title, above hr) | "Past months frozen · current and future are live · m³" (below title) |

Mobile uses CSS bars (not Plotly) for weight and to avoid loading the Plotly bundle on a narrow viewport that already carries the desktop map elsewhere. The data shape is identical, so flipping mobile to Plotly later is a 1-file change.

Anti-regression:
- If a future change ever re-introduces a single RPC that recomputes the whole series from one snapshot (the legacy `get_nd_volume_mensal_descarga` behavior), the frozen-history guarantee breaks silently — closed months will start moving again. Keep the wrapper in `rpc.ts` pointed at `get_nd_volume_mensal_historico` (with the legacy as fallback only).
- The `v_current_ts` declaration MUST stay `timestamptz` and parse `p_collected_at::timestamptz`. A previous regression used `::timestamp AT TIME ZONE 'America/Sao_Paulo'`, which shifted the anchor by 3 hours and silently emptied current- and future-month buckets (`nd.collected_at = ma.anchor_ts` matched nothing). Symptom: pending vessels appeared as discharged, future months never rendered. Fixed in `20260527500000_nd_volume_mensal_historico_future_months.sql`.
- "Past Pending = 0" is a contract, not a coincidence. The reclassification lives in the `past_and_current` CTE: `WHEN ma.month < v_current_mo THEN 0` for pending, `+ COALESCE(p.pending_volume, 0)` for indeterminate. Removing either half re-introduces the conceptually-impossible "pending in a closed month" bar.

## Export

Tier 1 — download direto via `<ExportPanel>` (desktop) / `ExportFAB` (mobile).

- Excel: `downloadGenericExcel<T>` em [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts) — workbook single-sheet com título brand orange, header preto, dados Arial 10.
- CSV: `downloadCsv<T>` em [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts) (RFC4180, UTF-8).
- Filename pattern: `Navios-Diesel-Lineup.<xlsx|csv>`.
- Dados exportados: linhas correspondentes ao estado `naviosDisplay` (saída de `get_nd_navios` já filtrada + `WHERE NOT is_cabotagem`).
