# Sub-PRD — `/market-share`

Dashboard de Market Share (% de participação). Owner: [`dash-market-share`](../../.claude/agents/dash-market-share.md).

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

> **Coordenação obrigatória:** mudança nas 3 RPCs compartilhadas exige alinhamento com `dash-sales-volumes`.

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

Idênticas ao sales-volumes (ETL/anp_watcher → `vendas` → MV).

## Anti-padrões

- Calcular % no cliente quando o backend já retorna agregado.
- Misturar metáfora "absoluto" com "share" no mesmo gráfico.
- Mudar `get_ms_*` sem coordenar.
