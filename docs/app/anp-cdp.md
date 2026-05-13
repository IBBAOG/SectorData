# Sub-PRD — `/anp-cdp`

Dashboard ANP CDP — Produção por Poço (Oil & Gas). Owner: [`worker_dash-anp-cdp`](../../.claude/agents/worker_dash-anp-cdp.md).

> **Único dashboard do dropdown "Oil & Gas" da NavBar.** Demais dashboards estão em "Fuel Distribution".

## Escopo de código

```
src/app/(dashboard)/anp-cdp/
  page.tsx
```

RPC wrappers: seção "ANP CDP" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (linhas ~1532–1652).

## Produto

Visualização da **produção mensal por poço** declarada na CDP (Comunicação de Dados de Produção) da ANP. Permite ao usuário:

- Selecionar uma das 9 **métricas** (Petróleo kbpd, Óleo, Condensado, Gás Total, Gás Assoc., Gás N-Assoc., Gás Royalties, Água, Tempo de Produção).
- Filtrar por **Ambiente** (Pré-Sal, Pós-Sal Mar, Terra), **Bacia**, **Estado**, **Operador**, **Instalação Destino**, **Tipo Instalação**, **Campo** e **Poço** (multi-select com search).
- Restringir o **período** via range slider (default: últimos 10 anos).
- Ver série temporal agregada da seleção em chart de área (Plotly, laranja `#FF5000`).

Header dinâmico: "ANP CDP — Produção por Poço · {métrica} · {ano início}–{ano fim}".

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_anp_cdp_filtros` | próprio | Opções de filtros (8 listas + `ano_min`/`ano_max`) |
| `get_anp_cdp_poco_serie` | próprio | Série mensal agregada filtrada (10 params: pocos, campos, bacoes, locais, estados, operadores, instalacoes, tipos_instalacao, ano_inicio, ano_fim) — returns `wells_count` + `fields_count` per month since migration `20260513140000` |
| `get_anp_cdp_pocos_json` | próprio | Dump completo de poços via MV (lista para multi-select de Poço, filtrada client-side) |
| `refresh_anp_cdp_pocos` | próprio (chamado pelo ETL) | Refresh do `mv_anp_cdp_pocos` após upload |

## Tabelas / Views

| Objeto | Volume | Populado por |
|---|---|---|
| `anp_cdp_producao` | ~1.813.851 linhas | ETL `scripts/pipelines/anp/cdp/01_extract.py` (Selenium + ddddocr CAPTCHA) → `02_upload.py` |
| `mv_anp_cdp_pocos` | ~poços únicos | Materialized view, refresh via `refresh_anp_cdp_pocos()` ao final do upload |

### Colunas de `anp_cdp_producao`

`ano, mes, poco, campo, bacia, local, petroleo_bbl_dia, gas_total_mm3_dia, instalacao_destino, agua_bbl_dia, estado, nome_poco_operador, operador, num_contrato, oleo_bbl_dia, condensado_bbl_dia, gas_natural_assoc_mm3_dia, gas_natural_n_assoc_mm3_dia, gas_royalties, tipo_instalacao, tempo_prod_hs_mes`.

### Colunas de `mv_anp_cdp_pocos`

`poco, campo, bacia, local, estado, operador, nome_poco_operador, num_contrato, instalacao_destino, tipo_instalacao, petroleo_total`.

### Migrations relevantes

- `20260504000005_anp_cdp.sql` — schema + RLS inicial
- `20260504000006_anp_cdp_v2.sql` → `20260504000011_anp_cdp_v7.sql` — iterações sucessivas (RPC, MV, índices)

## Pipeline de origem

| Workflow | Schedule | Scripts |
|---|---|---|
| `.github/workflows/etl_anp_cdp.yml` | Mensal (dia 5) | `scripts/pipelines/anp/cdp/01_extract.py` (CAPTCHA + Selenium) → `02_upload.py` (upsert via service key + refresh MV) |

Backfill histórico foi feito via `02_upload.py --from-parquet`. Cargas mensais usam `--from-csv-dir`.

## Filtros disponíveis (UI)

| Filtro | Componente | Comportamento |
|---|---|---|
| Métrica | radio inline | troca `metric` (re-render do chart, sem nova request) |
| Ambiente | checkboxes (`PreSal`, `PosSal`, `Terra`) | server-side via `p_locais` |
| Bacia | checkboxes | server-side via `p_bacoes` |
| Estado | `SearchableMultiSelect` | server-side via `p_estados` |
| Operador | `SearchableMultiSelect` | server-side via `p_operadores` |
| Instalação Destino | `SearchableMultiSelect` | server-side via `p_instalacoes` |
| Tipo Instalação | `SearchableMultiSelect` | server-side via `p_tipos_instalacao` |
| Campo | `SearchableMultiSelect` | server-side via `p_campos`; reseta seleção de Poço |
| Poço | `SearchableMultiSelect` (filtragem client-side cascata) | server-side via `p_pocos` |
| Período | `rc-slider` range | server-side via `p_ano_inicio`/`p_ano_fim` (default últimos 10 anos) |

## Componentes consumidos

- `PlotlyChart` — gráfico de área (scatter mode lines + fill tozeroy).
- `SearchableMultiSelect` — multi-selects.
- `rc-slider` — slider de período.
- `NavBar`.
- `useModuleVisibilityGuard("anp-cdp")` — guard de role.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| ETL (`anp_cdp_extract`) | Popula `anp_cdp_producao` mensalmente + chama `refresh_anp_cdp_pocos()` |
| Subgerente APP | Schema/migration de `anp_cdp_producao`, MV e RPCs |
| Designer | Cor laranja `#FF5000`, Arial, padrão de chart de área |
| Supabase | RLS habilitado em `anp_cdp_producao` (read-only via anon) |

## Performance

- **`anp_cdp_producao` é grande (~1.8M)** — sempre consultar via `get_anp_cdp_poco_serie` (RPC com agregação SQL e índices em `(ano, mes)`, `poco`, `campo`, `bacia`, etc.).
- **MV `mv_anp_cdp_pocos`** — pré-agregada, `get_anp_cdp_pocos_json` retorna em ~1-2s gzipped.
- **Debounce 400ms** no fetch da série ao mudar filtros — evita rajada de requests.
- **Filtragem cascata client-side** na lista de Poços — sem novas requests ao mudar Campo/Bacia/Estado/Operador/Local.

## Display units (kbpd vs raw bbl/day)

Liquid-flow metrics (`petroleo_bbl_dia`, `oleo_bbl_dia`, `condensado_bbl_dia`, `agua_bbl_dia`) are stored in **bbl/day** server-side but displayed in **kbpd** (thousand barrels per day) on the chart and in the metric labels. The conversion (`/1000`) is applied at render time via `bblDiaToKbpd()` from [`src/lib/units.ts`](../../src/lib/units.ts); the RPC `get_anp_cdp_poco_serie` is unchanged and continues to return raw bbl/day. Excel/CSV exports also keep raw bbl/day for data fidelity (column headers explicitly say `bbl/day`). Gas metrics keep their native `Mm³/day`.

## Partial-month data — preservation contract

### Principle

Partial data for the **current (or most recent incomplete) month must be preserved in the database and displayed as-is on the dashboard.** Do not filter, hide, or delete it.

### Why

The ANP releases CDP production data well by well, incrementally — some fields are published days after month-end; others take weeks. The dashboard is the primary tool for monitoring this real-time disclosure. A month that looks "low" compared to history may simply have fewer wells reported so far, not bad data.

Additionally, the alert subsystem (`alertas/bases/anp_cdp_producao_poco.py`) consumes the same table to detect newly disclosed fields (especially offshore Pré-Sal / Pós-Sal Mar) and sends email notifications for each new arrival. If partial rows are filtered or deleted, the alert baseline is broken and offshore-field alerts stop firing.

### What "partial" looks like in practice

A freshly published month may show aggregate production that is dramatically lower than historical averages (e.g., `~79 kbpd` vs `~4 000 kbpd`). This is expected and correct: fewer wells have been reported yet. The value rises over the following weeks as the ANP adds more wells.

**Do not interpret a low kbpd reading on the most recent month as a data quality problem.** It is a monitoring signal.

### Curation rules

| Scenario | Correct action |
|---|---|
| Month has only ~50 % of wells published | Leave as-is; pipeline will upsert the rest incrementally |
| Genuinely duplicate rows (same well, different key format — e.g., hyphenated vs non-hyphenated `poco`) | Filter by the duplication pattern (e.g., `poco NOT LIKE '%-%'`), **not** by month |
| `02_upload.py --purge` flag | Safe: does `DELETE … WHERE ano=X AND mes=Y AND local=Z` then immediately re-upserts the same batch. Not equivalent to a manual month-level delete |
| Manual `DELETE FROM anp_cdp_producao WHERE ano=YYYY AND mes=MM` | **Prohibited** — destroys incremental disclosure data and breaks alert baseline |

### Anti-patterns (additions)

- Hiding or clipping the most recent month on the frontend because "it looks low" — this destroys the incremental-monitoring feature.
- Running a manual month-level DELETE for curation purposes — breaks the alert subsystem and loses disclosure-order information.
- Treating a partial-month kbpd value as erroneous without first checking how many wells the ANP has published for that month.

## Partial-month coverage UX — wells & fields counts

Since migration `20260513140000_anp_cdp_poco_serie_counts.sql`, `get_anp_cdp_poco_serie` returns two extra columns per month:

| Column | Type | Meaning |
|---|---|---|
| `wells_count` | `bigint` | `COUNT(DISTINCT poco)` for that `(ano, mes)` slice |
| `fields_count` | `bigint` | `COUNT(DISTINCT campo)` for that `(ano, mes)` slice |

These are surfaced in the chart in two ways (UX Option A + B):

1. **Enriched hover tooltip** — every data point shows `{value} · {N} wells · {N} fields` when the user hovers.
2. **Last-point annotation** — a small muted label (`font-size 10, color #aaa`) floats above the most recent point showing `{N} wells · {N} fields`. It has a faint arrow and white background so it does not obscure the trace. This makes partial-month coverage visible without needing to hover.

If `wells_count` / `fields_count` are `0` (migration not yet applied, or filtered to an empty set), the annotation is suppressed and the hover falls back gracefully.

**TypeScript contract:** `AnpCdpSeriePonto` in `src/lib/rpc.ts` now includes `wells_count: number` and `fields_count: number`. The `buildChart` helper in `page.tsx` reads these via Plotly `customdata`.

## Anti-padrões

- Query direta em `anp_cdp_producao` do front — sempre via RPC agregada.
- Recarregar `get_anp_cdp_pocos_json` em cada filtro change (é one-shot no mount).
- Adicionar métrica nova no array `METRICS` sem garantir que a coluna existe em `AnpCdpSeriePonto` (TS) E na RPC SQL `get_anp_cdp_poco_serie`.
- Mexer em `scripts/pipelines/anp/cdp/` — pertence ao ETL.
- Mostrar nome de coluna SQL na UI sem traduzir (ex: `PreSal` → "Pré-Sal").
- Filtrar/esconder o mês mais recente no front porque "parece baixo" — destrói a feature de monitoramento incremental (ver "Partial-month data — preservation contract" acima).
- Deletar dados parciais por curadoria manual — quebra o sistema de alertas.

## Export

Tier 2 — `<ExportPanel mode="modal">` abre `<ExportModal>` com filtros + calculadora live de tamanho (ver [`docs/app/PRD.md`](PRD.md) → "Export padronizado").

- RPC count: `get_anp_cdp_export_count` (`p_ano_inicio`, `p_ano_fim`, `p_bacoes`, `p_operadores`, `p_locais`, `p_tipos_instalacao`) → `bigint`, em `supabase/migrations/20260507000003_export_count_rpcs.sql`.
- JS wrapper: `getAnpCdpExportCount` em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).
- datasetKey heuristic: `anp_cdp_producao` (ver [`src/lib/exportSizeHeuristics.ts`](../../src/lib/exportSizeHeuristics.ts) → `AVG_BYTES_PER_ROW.anp_cdp_producao`). Tabela é a maior do projeto (~1.8M linhas) — heurística é crítica aqui.
- Filtros expostos no modal: período (slider de anos), bacias, operadores, ambientes (Pré-Sal/Pós-Sal/Terra), tipos de instalação.
- Excel handler: `downloadAnpCdpExcel` em [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts) — workbook single-sheet com título brand orange, header preto, dados Arial 10.
- CSV handler: paginated fetch direto em `anp_cdp_producao` (PostgREST 1.000 linhas/página) + `downloadCsv` em [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts) (RFC4180, UTF-8).
- Filename pattern: `AnpCdp_DD-MM-YY.<xlsx|csv>`.
- Warning visual quando estimativa > 200 000 linhas — particularmente importante neste dashboard, dado o volume da tabela.
