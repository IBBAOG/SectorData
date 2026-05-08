# Sub-PRD — `/anp-cdp-diaria`

Dashboard ANP CDP Diária — Produção Diária por Campo (Oil & Gas). Owner: [`worker_dash-anp-cdp-diaria`](../../.claude/agents/worker_dash-anp-cdp-diaria.md).

> Item do dropdown "Oil & Gas" da NavBar (irmão de `/anp-cdp`). Distinção crítica: `/anp-cdp` é mensal por **poço** (formulário CDP); `/anp-cdp-diaria` é diário por **campo** (Power BI ANP).

## Escopo de código

```
src/app/(dashboard)/anp-cdp-diaria/
  page.tsx
```

RPC wrappers: seção "ANP CDP Diária" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (`rpcGetAnpCdpDiariaFiltros`, `rpcGetAnpCdpDiariaSerie`).

Heurística de tamanho de export: chave `anp_cdp_diaria` em [`src/lib/exportSizeHeuristics.ts`](../../src/lib/exportSizeHeuristics.ts).

## Produto

Visualização da **produção diária de petróleo e gás natural por campo** declarada no Power BI público da ANP. Permite ao usuário:

- Selecionar **bacias** via checkbox list (default: todas, server-side via `p_bacias`).
- Selecionar **campos** via `SearchableMultiSelect` (94 opções; sem seleção → gráficos mostram Top 10 por média no período).
- Restringir o **período** via `PeriodSlider` em modo `dates` (granularidade diária — server-side via `p_data_inicio`/`p_data_fim`).
- Ver duas séries temporais (Petróleo `bbl/dia` e Gás `Mm³/dia`) para os campos selecionados ou Top 10.
- Inspecionar a tabela de produção mais recente (ordem desc por data + campo, primeiras 500 linhas).
- Exportar Excel/CSV via `ExportPanel` Tier 2 (`ExportModal` com calculadora de tamanho).

Header: `ANP CDP — Produção Diária por Campo` + sub `Petróleo e gás natural por campo, atualizado 3×/dia (fonte: Power BI ANP)` + badge de período `data_min – data_max` quando dados existem.

### Diferença vs `/anp-cdp`

| | `/anp-cdp` | `/anp-cdp-diaria` |
|---|---|---|
| Granularidade | Mensal | Diária |
| Unidade | Poço × campo | Campo × bacia |
| Fonte | Formulário CDP (Selenium + CAPTCHA, mensal) | Power BI ANP (3×/dia automático) |
| Volume | ~1.8M linhas | ~16.5k linhas iniciais, +94/dia |
| Tabela | `anp_cdp_producao` | `anp_cdp_diaria` |
| Range | Histórico longo (dezenas de anos) | Começa em 2025-11-30 (limitação da fonte) |

## RPCs consumidas

| Wrapper TS | RPC PostgreSQL | Retorno (T) |
|---|---|---|
| `rpcGetAnpCdpDiariaFiltros` | `get_anp_cdp_diaria_filtros()` | `{ campos[], bacias[], data_min, data_max }` |
| `rpcGetAnpCdpDiariaSerie` | `get_anp_cdp_diaria_serie(p_campos, p_bacias, p_data_inicio, p_data_fim)` | `Array<{ data, campo, bacia, petroleo_bbl_dia, gas_mm3_dia }>` (sem agregação — front agrega) |

## Schema da tabela alvo

Tabela: `public.anp_cdp_diaria` (~16.5k linhas iniciais; cresce ~94/dia × 1 dia × 3 refreshes/dia ≈ 282 linhas/dia se sempre houver dado novo).

| Coluna | Tipo | PK? | Notas |
|---|---|---|---|
| `data` | DATE | ✓ | Day of measurement |
| `campo` | TEXT | ✓ | Nome do campo |
| `bacia` | TEXT | ✓ | Nome da bacia |
| `petroleo_bbl_dia` | REAL | | bbl/dia |
| `gas_mm3_dia` | REAL | | Mm³/dia |

**RLS**: `SELECT TO authenticated USING (true)` — padrão Phase 3.

## Pipeline de origem

- **Script**: `scripts/extractors/anp_cdp_powerbi.py` (extrator Power BI — owner: `worker_etl-pipelines`)
- **Workflow**: `.github/workflows/etl_anp_cdp_diaria.yml` (em construção em paralelo)
- **Schedule**: 3×/dia (10:00, 15:00, 20:00 UTC)
- **Range**: dataset começa em **2025-11-30** (limite da fonte Power BI)

## Filtros UI

| Filtro | Componente | Comportamento |
|---|---|---|
| Bacia | `<MultiSelectFilter>` com `emptyMeansAll` | server-side via `p_bacias` (debounced 400ms); empty = sem filtro |
| Campo | `<SearchableMultiSelect>` | client-side; sem seleção → Top 10 por média |
| Período | `<PeriodSlider>` modo `dates` | server-side via `p_data_inicio`/`p_data_fim` (debounced 400ms) |

## Charts esperados

| Chart | Tipo Plotly | Source RPC | Notas |
|---|---|---|---|
| Petróleo (bbl/dia) | line (multi-trace) | `get_anp_cdp_diaria_serie` | Top 10 campos por média se sem seleção; senão exatos selecionados |
| Gás (Mm³/dia) | line (multi-trace) | `get_anp_cdp_diaria_serie` | mesma lógica de seleção |
| Produção por Campo (tabela) | HTML table com sticky thead | mesma série | Top 500 linhas mais recentes (desc por data + campo) |

**Coerência unidade↔label**: tabela já guarda valores em `bbl/dia` e `Mm³/dia` — sem divisor adicional. Mm³ = milhões de m³.

## Padrões consolidados aplicados

- [x] Header: `<DashboardHeader title sub period>` com `<hr>` separator
- [x] Period badge: condicional ao `hasDates` (`[string, string] | null`)
- [x] Push período + bacia para RPC server-side (não filtrar série inteira no client)
- [x] Debounce 400ms via `useDebouncedFetch`
- [x] Loading: `<BarrelLoading>` no init; `<ChartSection loading>` inline durante refetch
- [x] Filtros: `<MultiSelectFilter>` (Bacia) + `<SearchableMultiSelect>` (Campo) com counter `(N/total)`
- [x] Empty state amigável (tabela e charts) quando filtros sem dados
- [x] Identidade visual: `#FF5000` first color, Arial, padrão `COMMON_LAYOUT` + `AXIS_LINE`
- [x] pt-BR consistente (labels, hovertemplate, números via `Intl.NumberFormat("pt-BR")`)
- [x] Visibility guard: `useModuleVisibilityGuard("anp-cdp-diaria")`

## Definition of Done

1. **`npx tsc --noEmit` clean** — passou (zero erros).
2. **`npx eslint src/app/(dashboard)/anp-cdp-diaria` clean** — passou (zero warnings).
3. **Smoke test em dev server**: filtros populam (94 campos, 8 bacias), charts renderizam, slider de datas funciona.
4. **Self-QA estática**: comparado com `/anp-glp` (granularidade temporal), `/anp-lpc` (slider de datas), `/anp-precos-distribuicao` (export modal Tier 2).
5. **Sub-PRD (este arquivo)** atualizado quando ganhar nova RPC/coluna/chart.

## Dependências cross-departamentais

- **Schema/RPCs (`worker_supabase`)**: criou `anp_cdp_diaria` + 2 RPCs + RLS + entrada em `module_visibility`. Consumimos read-only via anon authenticated.
- **Pipeline ETL (`worker_etl-pipelines`)**: `scripts/extractors/anp_cdp_powerbi.py` + workflow `etl_anp_cdp_diaria.yml` (3×/dia). Tabela é populada e mantida por eles.
- **Admin (`worker_dash-admin`)**: slug `anp-cdp-diaria` em `module_visibility` (default visível); precisa de upload de imagem de home + toggle no `/admin-panel` (memória do CEO: TODO módulo novo precisa disso).

## Anti-padrões / decisões técnicas

- **Sem RPC dedicada `get_anp_cdp_diaria_export_count`**: para a primeira versão usamos heurística (~50 bytes/linha × `rpcGetAnpCdpDiariaSerie(...).length`). TODO: virar RPC se export pesado virar gargalo.
- **Filtro de Campo não é empurrado pra RPC do chart**: queremos buscar todos os campos no período/bacia para que a Top-N (defaults) seja estável — só o slider de período e o filtro de bacia disparam refetch debounced. Filtro de campo é client-side puro.
- **Sem `MultiSelectFilter` para Campo**: 94 opções → list muito longa; `SearchableMultiSelect` (search + virtual list) é mais usável.
- **Sem `useMemo` da tabela com `useExportSize`**: `countFetcher` é uma função sem cache — chamada custa um round-trip de RPC. Aceitável em export modal (low frequency).
- **Tabela mostra apenas top 500 linhas**: visualização de auditoria/spot-check, não é UI de download. Para o dump completo, usar Export.

## Performance

- **`anp_cdp_diaria` é pequena (~16.5k inicial)** — fetch sem filtros traz tudo (~3MB descomprimido, gzip ~1MB).
- **Crescimento ~94 linhas/dia**: em 2 anos teremos ~70k linhas — ainda confortável para fetch full.
- **Top 10 client-side via `useMemo`** — sem refetch ao mudar seleção de campos.
- **Debounce 400ms** no fetch ao mudar slider de datas ou checkbox de bacia.
- **Paginação PostgREST**: `rpcGetAnpCdpDiariaSerie` usa `.range(offset, offset+999)` em loop até esgotar.

## Histórico

- `2026-05-08` — Implementação inicial (commit pendente — coordenado com `worker_etl-pipelines` em paralelo).
