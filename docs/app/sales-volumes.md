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
| `get_sv_opcoes_filtros` | próprio | Retorna opções de filtros (datas, regiões, UFs, mercados) |
| `get_sv_serie_fast` | próprio | Série mensal pré-agregada via `mv_ms_serie` (agregada por classificacao) |
| `get_sv_serie_others` | próprio | Série por `agente_regulado` para players não-Big3 |
| `get_sv_others_players` | próprio | Lista de agentes não-Big3 para dropdown (~50 rows) |

Wrappers em `src/lib/rpc.ts`: `rpcGetSvOpcoesFiltros`, `rpcGetSvSerieFast`, `rpcGetSvSerieOthers`, `rpcGetSvOthersPlayers`.

> **Nota histórica:** a migration `20260402000000_sales_volumes.sql` falhou silenciosamente (funções não foram criadas). A migration `20260505000006_restore_sv_rpcs.sql` restaurou as 4 funções. O `page.tsx` estava usando as RPCs compartilhadas de market-share (`get_ms_*`) — corrigido para usar as próprias `get_sv_*`.

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
