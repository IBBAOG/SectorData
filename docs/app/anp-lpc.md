# Sub-PRD — `/anp-lpc`

Dashboard ANP LPC — Levantamento de Preços de Combustíveis (Fuel Distribution). Owner: [`worker_dash-anp-lpc`](../../.claude/agents/worker_dash-anp-lpc.md).

> Item do dropdown "Fuel Distribution" da NavBar.

## Escopo de código

```
src/app/(dashboard)/anp-lpc/
  page.tsx
```

RPC wrappers: seção "ANP LPC" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (linhas ~1353–1457).

## Produto

Visualização do **Levantamento de Preços de Combustíveis (LPC)** publicado semanalmente pela ANP — preço médio nos postos por produto e UF, calculado como **média ponderada pelo número de postos pesquisados**. Permite ao usuário:

- Comparar via checkbox quais **produtos** acompanhar no chart Nacional (GASOLINA COMUM, GASOLINA ADITIVADA, ETANOL HIDRATADO, DIESEL S10, DIESEL S500, GNV, GLP) — ao menos 1 sempre marcada.
- Restringir o **período** via range slider de anos (default: últimos 5 anos), aplicado server-side via RPC (convertido para `data_inicio`/`data_fim` ISO).
- Escolher **um produto** (select único) e ver o **breakdown por região** (5 macrorregiões: N, NE, CO, SE, S) num chart de linha.

Header: `ANP LPC — Levantamento de Preços de Combustíveis` + sub `Preço médio semanal nos postos por produto e UF (média ponderada por número de postos pesquisados)` + badge de período quando dados existem.

Diferença vs `/anp-precos-produtores`: aqui é o **preço final ao consumidor** nos postos (revenda), não o preço de produtores/importadores. Diferença vs `/anp-ppi`: paridade de importação é teórica; LPC é preço efetivamente cobrado.

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_anp_lpc_filtros` | próprio | `produtos`, `estados`, `data_min`, `data_max` (strings ISO `YYYY-MM-DD`) |
| `get_anp_lpc_nacional` | próprio | Série semanal nacional agregada (média ponderada por nº de postos) por produto. Aceita `p_produtos`, `p_data_inicio`, `p_data_fim` (todos opcionais) |
| `get_anp_lpc_serie` | próprio | Série semanal por produto/UF — para breakdown regional. Aceita `p_produtos`, `p_estados`, `p_data_inicio`, `p_data_fim` (todos opcionais) |

## Tabelas

| Objeto | Volume | Populado por |
|---|---|---|
| `anp_lpc` | ~29.736 linhas | ETL `scripts/pipelines/anp/lpc_sync.py` (download de XLSXs revendas da página ANP, parse + agregação por (data_fim, produto, estado), upsert idempotente) |

### Colunas de `anp_lpc`

`data_fim (date — fim da semana coletada), produto (text), estado (text — UF de 2 letras), preco_medio_venda (float8), preco_medio_compra (float8 — geralmente null), n_postos (int — número de postos pesquisados naquela semana/produto/UF)`. PK: `(data_fim, produto, estado)`.

> **Período é DATE, não YEAR** — primeiro dashboard com este formato. A UI mantém slider de ANOS (consistência) mas converte para `${ano}-01-01` / `${ano}-12-31` ao chamar RPC.

## Pipeline de origem

| Workflow | Schedule | Scripts |
|---|---|---|
| `.github/workflows/etl_anp_lpc.yml` | Quarta 14:30 UTC (11:30 BRT) | `scripts/pipelines/anp/lpc_sync.py` |

Comportamento do scraper:
- Estratégia incremental: consulta `MAX(data_fim)` em `anp_lpc`, baixa apenas semanas mais recentes.
- Parse XLSX usa **`engine="calamine"`** — fix recente para evitar bug do `openpyxl 3.1.x` com `ExternalReference` em arquivos da ANP. **Não regredir** para openpyxl.
- Agregação local antes do upsert: `GROUP BY (data_fim, produto, estado)` com `mean(preco_venda)` e `count(preco_venda)`.
- Batch upsert: 500 linhas por request via supabase-py.

## Filtros disponíveis (UI)

| Filtro | Componente | Comportamento |
|---|---|---|
| Produto (chart Nacional) | checkboxes c/ swatch de cor | client-side; mínimo 1 sempre selecionada; botão "Limpar" restaura todas; counter `(N/total)` (total dinâmico vindo da RPC) |
| Período | `rc-slider` range (anos) | server-side em ambas as RPCs (debounced 400ms); convertido para `${y}-01-01` / `${y}-12-31` |
| Detalhe por Região — Produto | `<select>` único | client-side (recálculo do agrupamento por região via `useMemo`) |

## Charts esperados (2)

1. **Preço Médio Nacional — Venda (R$/L ou R$/kg)** — chart de linha múltipla, 1 trace por produto selecionado. Cor por `PRODUTO_COLORS`. Eixo Y: `R$ / L (ou kg)` (GLP é por kg, demais por L).
2. **Preço por Região — {produto}** — chart de linha múltipla, 1 trace por macrorregião (N, NE, CO, SE, S). Cores em `REGIAO_COLORS`. Agrega via mapa `UF_REGIAO` client-side, fazendo média simples entre UFs daquela região por semana.

## Componentes consumidos

- `PlotlyChart` — 2 charts de linha múltipla.
- `rc-slider` — slider de período (anos).
- `NavBar`.
- `useModuleVisibilityGuard("anp-lpc")` — guard de role.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| ETL (`anp_lpc_sync`) | Popula `anp_lpc` semanalmente. **Engine `calamine` no parse é crítica.** |
| Subgerente APP | Schema/migration de `anp_lpc` e RPCs |
| Designer | Cores fixas por produto, palette rotativa para extras, Arial, padrão de chart de linha múltipla |
| Supabase | RLS habilitado em `anp_lpc` (read-only via anon authenticated); 3 RPCs SECURITY DEFINER |
| `worker_dash-admin` | Visibilidade do módulo (`module_visibility.anp-lpc`) e imagem da home |

## Performance

- **`anp_lpc` é médio (~30k)** — `get_anp_lpc_nacional` agrega ponderado por nº de postos para algumas centenas de pontos; `get_anp_lpc_serie` por UF retorna ~5k–10k linhas com filtro de período.
- **Período via `p_data_inicio`/`p_data_fim`** — empurra filtragem para o servidor; sem isso, scan completo seria oneroso.
- **Filtragem por produto** no chart Nacional é client-side via `useMemo` — sem refetch (lista finita).
- **Agregação regional** é client-side via `useMemo` sobre `estadoRows` (mapa UF→Região, soma+contagem por (regiao, data_fim), média final).
- **Debounce 400ms** no fetch ao mudar slider — evita rajadas durante drag.

## Anti-padrões

- Query direta em `anp_lpc` do front — sempre via RPC.
- Refetch sem debounce — usar 400ms.
- Filtrar série inteira client-side por período — empurrar para RPC via `p_data_inicio`/`p_data_fim`.
- Permitir `selectedProdutos.length === 0` — sempre manter ao menos 1.
- Resetar `yearRange` em mudança de produto — slider é setado uma vez no mount.
- Bloquear página inteira com barrel em `serieLoading` — barrel é só pro `loading` inicial; subsequentes usam indicador inline + opacity 0.5.
- Trocar slider de anos por slider de semanas sem coordenar com Designer — quebra consistência cross-dashboard.
- Mexer em `scripts/pipelines/anp/lpc_sync.py` — pertence ao ETL. **Em particular: não regredir o engine `calamine` para `openpyxl`** (bug conhecido com `ExternalReference`).

## Export

Tier 2 — `<ExportPanel mode="modal">` abre `<ExportModal>` com filtros + calculadora live de tamanho (ver [`docs/app/PRD.md`](PRD.md) → "Export padronizado").

- RPC count: `get_anp_lpc_export_count` (`p_data_inicio`, `p_data_fim`, `p_produtos`, `p_estados`) → `bigint`, em `supabase/migrations/20260507000003_export_count_rpcs.sql`.
- JS wrapper: `getAnpLpcExportCount` em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).
- datasetKey heuristic: `anp_lpc` (ver [`src/lib/exportSizeHeuristics.ts`](../../src/lib/exportSizeHeuristics.ts) → `AVG_BYTES_PER_ROW.anp_lpc`).
- Filtros expostos no modal: período (slider de anos, convertido para `${y}-01-01` / `${y}-12-31` antes do envio), produtos, estados.
- Excel handler: `downloadAnpLpcExcel` em [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts) — workbook single-sheet com título brand orange, header preto, dados Arial 10.
- CSV handler: paginated fetch direto em `anp_lpc` (PostgREST 1.000 linhas/página) + `downloadCsv` em [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts) (RFC4180, UTF-8).
- Filename pattern: `AnpLpc_DD-MM-YY.<xlsx|csv>`.
- Warning visual quando estimativa > 200 000 linhas.

## Padrão arquitetural: período em DATE vs YEAR

Este é o **primeiro dashboard com tabela cuja chave temporal é DATE (semanal)**, não (ano, mes) como os demais. A solução adotada — **slider de anos no UI, conversão para `${y}-01-01` / `${y}-12-31` ao chamar RPC** — preserva consistência visual com os outros dashboards e evita reaprender UX. Esta abordagem deve ser referência para futuros dashboards com período em DATE (`/sindicom`, `/anp-fase3-daie`, `/anp-fase3-desembaracos`, `/anp-fase3-painel-imp` quando vierem).
