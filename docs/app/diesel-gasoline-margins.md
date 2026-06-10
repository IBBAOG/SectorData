# Sub-PRD — `/diesel-gasoline-margins`

Dashboard de Margens Diesel/Gasolina. Owner: [`worker_dash-margins`](../../.claude/agents/worker_dash-margins.md).

## Escopo de código

```
src/app/(dashboard)/diesel-gasoline-margins/
  page.tsx                           ← viewport router (useIsMobile)
  useDieselGasolineMarginsData.ts    ← single brain hook
  desktop/View.tsx                   ← desktop UX (sidebar + charts)
  mobile/View.tsx                    ← mobile UX (MobileTopBar + stacked chart + cards)
```

RPC wrappers: seção "d_g_margins" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

## Dual-view structure

Dashboard follows the canonical dual-view pattern from `docs/app/dual-view-pattern.md` (Phase 2 / Wave 2).

### Hook — `useDieselGasolineMarginsData.ts`

Single source of truth for both Views. Exports:

| Export | Type | Purpose |
|---|---|---|
| `allRows` | `DgMarginsRow[]` | Full unfiltered data (needed by VariationsTable for YoY/QTD) |
| `filteredRows` | `DgMarginsRow[]` | Rows matching current week-range |
| `weeks` | `string[]` | Ordered week strings from `get_dg_margins_filters` |
| `weekRange` | `[number, number]` | Index pair into `weeks` |
| `setWeekRange` | setter | Updates week-range filter |
| `visibleWeeks` | `string[]` | `weeks.slice(weekRange[0], weekRange[1]+1)` |
| `latestVisibleWeek` | `string \| null` | Last element of visibleWeeks |
| `loading / error` | — | Fetch state |
| `excelLoading / setExcelLoading` | — | Excel export busy state (shared) |

Also exports week helpers (`parseWeek`, `weekToDateRange`, `weekLastDay`, `weekLastDayShort`, `weekLastDayFormatted`, `compLabel`) and constants (`STACK_COLORS`, `ANNOT_COLORS`, `MARGIN_LINE_COLORS`, `STACK_COMPONENTS`, `TABLE_KEYS`) so Views share the same logic and palette.

`weekLastDayFormatted` produces `dd-mmm-yy` labels (e.g. `09-Jan-21`, `02-May-26`, en-US month abbreviation). Used exclusively for chart x-axis tick values. `weekLastDay` / `weekLastDayShort` remain for non-chart UI (badges, slider tooltips, table headers).

### Desktop View — `desktop/View.tsx`

Verbatim migration of the previous `page.tsx` body. Layout:
- Sidebar with `WeekSlider` + `WeekPeriodBadge`
- Distribution & Resale Margin comparison line chart (both fuels)
- Weekly variations tables (WoW, −4 Weeks, QTD, YoY) — Diesel B + Gasoline C side-by-side
- Stacked area charts (Diesel B + Gasoline C price composition)
- `<ExportButton spec={dgMarginsExport} />` (unified library — Tier 1, 2 sheets, no filters; see Export section below)

### Mobile View — `mobile/View.tsx`

Wave 3 reform (2026-05-27) — full desktop content parity, re-layout mobile-first. Layout:
- **Sticky sub-bar**: `FuelTab` segmented control (Diesel B / Gasoline C) + `FilterChip` (period → opens drawer). Sits below the global `MobileTopBar` rendered by `MobileLayout`.
- Latest week badge
- `MobileChart` stacked area (selected fuel only — full-width, height 260) — all 5 components
- **Comparison table** (`ComparisonTable`): WoW / −4 Wks / QTD / YoY deltas for all components, color-coded cells, horizontal scroll with first column sticky.
- **No ExportFAB** (§ 3.4 mobile reform policy — export disabled on mobile).

> **[mobile-only] 2026-05-28:** KPI delta block ("Current Week vs Prior Week" horizontal-scroll cards) removed. Mobile layout now shows only the stacked area chart + comparison table below the sticky sub-bar.

Filter drawer (`FilterDrawer` + `DrawerWeekSlider`):
- Week-range slider with year marks
- Draft-then-apply pattern (changes only committed on "Apply")

### Divergences

| Aspect | Desktop | Mobile |
|---|---|---|
| Fuel selection | Both fuels shown simultaneously | One fuel at a time via `FuelTab` |
| Variations table | Full WoW/−4W/QTD/YoY table | Same data — `ComparisonTable` with horizontal scroll |
| KPI delta block | N/A (inline in table) | Removed (2026-05-28) — WoW delta visible via Variation Table |
| Export trigger | `ExportPanel` inline in header | None (§ 3.4 policy) |
| Period label | `WeekPeriodBadge` in sidebar | `FilterChip` in sticky sub-bar → `FilterDrawer` |

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
| `get_dg_margins_data` | Linhas (filtráveis) — read-only, consumida pela UI |
| `get_dg_margins_filters` | Opções de filtros |
| `recompute_dg_margins(p_week_start text, p_week_end text)` | **Recompute job** — `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `SET statement_timeout = '300s'`, `EXECUTE` only `service_role`. Recalcula `d_g_margins` para o range de semanas ISO informado a partir das tabelas-fonte (preços, produção, ethanol, impostos, blend). Args são ISO `"W/YYYY"` unpadded (ex. `12/2026`), parseados via `to_date('IYYY-IW')`; ambos NULL = timeline completa. Chamada pelo workflow `etl_dg_margins.yml` (rotina: janela das últimas ~12 semanas; full timeline só via `full_backfill`). Não callable pelo anon/authenticated. Timeout guard + otimização set-based do `imp_pct` em `20260616100000` (incident 2026-06-09) — ver § "Como o dado chega". |

## Tabela

`d_g_margins`:
- PK: `id`
- Chave de upsert: `(fuel_type, week)`
- Colunas: `fuel_type, week, base_fuel, biofuel_component, federal_tax, state_tax, distribution_and_resale_margin, total`
- 566 rows (cutover state). O arquivo manual antigo está arquivado em `d_g_margins_manual_bak`.

### Reference / source tables (lidas pelo `recompute_dg_margins`)

| Tabela | Conteúdo | Origem |
|---|---|---|
| `cepea_etanol_anidro` | Preço semanal R$/L do etanol anidro | CEPEA/ESALQ |
| `anp_producao_derivados` | Produção mensal nacional (m³) de Gasolina A / Óleo Diesel | ANP |
| `anp_sintese_taxes` | **Imposto federal + ICMS (R$/L)** publicados pela ANP — `federal_rs_litro` (Tributos Federais) + `icms_rs_litro` (ICMS) por `(data_fim, fuel_type)`; **fonte primária** dos impostos, auto-atualizável | ANP Síntese de Preços (composição), via `anp_sintese_taxes_sync.py` |
| `fuel_tax_reference` | Imposto federal + ICMS (R$/L) por período — **fallback** histórico/lacuna do `anp_sintese_taxes` | ANP Síntese de Preços (federal) + CONFAZ (ICMS ad-rem) |
| `fuel_blend_ratio` | % de mandato de etanol / biodiesel por período | ANP / regulação |
| `price_bands` | Paridade de importação + preço Petrobras | Dados Locais (`price_bands`) |
| `anp_lpc_brasil` | **Preço de bomba (pump)** — revenda **nacional publicada pela ANP** (volume-weighted, aba BRASIL do resumo semanal); fonte primária do pump desde 2026-06-08 | ANP LPC (aba BRASIL) |
| `anp_lpc` | Preço de bomba — média **station-weighted** sobre linhas per-UF; usada **só como fallback** nas semanas sem resumo ANP nacional | ANP LPC (per-UF) |
| `anp_desembaracos` / `mdic_comex` | Volume de importação (kg→m³ via densidade NCM) | ANP / MDIC |

## Como o dado chega

**Fully automated (computed) since 2026-06-05.** A tabela `d_g_margins` deixou de ser preenchida manualmente (Excel + admin Data Input) e passou a ser **calculada** por um job SQL a partir de fontes públicas.

### Pipeline

```
etl_dg_margins.yml
  triggers:
    - PRIMARY: workflow_run after a successful etl_anp_lpc.yml (daily 14:30 UTC scrape)
    - FALLBACK: daily 15:00 UTC cron (after the 14:30 LPC scrape)
    - MANUAL: workflow_dispatch (inputs: full_backfill bool, week_start "W/YYYY")
  steps:
    ├─ scripts/pipelines/cepea/cepea_etanol_anidro_sync.py            → cepea_etanol_anidro
    ├─ scripts/pipelines/anp/producao/anp_producao_derivados_sync.py  → anp_producao_derivados
    ├─ scripts/pipelines/anp/sintese/anp_sintese_taxes_sync.py        → anp_sintese_taxes (continue-on-error; nunca trava o recompute)
    └─ recompute_dg_margins(week_start, week_end)                     → d_g_margins (upsert por (fuel_type, week))
         routine: bounded to the last ~12 ISO weeks (dynamic), p_week_end=NULL
         full timeline: only via workflow_dispatch full_backfill=true
```

### Ordering & schedule (incident 2026-06-09)

The "Distribution & Resale Margin" is a residual driven by the ANP pump price in
`anp_lpc`. ANP publishes the weekly LPC survey on an **unstable weekday** (assumed
Wed; on 2026-06-09 it was a Tuesday). The old setup ran this recompute on Tue 15:00
UTC but `anp_lpc` only scraped Wed 14:30 UTC — so the margins ran a full day *before*
the freshest pump price even landed, freezing the dashboard and starving the Client
Alert. Fixed by:

1. `etl_anp_lpc.yml` now scrapes **daily** (incremental + idempotent), tracking ANP's
   publish day within ~24h.
2. `etl_dg_margins.yml` **primary trigger is `workflow_run`** downstream of a
   *successful* `etl_anp_lpc.yml`, so the recompute (and its Client Alert hook) always
   runs on the freshest pump price the same day ANP publishes.
3. A **daily 15:00 UTC fallback cron** (after the 14:30 LPC scrape) backstops the
   `workflow_run` path.
4. The **routine recompute is bounded to the last ~12 ISO weeks** (computed
   dynamically as `today − 12 weeks` in unpadded ISO `"W/YYYY"`, `p_week_end=NULL`), so
   each run finishes in seconds. The **full-timeline recompute** is reachable only via
   the manual `workflow_dispatch` input `full_backfill=true`.

### Timeout guard & optimization (incident 2026-06-09)

Migration `20260616100000_recompute_dg_margins_timeout_guard.sql` (live in prod) added
a function-level `SET statement_timeout = '300s'` and a set-based optimization of the
`imp_pct` block (computed once per `(fuel_type, month)` instead of per `(week, fuel)` —
QA-verified result-identical). **Nuance:** the function-level `SET statement_timeout`
does *not* rescue the PostgREST call path (PostgREST runs as `authenticator`, whose
30s login-time timeout governs; `SET ROLE service_role` does not pick up its config, and
a `SET` inside an already-running statement does not re-arm its timer). The prod path is
fixed by the set-based optimization (full recompute now <30s) + the ETL's bounded-window
call; the function-level guard only protects direct / pg_cron / psql callers. Full
detail in [`docs/supabase/PRD.md`](../supabase/PRD.md) § "`recompute_dg_margins` — timeout
guard & optimization" and [`docs/etl-pipelines/PRD.md`](../etl-pipelines/PRD.md) §
"D&G Margins — ordering & bounded recompute".

### Fórmula de decomposição (R$/L, por semana ISO)

Cada componente é em R$/L; `total` reconstrói o preço de bomba.

| Componente | Cálculo |
|---|---|
| `base_fuel` | `(import_parity × import% + petrobras_price × production%) × (1 − blend)`. `import_parity`/`petrobras_price` vêm de `price_bands`. |
| `biofuel_component` | **Gasolina:** etanol anidro (lag de 1 semana, `week−1`) × `ethanol_blend`. **Diesel:** Biodiesel B-100 (mesma semana) × `biodiesel_blend`. |
| `federal_tax` | **Tributos Federais** publicados pela ANP Síntese (`anp_sintese_taxes.federal_rs_litro`) para a semana ISO; **fallback** para a soma das linhas não-ICMS de `fuel_tax_reference` nas semanas sem Síntese. |
| `state_tax` | **ICMS** publicado pela ANP Síntese (`anp_sintese_taxes.icms_rs_litro`) para a semana ISO; **fallback** para o ICMS de `fuel_tax_reference` (CONFAZ ad-rem) nas semanas sem Síntese. |
| `distribution_and_resale_margin` | **residual** = `pump − (todos os componentes acima)`. |
| `total` | = preço de bomba (pump) = **revenda nacional publicada pela ANP** (`anp_lpc_brasil`, volume-weighted, `'GASOLINA COMUM'` / `'DIESEL S10'`), com **fallback** para a média station-weighted de `anp_lpc` só nas semanas sem resumo ANP. Ver § "Pump price". |

- **`import%`** = `imports / (imports + production)`, onde `imports` vem de `anp_desembaracos`/`mdic_comex` (kg→m³ via densidade NCM) e `production` de `anp_producao_derivados`. `production% = 1 − import%`.

### Pump price — ANP national (Brasil) com fallback station-weighted (2026-06-08)

Desde 2026-06-08 o pump (`total`, e portanto o residual `distribution_and_resale_margin`) usa o **valor de revenda nacional publicado pela ANP** diretamente, em vez de recalcular a média a partir das linhas per-UF.

```
pump(fuel, week) = COALESCE(
  anp_lpc_brasil.preco_revenda,   -- (1) ANP Brasil para a mesma semana ISO (preferido)
  SUM(anp_lpc.preco_medio_venda * n_postos) / NULLIF(SUM(n_postos), 0)  -- (2) fallback gap-week
)
```

- **Por quê**: a média nacional da ANP é **volume-weighted por região**; a antiga média station-count-weighted rodava **~R$0,04 alto** (diferença de metodologia). Com o valor publicado, semanas recentes batem exato com a ANP (ex.: wk23/2026 Gasolina 6.61 / Diesel 7.12).
- A fonte primária `anp_lpc_brasil` cobre ~146 semanas (2023-05→presente) **com lacunas** — a ANP não publica o resumo toda semana; nessas semanas o pump cai no fallback station-weighted (byte-for-byte o cálculo antigo).
- Só `total` e `dist_margin` mudam nas semanas cobertas; `base_fuel`, `biofuel_component`, `federal_tax`, `state_tax` são idênticos. Migrations `20260617000000_anp_lpc_brasil.sql` + `20260617100000_recompute_dg_margins_brasil_pump.sql`.

### Impostos federais + ICMS — fonte primária ANP Síntese, auto-atualizável (2026-06-08)

Desde 2026-06-08 `federal_tax` e `state_tax` usam as linhas de imposto **publicadas pela ANP Síntese de Preços** (`anp_sintese_taxes`) como fonte primária, com `fuel_tax_reference` como fallback histórico/lacuna.

```
federal_tax(fuel, week) = COALESCE(
  anp_sintese_taxes.federal_rs_litro,   -- (1) "Tributos Federais" da Síntese p/ a mesma semana ISO
  SUM(fuel_tax_reference.rate_rs_litro WHERE tax_type <> 'ICMS' AND ativo)  -- (2) fallback
)
state_tax(fuel, week) = COALESCE(
  anp_sintese_taxes.icms_rs_litro,      -- (1) "ICMS" da Síntese p/ a mesma semana ISO
  fuel_tax_reference.rate_rs_litro WHERE tax_type = 'ICMS' AND ativo            -- (2) fallback
)
```

- **Por quê**: a Síntese é raspada semanalmente (`anp_sintese_taxes_sync.py`, step 2b do `etl_dg_margins.yml`), então quando a ANP mudar um imposto publicado o scraper captura o novo valor e o próximo recompute o adota — **sem edição manual** em `fuel_tax_reference`.
- **Sem mudança de valor hoje**: as linhas da Síntese publicadas hoje são **iguais** aos valores seedados de `fuel_tax_reference`, então `total` e o residual `dist_margin` ficam byte-for-byte nas semanas cobertas. A mudança é puramente estrutural (liga o caminho de auto-atualização).
- `fuel_tax_reference` continua como **fallback** histórico/lacuna (a composição da Síntese só é parseável de forma confiável ~meados de 2025+). O guard skip-if-NULL é preservado — a Síntese só ADICIONA cobertura. Migrations `20260618100000_anp_sintese_taxes.sql` + `20260621100000_recompute_dg_margins_prefer_sintese_taxes.sql`.

### Fontes (exibidas no dashboard)

"Sources: ANP · CEPEA/ESALQ · CONFAZ".

- **ANP** — produção de derivados, preços LPC/produtor (incl. revenda **nacional Brasil** = pump, `anp_lpc_brasil`; per-UF `anp_lpc` como fallback), **Síntese de Preços (composição) = fonte primária dos impostos federais + ICMS** (`anp_sintese_taxes`).
- **CEPEA/ESALQ** — preço do etanol anidro (licença **CC BY-NC, atribuição obrigatória**).
- **CONFAZ** — ICMS ad-rem (fallback histórico/lacuna via `fuel_tax_reference`).
- **`price_bands`** — paridade de importação / preço Petrobras.

### Escopo do cutover

| Janela | Origem |
|---|---|
| Era ad-rem ICMS (Gasolina a partir de Jun/2023; Diesel a partir de Mai/2023) | **Computado** via `recompute_dg_margins`. |
| Pré-ad-rem (2021 → meados de 2023, era ICMS ad-valorem) | **Preservado** da série manual original. |

A série manual completa fica arquivada em `d_g_margins_manual_bak`.

**Data owner:** `worker_etl-pipelines` (automated ETL). Este dashboard é read-only.

## Palette

| Constant | Key | Color | Used in |
|---|---|---|---|
| `MARGIN_LINE_COLORS` | `"Diesel B"` | `#FF5000` (brand orange) | Dist. & Resale Margin line chart |
| `MARGIN_LINE_COLORS` | `"Gasoline C"` | `#1a1a1a` (black) | Dist. & Resale Margin line chart |
| `STACK_COLORS` | `distribution_and_resale_margin` | `#FF5000` | Stacked area charts (both fuels) |

Both views share `MARGIN_LINE_COLORS` via the hook — no per-view color override exists.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| ETL / Pipelines | `etl_dg_margins.yml` + 2 scrapers (CEPEA, ANP produção) + chamada `recompute_dg_margins` |
| Supabase / DB | Schema/migration de `d_g_margins` + tabelas de referência (incl. `anp_lpc_brasil`, migration `20260617000000`) + RPC `recompute_dg_margins` (grant `service_role`; pump = ANP Brasil desde `20260617100000`) |
| Dados Locais | `price_bands` (paridade / Petrobras) é input do cálculo |
| Designer | Stacked chart pattern, cores dos componentes |

## Filtros tipicamente usados (UI)

- `fuel_type` (Diesel, Gasolina) — geralmente como tabs ou toggle.
- Período (slider de semanas).

## Anti-padrões

- Tentar reativar o upload manual (`scripts/manual/dg_margins_upload.py`) ou o editor admin Data Input — ambos foram **retirados** na reforma de automação. A tabela agora é computada.
- Sobrescrever as semanas pré-ad-rem (2021→meados de 2023) com o recompute — elas são preservadas da série manual.
- Esquecer a atribuição CEPEA/ESALQ (CC BY-NC) ao exibir o componente de etanol anidro.
- Mostrar `fuel_type` em inglês na UI — traduza pra "Diesel" / "Gasolina".

## Export

Tier 1 — download direto via `<ExportButton spec={dgMarginsExport} />` na unified library (ver [`docs/app/export-library-contract.md`](export-library-contract.md)).

- **Spec file:** [`src/lib/export/dashboards/dgMargins.ts`](../../src/lib/export/dashboards/dgMargins.ts) (owner `worker_dash-margins`).
- **`filename`:** `"DGMargins"` → `DGMargins_DD-MM-YY.<xlsx|csv>`.
- **`tier`:** 1 (no modal — two buttons, direct download).
- **`filterSource`:** `"none"` — sempre exporta histórico completo, ambos os fuel types, sem filtros aplicados (decidido pelo CTO).
- **Excel:** 2 sheets — `Diesel B` e `Gasoline C`. Colunas por sheet (mesma ordem, headers per-fuel override no biofuel e base_fuel):

  | key | Diesel B header | Gasoline C header | numFmt |
  |---|---|---|---|
  | `week` | Week | Week | (text) |
  | `distribution_and_resale_margin` | Distribution & Resale Margin | Distribution & Resale Margin | `0.00` |
  | `state_tax` | State Tax | State Tax | `0.00` |
  | `federal_tax` | Federal Tax | Federal Tax | `0.00` |
  | `biofuel_component` | **Biodiesel** | **Anhydrous Ethanol** | `0.00` |
  | `base_fuel` | **Diesel A** | **Gasoline A** | `0.00` |
  | `total` | Total | Total | `0.00` |

  Per-sheet `rowsAsync` chama `rpcGetDgMarginsData(fuel_type)` — uma chamada por sheet, sem filtros.
- **CSV:** `mode: "single-with-discriminator"`, `discriminatorColumn: "fuel_type"`. Um único `.csv` com a coluna `fuel_type` distinguindo Diesel B e Gasoline C (valores idênticos aos da coluna do banco).
- **Charts (Excel):** nenhum (stacked bar descartado pelo CTO — só dados tabulares).
- **Mobile:** export desabilitado por política da reforma mobile v2 (§ 3.4) — `ExportButton` retorna `null` em `useIsMobile()`.
