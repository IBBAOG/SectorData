# Sub-PRD — `/anp-desembaracos`

Dashboard ANP Desembaraços — Desembaraços Aduaneiros de Importação de Petróleo, Gás e Derivados, por NCM e país de origem (Oil & Gas / Fuel Distribution). Owner: [`worker_dash-anp-desembaracos`](../../.claude/agents/worker_dash-anp-desembaracos.md).

> Item do dropdown "Oil & Gas" da NavBar. Segundo dashboard da Fase 3 ANP (DAIE → **Desembaraços** → Painel Importações).

## Escopo de código

```
src/app/(dashboard)/anp-desembaracos/
├── page.tsx                       ← viewport router (useIsMobile)
├── useAnpDesembaracosData.ts      ← single shared brain (RPCs, filters, rankings)
├── desktop/View.tsx               ← desktop UX (sidebar + dual-chart)
└── mobile/View.tsx                ← mobile UX (chart hero + Top Countries list)
```

RPC wrappers: seção "ANP Desembaraços" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (linhas ~1161–1255).

## Dual-view structure (2026-05-20)

Dashboard é **dual-view** — desktop (`≥769px`) e mobile (`≤768px`) compartilham `useAnpDesembaracosData.ts` como única fonte de verdade. Mobile é "mesma análise, roupagem adaptada": chart hero multi-linha (até 5 NCMs top-N) seguido de ranking de países origem em cards verticais.

### Hook (`useAnpDesembaracosData.ts`)

Contrato:

```ts
interface UseAnpDesembaracosData {
  // raw data + meta
  filtros, serieRows, topRows, allYears, yMin, yMax, hasYears, hasData;
  // loading flags
  loading, serieLoading, topLoading;
  // filter state (min-1 guard on selectedNcms)
  filters: { yearRangeIdx, selectedNcms, topNcm };
  setFilters, toggleNcm, resetNcms, setTopNcm;
  // helpers
  ncmCodigos, ncmNomeMap, topNcmNome, resolveNcmNome, colorForNcm;
  // derived rankings (already in kt)
  topNcms: TopNcmEntry[];        // [{ncm_codigo, ncm_nome, totalKt}]
  topCountries: TopCountryEntry[];// [{pais_origem, totalKt}]
}
```

Responsabilidades:

- Chama as 3 RPCs (`get_anp_desembaracos_filtros`, `_serie`, `_top_paises`).
- Mantém `filters` (período via `yearRangeIdx`, NCMs selecionados, NCM do ranking).
- Debounce 400ms em ambos os refetches reativos (série e top países).
- Converte `quantidade_kg → kt` (via `kgToMilTon`) **uma única vez** nas derivadas (`topNcms`, `topCountries`).
- Default no mount: últimos 10 anos + top 5 NCMs por volume na janela.

### Desktop view (`desktop/View.tsx`)

UX original preservada — sidebar fixa com `MultiSelectFilter` (NCMs), `PeriodSlider`, e `<select>` para Top Countries NCM. Charts:

1. **Imported Volumes by NCM — National Total (kt / month)** — multi-line, 1 trace por NCM selecionado, palette rotativa.
2. **Top Origin Countries — `<NCM>` (kt)** — barras horizontais, cor única `#1E88E5`.

Export Tier 1 via `<ExportPanel>` (Excel formatado + CSV raw).

### Mobile view (`mobile/View.tsx`)

Arquetípo: `mockups/market-share-mobile.html` (chart + ranking + filter sheet).

Componentes compostos:

| Slot | Componente | Conteúdo |
|---|---|---|
| Top | `MobileTopBar` | Título "Customs Clearances" |
| Título | div inline | "ANP — Customs Clearances" + subtítulo kt |
| Filtros sticky | div inline | Chip de período + chip "N/total NCMs" + botão Filters |
| Chart hero | `MobileChart` | Multi-linha mensal, cap em top-5 NCMs (`MOBILE_CHART_MAX_NCMS`) |
| Tab bar | `MobileTabBar` | 1 tab por NCM top-N → escolhe NCM para ranking de países |
| Ranking | `MobileDataCard` × N | Top countries (cor `#1E88E5`, leader badge cheio, demais com opacity 0.55) |
| FAB | `ExportFAB` | Abre sheet de export Tier 1 |
| Drawer filtros | `FilterDrawer` + `PeriodSlider` + `CheckList` + `<select>` | Período, NCMs (min-1), NCM ranking |
| Drawer export | `FilterDrawer` | Botão Excel (apply) + botão CSV (no body) |

Cap em 5 NCMs no chart é para manter legibilidade em 375px. Selecionados a mais aparecem só nos rankings.

### Binding sync rule

Toda mudança em desktop (novo filtro, chart, KPI, copy) **exige** equivalente em mobile no mesmo commit, OU commit declara `[desktop-only]` / `[mobile-only]` com justificativa. Adicionar nova métrica/série → adicionar antes ao hook; views só consomem.

## Produto

Visualização das **séries mensais e ranking de países origem dos desembaraços aduaneiros de importação** publicados pela ANP. Permite ao usuário:

- Selecionar via checkbox quais **NCMs** comparar no chart de série temporal — ao menos 1 sempre marcado; default: top 5 por volume na janela inicial.
- Restringir o **período** via range slider de anos (default: últimos 10 anos), aplicado server-side via RPC.
- Escolher (dropdown) 1 NCM para ver o **ranking de países origem** (top 15 por massa).

Header: `ANP — Desembaraços de Importação (Petróleo, Gás e Derivados)` + sub `Volumes mensais desembaraçados na importação por NCM e país de origem (massa em mil t)` + badge de período quando dados existem.

Diferenças entre os 3 dashboards Fase 3:

| Dashboard | Granularidade | Métrica |
|---|---|---|
| `/anp-daie` | produto comercial × operação (Imp/Exp) | volume_m³ + valor_usd |
| `/anp-desembaracos` | **NCM × país de origem** | **quantidade_kg** |
| `/anp-painel-importacoes` | distribuidor × produto | volume_m³ |

## Unidades

- **Source**: `quantidade_kg` (kilogramas)
- **UI**: `mil t` (kton). Conversão: `kg / 1e6 = mil t`.
- Em todos os charts (Y-axis title, hovertemplate, section-title) o label é "mil t".

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_anp_desembaracos_filtros` | próprio | `ncms` ([{ncm_codigo, ncm_nome}]), `paises` (string[]), `ano_min`, `ano_max` |
| `get_anp_desembaracos_serie` | próprio | Série mensal. Aceita `p_ncms`, `p_paises`, `p_ano_inicio`, `p_ano_fim` (todos opcionais). Wrapper paginado (1.000 linhas/página). |
| `get_anp_desembaracos_top_paises` | próprio | Top N países origem para 1 NCM. Aceita `p_ncm_codigo` (obrigatório), `p_ano_inicio`, `p_ano_fim`, `p_limit` (default 15). |

## Tabelas

| Objeto | Volume | Populado por |
|---|---|---|
| `anp_desembaracos` | ~6.204 linhas | ETL `scripts/pipelines/anp/fase3/02_desembaracos_sync.py` |

### Colunas de `anp_desembaracos`

`ano (smallint), mes (smallint), ncm_codigo (text), ncm_nome (text), pais_origem (text), quantidade_kg (float8)`. PK: `(ano, mes, ncm_codigo, pais_origem)`. Índices: `(ano, mes)`, `(ncm_codigo)`, `(pais_origem)`.

### Migration relevante

- `20260504000003_anp_fase3.sql` — schema + RLS + RPCs + INSERT em `module_visibility` (compartilhada com `/anp-daie` e `/anp-painel-importacoes`).

## Pipeline de origem

| Workflow | Schedule | Scripts |
|---|---|---|
| `.github/workflows/etl_anp_fase3.yml` | Mensal dia 1° 13:00 UTC (10:00 BRT) | `scripts/pipelines/anp/fase3/01_daie_sync.py` → `02_desembaracos_sync.py` → `03_painel_imp_sync.py` |

Comportamento do scraper `02_desembaracos_sync.py`:
- Baixa o dataset de desembaraços aduaneiros da ANP (Painel Dinâmico).
- Normaliza NCM (string), nome do NCM, e país de origem.
- Agrega por `(ano, mes, ncm_codigo, pais_origem)` somando `quantidade_kg`.
- Upsert idempotente via supabase-py.

## Filtros disponíveis (UI)

| Filtro | Componente | Comportamento |
|---|---|---|
| NCM (Série) | checkboxes c/ swatch de cor + counter `(N/total)` | client-side; mínimo 1 sempre selecionado; "Limpar" restaura todos; default no mount = top 5 NCMs por volume |
| Período | `rc-slider` range (anos) | server-side em `get_anp_desembaracos_serie` e `get_anp_desembaracos_top_paises` (debounced 400ms cada) |
| Top Países — NCM | `<select>` (single) | server-side em `get_anp_desembaracos_top_paises` (debounced 400ms); independente do checkbox de Série |

## Charts esperados (2)

1. **Volumes Importados por NCM — Total Nacional (mil t / mês)** — chart de linha múltipla, 1 trace por NCM selecionado, agregando todos os países. Eixo Y: `mil t / mês`. Cor por palette rotativa (16 cores).
2. **Top Países Origem — `<NCM nome>` (mil t)** — chart de barras horizontais, 1 barra por país (top 15 por massa total no período). Cor única `#1E88E5`.

## Componentes consumidos

- `PlotlyChart` — 2 charts (linha múltipla + barras horizontais).
- `rc-slider` — slider de período (anos).
- `NavBar`.
- `useModuleVisibilityGuard("anp-desembaracos")` — guard de role.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| ETL (`anp_fase3_sync`) | Popula `anp_desembaracos` mensalmente (etapa 2 da chain) |
| Subgerente APP | Schema/migration de `anp_desembaracos` e RPCs |
| Designer | Palette rotativa de 16 cores, Arial, padrões de chart de linha múltipla + barras horizontais |
| Supabase | RLS habilitado em `anp_desembaracos` (read-only via anon authenticated); 3 RPCs SECURITY DEFINER |
| `worker_dash-admin` | Visibilidade do módulo (`module_visibility.anp-desembaracos`) e imagem da home |

## Performance

- **`anp_desembaracos` é médio (~6k)** — `get_anp_desembaracos_serie` com `p_ano_inicio/p_ano_fim` filtra à janela visível.
- **Paginação no wrapper** — 1.000 linhas/página (PostgREST default), itera até esgotar. Necessário porque a série completa pode ultrapassar 1.000 linhas (NCM × país × meses).
- **Período via `p_ano_inicio`/`p_ano_fim`** — empurra filtragem para o servidor.
- **Filtragem por NCM no chart de série** é client-side via `useMemo` (sem refetch — re-render apenas).
- **Top países**: refetch no servidor sempre que NCM ou período muda (via `get_anp_desembaracos_top_paises`).
- **Debounce 400ms** em ambos os fetches reativos — evita rajadas durante drag do slider.

## Anti-padrões

- Query direta em `anp_desembaracos` do front — sempre via RPC.
- Refetch sem debounce — usar 400ms.
- Filtrar série inteira client-side por período — empurrar para RPC.
- Permitir `selectedNcms.length === 0` — sempre manter ao menos 1.
- Resetar `yearRange` em mudança de NCM — slider é setado uma vez no mount.
- Bloquear página inteira com barrel em `serieLoading`/`topLoading` — barrel é só pro `loading` inicial.
- **Drift entre divisor e label** — `quantidade_kg / 1e6 = mil t`. Se trocar divisor, atualizar todos os labels (Y-axis title, hovertemplate, section-title). Bug histórico recorrente em fases 3.x.
- Mexer em `scripts/pipelines/anp/fase3/02_desembaracos_sync.py` — pertence ao ETL.

## Export

Tier 1 — download direto via `<ExportPanel>` (ver [`docs/app/PRD.md`](PRD.md) → "Export padronizado").

- Excel: `downloadGenericExcel<T>` em [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts) — workbook single-sheet com título brand orange, header preto, dados Arial 10.
- CSV: `downloadCsv<T>` em [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts) (RFC4180, UTF-8).
- Filename pattern: `AnpDesembaracos_DD-MM-YY.<xlsx|csv>`.
- Dados exportados: linhas atualmente em estado da página (saída paginada de `get_anp_desembaracos_serie` aplicada com filtros de período + NCMs selecionados).
