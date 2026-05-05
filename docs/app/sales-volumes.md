# Sub-PRD — `/sales-volumes`

Dashboard de Volumes de Venda. Owner: [`worker_dash-sales-volumes`](../../.claude/agents/worker_dash-sales-volumes.md).

## Escopo de código

```
src/app/(dashboard)/sales-volumes/
  page.tsx
```

RPC wrappers: seção "sales-volumes" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

## Produto

Visualização de **volume absoluto** de combustíveis por agente regulado, ao longo do tempo, filtrável por:
- Período (slider)
- Região / UF de destino
- Mercado / segmento
- Agente regulado (multi-select)

Output principal: gráfico de linhas / barras com séries por agente. Tabela com totais. Export Excel.

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_sv_opcoes_filtros` | próprio | Retorna opções de filtros (anos, meses, agentes, regiões, UFs, mercados) |
| `get_ms_serie_fast` | **compartilhado com market-share** | Série mensal pré-agregada (mv_ms_serie_fast) |
| `get_ms_serie_others` | **compartilhado** | Soma agregada dos players "Outros" |
| `get_others_players` | **compartilhado** | Lista de players agregados em "Outros" |

> **Coordenação obrigatória:** mudança nas 3 RPCs compartilhadas exige alinhamento com `worker_dash-market-share`.

## Tabelas / Views

- `vendas` — granular (não usar em consultas grandes; preferir mv).
- `mv_ms_serie_fast` — materialized view pré-agregada por mês, refresh via função SQL `classificar_agentes()`.

## Filtros disponíveis (UI)

- `PeriodSlider` (rc-slider, range de meses).
- `RegionStateFilter` (cascata Região → UF).
- `CheckList` para mercados/segmentos.
- `SearchableMultiSelect` para agentes regulados.

## Componentes consumidos

- `PlotlyChart` (gráfico).
- `exportExcel` (tabela → xlsx).

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| ETL (`vendas_watch`) | Popula `vendas` periodicamente |
| Subgerente APP | Migration de `vendas` e RPCs base |
| Designer | Identidade visual de séries, cores, tooltip |
| dash-market-share | RPCs compartilhadas |

## Performance

- **`vendas`** tem volume grande. Sempre usar `mv_ms_serie_fast` para agregações mensais.
- **Refresh do MV**: função `classificar_agentes()` é chamada após upload em `vendas`.
- **Filtros do lado do servidor** (RPC) — não tente filtrar em memória depois.

## Anti-padrões

- Query direta em `vendas` para visualizações temporais. Use o MV.
- Modificar `get_ms_*` sem avisar `worker_dash-market-share`.
- Plotly importado direto (use `PlotlyChart`).
