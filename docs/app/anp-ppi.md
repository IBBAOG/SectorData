# Sub-PRD — `/anp-ppi`

Dashboard ANP PPI — Preços de Paridade de Importação (Fuel Distribution). Owner: [`worker_dash-anp-ppi`](../../.claude/agents/worker_dash-anp-ppi.md).

> Item do dropdown "Fuel Distribution" da NavBar.

## Escopo de código

```
src/app/(dashboard)/anp-ppi/
  page.tsx
```

RPC wrappers: seção "ANP PPI" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (linhas ~859–953).

## Produto

Visualização do **PPI (Petrobras Internal Prices)** — preços semanais de paridade de importação publicados pela ANP em planilha XLSX. Permite ao usuário:

- Selecionar via checkbox quais **produtos** comparar no chart Nacional (Gasolina A Comum, Diesel A S10, QAV, GLP) — ao menos 1 sempre marcado.
- Restringir o **período** via range slider (default: últimos 10 anos).
- Escolher um **produto-detalhe** (select único) e ver o breakdown por **local** (cidade portuária — Itaqui, Paulínia, Suape, etc.) num segundo chart.

Header: `ANP — Preços de Paridade de Importação (PPI)` + sub `Preços semanais de paridade publicados pela ANP, por produto e local de entrega` + badge de período quando dados existem.

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_anp_ppi_filtros` | próprio | `produtos`, `locais`, `data_min`, `data_max` |
| `get_anp_ppi_media_serie` | próprio | Série semanal nacional média por produto. Aceita `p_data_inicio`, `p_data_fim`. Sem params: full table (~5–6k linhas) |
| `get_anp_ppi_locais_serie` | próprio | Série semanal por local para um produto específico. Aceita `p_produto`, `p_data_inicio`, `p_data_fim` |

## Tabelas

| Objeto | Volume | Populado por |
|---|---|---|
| `anp_ppi` | ~18.131 linhas | ETL `scripts/pipelines/anp/precos/01_ppi_sync.py` (download XLSX da ANP, parse 4 sheets, upsert) |

### Colunas de `anp_ppi`

`data_inicio (date), data_fim (date), produto (text), local (text), preco (float4), variacao_pct (float4), unidade (text)`. PK: `(data_fim, produto, local)`.

### Migration relevante

- `20260504000002_anp_precos.sql` — schema + RLS + RPCs + INSERT em `module_visibility`.

## Pipeline de origem

| Workflow | Schedule | Scripts |
|---|---|---|
| `.github/workflows/etl_anp_precos.yml` | Semanal segunda 12:00 UTC (09:00 BRT) | `scripts/pipelines/anp/precos/01_ppi_sync.py` (4 sheets: Gasolina, Diesel, QAV, GLP — `_SHEETS` map) |

O mesmo workflow encadeia também `02_precos_produtores_sync.py` e `glp_sync.py` (outros dashboards).

## Filtros disponíveis (UI)

| Filtro | Componente | Comportamento |
|---|---|---|
| Produto (chart médio) | checkboxes c/ swatch de cor | client-side; mínimo 1 sempre selecionado |
| Período | `rc-slider` range | server-side em `get_anp_ppi_locais_serie` (debounced 400ms); client-side filter no chart médio |
| Produto-detalhe | select único | dispara refetch de `get_anp_ppi_locais_serie` (debounced 400ms) |

## Componentes consumidos

- `PlotlyChart` — 2 charts (linha múltipla nacional + linha por local).
- `rc-slider` — slider de período.
- `NavBar`.
- `useModuleVisibilityGuard("anp-ppi")` — guard de role.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| ETL (`anp_precos_sync`) | Popula `anp_ppi` semanalmente |
| Subgerente APP | Schema/migration de `anp_ppi` e RPCs |
| Designer | Cor laranja `#FF5000` (Gasolina), Arial, padrão de chart de linha |
| Supabase | RLS habilitado em `anp_ppi` (read-only via anon authenticated) |

## Performance

- **`anp_ppi` é pequena (~18k)** — `get_anp_ppi_media_serie` retorna ~5–6k linhas (4 produtos × N semanas) num único request, gzipped.
- **`get_anp_ppi_locais_serie`** retorna ~16 locais × N semanas para um produto. Tipicamente <1k linhas para 10 anos. Debounce 400ms.
- **Filtragem por produto** no chart médio é client-side via `useMemo` — sem refetch.
- **Filtragem por período** no chart médio também é client-side; a re-fetch só acontece para o chart de locais (porque a RPC já filtra por data).

## Anti-padrões

- Query direta em `anp_ppi` do front — sempre via RPC.
- Refetch da `media_serie` a cada filter change — é one-shot no mount.
- Adicionar produto novo em `PRODUTO_INFO` sem garantir que o ETL `01_ppi_sync.py` mapeia o sheet correspondente em `_SHEETS`.
- Permitir array vazio em `selectedProdutos` — sempre manter ao menos 1 produto selecionado.
- Mostrar nome de produto sem aplicar `PRODUTO_INFO[p].label` (label oficial PT-BR).
