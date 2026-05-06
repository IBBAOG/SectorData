# Sub-PRD — `/mdic-comex`

Dashboard MDIC Comex Stat — Importações e Exportações de Combustíveis (Oil & Gas / Fuel Distribution). Owner: [`worker_dash-mdic-comex`](../../.claude/agents/worker_dash-mdic-comex.md).

> Item da NavBar.

## Escopo de código

```
src/app/(dashboard)/mdic-comex/
  page.tsx
```

RPC wrappers: seção "MDIC Comex" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (linhas ~765–857).

## Produto

Visualização dos **volumes mensais de importação e exportação** dos 3 NCMs principais de petróleo/combustíveis publicados pelo **MDIC Comex Stat** (Ministério do Desenvolvimento, Indústria, Comércio e Serviços), com breakdown por país de origem/destino. Permite ao usuário:

- Selecionar via checkboxes quais **NCMs** comparar nos charts de série (Petróleo Cru, Gasolina, Diesel) — ao menos 1 sempre marcada.
- Restringir o **período** via range slider (default: últimos 10 anos), aplicado server-side via RPC.
- Escolher **um NCM** (select único) e ver o ranking **Top 15 Países** acumulado no período em 2 charts de barras horizontais — um para Importação e um para Exportação.

Header: `MDIC Comex Stat — Importações e Exportações` + sub `Volume mensal de importação e exportação de petróleo cru, gasolina e diesel por NCM e país de origem/destino` + badge de período quando dados existem.

Diferença vs `/anp-cdp`: aqui é o **fluxo internacional** (import/export) reportado pela alfândega, não a produção doméstica. Diferença vs `/navios-diesel`: agregação mensal por NCM/país, não navio individual em tempo real.

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_mdic_comex_filtros` | próprio | `anos[]`, `ncms[{ncm_codigo, ncm_nome}]` |
| `get_mdic_comex_serie` | próprio | Série mensal agregada por NCM (sem breakdown por país). Aceita `p_flow`, `p_ncms`, `p_ano_inicio`, `p_ano_fim` (todos opcionais) |
| `get_mdic_comex_top_paises` | próprio | Top N países por volume para uma combinação flow+NCM+período. Aceita `p_flow`, `p_ncm_codigo`, `p_ano_inicio`, `p_ano_fim`, `p_limit` (default 15) |

## Tabelas

| Objeto | Volume | Populado por |
|---|---|---|
| `mdic_comex` | ~1.238 linhas | ETL `scripts/pipelines/mdic_comex_sync.py` (chama API `api-comexstat.mdic.gov.br/general` para os 3 NCMs × 2 flows × últimos N meses, parse + upsert idempotente) |

### Colunas de `mdic_comex`

`ano (smallint), mes (smallint), flow (text), ncm_codigo (text), ncm_nome (text), pais (text), volume_kg (float8), valor_fob_usd (float8)`. PK: `(ano, mes, flow, ncm_codigo, pais)`. Indexes: `(ano, mes)`, `(ncm_codigo)`, `(flow)`.

### Migration relevante

- `20260504000012_mdic_comex.sql` — schema + indexes + RLS + 3 RPCs + INSERT em `module_visibility('mdic-comex', true)`.

## Pipeline de origem

| Workflow | Schedule | Scripts |
|---|---|---|
| `.github/workflows/etl_mdic_comex.yml` | Diário 14:00 UTC (11:00 BRT) | `scripts/pipelines/mdic_comex_sync.py` |

Comportamento do scraper:
- Default: re-baixa últimos 3 meses (`--meses 3`) e faz upsert idempotente.
- Manual: `--desde YYYY-MM` permite backfill a partir de mês específico.
- Retries: 4 tentativas com backoff `[2, 5, 12, 30]s` por chunk.
- Batch upsert: 500 linhas por request via supabase-py.
- Os 3 NCMs `_NCMS = ["27090010", "27101259", "27101921"]` são fixos no script — adicionar NCM exige mudança no scraper E no `NCM_INFO` da página.

## NCMs fixos (3)

Mesmas 3 entradas em `NCM_INFO` no `page.tsx` e em `_NCMS` no scraper:

| NCM | Label | Cor | Significado |
|---|---|---|---|
| `27090010` | Petróleo Cru | `#1a1a1a` | Óleos brutos de petróleo |
| `27101259` | Gasolina | `#FF5000` | Gasolinas para motores |
| `27101921` | Diesel | `#2196F3` | Óleos combustíveis tipo diesel |

> Lista é **fechada client-side** — `get_mdic_comex_filtros` retorna `ncms[]` mas a UI usa o constante para garantir cor + label + ordem fixos.

## Filtros disponíveis (UI)

| Filtro | Componente | Comportamento |
|---|---|---|
| Produto (chart série) | checkboxes c/ swatch de cor (3 fixas) | client-side; mínimo 1 sempre selecionada; botão "Limpar" restaura todas; counter `(N/3)` |
| Período | `rc-slider` range | server-side em `get_mdic_comex_serie` E `get_mdic_comex_top_paises` (debounced 400ms) |
| Top Países — Produto | `<select>` único | server-side em `get_mdic_comex_top_paises` (debounced 400ms) |

## Charts esperados (4)

1. **Importações (mil t / mês)** — chart de linha múltipla, 1 trace por NCM selecionado (filtrado client-side).
2. **Exportações (mil t / mês)** — chart de linha múltipla, 1 trace por NCM selecionado.
3. **Top 15 Países — Importação · {NCM}** — barras horizontais, cor `#2196F3`.
4. **Top 15 Países — Exportação · {NCM}** — barras horizontais, cor `#FF5000`.

## Componentes consumidos

- `PlotlyChart` — 4 charts (2 de linha + 2 de barras horizontais).
- `rc-slider` — slider de período.
- `NavBar`.
- `useModuleVisibilityGuard("mdic-comex")` — guard de role.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| ETL (`mdic_comex_sync`) | Popula `mdic_comex` diariamente; define os 3 NCMs |
| Subgerente APP | Schema/migration de `mdic_comex` e RPCs |
| Designer | Cores por NCM fixas client-side, Arial, padrão de chart de linha + barra horizontal |
| Supabase | RLS habilitado em `mdic_comex` (read-only via anon authenticated); 3 RPCs SECURITY DEFINER |
| `worker_dash-admin` | Visibilidade do módulo (`module_visibility.mdic-comex`) e imagem da home (memória do CEO: todo módulo novo precisa) |

## Performance

- **`mdic_comex` é pequena (~1.2k)** — `get_mdic_comex_serie` agrega por (ano, mes, flow, ncm_codigo) reduzindo a algumas centenas de linhas. Período via `p_ano_inicio/p_ano_fim` reduz adicionalmente.
- **Filtragem por NCM** no chart de série é client-side via `useMemo` — sem refetch (3 opções fixas).
- **Top Países** via RPC dedicado com `LIMIT 15` ordem `SUM(volume_kg) DESC` — server-side, executado em paralelo (Promise.all) para import + export.
- **Debounce 400ms** no fetch ao mudar slider de período OU NCM do top países — evita rajadas durante drag.

## Anti-padrões

- Query direta em `mdic_comex` do front — sempre via RPC.
- Refetch sem debounce — usar 400ms.
- Filtrar série inteira client-side por período — empurrar para RPC via `p_ano_inicio/p_ano_fim`.
- Permitir `selectedNCMs.length === 0` — sempre manter ao menos 1.
- Resetar `yearRange` em mudança de NCM — slider é setado uma vez no mount a partir de `filtros.anos`.
- Bloquear página inteira com barrel em `serieLoading` ou `topLoading` — barrel é só pro `loading` inicial; subsequentes usam indicador inline + opacity 0.5.
- Adicionar NCM novo apenas no `NCM_INFO` sem coordenar com ETL para incluir em `_NCMS` — vai ficar sem dados.
- Mexer em `scripts/pipelines/mdic_comex_sync.py` — pertence ao ETL.
