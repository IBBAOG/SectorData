# Sub-PRD — `/anp-painel-importacoes`

Dashboard ANP Painel Importações — Importações de Distribuidores de Combustíveis Líquidos por produto, UF e distribuidor (Fuel Distribution). Owner: [`worker_dash-anp-painel-importacoes`](../../.claude/agents/worker_dash-anp-painel-importacoes.md).

> Item do dropdown "Oil & Gas" da NavBar. Terceiro e último dashboard da Fase 3 ANP (DAIE → Desembaraços → **Painel Importações**).

## Escopo de código

```
src/app/(dashboard)/anp-painel-importacoes/
  page.tsx
```

RPC wrappers: seção "ANP Painel Importações" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (linhas ~1257–1351).

## Produto

Visualização das **séries mensais e ranking de distribuidores das importações por distribuidor** publicadas pela ANP no Painel de Importações. Permite ao usuário:

- Selecionar via checkbox quais **produtos** comparar no chart de série temporal — ao menos 1 sempre marcado; default: todos selecionados (poucos produtos no painel).
- Restringir o **período** via range slider de anos (default: últimos 10 anos), aplicado server-side via RPC.
- Escolher (dropdown) 1 produto para ver o **ranking de distribuidores** (top 15 por volume).

Header: `ANP Painel — Importações de Distribuidores` + sub `Volumes mensais importados por distribuidor, UF e produto (volume em mil m³)` + badge de período quando dados existem.

Diferenças entre os 3 dashboards Fase 3:

| Dashboard | Granularidade | Métrica |
|---|---|---|
| `/anp-daie` | produto comercial × operação (Imp/Exp) | volume_m³ + valor_usd |
| `/anp-desembaracos` | NCM × país de origem | quantidade_kg |
| `/anp-painel-importacoes` | **distribuidor × UF × produto** | **volume_m³** |

## Unidades

- **Source**: `volume_m3` (metros cúbicos)
- **UI**: `mil m³`. Conversão: `m³ / 1e3 = mil m³`.
- Em todos os charts (Y-axis title, hovertemplate, section-title) o label é "mil m³".
- **Origem upstream**: o scraper `03_painel_imp_sync.py` lê a coluna "Quantidade de produto (mil m³)" do CSV ANP e **multiplica por 1.000** para armazenar em m³, garantindo unidade base SI consistente com `volume_m3` do `anp_daie` (mesma convenção).

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_anp_painel_imp_filtros` | próprio | `produtos` (string[]), `ufs` (string[]), `distribuidores` (string[]), `ano_min`, `ano_max` |
| `get_anp_painel_imp_serie` | próprio | Série mensal por produto. Aceita `p_produtos`, `p_ufs`, `p_ano_inicio`, `p_ano_fim` (todos opcionais). Agrega cross-distribuidor/UF: `GROUP BY (ano, mes, nome_produto)` somando `volume_m3`. Wrapper paginado (1.000 linhas/página). |
| `get_anp_painel_imp_top_dist` | próprio | Top N distribuidores para 1 produto. Aceita `p_produto` (obrigatório), `p_ano_inicio`, `p_ano_fim`, `p_limit` (default 15). |

## Tabelas

| Objeto | Volume | Populado por |
|---|---|---|
| `anp_painel_imp_dist` | ~1.444 linhas | ETL `scripts/pipelines/anp/fase3/03_painel_imp_sync.py` |

### Colunas de `anp_painel_imp_dist`

`ano (smallint), mes (smallint), distribuidor (text), uf (text), nome_produto (text), volume_m3 (float8)`. PK: `(ano, mes, distribuidor, uf, nome_produto)`. Índices: `(ano, mes)`, `(nome_produto)`, `(distribuidor)`.

### Migration relevante

- `20260504000003_anp_fase3.sql` — schema + RLS + RPCs + INSERT em `module_visibility` (compartilhada com `/anp-daie` e `/anp-desembaracos`).

## Pipeline de origem

| Workflow | Schedule | Scripts |
|---|---|---|
| `.github/workflows/etl_anp_fase3.yml` | Mensal dia 1° 13:00 UTC (10:00 BRT) | `scripts/pipelines/anp/fase3/01_daie_sync.py` → `02_desembaracos_sync.py` → `03_painel_imp_sync.py` |

Comportamento do scraper `03_painel_imp_sync.py`:
- Baixa o dataset do "Painel Dinâmico de Importações por Distribuidor" da ANP.
- Renomeia "Quantidade de produto (mil m³)" para `volume_mil_m3` e converte para `volume_m3 *= 1000`.
- Normaliza `ano`/`mes` (Int16/Int8), `distribuidor`, `uf`, `nome_produto`.
- Agrega por `(ano, mes, distribuidor, uf, nome_produto)` somando `volume_m3`.
- Upsert idempotente via supabase-py.

## Filtros disponíveis (UI)

| Filtro | Componente | Comportamento |
|---|---|---|
| Produto (Série) | checkboxes c/ swatch de cor + counter `(N/total)` | client-side; mínimo 1 sempre selecionado; "Limpar" restaura todos; default no mount = todos os produtos |
| Período | `rc-slider` range (anos) | server-side em `get_anp_painel_imp_serie` e `get_anp_painel_imp_top_dist` (debounced 400ms cada) |
| Top Distribuidores — Produto | `<select>` (single) | server-side em `get_anp_painel_imp_top_dist` (debounced 400ms); independente do checkbox de Série; default = produto com maior volume na janela inicial |

## Charts esperados (2)

1. **Volume Mensal Importado por Produto — Total Nacional (mil m³ / mês)** — chart de linha múltipla, 1 trace por produto selecionado, agregando todos os distribuidores e UFs. Eixo Y: `mil m³ / mês`. Cor por palette rotativa (16 cores).
2. **Top 15 Distribuidores — `<produto>` (mil m³)** — chart de barras horizontais, 1 barra por distribuidor (top 15 por volume total no período). Cor única `#1E88E5`.

## Componentes consumidos

- `PlotlyChart` — 2 charts (linha múltipla + barras horizontais).
- `rc-slider` — slider de período (anos).
- `NavBar`.
- `useModuleVisibilityGuard("anp-painel-importacoes")` — guard de role.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| ETL (`anp_fase3_sync`) | Popula `anp_painel_imp_dist` mensalmente (etapa 3 da chain, após DAIE e Desembaraços) |
| Subgerente APP | Schema/migration de `anp_painel_imp_dist` e RPCs |
| Designer | Palette rotativa de 16 cores, Arial, padrões de chart de linha múltipla + barras horizontais |
| Supabase | RLS habilitado em `anp_painel_imp_dist` (read-only via anon authenticated); 3 RPCs SECURITY DEFINER |
| `worker_dash-admin` | Visibilidade do módulo (`module_visibility.anp-painel-importacoes`) e imagem da home |

## Performance

- **`anp_painel_imp_dist` é pequeno (~1.4k)** — `get_anp_painel_imp_serie` com `p_ano_inicio/p_ano_fim` filtra à janela visível.
- **Paginação no wrapper** — 1.000 linhas/página (PostgREST default), itera até esgotar. Com 1.4k linhas hoje, são 2 páginas; necessário caso o histórico cresça (ex.: ANP libera retroativos).
- **Período via `p_ano_inicio`/`p_ano_fim`** — empurra filtragem para o servidor.
- **Filtragem por produto no chart de série** é client-side via `useMemo` (sem refetch — re-render apenas).
- **Top distribuidores**: refetch no servidor sempre que produto ou período muda (via `get_anp_painel_imp_top_dist`).
- **Debounce 400ms** em ambos os fetches reativos — evita rajadas durante drag do slider.

## Anti-padrões

- Query direta em `anp_painel_imp_dist` do front — sempre via RPC.
- Refetch sem debounce — usar 400ms.
- Filtrar série inteira client-side por período — empurrar para RPC.
- Permitir `selectedProdutos.length === 0` — sempre manter ao menos 1.
- Resetar `yearRange` em mudança de produto — slider é setado uma vez no mount.
- Bloquear página inteira com barrel em `serieLoading`/`topLoading` — barrel é só pro `loading` inicial.
- **Drift entre divisor e label** — `volume_m3 / 1e3 = mil m³`. Se o ETL parar de multiplicar por 1.000, todos os divisores caem por 1.000 e o label vira `m³`. Bug histórico recorrente em fases 3.x.
- Mexer em `scripts/pipelines/anp/fase3/03_painel_imp_sync.py` — pertence ao ETL.

## Export

Tier 1 — download direto via `<ExportPanel>` (ver [`docs/app/PRD.md`](PRD.md) → "Export padronizado").

- Excel: `downloadGenericExcel<T>` em [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts) — workbook single-sheet com título brand orange, header preto, dados Arial 10.
- CSV: `downloadCsv<T>` em [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts) (RFC4180, UTF-8).
- Filename pattern: `AnpPainelImp_DD-MM-YY.<xlsx|csv>`.
- Dados exportados: linhas atualmente em estado da página (saída paginada de `get_anp_painel_imp_serie` aplicada com filtros de período + produtos selecionados, agregando cross-distribuidor/UF).
