# Sub-PRD — `/anp-cdp-diaria`

Dashboard Daily Production — by Field / Installation / Well / **Company** (Oil & Gas). Owner: [`worker_dash-anp-cdp-diaria`](../../.claude/agents/worker_dash-anp-cdp-diaria.md). Source: ANP Power BI (`anp_cdp_diaria`, `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco`) + admin-curated `field_stakes` (Company level).

> Item do dropdown "Oil & Gas" da NavBar (irmão de `/anp-cdp`). Distinção crítica: `/anp-cdp` é mensal por **poço** (formulário CDP); `/anp-cdp-diaria` é diário e cobre **quatro níveis de granularidade** (campo, instalação, poço, **empresa**) via Power BI ANP. O nível Company cruza a produção diária do campo com o stake (working interest) curado pelo admin em `/admin-panel → Field Stakes` para produzir **produção líquida no stake** por empresa.

## Escopo de código

```
src/app/(dashboard)/anp-cdp-diaria/
├── page.tsx                  ← viewport router (useIsMobile)
├── useAnpCdpDiariaData.ts    ← single brain hook (RPCs, filters, ranking, export)
├── desktop/View.tsx          ← desktop UX (sidebar + multi-column grid + table)
└── mobile/View.tsx           ← mobile UX (product tabs + chart card + ranking cards)
```

RPC wrappers: seções "ANP CDP Diária" + "ANP CDP Diária — Installation level" + "ANP CDP Diária — Well level" + "ANP CDP Diária — Company level (stake-weighted net)" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

Export spec: [`src/lib/export/dashboards/anpCdpDiaria.ts`](../../src/lib/export/dashboards/anpCdpDiaria.ts) (unified export library, see [`docs/app/export-library-contract.md`](export-library-contract.md)). Count helper: `rpcGetAnpCdpDiariaExportCount(nivel, filtros)` wrapping `get_anp_cdp_diaria_export_count(p_nivel, p_filtros)`. The legacy heuristic chaves in `src/lib/exportSizeHeuristics.ts` are no longer consumed by this dashboard.

## Dual-view structure (Phase 2 — 2026-05-20)

Both Views consume the shared hook `useAnpCdpDiariaData`. Views are pure presentation; they never call Supabase or derive metrics on their own.

### Hook surface (single source of truth)

`useAnpCdpDiariaData()` returns:
- All 6 RPCs already wired (`rpcGetAnpCdpDiariaSerie` + Installation + Well wrappers + the 3 Company-level wrappers)
- Filter state for every dimension (campos, instalacoes, pocos, dateRange) — Basin filter was removed from the UI on 2026-05-28; the per-row `bacia` field is still displayed in tables and badges
- Granularity toggle (`granularity` + `setGranularity`) — now `"field" | "installation" | "well" | "company"`. Desktop exposes all 4; mobile exposes a `Fields | Companies` switch (Installation/Well stay desktop-only) and drives `granularity` to `"field"` / `"company"`.
- Product toggle (`product` + `setProduct`) — `"oil" | "gas"`, drives mobile chart/ranking + the Company per-field ranking sort
- Derived: `petroleoChart`, `gasChart` (full multi-trace, kbpd / Mm³/d), `defaultPetroleoDims`, `defaultGasDims`, `ranking` (DimensionAggregate[] sorted by avg of current product)
- `tableRows` (top 500 most recent records)
- **Company level**: `empresas` (selector), `selectedEmpresa` + `setSelectedEmpresa` (single-select), `empresaCampos` (stake coverage), `companySerieRows` (raw net serie), `companyFieldAggregates` (per-field net avg/latest + stake), `companyFieldsNoData` (stake-held fields without daily data), `companyTotalOilNetAvg` / `companyTotalGasNetAvg`, `companyPetroleoChart` / `companyGasChart` (bold "Company total" headline + per-field net lines). All NET values = gross × stake/100, computed server-side; the hook only sums/aggregates.
- Export modal state + handlers (`handleExportExcel`, `handleExportCsv`, `estimateExportRows`) — vestigial, no longer consumed (desktop uses `<ExportButton spec={anpCdpDiariaExport} />`)
- Visibility guard already applied (`useModuleVisibilityGuard("anp-cdp-diaria")`)

### Desktop view (`desktop/View.tsx`)

Verbatim move of the previous `page.tsx` body, now reading from the hook. Layout:
- Sidebar: granularity toggle (Field / Installation / Well / **Company**), Filters section (Field · Installation · Well · Period — visibility per level; Basin filter removed 2026-05-28). In Company mode the dimension filters are hidden and a **Company** section with a single-select picker is shown instead (PRIO/Petrobras as featured pills + a `<select>` dropdown for the rest, each labelled with `n_campos_com_dado/n_campos_stake` coverage).
- Main (Field/Installation/Well): `DashboardHeader` + 2 line charts (Oil kbpd, Gas Mm³/day) + "Production by Level" table (sticky thead, max 500 rows)
- Main (Company): `DashboardHeader` ("Daily Net Production — <Company>") + a 4-tile KPI strip (Net Oil avg · Net Gas avg · Fields w/ daily data · Fields awaiting data) + 2 net line charts (bold "Company total" + per-field net lines, labels carry stake e.g. "PEREGRINO (80%)") + a per-field net table (Field · Basin · Stake % · Net Oil avg · Net Gas avg · Latest Net Oil · Latest Net Gas · Latest date) + a coverage note listing stake-held fields without daily data ("Not yet in the daily feed: WAHOO (100%)").
- `ExportModal` Tier 2 (export stays pinned to Field/Installation/Well — Company-level export is P2, see Export section)

### Mobile view (`mobile/View.tsx`)

Mobile-first redesign v2 (Onda 3, 2026-05-27); **Company mode added 2026-06-05**. A `Fields | Companies` `SegmentedToggle` sits in the page heading (Installation/Well stay desktop-only). Layout:

**Fields mode** (default):
- Page heading + period badge (MobileTopBar provided by MobileShell in layout.tsx — NOT imported here)
- Sticky filter chip row — period preset pills (1M / 3M / 6M / 1Y / All) + Filters trigger chip + active Field chip with × clear.
- Section 1 — Oil chart: `MobileChart` line chart (~260px), top 5 fields, brand orange leader.
- Section 2 — Gas chart: same treatment stacked vertically (desktop parity — both charts always visible, no tab).
- Section 3 — Top 10 ranking: `MobileDataCard` per field (top 10), rank pill (#1 orange), basin badge, avg + 14-point sparkline, latest value + date. "See all N fields" button opens `BottomSheet` (90vh) with full searchable list.
- Production summary card: 2×3 grid — Leader / Total Oil avg / Total Gas avg / Leader Oil / Leader Gas / Fields count.
- `FilterDrawer`: Period slider + Field chip cloud (touch-friendly, max-height 240px scroll). Reset clears all selections + restores full date range.
- `BottomSheet` "All Fields": full `ranking[]` list, searchable input, scrollable.

**Companies mode** ("same analysis, adapted UX" — single-select empresa):
- Sticky chip row: period preset pills (shared) + PRIO/Petrobras featured pills + "More companies" trigger (opens a searchable `BottomSheet` of all empresas with `n_campos_com_dado/n_campos_stake`).
- Net total averages: 2-cell grid (Net Oil avg kbpd / Net Gas avg Mm³/d).
- Net Oil + Net Gas charts: each a single bold "Company total" net line (`MobileChart`, ~240px).
- "By Field — Net" ranking: `MobileDataCard` per field with stake % badge, basin, avg net, latest net + date (sorted by product avg).
- Coverage note: stake-held fields not yet in the daily feed (e.g. "Not yet in the daily feed: WAHOO (100%)").

NOT on mobile (intentional `[mobile-only]` decisions):
- No `ExportFAB` / `ExportModal` — export is desktop-only (plan § 3.4)
- No `MobileTabBar` for Oil/Gas — both charts stacked, always visible
- No Installation / Well granularity on mobile — only Field and Company are reachable (the desktop 4-way toggle collapses to a 2-way `Fields | Companies` switch)
- No recent-records HTML table — wrong shape for phones

### Binding sync

Any new filter / chart / KPI / copy here must land in BOTH Views in the same commit, or the commit must declare `[desktop-only]` / `[mobile-only]` (see `CLAUDE.md` § Dual-view policy). The Company mode (2026-06-05) shipped in **both** Views in the same commit. Aspects intentionally desktop-only:
- Installation / Well granularity — mobile exposes only `Fields | Companies` per UX brief
- The recent-records table (500 rows of HTML table — wrong shape for phone)
- ExportFAB / ExportModal — export is desktop-only per plan § 3.4 (and Company-level export is P2 even on desktop)

Mobile-only:
- Period preset pills (1M/3M/6M/1Y/All) replacing the PeriodSlider in the chip row
- Top 10 ranking card list + "See all N" BottomSheet (desktop has the dense table instead)
- Production summary card (2×3 grid) — desktop conveys this through charts and the table
- Both Oil + Gas charts always stacked vertically — desktop also stacks them; mobile removed the MobileTabBar product switch that was in v1
- `Fields | Companies` 2-way switch (desktop has the 4-way Field/Installation/Well/Company toggle); the company picker is a featured-pills + searchable BottomSheet (desktop uses pills + a `<select>`)
- Company net charts collapse to a single "Company total" line per product (desktop also draws per-field lines); the per-field detail is in the "By Field — Net" `MobileDataCard` list

## Produto

Visualização da **produção diária de petróleo e gás natural** declarada no Power BI público da ANP em **4 níveis de granularidade**, escolhidos via toggle no topo dos filtros (`SegmentedToggle` "pill deslizante laranja"):

| Nível | Label UI | Tabela alvo | Páginas Power BI |
|---|---|---|---|
| `field` | **Field** | `anp_cdp_diaria` | Página 4 |
| `installation` | **Installation** | `anp_cdp_diaria_instalacao` | Página 5 |
| `well` | **Well** | `anp_cdp_diaria_poco` | Página 6 |
| `company` | **Company** | `anp_cdp_diaria` × `field_stakes` | — (derivado: campo diário × stake) |

Por nível, o usuário pode:

- Selecionar **campos** via `SearchableMultiSelect`.
- Selecionar **instalações** (apenas Installation) via `SearchableMultiSelect`.
- Selecionar **poços** (apenas Well) via `SearchableMultiSelect`.
- Restringir o **período** via `PeriodSlider` em modo `dates` (server-side).
- Ver duas séries temporais (Petróleo `kbpd` e Gás `Mm³/dia`) para a "dimensão" do nível atual (Top 10 por média se sem seleção, ou exatos selecionados).
- Inspecionar a tabela de produção mais recente (até 500 linhas).
- Exportar Excel/CSV via `<ExportButton spec={anpCdpDiariaExport} />` do unified export library (Tier 2, modal com calculadora de tamanho server-side).

Header: título e sub variam por nível ("Daily Production by Field/Installation/Well"; Company → "Daily Net Production — <Company>").

### Company level — produção diária líquida por empresa (2026-06-05)

O nível **Company** responde à pergunta "como está a produção diária da PRIO (ou Petrobras, etc.)?". O usuário seleciona **uma empresa** (single-select) e vê a **produção líquida no stake**: para cada campo da empresa, `net = produção bruta do campo × stake_pct/100`.

Decisões de produto (travadas pelo CTO):
- **Seletor dinâmico**: todas as empresas em `field_stakes` que têm ≥1 campo no feed diário (`get_anp_cdp_diaria_empresas`). **PRIO e Petrobras em destaque** (pills); as demais via dropdown (desktop) / BottomSheet pesquisável (mobile).
- **Somente produção líquida** (campo × stake/100). **Sem toggle bruta.** `stake_pct` é usado apenas como rótulo ("PEREGRINO (80%)") / coluna de tabela / badge.
- **Single-select** — uma empresa por vez.

Modelo de dados:
- **net = bruta × stake** — computado server-side por `get_anp_cdp_diaria_empresa_serie` (`petroleo_bbl_dia_net`, `gas_mm3_dia_net`). O frontend apenas soma/agrega.
- **Total da empresa** (linha "Company total", laranja, bold): por dia, soma de `*_net` entre todos os campos.
- **Por campo**: linhas individuais net, label com stake.
- **Tabela/ranking por campo**: Field · Stake% · Net Oil avg · Net Gas avg · Latest net · Latest date (ordenado pela média do produto ativo).
- **Cobertura**: `get_anp_cdp_diaria_empresa_campos` retorna todos os campos do stake com flag `has_daily_data`. Os `false` viram a nota "Not yet in the daily feed: …".

Exemplo confirmado (PRIO, smoke test 2026-06-05): Frade/Polvo/Tubarão Martelo (100%), Albacora Leste (90%), Peregrino/Pitangola (80%) — todos com dado diário; **Wahoo (100%) — no daily data yet** (FPSO ainda fora do feed). Net Oil avg ≈ 157,5 kbpd. Peregrino latest net 72,5 kbpd = bruta 90,7 kbpd × 0,8 (confere).

Limitações conhecidas:
- **Wahoo / FPSO Frade** e campos onshore da Petrobras podem não estar no feed diário Power BI → aparecem na nota de cobertura, não nos charts/tabela. O INNER JOIN do `get_anp_cdp_diaria_empresa_serie` exclui campos sem dado diário.
- A discrepância "Field 94 vs Installation/Well 76 campos" (ver seção própria) **não** afeta Company, pois Company usa `anp_cdp_diaria` (Field-level, entity `v_campos_detalhe`).
- A produção líquida depende da curadoria de `field_stakes` no `/admin-panel`. Stakes desatualizados → net incorreto. Não é módulo novo (project_new_module_admin_requirements não se aplica) — é um modo dentro de um módulo existente; a curadoria de stakes já é feita no admin.

### Diferença vs `/anp-cdp`

| | `/anp-cdp` | `/anp-cdp-diaria` |
|---|---|---|
| Granularidade temporal | Mensal | Diária |
| Granularidades possíveis | Poço × campo (mensal) | Field, Installation, Well, **Company** (diário, toggle) |
| Fonte | Formulário CDP (Selenium + CAPTCHA, mensal) | Power BI ANP (3×/dia automático) + `field_stakes` (Company) |
| Tabela | `anp_cdp_producao` | `anp_cdp_diaria` + `anp_cdp_diaria_instalacao` + `anp_cdp_diaria_poco` (+ `field_stakes` p/ Company) |
| Range | Histórico longo (dezenas de anos) | Começa em 2025-11-30 (limitação da fonte) |

## Filtros UI por nível

Os filtros visíveis na sidebar dependem do `granularity`:

| Nível | Filtros visíveis |
|---|---|
| **Field** | Campo (client), Período (server) |
| **Installation** | Campo (server, push se selecionado), Instalação (client), Período (server) |
| **Well** | Campo (client), Poço (client), Período (server) |
| **Company** | Empresa (single-select, server: dispara fetch da série net), Período (server) — sem filtro de campo (o universo é o stake da empresa) |

A troca de nível (`onChange` do `SegmentedToggle`) **reseta todas as seleções de filtros** para evitar carregar termos estranhos entre vocabulários (ex: poço selecionado quando ainda estava no nível Field). A troca para/de Company também reseta `selectedEmpresa`, `empresaCampos` e `companySerieRows`.

> **Basin filter removed (2026-05-28)** — not relevant for the analyst workflow. The backend RPCs `get_anp_cdp_diaria_serie` and `get_anp_cdp_diaria_poco_serie` still accept `p_bacias` for compatibility, but the frontend wrapper now pins it to `NULL`. The per-row `bacia` column remains in chart hovertemplates, the desktop recent-records table, the mobile ranking card badge, and Excel/CSV exports — only the input filter is gone.

## RPCs consumidas

| Wrapper TS | RPC PostgreSQL | Retorno |
|---|---|---|
| `rpcGetAnpCdpDiariaFiltros` | `get_anp_cdp_diaria_filtros()` | `{ campos[], data_min, data_max }` (backend also returns `bacias[]`; dropped by wrapper since 2026-05-28) |
| `rpcGetAnpCdpDiariaSerie` | `get_anp_cdp_diaria_serie(p_campos, p_bacias, p_data_inicio, p_data_fim)` | `Array<{ data, campo, bacia, petroleo_bbl_dia, gas_mm3_dia }>` — wrapper pins `p_bacias = NULL` since 2026-05-28 |
| `rpcGetAnpCdpDiariaInstalacaoFiltros` | `get_anp_cdp_diaria_instalacao_filtros()` | `{ campos[], instalacoes[], data_min, data_max }` |
| `rpcGetAnpCdpDiariaInstalacaoSerie` | `get_anp_cdp_diaria_instalacao_serie(p_campos, p_instalacoes, p_data_inicio, p_data_fim)` | `Array<{ data, campo, instalacao, petroleo_bbl_dia, gas_mm3_dia }>` |
| `rpcGetAnpCdpDiariaPocoFiltros` | `get_anp_cdp_diaria_poco_filtros()` | `{ campos[], pocos[], data_min, data_max }` (backend also returns `bacias[]`; dropped by wrapper since 2026-05-28) |
| `rpcGetAnpCdpDiariaPocoSerie` | `get_anp_cdp_diaria_poco_serie(p_campos, p_bacias, p_pocos, p_data_inicio, p_data_fim)` | `Array<{ data, campo, bacia, poco, petroleo_bbl_dia, gas_mm3_dia }>` — wrapper pins `p_bacias = NULL` since 2026-05-28 |
| `rpcGetAnpCdpDiariaEmpresas` | `get_anp_cdp_diaria_empresas()` | `Array<{ empresa, n_campos_com_dado, n_campos_stake }>` (ordenado por n_campos_com_dado DESC) — popula o seletor |
| `rpcGetAnpCdpDiariaEmpresaSerie` | `get_anp_cdp_diaria_empresa_serie(p_empresa, p_data_inicio, p_data_fim)` | `Array<{ data, campo, bacia, stake_pct, petroleo_bbl_dia, gas_mm3_dia, petroleo_bbl_dia_net, gas_mm3_dia_net }>` — 1 linha por (data, campo), INNER JOIN (campos sem dado diário não vêm) |
| `rpcGetAnpCdpDiariaEmpresaCampos` | `get_anp_cdp_diaria_empresa_campos(p_empresa)` | `Array<{ campo, stake_pct, has_daily_data }>` (ordenado has_daily_data DESC, stake DESC) — cobertura do stake |

Tabelas e RPCs dos níveis Installation e Well foram criadas pela migration `20260508120001_anp_cdp_diaria_levels.sql`. As 3 RPCs do nível Company foram criadas pela migration `20260609000000` (todas `SECURITY DEFINER`, anon-safe).

> ⚠️ **Parsing das RPCs Company**: as colunas `numeric` (`stake_pct`, `petroleo_bbl_dia_net`, `gas_mm3_dia_net`) chegam como **string** no supabase-js. Os wrappers fazem `Number()` antes de retornar (tipos limpos: `*_net` como `number | null`). As colunas `real` (`petroleo_bbl_dia`, `gas_mm3_dia`) já chegam como number.

## Schema das tabelas alvo

Todas com `RLS: SELECT TO authenticated USING (true)` — padrão Phase 3.

### `anp_cdp_diaria` (Field — pré-existente)

| Coluna | Tipo | PK? |
|---|---|---|
| `data` | DATE | ✓ |
| `campo` | TEXT | ✓ |
| `bacia` | TEXT | ✓ |
| `petroleo_bbl_dia` | REAL | |
| `gas_mm3_dia` | REAL | |

### `anp_cdp_diaria_instalacao` (Installation — novo)

| Coluna | Tipo | PK? |
|---|---|---|
| `data` | DATE | ✓ |
| `instalacao` | TEXT | ✓ |
| `campo` | TEXT NOT NULL | |
| `petroleo_bbl_dia` | REAL | |
| `gas_mm3_dia` | REAL | |

### `anp_cdp_diaria_poco` (Well — novo)

| Coluna | Tipo | PK? |
|---|---|---|
| `data` | DATE | ✓ |
| `poco` | TEXT | ✓ |
| `campo` | TEXT nullable | |
| `bacia` | TEXT nullable | |
| `instalacao` | TEXT nullable | |
| `petroleo_bbl_dia` | REAL | |
| `gas_mm3_dia` | REAL | |

## Pipeline de origem

<!-- editado por worker_documentador 2026-05-08 — agent dash-anp-cdp-diaria não invocável nesta sessão -->

- **Script**: `scripts/extractors/anp_cdp_powerbi.py` (extrator Power BI — owner: `worker_etl-pipelines`). Estendido para extrair as 3 páginas (4, 5, 6).
- **Workflow**: `.github/workflows/etl_anp_cdp_diaria.yml`
- **Schedule**: 3×/dia (10:00, 15:00, 20:00 UTC)
- **Range**: dataset começa em **2025-11-09** (base point — primeira data com dados Power BI; `--start` default ajustado em commit `397a108c`)

### Semântica de upload — append-only (desde 2026-05-08)

Upload usa `ignore_duplicates=True` (PostgREST `Prefer: resolution=ignore-duplicates` → SQL `ON CONFLICT DO NOTHING`). Comportamento:

| Caso | Resultado |
|---|---|
| (data, dim) inédito | INSERT |
| (data, dim) já existe | SKIP — valor original preservado |

Aplica-se às 3 tabelas (`anp_cdp_diaria`, `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco`) — todas passam pela mesma `upload_to_supabase()`.

**Trade-off:** revisões retroativas do Power BI ANP não são refletidas (ex: se a ANP revisar a produção de um poço de Nov/2025 em Jun/2026, o valor original persiste). Decisão explícita do usuário — snapshot histórico tem prioridade sobre fidelidade a revisões.

> Installation e Well começam vazios até o primeiro run pós-deploy do ETL atualizado. UI lida bem com `data: []` (mensagem amigável "Sem dados de produção <level> ainda. O ETL desta granularidade roda 3×/dia — aguarde primeiro pull pós-deploy.").

## Charts esperados (todos os níveis)

| Chart | Tipo Plotly | Source RPC | Top-N agrupador |
|---|---|---|---|
| Petróleo (kbpd) | line (multi-trace) | RPC do nível atual | campo / instalacao / poco |
| Gás (Mm³/dia) | line (multi-trace) | RPC do nível atual | campo / instalacao / poco |
| Production by ... (tabela) | HTML table com sticky thead | mesma série | colunas por nível |

A tabela "Production by ..." muda colunas por nível:

| Nível | Colunas |
|---|---|
| Field | Date · Bacia · Campo · Oil · Gas |
| Installation | Date · Campo · Instalação · Oil · Gas |
| Well | Date · Bacia · Campo · Poço · Oil · Gas |

## Display units (kbpd vs raw bbl/day)

The petroleum trace, the table column "Petróleo", and the chart Y-axis label are rendered in **kbpd** (thousand barrels per day). The underlying column `petroleo_bbl_dia` returned by all three level RPCs (`get_anp_cdp_diaria_serie`, `*_instalacao_serie`, `*_poco_serie`) is still in **bbl/day**; the page divides by 1000 at display time via `bblDiaToKbpd()` from [`src/lib/units.ts`](../../src/lib/units.ts). Excel/CSV exports keep the raw bbl/day column header for data fidelity. Gas remains in its native `Mm³/dia`.

## Padrões consolidados aplicados

- [x] Header: `<DashboardHeader title sub period>` com `<hr>` separator
- [x] Period badge: condicional ao `hasDates` (`[string, string] | null`)
- [x] Push período (Field/Well) ou período + campos (Installation) para RPC server-side
- [x] Debounce 400ms via `useDebouncedFetch`
- [x] Loading: `<BarrelLoading>` no init; `<ChartSection loading>` inline durante refetch
- [x] Filtros: `<SearchableMultiSelect>` (Campo, Instalação, Poço) com counter `(N/total)`
- [x] **`<SegmentedToggle>` (Field/Installation/Well) no topo dos filtros**, abaixo do "TBD" e acima da seção "Filtros"
- [x] Empty state amigável (chart e tabela) quando filtros sem dados, e mensagem específica quando o ETL ainda não populou Installation/Well
- [x] Identidade visual: `#FF5000` first color, Arial, padrão `COMMON_LAYOUT` + `AXIS_LINE`, pill desliza laranja
- [x] pt-BR consistente (labels, hovertemplate, números via `Intl.NumberFormat("pt-BR")`)
- [x] Visibility guard: `useModuleVisibilityGuard("anp-cdp-diaria")`

## Definition of Done

1. **`npx tsc --noEmit` clean** — passou (zero erros).
2. **`npx eslint src/app/(dashboard)/anp-cdp-diaria` clean** — passou (zero warnings).
3. **Smoke test em dev server**: toggle alterna entre Field/Installation/Well, filtros do nível populam, charts e tabela renderizam (ou empty state coerente quando Installation/Well vazios pré-ETL).
4. **Self-QA estática**: comparado com `/anp-glp` (granularidade temporal), `/anp-lpc` (slider de datas), `/anp-precos-distribuicao` (export modal Tier 2), `/sales-volumes` (uso do `SegmentedToggle` para View Mode).
5. **Sub-PRD (este arquivo)** atualizado.

## Dependências cross-departamentais

- **Schema/RPCs (`worker_supabase`)**: criou `anp_cdp_diaria` + 2 RPCs originais (Phase 3) + migration `20260508120001_anp_cdp_diaria_levels.sql` adicionando `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco` + 4 RPCs novas + RLS.
- **Pipeline ETL (`worker_etl-pipelines`)**: extrator estendido para processar páginas 5 e 6 do Power BI; workflow já roda 3×/dia. Tabelas Installation/Well começam vazias até primeiro pull pós-deploy.
- **Admin (`worker_dash-admin`)**: slug `anp-cdp-diaria` em `module_visibility` (default visível) — sem mudança nesta tarefa.

## Anti-padrões / decisões técnicas

- **RPC `get_anp_cdp_diaria_export_count(p_nivel, p_filtros)` é o oráculo de tamanho do modal** desde a migração para o unified export library (2026-05-28). Substitui a heurística `refetch + length` por nível. Wrapper TS: `rpcGetAnpCdpDiariaExportCount(nivel, filtros)`.
- **Filtro de "dimensão" não é empurrado pra RPC do chart no nível Field e Well**: queremos buscar todos os campos/poços no período para que a Top-N (defaults) seja estável — só o slider de período dispara refetch debounced. Filtro de dimensão é client-side.
- **No nível Installation, push de campos para RPC**: como instalação não pertence a uma bacia explícita e o universo de instalações pode ser denso, o filtro de campos é empurrado server-side para reduzir payload. Filtro de instalação é client-side.
- **Reset de filtros ao trocar nível**: vocabulários diferentes (instalação só existe em Installation, poço só em Well) — manter seleções antigas após troca causaria filtros vazios silenciosos.
- **Basin filter removido (2026-05-28)**: o filtro de bacia foi removido da sidebar (desktop) e do FilterDrawer (mobile) por não ser relevante para a análise diária. Os wrappers TS continuam aceitando o parâmetro internamente (pinned a NULL) e o backend não foi tocado.
- **Linha unificada (`UnifiedRow`) para chart/table**: cada nível projeta seu shape específico para `{ data, campo, bacia, dimension, ... }` antes de alimentar `pickTopDimensions` e `buildSerieChart`, mantendo o downstream level-agnostic.

## Export (unified library)

Migrated to the unified export library on 2026-05-28 (contract: [`docs/app/export-library-contract.md`](export-library-contract.md)). Spec file: [`src/lib/export/dashboards/anpCdpDiaria.ts`](../../src/lib/export/dashboards/anpCdpDiaria.ts).

> **Company-level export is P2 (not shipped 2026-06-05).** The export modal stays pinned to the 3 nível options (Campo / Instalação / Poço). The Company net serie is not yet a candidate sheet — the company feature shipped without touching the export spec to avoid blocking it. Add a `empresa` nível + a net-columns sheet when prioritized.

| Field | Value |
|---|---|
| `filename` | `DailyProduction` (library appends `_{nivel}_DD-MM-YY.<ext>`) |
| `tier` | 2 (modal with size estimator) |
| `filterSource` | `"modal-editable"` — filters drawn from zero in the modal, **not** WYSIWYG of dashboard state. The dashboard's `granularity` sidebar toggle does **not** propagate into the export; the user picks the nível inside the modal. |
| Sheets / files | Spec declares 3 candidate sheets (`"Campo"` / `"Instalação"` / `"Poço"`); only the one matching the chosen `nivel` carries rows (see "Multi-sheet behavior — P1" below). |
| CSV mode | `single` — same row set as the active sheet |
| Charts | None |

### Multi-sheet behavior — P1 (2026-05-28)

`ExcelBuilder.downloadExcel` iterates **all** declared sheets unconditionally, so every download materializes the 3 sheets. To avoid triggering the 3 RPC pulls per click (including the ~180k-row Poço one), each sheet's `rowsAsync` short-circuits with `[]` when `filters.nivel` does not match its own level. The resulting workbook contains 3 tabs — only the one matching the chosen `nivel` has rows; the other two are empty tabs. Mirrors the `flow` short-circuit pattern used by `/imports-exports`. **Phase 2** will collapse the workbook to a single sheet via an `ExcelBuilder` enhancement that honors the `segmented` sheet-selection convention documented below.

### Modal filters

| Key | Type | Default | Notes |
|---|---|---|---|
| `nivel` | `segmented` | `"campo"` | Field / Installation / Well — selects which sheet (and which columns) is materialized |
| `period` | `date-range` | Last 30 days (today − 30 → today) | |
| `campos` | `multi-select` (options from `rpcGetAnpCdpDiariaFiltros`) | `[]` (= all) | Always visible |
| `instalacoes` | `multi-select` (options from `rpcGetAnpCdpDiariaInstalacaoFiltros`) | `[]` (= all) | Library should show only when `nivel = instalacao` |
| `poco` | `search` | empty | Library should show only when `nivel = poco`; wrapper passes the typed string as a single-element `pocos` array |

### Sheet columns per nível

| Nível | Sheet name | Columns |
|---|---|---|
| `campo` | `"Campo"` | Date · Field · Basin · Oil (bbl/day) · Gas (Mm³/day) |
| `instalacao` | `"Instalação"` | Date · Installation · Field · Oil (bbl/day) · Gas (Mm³/day) |
| `poco` | `"Poço"` | Date · Well · Field · Basin · Installation · Oil (bbl/day) · Gas (Mm³/day) |

### Size estimator

Server-side count via `rpcGetAnpCdpDiariaExportCount(nivel, filtros)` → `get_anp_cdp_diaria_export_count(p_nivel text, p_filtros jsonb)`. Filter payload keys: `data_inicio`, `data_fim`, `campos`, `instalacoes`, `pocos`. Unknown keys silently ignored by the SQL function. The legacy heuristic in `src/lib/exportSizeHeuristics.ts` (`anp_cdp_diaria`, `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco`) is no longer consumed by this dashboard, but the keys remain in the file for backward compatibility until the cleanup wave.

### Sheet-selection convention

When `filterSource === "modal-editable"` and the modal declares a `segmented` filter with `key = "nivel"`, the library materializes only the matching sheet at download time (mapping `campo → "Campo"`, `instalacao → "Instalação"`, `poco → "Poço"`). The unified library author (`worker_subgerente-app`) is responsible for wiring this selection — see the binding header comment in the spec file.

## Performance

- **Field**: `anp_cdp_diaria` é pequena (~16.5k inicial); fetch sem filtros traz tudo (~3MB descomprimido).
- **Installation**: tamanho similar a Field × ~N instalações por campo; primeiros runs mostrarão a magnitude real.
- **Well**: nível mais profundo — pode crescer rápido (centenas de poços × dia). Fetch de série pode pular de "wide" para "narrow filter required" se passar de ~100k linhas. TODO: monitorar e adicionar filtro obrigatório de período se necessário.
- **Top 10 client-side via `useMemo`** — sem refetch ao mudar seleção de campos/instalações/poços.
- **Debounce 400ms** no fetch ao mudar slider de datas ou filtro server-side.
- **Paginação PostgREST**: cada wrapper usa `.range(offset, offset+999)` em loop até esgotar.

## Limitação: filtro Campo em Installation/Well mostra 76 (vs 94 em Field)

<!-- editado por worker_documentador 2026-05-08 — agent dash-anp-cdp-diaria não invocável nesta sessão -->

A discrepância vem da fonte (Power BI ANP), não do nosso ETL.

- **Field** usa a entity `v_campos_detalhe` → atribuição **N:N** (mesma produção atribuída a múltiplos campos via rateio ANP). Retorna **94 campos**.
- **Installation / Well** usam a entity `v_poco_instalacao_sigep_ultimo` → atribuição **1:1** ("último" mapping — cada poço linka a apenas UM campo principal contratual). Retornam **76 campos**.

Os 19 campos ausentes em Installation/Well são todos casos onde 100% dos poços são compartilhados com outro campo "principal", e `v_poco_instalacao_sigep_ultimo` mapeia cada poço apenas ao principal.

### Exemplos confirmados (cross-check com `anp_cdp_producao` mensal)

| Poço representativo | Campo principal (Well/Installation) | Campo(s) "perdidos" (Field-only) |
|---|---|---|
| `7-BUZ-10-RJS` | BÚZIOS | TAMBUATÁ (32 poços compartilhados) |
| `7-LL-100-RJS` | TUPI | AnC_TUPI (51 poços) |
| `7-MRO-10B-RJS` | MERO | AnC_MERO |
| `7-SPH-1-SPS` | SAPINHOÁ | NE / SO / NO de SAPINHOÁ (14 poços) |
| `7-PRG-76HB-RJS` | PEREGRINO | PITANGOLA (9 poços) |
| `7-PM-21D-RJS` | PAMPO | LINGUADO (4 poços) |
| `7-BAC-1-SPS` | BACALHAU | BACALHAU NORTE |
| `6-BRSA-770D-RJS` | MARLIM | ESPADIM + VOADOR |
| `7-JUB-57DPA-ESS` | JUBARTE | AnC_Jubarte_Nordeste/Sudoeste |

Os 19 campos faltantes representam ~0,3% da produção nacional (maioria são buckets `AnC_*` ou produção zerada).

**Decisão:** documentar e manter como está. Implementar atribuição N:N de fato exigiria criar tabela de mapping `(poco, campo, share_pct)` derivada de `anp_cdp_producao` (mensal × poço × campo, PK composta suporta N:N nativamente) — fora de escopo.

## Histórico

- `2026-05-08` — Implementação inicial (Field-only).
- `2026-05-08` — **Adicionada granularidade Installation e Well via `SegmentedToggle`**. 4 RPC wrappers novos, 2 chaves novas em export heuristics, sub-PRD atualizado. Migration `20260508120001_anp_cdp_diaria_levels.sql` aplicada via supabase_deploy.yml.
- `2026-05-27` — **Mobile reform v2 (Onda 3)**. `mobile/View.tsx` reescrito: período preset pills (1M/3M/6M/1Y/All) no chip row sticky; dois charts (Oil + Gas) empilhados verticalmente sempre visíveis (sem tab Oil/Gas); ranking Top 10 com `MobileDataCard` + botão "See all N fields" abre `BottomSheet` (90vh) com lista completa pesquisável; production summary card 2×3; `ExportFAB`/`ExportModal` removidos (export é desktop-only); `MobileTabBar` de produto removido. Commit `b29914ff`, branch `worktree-agent-ae3d7c80602ee09fb`.
- `2026-05-28` — **Export migrado para o unified export library** ([contract](export-library-contract.md)). Novo spec em `src/lib/export/dashboards/anpCdpDiaria.ts`; `desktop/View.tsx` agora consome `<ExportButton spec={anpCdpDiariaExport} />` em `DashboardHeader.rightSlot`. Estado de export modal/handlers removidos do hook do desktop (modal-editable filters: período default last 30d, todos os campos). Novo wrapper TS `rpcGetAnpCdpDiariaExportCount(nivel, filtros)` em `src/lib/rpc.ts` envelopando `get_anp_cdp_diaria_export_count(p_nivel, p_filtros)` (shipped por worker_supabase). Heurística em `exportSizeHeuristics.ts` deprecada para este dashboard.
- `2026-06-05` — **Nível Company (produção diária líquida no stake por empresa)**. 4º modo no `Granularity` (`"company"`). Seletor dinâmico (PRIO/Petrobras em destaque + dropdown/BottomSheet das demais), single-select, somente net (campo × stake/100). Desktop: KPI strip + 2 charts net (total + por campo, labels com stake) + tabela net por campo + nota "no daily data yet" (ex.: Wahoo). Mobile (binding sync, mesmo commit): switch `Fields | Companies`, pills PRIO/Petrobras + BottomSheet, charts do total net, ranking `MobileDataCard` por campo com stake%, nota de cobertura. 3 wrappers TS novos (`rpcGetAnpCdpDiariaEmpresas`, `rpcGetAnpCdpDiariaEmpresaSerie`, `rpcGetAnpCdpDiariaEmpresaCampos`) com `Number()` das colunas numeric-as-string. Backend: 3 RPCs `SECURITY DEFINER` da migration `20260609000000` (commit `9caefb28`, worker_supabase). Export Company P2 (não tocado). Smoke test (Preview MCP): PRIO → 6 campos net + Wahoo na nota; Petrobras → 37 campos net. `tsc`/`eslint` clean.
