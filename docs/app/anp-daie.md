# Sub-PRD — `/anp-daie`

Dashboard ANP DAIE — Dados Abertos de Importações e Exportações de Derivados de Petróleo (Oil & Gas / Fuel Distribution). Owner: [`worker_dash-anp-daie`](../../.claude/agents/worker_dash-anp-daie.md).

> Item do dropdown "Oil & Gas" da NavBar. Primeiro dashboard da Fase 3 ANP (DAIE + Desembaraços + Painel Importações).

## Escopo de código

```
src/app/(dashboard)/anp-daie/
  page.tsx
```

RPC wrappers: seção "ANP Dados Abertos IE" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (linhas ~1092–1159).

## Produto

Visualização das **séries mensais de importações e exportações de derivados de petróleo** publicadas pela ANP no portal Dados Abertos. Permite ao usuário:

- Selecionar via checkbox quais **produtos** comparar nos charts (ÓLEO DIESEL, GASOLINA A, GLP, NAFTA, QUEROSENE DE AVIAÇÃO, ÓLEO COMBUSTÍVEL, COQUE, COMBUSTÍVEIS PARA AERONAVES, COMBUSTÍVEIS PARA NAVIOS, GASOLINA DE AVIAÇÃO, QUEROSENE ILUMINANTE, PETRÓLEO) — ao menos 1 sempre marcada.
- Restringir o **período** via range slider de anos (default: últimos 10 anos), aplicado server-side via RPC.
- Comparar **Importação vs Exportação** lado a lado em dois charts independentes, com mesmas escalas de produto/cor.

Header: `ANP — Dados Abertos Importações e Exportações` + sub `Volumes mensais de importações e exportações de derivados de petróleo (volume em mil m³)` + badge de período quando dados existem.

Diferença vs `/anp-desembaracos` (Fase 3): aqui o foco é **agregação por produto declarado** (granularidade ANP — produto comercial); desembaraços usa NCM e país de origem.

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_anp_daie_filtros` | próprio | `produtos`, `operacoes` (`Importação`/`Exportação`), `ano_min`, `ano_max` |
| `get_anp_daie_serie` | próprio | Série mensal por produto/operação. Aceita `p_operacoes`, `p_produtos`, `p_ano_inicio`, `p_ano_fim` (todos opcionais) |

## Tabelas

| Objeto | Volume | Populado por |
|---|---|---|
| `anp_daie` | ~6.912 linhas | ETL `scripts/pipelines/anp/fase3/01_daie_sync.py` (download CSV/XLSX do portal Dados Abertos ANP, parse + upsert) |

### Colunas de `anp_daie`

`ano (smallint), mes (smallint), produto (text), operacao (text), volume_m3 (float8), valor_usd (float8)`. PK: `(ano, mes, produto, operacao)`.

### Migration relevante

- `20260504000003_anp_fase3.sql` — schema + RLS + RPCs + INSERT em `module_visibility` (compartilhada com `/anp-desembaracos` e `/anp-painel-imp`).

## Pipeline de origem

| Workflow | Schedule | Scripts |
|---|---|---|
| `.github/workflows/anp_fase3_sync.yml` | Mensal dia 1° 13:00 UTC (10:00 BRT) | `scripts/pipelines/anp/fase3/01_daie_sync.py` (encadeado com `02_desembaracos_sync.py` e `03_painel_imp_sync.py`) |

Comportamento do scraper:
- Baixa o dataset Dados Abertos IE da ANP (CSV/XLSX).
- Normaliza produtos (uppercase, trim) e operações (`Importação`/`Exportação`).
- Agrega por `(ano, mes, produto, operacao)` somando `volume_m3` e `valor_usd`.
- Upsert idempotente via supabase-py.

## Filtros disponíveis (UI)

| Filtro | Componente | Comportamento |
|---|---|---|
| Produto | checkboxes c/ swatch de cor | client-side; mínimo 1 sempre selecionada; botão "Limpar" restaura todas; counter `(N/total)` (total dinâmico vindo da RPC) |
| Período | `rc-slider` range (anos) | server-side em `get_anp_daie_serie` (debounced 400ms) |

## Charts esperados (2)

1. **Importação (mil m³ / mês)** — chart de linha múltipla, 1 trace por produto selecionado. Cor por `PRODUTO_COLORS`. Eixo Y: `mil m³ / mês`.
2. **Exportação (mil m³ / mês)** — mesma estrutura, dados filtrados por `operacao = 'Exportação'`.

> Os dois charts compartilham a paleta de cores por produto, facilitando comparação visual entre fluxos.

## Componentes consumidos

- `PlotlyChart` — 2 charts de linha múltipla.
- `rc-slider` — slider de período (anos).
- `NavBar`.
- `useModuleVisibilityGuard("anp-daie")` — guard de role.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| ETL (`anp_fase3_sync`) | Popula `anp_daie` mensalmente |
| Subgerente APP | Schema/migration de `anp_daie` e RPCs |
| Designer | Cores fixas por produto, palette rotativa para extras, Arial, padrão de chart de linha múltipla |
| Supabase | RLS habilitado em `anp_daie` (read-only via anon authenticated); 2 RPCs SECURITY DEFINER |
| `worker_dash-admin` | Visibilidade do módulo (`module_visibility.anp-daie`) e imagem da home |

## Performance

- **`anp_daie` é médio (~7k)** — `get_anp_daie_serie` com `p_ano_inicio/p_ano_fim` filtra a ~3k linhas (10 anos × 12 meses × ~12 produtos × 2 operações).
- **Período via `p_ano_inicio`/`p_ano_fim`** — empurra filtragem para o servidor; sem isso, scan completo ainda é barato mas viola o padrão consolidado.
- **Filtragem por produto** nos charts é client-side via `useMemo` — sem refetch.
- **Debounce 400ms** no fetch ao mudar slider — evita rajadas durante drag.

## Anti-padrões

- Query direta em `anp_daie` do front — sempre via RPC.
- Refetch sem debounce — usar 400ms.
- Filtrar série inteira client-side por período — empurrar para RPC via `p_ano_inicio`/`p_ano_fim`.
- Permitir `selectedProdutos.length === 0` — sempre manter ao menos 1.
- Resetar `yearRange` em mudança de produto — slider é setado uma vez no mount.
- Bloquear página inteira com barrel em `serieLoading` — barrel é só pro `loading` inicial; subsequentes usam indicador inline + opacity 0.5.
- Assumir que `operacoes[0]` é "Importação" — em pt-BR, "Exportação" vem antes na ordem alfabética. Detectar por `includes("import")` / `includes("export")`.
- Mexer em `scripts/pipelines/anp/fase3/01_daie_sync.py` — pertence ao ETL.
