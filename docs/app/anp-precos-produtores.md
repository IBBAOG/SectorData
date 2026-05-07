# Sub-PRD — `/anp-precos-produtores`

Dashboard ANP — Preços Médios Ponderados Produtores e Importadores (Fuel Distribution). Owner: [`worker_dash-anp-precos-produtores`](../../.claude/agents/worker_dash-anp-precos-produtores.md).

> Item do dropdown "Fuel Distribution" da NavBar.

## Escopo de código

```
src/app/(dashboard)/anp-precos-produtores/
  page.tsx
```

RPC wrappers: seção "ANP Preços Produtores" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (linhas ~955–1022).

## Produto

Visualização dos **preços médios ponderados semanais** praticados por **produtores e importadores** (refino/upstream) publicados pela ANP. Permite ao usuário:

- Selecionar via select único qual **produto** visualizar (Gasolina A Comum, Óleo Diesel, etc. — vindo da RPC).
- Filtrar quais **regiões geográficas** (Norte, Nordeste, Centro-Oeste, Sul, Sudeste) aparecem no chart — ao menos 1 sempre marcada. Cor por região fixa client-side.
- Restringir o **período** via range slider (default: últimos 10 anos).

Header: `ANP — Preços Médios Ponderados Produtores e Importadores` + sub `Preços semanais médios ponderados praticados por produtores e importadores, por região` + badge de período quando dados existem.

Diferença vs `/anp-ppi`: aqui é o **preço de venda real do produtor** (refino/distribuidor primário) por região. PPI é o **preço de paridade de importação** por local portuário.

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_anp_precos_produtores_filtros` | próprio | `produtos`, `regioes`, `data_min`, `data_max` |
| `get_anp_precos_produtores_serie` | próprio | Série semanal por região para um produto. Aceita `p_produto`, `p_regioes`, `p_data_inicio`, `p_data_fim` (todos opcionais) |

## Tabelas

| Objeto | Volume | Populado por |
|---|---|---|
| `anp_precos_produtores` | ~38.392 linhas | ETL `scripts/pipelines/anp/precos/02_precos_produtores_sync.py` (download 2 XLS da ANP — série 2002-2012 estática + 2013+ corrente, parse + upsert) |

### Colunas de `anp_precos_produtores`

`data_inicio (date), data_fim (date), produto (text), unidade (text), regiao (text), preco (float4)`. PK: `(data_inicio, produto, regiao)`.

### Migration relevante

- `20260504000002_anp_precos.sql` — schema + RLS + RPCs + INSERT em `module_visibility` (compartilhada com `/anp-ppi` e `/anp-glp`).

## Pipeline de origem

| Workflow | Schedule | Scripts |
|---|---|---|
| `.github/workflows/etl_anp_precos.yml` | Semanal segunda 12:00 UTC (09:00 BRT) | `scripts/pipelines/anp/precos/02_precos_produtores_sync.py` (após `01_ppi_sync.py` no mesmo workflow) |

A série 2002-2012 é baixada uma única vez (estática); a 2013+ é rebaixada e upsertada a cada execução.

## Filtros disponíveis (UI)

| Filtro | Componente | Comportamento |
|---|---|---|
| Produto | `<select>` único | server-side em `get_anp_precos_produtores_serie` (debounced 400ms) |
| Região | checkboxes c/ swatch de cor (5 fixas) | client-side; mínimo 1 sempre selecionada; botão "Limpar" restaura todas |
| Período | `rc-slider` range | server-side em `get_anp_precos_produtores_serie` (debounced 400ms) |

## Componentes consumidos

- `PlotlyChart` — chart de linha múltipla (1 trace por região).
- `rc-slider` — slider de período.
- `NavBar`.
- `useModuleVisibilityGuard("anp-precos-produtores")` — guard de role.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| ETL (`anp_precos_sync`) | Popula `anp_precos_produtores` semanalmente |
| Subgerente APP | Schema/migration de `anp_precos_produtores` e RPCs |
| Designer | Cores por região fixas client-side, Arial, padrão de chart de linha |
| Supabase | RLS habilitado em `anp_precos_produtores` (read-only via anon authenticated) |

## Performance

- **`anp_precos_produtores` é médio (~38k)** — `get_anp_precos_produtores_serie` com `p_produto` filtra a ~7-8k linhas/produto. Período via `p_data_inicio/p_data_fim` reduz adicionalmente.
- **Filtragem por região** é client-side via `useMemo` — sem refetch (5 opções fixas).
- **Debounce 400ms** no fetch ao mudar produto OU slider de período — evita rajadas.

## Anti-padrões

- Query direta em `anp_precos_produtores` do front — sempre via RPC.
- Refetch sem debounce — usar 400ms.
- Permitir `selectedRegioes.length === 0` — sempre manter ao menos 1.
- Resetar `yearRange` em mudança de produto — slider é setado uma vez no mount a partir de `filtros.data_min/data_max`.
- Mostrar nome de região com label diferente do banco (consistência: usar exatamente `Norte`, `Nordeste`, `Centro-Oeste`, `Sul`, `Sudeste`).
- Bloquear página inteira com barrel em `serieLoading` — barrel é só pro `loading` inicial; subsequentes usam indicador inline + opacity 0.5.
- Mexer em `scripts/pipelines/anp/precos/02_precos_produtores_sync.py` — pertence ao ETL.

## Export

Tier 1 — download direto via `<ExportPanel>` (ver [`docs/app/PRD.md`](PRD.md) → "Export padronizado").

- Excel: `downloadGenericExcel<T>` em [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts) — workbook single-sheet com título brand orange, header preto, dados Arial 10.
- CSV: `downloadCsv<T>` em [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts) (RFC4180, UTF-8).
- Filename pattern: `AnpPrecosProdutores_DD-MM-YY.<xlsx|csv>`.
- Dados exportados: linhas atualmente em estado da página (saída de `get_anp_precos_produtores_serie` para o produto selecionado + período, com regiões filtradas client-side antes do export).
