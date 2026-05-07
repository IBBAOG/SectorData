# Sub-PRD — `/market-share`

Dashboard de Market Share (% de participação). Owner: [`worker_dash-market-share`](../../.claude/agents/worker_dash-market-share.md).

## Escopo de código

```
src/app/(dashboard)/market-share/
  page.tsx
```

RPC wrappers: seção "market-share" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

## Produto

Visualização de **% de participação de mercado** entre players de combustíveis, ao longo do tempo. Filtros idênticos ao sales-volumes (período, região, UF, mercado, agentes), mas a narrativa é distinta:
- Não importa o **valor absoluto** — importa **share relativo**.
- "Outros" é tratado como agregado (soma dos pequenos players para não poluir o gráfico).

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_ms_opcoes_filtros` | próprio | Opções de filtros |
| `get_ms_serie_fast` | **compartilhado com sales-volumes** | Série mensal |
| `get_ms_serie_others` | **compartilhado** | Soma de "Outros" |
| `get_others_players` | **compartilhado** | Lista de players em "Outros" |

> **Coordenação obrigatória:** mudança nas 3 RPCs compartilhadas exige alinhamento com `worker_dash-sales-volumes`.

## Tabelas / Views

- `vendas`
- `mv_ms_serie_fast`

## Por que existe separado de `/sales-volumes`?

Ambos consomem mesmas RPCs, mas:
- **Sales Volumes**: eixo Y = volume absoluto (toneladas/m³), narrativa de "quanto cada um vendeu".
- **Market Share**: eixo Y = % do total, narrativa de "quem ganhou/perdeu mercado".
- Mesmo backend, **frontends distintos**. Manter separado permite evolução independente da apresentação.

## Filtros disponíveis (UI)

Idênticos ao sales-volumes. Padronização intencional.

## Dependências cross-dept

Idênticas ao sales-volumes (ETL/`vendas_watch` → `vendas` → MV).

## Anti-padrões

- Calcular % no cliente quando o backend já retorna agregado.
- Misturar metáfora "absoluto" com "share" no mesmo gráfico.
- Mudar `get_ms_*` sem coordenar.

## Export

Tier 2 — `<ExportPanel mode="modal">` abre `<ExportModal>` com filtros + calculadora live de tamanho (ver [`docs/app/PRD.md`](PRD.md) → "Export padronizado").

- RPC count: `get_ms_export_count` (`p_data_inicio`, `p_data_fim`, `p_regioes`, `p_ufs`, `p_mercados`) → `bigint`, em `supabase/migrations/20260507000003_export_count_rpcs.sql`.
- JS wrapper: `getMsExportCount` em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).
- datasetKey heuristic: `vendas` (ver [`src/lib/exportSizeHeuristics.ts`](../../src/lib/exportSizeHeuristics.ts) → `AVG_BYTES_PER_ROW.vendas`).
- Filtros expostos no modal: período (slider de meses), regiões, UFs, mercados/segmentos.
- Excel handler: `downloadMarketShareExcel` em [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts) — workbook single-sheet com título brand orange, header preto, dados Arial 10.
- CSV handler: paginated fetch via `fetchVendasFiltered` (helper em `src/lib/rpc.ts`) + `downloadCsv` em [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts) (RFC4180, UTF-8).
- Filename pattern: `MarketShare_DD-MM-YY.<xlsx|csv>`.
- Warning visual quando estimativa > 200 000 linhas.
- Compartilha o `get_ms_export_count` com `/sales-volumes` — qualquer mudança de assinatura exige coordenação com `worker_dash-sales-volumes`.
