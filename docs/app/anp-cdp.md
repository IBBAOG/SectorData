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
| `get_anp_cdp_poco_serie` | próprio | Série mensal agregada filtrada (10 params: pocos, campos, bacoes, locais, estados, operadores, instalacoes, tipos_instalacao, ano_inicio, ano_fim) — returns `wells_count` + `records_count` + `fields_count` per month (records_count added after `20260513140000`) |
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

## Data source: CDP APEX portal (do not migrate to Power BI)

The authoritative source for `anp_cdp_producao` is the **ANP CDP APEX portal**:
`https://cdp.anp.gov.br/ords/r/cdp_apex/consulta-dados-publicos-cdp`

### Why this must stay Selenium/APEX

The **Power BI public API** is a completely different product. It feeds the **separate** `/anp-cdp-diaria` dashboard (tables `anp_cdp_diaria*`, `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco`). These are daily intermediate figures — NOT the official monthly CDP declarations.

Mixing these two sources contaminates `anp_cdp_producao` in two ways:

1. **Well-name format divergence**: APEX uses canonical SIGEP hyphenated codes (`7-SPH-6-SPS`); Power BI uses compact codes (`7SPH6SPS`). Same well gets two PKs → duplicate rows that survive `ON CONFLICT`.
2. **Conflicting `local` classification**: Power BI derives PosSal/PreSal from basin heuristics; APEX derives it from the actual CDP submission. They disagree for borderline wells.

### The ~197 vs 427 wells discrepancy (root cause, resolved)

The original Selenium scraper returned only ~197 offshore wells for 04/2026 because `do_acoes_download()` did not explicitly select **"Todos os registros"** in the APEX IR download dialog. Without this selection, the download exports only the currently visible paginated rows (≤200 by default).

**Fix applied in `01_extract.py`** (`do_acoes_download`): before clicking the confirm button, the JS now selects the "Todos os registros" radio (value `"all"`, or the second visible radio in the dialog as fallback). This allows the full 427-well dataset to be exported.

### Guards

Two guardrails prevent this confusion from recurring:

**Guard 1 — Header comments**: `01_extract.py` and `etl_anp_cdp.yml` both carry a top-of-file warning block explaining the source separation and listing the 3 steps required to legitimately change the source.

**Guard 2 — Format check in `02_upload.py`**: `_check_poco_format()` inspects the `poco` column before any upsert. If >20% of rows have compact (non-hyphenated) codes, the upload aborts with a clear error message identifying the probable source contamination. Bypass: `--allow-non-apex-format` (requires CTO sign-off).

### How to legitimately change the source (requires CTO sign-off)

1. Update this section ("Data source") in `docs/app/anp-cdp.md`.
2. Remove or update the `_check_poco_format()` guard in `02_upload.py`.
3. Get explicit CTO approval before merging.

### Related files

| File | Role |
|---|---|
| `scripts/pipelines/anp/cdp/01_extract.py` | Selenium + APEX extraction (this pipeline) |
| `scripts/pipelines/anp/cdp/01_extract_powerbi.py` | Power BI extraction — feeds `/anp-cdp-diaria` ONLY |
| `scripts/extractors/anp_cdp_powerbi.py` | Core Power BI client used by `etl_anp_cdp_diaria.yml` |
| `.github/workflows/etl_anp_cdp.yml` | Monthly CDP APEX pipeline (this dashboard) |
| `.github/workflows/etl_anp_cdp_diaria.yml` | Daily Power BI pipeline (separate dashboard) |

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

## Partial-month coverage UX — wells, records & fields counts

Since migration `20260513140000_anp_cdp_poco_serie_counts.sql`, `get_anp_cdp_poco_serie` returns two extra columns per month, and a third was added subsequently:

| Column | Type | Meaning |
|---|---|---|
| `wells_count` | `bigint` | `COUNT(DISTINCT poco)` — distinct wells reported for that `(ano, mes)` slice (geological count) |
| `records_count` | `bigint` | `COUNT(*)` — total rows for that slice; matches ANP portal pagination (e.g. "1-25 de 774") |
| `fields_count` | `bigint` | `COUNT(DISTINCT campo)` — distinct fields reported for that `(ano, mes)` slice |

**wells vs records distinction:** A single well can appear in multiple records when it is tied to more than one field (e.g. `SÉPIA`, `SÉPIA LESTE`, `SÉPIA_ECO`). `wells_count` is the geologically meaningful number; `records_count` is the pagination count shown on the ANP portal. For Apr/2026 offshore: 414 distinct wells → 774 records (because many wells are tied to 2+ fields). Both numbers are informative to different audiences.

These are surfaced in the chart in two ways:

1. **Enriched hover tooltip** — every data point shows `{value} · {N} wells · {N} records · {N} fields` when the user hovers. Example: `"4,055.2 kbpd — 414 wells · 774 records · 55 fields"`.
2. **Last-point annotation** — a small muted label (`font-size 10, color #aaa`) floats above the most recent point showing `"{N} wells · {N} records · {N} fields"`. It has a faint arrow and white background so it does not obscure the trace. This makes partial-month coverage visible without needing to hover.

**Graceful fallback:** if `records_count` is `undefined` or `0` (migration not yet deployed, or pre-merge deploy window), it is omitted from both hover and annotation — the label falls back to `"{N} wells · {N} fields"`. If `wells_count` / `fields_count` are also `0`, the annotation is suppressed entirely.

**TypeScript contract:** `AnpCdpSeriePonto` in `src/lib/rpc.ts` includes `wells_count: number`, `records_count?: number` (optional — new migration), and `fields_count: number`. The `buildChart` helper in `page.tsx` reads these via Plotly `customdata[0..2]`.

## As-is loading contract

**The CDP APEX CSV is the authoritative source. Load it row-by-row, exactly as published by the ANP. No exceptions.**

### What "as-is" means

| Prohibited | Correct |
|---|---|
| `groupby(PK).agg({"petroleo_bbl_dia": "sum"})` | Each CSV row becomes exactly one DB row |
| Filtering `WHERE petroleo > 0 OR gas > 0` | Wells with zero production are published by the ANP and must be stored |
| Dividing or multiplying any production value | Values go to DB in the same units as the CSV (bbl/day, Mm³/day) |
| Summing rows from different `campo` for the same `poco` | A well tied to two fields is two separate rows — both go in |

### Why this rule exists (2026-05-14)

The pipeline had a `groupby(_PK).agg(sum)` step introduced as a "deduplication fix". The intent was to handle apparent duplicates, but the PK included `campo` — meaning the groupby was collapsing rows for the same well across **different fields**, summing their production. A well appearing in `ITAPU` and `ITAPU_ECO` with ~12 kbpd each ended up stored as ~24 kbpd. Multiplied across hundreds of offshore wells, this doubled the reported aggregate production for Apr/2026 (~7,591 kbpd vs the correct ~3,800 kbpd).

The CEO directive (2026-05-14): **"Just extract the data as-is. The production figures are already correct."**

### The APEX CSV is already unique by PK

The ANP CDP APEX portal exports one row per `(poco, campo, bacia)` per file. The file is already scoped to one `(periodo, ambiente)`. Therefore:

- PK `(ano, mes, poco, campo, bacia, local)` is naturally unique in each CSV
- No deduplication is needed before upsert
- `ON CONFLICT (ano,mes,poco,campo,bacia,local) DO UPDATE` is the correct upsert strategy

### APEX file structure: M is a superset of S

The ANP CDP APEX portal exports three files per month:
- **File M** (`amb=M`, mapped to `local=PosSal`): ALL offshore wells — both Pós-Sal and Pré-Sal.
- **File S** (`amb=S`, mapped to `local=PreSal`): ONLY the Pré-Sal subset. Rows in S are **identical** to the corresponding rows in M.
- **File T** (`amb=T`, `local=Terra`): onshore wells only, no overlap.

This means:
- Files M and S are NOT additive. Loading both as-is would store ~187 wells twice (once as PosSal, once as PreSal), doubling their production in any aggregate query.
- The pipeline (`_deduplicate_m_vs_s`) removes from M any `poco` that also appears in S. Only the M-exclusive wells (genuine Pós-Sal) are stored with `local=PosSal`; the PreSal wells come from S only.
- Total offshore rows after deduplication = `len(M-exclusive) + len(S)` = the same count as file M alone, matching the portal pagination.

### Validation baseline

After a complete Apr/2026 load (post-deduplication):
- PosSal rows: **282** (M-exclusive wells)
- PreSal rows: **492** (from file S)
- Terra rows: **3 260**
- Total offshore rows: **774** (= portal pagination `1-25 de 774`)
- Offshore kbpd: **~4 055** (PosSal ~519 + PreSal ~3 536)
- `7-TUP-121DA-RJS` TUPI Apr/2026: `petroleo_bbl_dia ≈ 30 234.9198`

### Historical validation vs ANP Boletim Mensal (2024-2025)

Audit conducted 2026-05-14. Compared `anp_cdp_producao` aggregates (SUM petroleo_bbl_dia / 1000) against the official ANP **Boletim Mensal da Produção de Petróleo e Gás Natural** published PDFs for every month from Jan/2024 through Dec/2025.

**Method:** 24 monthly bulletins downloaded directly from `gov.br/anp`. Oil production totals extracted from the historical table (page 6 of each bulletin). Compared to our DB aggregate via full table scan (189,972 rows >= 2024).

| Month   | Our kbpd | ANP kbpd | Delta kbpd | Delta %  | Status      |
|---------|----------|----------|------------|----------|-------------|
| 2024-01 | 3519.1   | 3519     | +0.1       | +0.00%   | OK (exact)  |
| 2024-02 | 3448.3   | 3448     | +0.3       | +0.01%   | OK (exact)  |
| 2024-03 | 3356.3   | 3356     | +0.3       | +0.01%   | OK (exact)  |
| 2024-04 | 3194.4   | 3194     | +0.4       | +0.01%   | OK (exact)  |
| 2024-05 | 3317.9   | 3318     | -0.1       | -0.00%   | OK (exact)  |
| 2024-06 | 3408.9   | 3412     | -3.1       | -0.09%   | OK (exact)  |
| 2024-07 | 3229.7   | 3232     | -2.3       | -0.07%   | OK (exact)  |
| 2024-08 | 3340.4   | 3343     | -2.6       | -0.08%   | OK (exact)  |
| 2024-09 | 3470.3   | 3472     | -1.7       | -0.05%   | OK (exact)  |
| 2024-10 | 3268.5   | 3271     | -2.5       | -0.08%   | OK (exact)  |
| 2024-11 | 3309.9   | 3313     | -3.1       | -0.09%   | OK (exact)  |
| 2024-12 | 3418.6   | 3421     | -2.4       | -0.07%   | OK (exact)  |
| 2025-01 | 3445.8   | 3449     | -3.2       | -0.09%   | OK (exact)  |
| 2025-02 | 3485.3   | 3488     | -2.7       | -0.08%   | OK (exact)  |
| 2025-03 | 3618.1   | 3621     | -2.9       | -0.08%   | OK (exact)  |
| 2025-04 | 3629.7   | 3632     | -2.3       | -0.06%   | OK (exact)  |
| 2025-05 | 3679.0   | 3679     | 0.0        | +0.00%   | OK (exact)  |
| 2025-06 | 3755.8   | 3757     | -1.2       | -0.03%   | OK (exact)  |
| 2025-07 | 3956.2   | 3959     | -2.8       | -0.07%   | OK (exact)  |
| 2025-08 | 3893.2   | 3896     | -2.8       | -0.07%   | OK (exact)  |
| 2025-09 | 3911.8   | 3915     | -3.2       | -0.08%   | OK (exact)  |
| 2025-10 | 4026.9   | 4030     | -3.1       | -0.08%   | OK (exact)  |
| 2025-11 | 3769.7   | 3773     | -3.3       | -0.09%   | OK (exact)  |
| 2025-12 | 4011.9   | 4015     | -3.1       | -0.08%   | OK (exact)  |

**Gas cross-check (2024, Mm³/d):** Max delta < 0.07% across all months. Exact to 3 significant figures.

**Well-level spot check (Jan/2025 top-30 from boletim page 20):**
- `7-TUP-121DA-RJS` (TUPI): DB = 31,544.3 bbl/d, Boletim = 31,544 bbl/d — delta 0.3 bbl/d (0.001%)
- `9-BRSA-1254-RJS` (SÉPIA): DB sum across 3 campos = 48,666.3 bbl/d, Boletim = 48,666 bbl/d — delta 0.3 bbl/d (0.0006%)
  - Note: this well appears in `SÉPIA`, `SÉPIA LESTE`, and `SÉPIA_ECO` — three separate rows, sum = boletim value. Correct.

**Systematic small negative bias (< 0.1%):** Jun/2024 onward shows a consistent ~3 kbpd undercount vs boletim. This is explained by condensate: the boletim includes both oil AND condensate in the "petróleo" total; CDP APEX separately tracks them. The bias magnitude (~0.07%) is negligible.

**Max absolute delta: 0.09%. No month exceeds 0.1% deviation. Pipeline is historically clean across all 24 comparable months.**

**2026 months (no boletim reference yet):**
| Month   | Our kbpd | Wells | Notes |
|---------|----------|-------|-------|
| 2026-01 | 3950.5   | 6092  | — |
| 2026-02 | 4058.5   | 6079  | — |
| 2026-03 | 3672.8   | 6286  | Lower PreSal (2978.6 vs ~3980 prior month) — likely planned FPSO maintenance, not a data issue |
| 2026-04 | 4091.3   | 3674  | Partial month: Terra = 36 kbpd (vs ~82-88 typical) — onshore wells still being published. Offshore (PreSal 3536 + PosSal 519) matches portal pagination 774 offshore rows. |

### Record count audit — 2024-01 to 2026-04 (conducted 2026-05-14)

Second audit round comparing `COUNT(*)` in `anp_cdp_producao` per (ano, mes, local) against the ANP CDP portal pagination total ("1-25 de N") for the same period and environment filter. Methodology: Selenium + ddddocr CAPTCHA on the live portal, reading `.a-IRR-pagination-label` text (handles European thousands separator "3.260").

**Note on metrics:** the CEO's "offshore_records" in the issue table refers to `COUNT(*) WHERE local IN ('PosSal','PreSal')` (DB total offshore = PosSal + PreSal), compared against the portal "Mar" filter (file M = all offshore wells before M/S dedup).

#### Table 1 — Mar/Offshore (portal "Mar" filter vs DB PosSal+PreSal total)

| ano-mes | DB_PosSal | DB_PreSal | DB_offshore | ANP_Mar | gap | gap_% | status |
|---------|-----------|-----------|-------------|---------|-----|-------|--------|
| 2024-01 | 436 | 353 | 789 | 845 | -56 | -6.6% | BAD |
| 2024-02 | 434 | 355 | 789 | 850 | -61 | -7.2% | BAD |
| 2024-03 | 423 | 366 | 789 | 852 | -63 | -7.4% | BAD |
| 2024-04 | 408 | 356 | 764 | 826 | -62 | -7.5% | BAD |
| 2024-06 | 416 | 372 | 788 | 856 | -68 | -7.9% | BAD |
| 2024-09 | 381 | 375 | 756 | 836 | -80 | -9.6% | BAD |
| 2024-12 | 419 | 393 | 812 | 906 | -94 | -10.4% | BAD |
| 2025-03 | 419 | 379 | 798 | 882 | -84 | -9.5% | BAD |
| 2025-05 | 415 | 391 | 806 | 893 | -87 | -9.7% | BAD |
| 2025-06 | 429 | 393 | 822 | 906 | -84 | -9.3% | BAD |
| 2025-07 | 454 | 411 | 865 | 935 | -70 | -7.5% | BAD |
| 2025-08 | 451 | 466 | 917 | 1001 | -84 | -8.4% | BAD |
| 2025-09 | 404 | 452 | 856 | 979 | -123 | -12.6% | BAD |
| 2025-10 | 426 | 477 | 903 | 1008 | -105 | -10.4% | BAD |
| 2025-11 | 418 | 475 | 893 | 998 | -105 | -10.5% | BAD |
| 2025-12 | 427 | 476 | 903 | 1002 | -99 | -9.9% | BAD |
| 2026-01 | 445 | 472 | 917 | 1004 | -87 | -8.7% | BAD |
| 2026-02 | 460 | 494 | 954 | 1022 | -68 | -6.7% | BAD |
| **2026-03** | **530** | **509** | **1039** | **1039** | **0** | **0.0%** | **OK** |
| **2026-04** | **282** | **492** | **774** | **774** | **0** | **0.0%** | **OK** |

**BAD months (gap > 2%): all months from 2024-01 through 2026-02 inclusive (18+ months). First clean months: 2026-03 and 2026-04.**

#### Table 2 — PreSal (portal "Pre-Sal" filter vs DB PreSal)

| ano-mes | DB_PreSal | ANP_PreSal | gap | gap_% | status |
|---------|-----------|-----------|-----|-------|--------|
| 2024-01 | 353 | 353 | 0 | 0.0% | OK |
| 2024-06 | 372 | 372 | 0 | 0.0% | OK |
| 2024-12 | 393 | 394 | -1 | -0.3% | OK |
| 2025-03 | 379 | 379 | 0 | 0.0% | OK |
| 2025-06 | 393 | 395 | -2 | -0.5% | OK |
| 2025-09 | 452 | 452 | 0 | 0.0% | OK |
| 2025-12 | 476 | 478 | -2 | -0.4% | OK |
| 2026-01 | 472 | 475 | -3 | -0.6% | OK |
| 2026-02 | 494 | 494 | 0 | 0.0% | OK |
| 2026-03 | 509 | 509 | 0 | 0.0% | OK |
| 2026-04 | 492 | 492 | 0 | 0.0% | OK |

**PreSal: clean across all periods. Max gap 0.6% (2026-01, 3 rows). No BAD months.**

#### Table 3 — Terra (portal "Terra" filter vs DB Terra)

| ano-mes | DB_Terra | ANP_Terra | gap | gap_% | status |
|---------|----------|-----------|-----|-------|--------|
| 2024-01 | 6245 | 7351 | -1106 | -15.0% | BAD |
| 2024-06 | 6178 | 7387 | -1209 | -16.4% | BAD |
| 2024-12 | 6120 | 7690 | -1570 | -20.4% | BAD |
| 2025-06 | 6175 | 7843 | -1668 | -21.3% | BAD |
| 2025-12 | 5654 | 7642 | -1988 | -26.0% | BAD |
| 2026-01 | 5680 | 5863 | -183 | -3.1% | BAD |
| 2026-02 | 5649 | 5761 | -112 | -1.9% | OK |
| **2026-03** | **5760** | **5760** | **0** | **0.0%** | **OK** |
| **2026-04** | **3260** | **3260** | **0** | **0.0%** | **OK** |

**Terra: BAD from 2024 through 2026-01 with growing gap (~15% in early 2024, ~26% by late 2025). First clean months: 2026-02 and beyond.**

#### Hypothesis assessment

**CONFIRMED.** The gap pattern is unambiguous:

1. **Old pipeline era (pre-2026-03 for Mar/Offshore, pre-2026-02 for Terra):** systematic undercount. The gap ranges from -6.6% to -12.6% for offshore and -15% to -26% for Terra.
2. **Post-fix era (2026-03 onwards for Mar, 2026-02 for Terra):** zero gap. Both environments match the portal exactly.
3. **PreSal: always clean** — the `_deduplicate_m_vs_s` logic was not the source of errors for PreSal rows.

The two old-pipeline bugs that caused the undercounts:
- `groupby(_PK).agg(sum)` — collapsed wells associated with multiple `campo` into fewer records with summed production. E.g. a well in CAMPO_A + CAMPO_B became 1 row instead of 2. This collapsed the record count significantly.
- `WHERE petroleo > 0 OR gas > 0` filter — excluded wells with zero production in both columns. The ANP publishes zero-production wells legitimately (e.g. wells undergoing maintenance). These were silently dropped.

**Why kbpd audit passed but record count fails:** the `groupby+sum` preserved total production (correctly summing across campo rows for a well) but reduced record count. The `petroleo=0` filter only dropped wells that contributed zero kbpd — negligible impact on aggregate production totals but meaningful impact on record counts used by the CEO's monitoring dashboard.

#### BAD months ordered by gap_abs (offshore + Terra combined)

| ano-mes | environment | DB_count | ANP_count | gap_abs | gap_% |
|---------|-------------|----------|-----------|---------|-------|
| 2025-12 | Terra | 5654 | 7642 | -1988 | -26.0% |
| 2025-06 | Terra | 6175 | 7843 | -1668 | -21.3% |
| 2024-12 | Terra | 6120 | 7690 | -1570 | -20.4% |
| 2024-06 | Terra | 6178 | 7387 | -1209 | -16.4% |
| 2024-01 | Terra | 6245 | 7351 | -1106 | -15.0% |
| 2025-09 | offshore | 856 | 979 | -123 | -12.6% |
| 2025-10 | offshore | 903 | 1008 | -105 | -10.4% |
| 2025-11 | offshore | 893 | 998 | -105 | -10.5% |
| 2024-12 | offshore | 812 | 906 | -94 | -10.4% |
| 2025-08 | offshore | 917 | 1001 | -84 | -8.4% |
| 2025-03 | offshore | 798 | 882 | -84 | -9.5% |
| 2025-06 | offshore | 822 | 906 | -84 | -9.3% |
| 2026-01 | offshore | 917 | 1004 | -87 | -8.7% |
| 2025-05 | offshore | 806 | 893 | -87 | -9.7% |
| 2026-01 | Terra | 5680 | 5863 | -183 | -3.1% |
| 2026-02 | offshore | 954 | 1022 | -68 | -6.7% |
| 2024-06 | offshore | 788 | 856 | -68 | -7.9% |
| 2025-07 | offshore | 865 | 935 | -70 | -7.5% |
| 2024-04 | offshore | 764 | 826 | -62 | -7.5% |
| 2024-03 | offshore | 789 | 852 | -63 | -7.4% |
| 2024-02 | offshore | 789 | 850 | -61 | -7.2% |
| 2024-01 | offshore | 789 | 845 | -56 | -6.6% |

**Total BAD months (gap > 2%): 22 (all months 2024-01 through 2026-01 for offshore + Terra).**

#### Re-run batch recommendation for CTO

All months from 2024-01 through 2026-02 need to be re-extracted and re-uploaded with `--purge` flag to replace the records loaded by the old pipeline. Months 2026-03 onward are already correct.

| Priority | Months | Environments | Expected impact |
|----------|--------|-------------|----------------|
| High | 2024-01 to 2026-02 | Mar (M) + Terra (T) | ~1000-2000 missing records per month per env |
| None needed | 2026-03 onwards | All | Already correct |
| None needed | All months | PreSal (S) | Always clean |

**Suggested run order:** start with most recent BAD months (2026-02, 2026-01) to fix CEO's visible discrepancy first, then backfill 2025 and 2024 in reverse order.

**Trigger via:** GitHub Actions → `etl_anp_cdp.yml` → workflow_dispatch → set `periodo=MM/YYYY --purge` for each month. The `--purge` flag in `02_upload.py` deletes all existing rows for that (ano, mes) before re-upserting, ensuring stale compact-format records are replaced.

### Before you add any transformation to this pipeline

Read this section. Then ask: does this change aggregate, filter, or transform production values? If yes, do not merge without explicit CTO sign-off and update of this section.

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
