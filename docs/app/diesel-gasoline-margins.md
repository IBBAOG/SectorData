# Sub-PRD — `/diesel-gasoline-margins`

Dashboard de Margens Diesel/Gasolina. Owner: [`worker_dash-margins`](../../.claude/agents/worker_dash-margins.md).

## Escopo de código

```
src/app/(dashboard)/diesel-gasoline-margins/
  page.tsx
```

RPC wrappers: seção "d_g_margins" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

## Produto

Visualização semanal da **decomposição da margem** de venda de Diesel e Gasolina:
- `base_fuel`
- `biofuel_component`
- `federal_tax`
- `state_tax`
- `distribution_and_resale_margin`
- `total` (soma dos componentes)

Visualização típica: **stacked bar/area chart** ao longo de semanas, com filtros por tipo de combustível.

## RPCs

| RPC | Função |
|---|---|
| `get_dg_margins_data` | Linhas (filtráveis) |
| `get_dg_margins_filters` | Opções de filtros |

## Tabela

`d_g_margins`:
- PK: `id`
- Chave de upsert: `(fuel_type, week)`
- Colunas: `fuel_type, week, base_fuel, biofuel_component, federal_tax, state_tax, distribution_and_resale_margin, total`

## Como o dado chega

**Manualmente, pelo CEO.** Fluxo:

```
CEO edita data/d_g_margins.xlsx → scripts/manual/dg_margins_upload.py → upsert em d_g_margins
```

Workflow GitHub Action: `.github/workflows/dg_margins_upload.yml` roda semanalmente (segunda).

**Dono do dado:** `worker_dados-locais` (não ETL automático). Este dashboard só consome.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| Dados Locais | Excel manual + script de upload |
| Subgerente APP | Schema/migration de `d_g_margins` |
| Designer | Stacked chart pattern, cores dos componentes |

## Filtros tipicamente usados (UI)

- `fuel_type` (Diesel, Gasolina) — geralmente como tabs ou toggle.
- Período (slider de semanas).

## Anti-padrões

- Tentar editar `data/d_g_margins.xlsx` direto — é manual do CEO.
- Inferir colunas a partir do Excel — sempre cruze com o schema da tabela.
- Mostrar `fuel_type` em inglês na UI — traduza pra "Diesel" / "Gasolina".
