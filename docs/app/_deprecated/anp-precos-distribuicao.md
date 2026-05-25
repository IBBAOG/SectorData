# Sub-PRD — `/anp-precos-distribuicao`

Dashboard ANP — Preços de Distribuição de Combustíveis (PDC) (Fuel Distribution). Owner: [`worker_dash-anp-precos-distribuicao`](../../.claude/agents/worker_dash-anp-precos-distribuicao.md).

> Item do dropdown "Fuel Distribution" da NavBar — grupo "ANP data".

## Escopo de código

```
src/app/(dashboard)/anp-precos-distribuicao/
  page.tsx
```

RPC wrappers: seção "ANP Preços Distribuição" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

## Produto

Visualização dos **preços médios praticados por distribuidoras** (cadeia distribuidor → revenda) publicados pela ANP em quatro granularidades:

- **Brasil semanal** — combustíveis líquidos (Gasolina Comum, Etanol Hidratado, Diesel S10, Diesel S500, GNV).
- **Região mensal** — preços agregados por região geográfica (NORTE, NORDESTE, CENTRO OESTE, SUDESTE, SUL).
- **UF mensal** — primeiro caso de uso é GLP P13.
- **Município mensal** — combustíveis líquidos por município (~459 municípios, 2024+).

Permite ao usuário:

- Selecionar um **produto** via select único (vindo da RPC de filtros).
- Escolher a **granularidade** via `<SegmentedToggle>` (Brasil | UF | Município | Região) — default `brasil`.
- Quando granularidade ≠ `brasil`, escolher quais **locais** (UFs, municípios ou regiões) aparecem no chart — `<MultiSelectFilter>`. Para granularidade municipal, **máx. 5 selecionados** simultaneamente no gráfico (export libera todos). Para Região, sem cap (apenas 5 opções).
- Restringir o **período** via range slider de anos (default: últimos 5 anos), aplicado server-side via RPC (convertido para `${y}-01-01` / `${y}-12-31`).

Header: `ANP — Preços de Distribuição de Combustíveis` + sub `Preços médios praticados por distribuidoras (Brasil semanal, UF/Município mensal)` + badge de período quando dados existem.

**Diferença vs `/anp-precos-produtores`**: lá é o preço de **produtores e importadores** (refino/upstream → distribuidor primário). Aqui é o preço de **distribuição** (distribuidora → revenda). Cadeia diferente.

**Diferença vs `/anp-lpc`**: LPC é o **preço final ao consumidor** nos postos (revenda → consumidor), semanal por município, fonte SLP. PDC é o preço de **distribuição** (distribuidora → revenda), múltiplas granularidades.

## RPCs consumidas

| Wrapper TS | RPC PostgreSQL | Retorno (T) |
|---|---|---|
| `rpcGetAnpPdistFiltros` | `get_anp_precos_distribuicao_filtros()` | `{ produtos, granularidades, ufs, municipios, regioes, data_min, data_max }` (jsonb) |
| `rpcGetAnpPdistSerie` | `get_anp_precos_distribuicao_serie(p_produto, p_granularidade, p_locais?, p_data_inicio?, p_data_fim?)` | `Array<{ data_referencia, local, preco_medio, preco_minimo, preco_maximo, unidade }>` |
| `getAnpPdistExportCount` | `get_anp_precos_distribuicao_export_count(p_produtos?, p_granularidades?, p_locais?, p_data_inicio?, p_data_fim?)` | `int` (count) |

## Schema da tabela alvo

Tabela: `anp_precos_distribuicao` (~50–100k linhas esperadas, populada por `scripts/pipelines/anp/precos_distribuicao_sync.py`).

| Coluna | Tipo | PK/UNIQUE? | Notas |
|---|---|---|---|
| `id` | bigint | PK identity | |
| `data_referencia` | date | UNIQUE composta | início da semana ou 1º dia do mês |
| `periodicidade` | text | | `'semanal'` ou `'mensal'` |
| `produto` | text | UNIQUE composta | `'Gasolina Comum'`, `'Etanol Hidratado'`, `'Diesel S10'`, `'Diesel S500'`, `'GNV'`, `'GLP P13'` |
| `granularidade` | text | UNIQUE composta | `'brasil'`, `'uf'`, `'municipio'`, `'regiao'` |
| `uf` | text | UNIQUE composta | NULL quando granularidade ∈ `{'brasil','regiao'}` |
| `municipio` | text | UNIQUE composta | NULL quando granularidade ≠ `'municipio'` |
| `regiao` | text | UNIQUE composta | NULL exceto quando granularidade = `'regiao'`. Valores: `'NORTE'`, `'NORDESTE'`, `'CENTRO OESTE'`, `'SUDESTE'`, `'SUL'` |
| `preco_medio` | numeric(10,4) | | obrigatório |
| `preco_minimo` | numeric(10,4) | | nullable |
| `preco_maximo` | numeric(10,4) | | nullable |
| `numero_postos` | int | | NULL para Brasil |
| `unidade` | text | | `'R$/L'` (líquidos), `'R$/13kg'` (GLP), `'R$/m³'` (GNV) |
| `fonte_arquivo` | text | | nome do XLSX de origem |
| `created_at` | timestamptz | | |

**RLS**: `acesso autenticado` (SELECT TO authenticated USING (true)) — padrão Phase 3. Service role tem acesso total.

**Índices**: `idx_anp_precos_dist_data` (range), `idx_anp_precos_dist_lookup` (produto, granularidade, data_referencia DESC) — primary lookup, `idx_anp_precos_dist_uf` e `idx_anp_precos_dist_municipio` (parciais).

**Migration**: `supabase/migrations/20260507000005_anp_precos_distribuicao.sql` — schema + RLS + 3 RPCs + INSERT em `module_visibility`.

## Pipeline de origem

- **Script**: `scripts/pipelines/anp/precos_distribuicao_sync.py` (gerenciado pelo `worker_etl-pipelines`).
- **Workflow**: `.github/workflows/etl_anp_precos_distribuicao.yml`.
- **Schedule**: mensal (após publicação da ANP — último dia útil do mês subsequente).
- **Fonte URL**: https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos/precos-de-distribuicao-de-combustiveis
- **Atenção operacional**:
  - Página publica múltiplos XLSX (Brasil semanal, UF mensal GLP, Municípios mensal).
  - Histórico legado pré-2024 vem em arquivos separados — esperar gap se ETL não fizer backfill.

## Filtros UI

| Filtro | Componente | Comportamento |
|---|---|---|
| Produto | `<select>` único | server-side em `get_anp_precos_distribuicao_serie` (debounced 400ms). Default: `'Gasolina Comum'` se existir, senão primeiro da lista. |
| Granularidade | `<SegmentedToggle>` (full) | 4 opções: Brasil / UF / Município / Região. Default: `'brasil'`. Trocar resseta `selectedLocais` (Região: todas as 5; demais: primeiros 5 disponíveis). |
| Locais (UF, Município ou Região) | `<MultiSelectFilter>` | Renderizado quando granularidade ≠ `'brasil'`. Para municípios: cap em 5 selecionados (UX). Para Região: sem cap (só 5 opções). Server-side para municípios e regiões (envia `p_locais`); UF passa `null` e filtra client-side. |
| Período | `<PeriodSlider years>` | server-side em `get_anp_precos_distribuicao_serie` (debounced 400ms); convertido para `${y}-01-01` / `${y}-12-31`. |

## Charts esperados

| Chart | Tipo Plotly | Source RPC | Notas |
|---|---|---|---|
| Preço Médio — `<produto>` (Brasil/UF/Município) | line | `get_anp_precos_distribuicao_serie` | 1 trace por local. Eixo Y em `unidade` (R$/L, R$/13kg, R$/m³). Cor laranja brand para Brasil; palette rotativa para UFs/Municípios. |

**Coerência unidade↔label**: o eixo Y usa `unidade` exatamente como vem do banco — não converter nem traduzir.

## Padrões consolidados aplicados

- [x] Header: `<DashboardHeader title sub period>` com `<hr>` separator
- [x] Period badge: condicional ao `hasYears`
- [x] Push período para RPC server-side
- [x] Debounce 400ms via `useDebouncedFetch`
- [x] Loading: `<BarrelLoading>` no init; `serieLoading` inline durante refetch
- [x] Filtros multi-select: `<MultiSelectFilter>` com Limpar + counter `(N/total)`
- [x] Empty state amigável quando tabela vazia (select disabled com placeholder "— sem dados —")
- [x] Identidade visual: `#ff5000`, Arial, liquid glass
- [x] pt-BR consistente
- [x] `useModuleVisibilityGuard("anp-precos-distribuicao")`

## Componentes consumidos

- `DashboardHeader`, `MultiSelectFilter`, `PeriodSlider`, `ChartSection`, `BarrelLoading`, `ExportPanel`, `ExportModal`, `SegmentedToggle` (`src/components/dashboard/`).
- `SearchableMultiSelect` (`src/components/SearchableMultiSelect.tsx`) — usado no modal de export para listas longas (UFs/municípios).
- `PlotlyChart`, `NavBar`.
- Hooks: `useDebouncedFetch`, `useModuleVisibilityGuard`.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| ETL (`worker_etl-pipelines` — `precos_distribuicao_sync`) | Popula `anp_precos_distribuicao` mensal/semanalmente |
| Supabase (`worker_supabase`) | Schema/migration + 3 RPCs SECURITY DEFINER + RLS |
| Designer | Cor brand `#ff5000` para Brasil; palette rotativa para multi-séries; Arial; chart de linha múltipla |
| `worker_dash-admin` | Visibilidade do módulo (`module_visibility.anp-precos-distribuicao`) e imagem da home |
| Alertas (`worker_alertas`) | Lê `anp_precos_distribuicao` para detecção de variações anômalas |

## Performance

- **`anp_precos_distribuicao` é médio (~50–100k linhas esperadas)**.
- **Granularidade municipal pode ser pesada** — para esse caso, página envia `p_locais = selectedLocais` (cap em 5) já no fetch para bound ao payload.
- **Granularidade UF** — passa `p_locais = null` (até 27 UFs cabem).
- **Granularidade Região** — passa `p_locais = selectedLocais` (5 opções fixas).
- **Granularidade Brasil** — uma única série, payload mínimo.
- **Debounce 400ms** ao mudar produto, granularidade, locais ou slider — evita rajadas durante drag.
- **Filtragem por local em UF mode** é client-side via `useMemo` — sem refetch (≤27 UFs).

## Anti-padrões

- Query direta em `anp_precos_distribuicao` do front — sempre via RPC.
- Refetch sem debounce — usar 400ms.
- Permitir granularidade vazia — sempre exatamente 1 (segmented toggle).
- Resetar `yearRange` em mudança de produto/granularidade — slider é setado uma vez no mount.
- Carregar todos os ~459 municípios no chart sem cap — UX quebra; cap em 5.
- "Amigável-izar" labels (ex: traduzir `'brasil'` → `'Brasil'`) no frontend — gera drift; usar valores do banco.
- Mexer em `scripts/pipelines/anp/precos_distribuicao_sync.py` — pertence ao `worker_etl-pipelines`.

## Export

Tier 2 — `<ExportPanel mode="modal">` abre `<ExportModal>` com filtros + calculadora live de tamanho.

- RPC count: `get_anp_precos_distribuicao_export_count` (`p_produtos?`, `p_granularidades?`, `p_locais?`, `p_data_inicio?`, `p_data_fim?`).
- JS wrapper: `getAnpPdistExportCount` em `src/lib/rpc.ts`.
- datasetKey heuristic: `anp-precos-distribuicao` em `src/lib/exportSizeHeuristics.ts` (~240 B/row XLSX, ~120 B/row CSV).
- Filtros expostos no modal: período (slider de anos), produtos (multi), granularidades (multi), locais (SearchableMultiSelect — quando há UF ou Município selecionado).
- Excel handler: `downloadAnpPdistExcel` em `src/lib/exportExcel.ts` — single-sheet com título brand orange.
- CSV handler: `downloadCsv` em `src/lib/exportCsv.ts` (RFC4180, UTF-8).
- Filename pattern: `anp_precos_distribuicao_DD-MM-YY.<xlsx|csv>` (CSV) / `ANP Precos Distribuicao` base (Excel).
- O export concatena resultados por (produto × granularidade) para todos os pares selecionados no modal.
- Warning visual quando estimativa > 200 000 linhas.

## Histórico

- `2026-05-07` — Implementação inicial (page + wrappers + NavBar + sub-PRD), em paralelo com schema (`worker_supabase`), ETL (`worker_etl-pipelines`) e alertas (`worker_alertas`).
- `2026-05-07` — Adicionada granularidade `'regiao'` (4ª opção no `<SegmentedToggle>`): NORTE / NORDESTE / CENTRO OESTE / SUDESTE / SUL. Tipo `AnpPdistFiltros.regioes: string[]` em `src/lib/rpc.ts`. Schema/RPC estendidos por `worker_supabase`; ETL parser estendido por `worker_etl-pipelines`.
