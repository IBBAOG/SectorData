# Sub-PRD — `/sindicom`

Dashboard SINDICOM — Distribuição de Combustíveis por Empresa (Fuel Distribution). Owner: [`worker_dash-sindicom`](../../.claude/agents/worker_dash-sindicom.md).

> Item da NavBar.

## Escopo de código

```
src/app/(dashboard)/sindicom/
├── page.tsx                ← viewport router (useIsMobile → desktop|mobile)
├── useSindicomData.ts      ← single brain: RPCs, filter state, debounce,
│                              derived market-share + filtered series
├── desktop/View.tsx        ← desktop UX (sidebar + 2 charts, verbatim move)
└── mobile/View.tsx         ← mobile UX (product tab bar + stacked area +
                              ranking cards + FilterDrawer + ExportFAB)
```

RPC wrappers: seção "SINDICOM" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (linhas ~1603–1674).

## Dual-view structure (2026-05 refactor)

Dashboard segue o template canônico de [`docs/app/dual-view-pattern.md`](dual-view-pattern.md): **hook único + duas views**. Mobile é "mesma análise, roupagem adaptada" — nunca cérebro diferente.

### `useSindicomData.ts` — fonte única da verdade

Expõe (contrato consumido pelas duas Views):

- `serieRows` / `filteredSerieRows` — output bruto da RPC e rows filtradas client-side por produto+segmento selecionados (`useMemo`).
- `filtros` — output de `get_sindicom_filtros` (empresas/produtos/segmentos/ano_min/ano_max).
- `allYears`, `yMin`, `yMax`, `hasYears` — derivados de `ano_min`/`ano_max` + posição corrente do slider.
- `hasData` — `filtros.produtos.length > 0`; usado para alternar entre charts e empty state.
- `loading` — barrel da carga inicial; `serieLoading` — atualização inline debounce 400ms.
- `filters` (`yearRangeIdx`, `selectedProdutos`, `selectedSegmentos`, `msProduto`) + `setFilters(partial)`.
- `toggleProduto(p)` / `toggleSegmento(s)` — com guard mínimo de 1.
- `resetProdutos()` / `resetSegmentos()` — restaura listas completas (botão "Clear").
- `marketShare: MarketShareEntry[]` — Top 15 empresas para `msProduto`, sort desc, com `sharePct` sobre o total dos top 15.
- `exportRows` — alias de `serieRows` para os botões de export (Excel/CSV).

Constantes compartilhadas exportadas pelo hook: `PRODUTO_COLORS`, `PALETTE`, `colorForProduto(produto, allProdutos)`.

### `desktop/View.tsx`

Verbatim do layout anterior (sidebar Bootstrap + `MultiSelectFilter` produto/segmento com swatches, `PeriodSlider` em anos, `<select>` único para o Market Share). Charts:
1. **Monthly Volume by Product (m³)** — multi-line por produto selecionado.
2. **Market Share by Company — {produto} (Top 15)** — bar horizontal azul `#2196F3`.

Export panel Tier 1 (Excel + CSV) no header.

### `mobile/View.tsx`

Mesma análise, roupagem mobile:

- **MobileTopBar** sticky + título "SINDICOM" + pill com período corrente.
- **Product MobileTabBar** (variant `container`) substitui o multi-select de produto: tap atualiza `msProduto` + `selectedProdutos` para `[key]` (single-product view). Mantém o cérebro coerente cross-viewport.
- **Filter chip row** horizontal scroll: "Filters" trigger + período + contador de segmentos.
- **Chart card** — `<MobileChart>` 240px, **stacked area por empresa Top 6** do produto ativo (uma trace por empresa, fill 20% alpha). Legenda horizontal abaixo.
- **Market Share section** — Top 15 empresas como `<MobileDataCard variant="compact">` com rank pill (líder em laranja), barra de share %, share % à direita, volume condensado (`1.2M m³` / `540K m³`).
- **FilterDrawer** (BottomSheet) com `PeriodSlider` (anos) + chip-row de segmentos (multi-select com min-1 guard); botão "Clear" expõe `resetSegmentos`.
- **ExportFAB** abre um `FilterDrawer` chamado `ExportSheet` que oferece Download Excel (botão laranja primário) + Download CSV.
- **Empty state** dedicado: card com mensagem amigável + instrução de disparar o workflow `etl_sindicom.yml` via GitHub Actions.

### Regra de sync (CLAUDE.md § Dual-view policy)

Qualquer mudança que afete análise (novo filtro/produto, novo chart, nova métrica, nova copy de label/empty state, nova opção de export) tem de cair em ambas as Views no **mesmo commit**. Mudanças puramente visuais que não alteram conteúdo podem ser view-específicas — declarar `[desktop-only]` / `[mobile-only]` no commit com justificativa.

## Produto

Visualização dos **volumes mensais de venda das distribuidoras associadas ao SINDICOM** (Sindicato Nacional das Empresas Distribuidoras de Combustíveis e Lubrificantes), por empresa, produto e segmento de mercado. Permite ao usuário:

- Comparar via checkbox quais **produtos** acompanhar no chart de Volume Mensal (GASOLINA C COMUM, GASOLINA C ADITIVADA, ETANOL HIDRATADO, DIESEL B S10, DIESEL B S500, GLP, GNV, ÓLEO DIESEL A S10, ÓLEO DIESEL A S500 — lista vem da RPC, não fechada client-side) — ao menos 1 sempre marcada.
- Comparar via checkbox quais **segmentos** filtrar (mercado, consumidor, etc — vem da RPC) — ao menos 1 sempre marcada.
- Restringir o **período** via range slider (default: últimos 5 anos), aplicado server-side via RPC (`p_ano_inicio`/`p_ano_fim`).
- Escolher **um produto** (select único) e ver o **Market Share por Empresa** (Top 15) acumulado no período em chart de barras horizontais com percentuais.

Header: `SINDICOM — Distribuição de Combustíveis por Empresa` + sub `Volumes mensais de venda das distribuidoras associadas ao SINDICOM, por empresa, produto e segmento (mercado / consumidor)` + badge de período quando dados existem.

Diferença vs `/sales-volumes` (ANP): SINDICOM agrega **apenas as distribuidoras associadas** (cobertura ~80–90% do mercado), publicado pela própria entidade setorial mensalmente; ANP cobre 100% via reporte regulatório (mais granular por agente/região, mais lento). Diferença vs `/anp-glp`: SINDICOM inclui GLP mas com granularidade só por empresa, sem distinção P13/granel/recipiente.

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_sindicom_filtros` | próprio | `empresas`, `produtos`, `segmentos`, `ano_min`, `ano_max` |
| `get_sindicom_serie` | próprio | Série mensal agregada por (ano, mes, empresa, nome_produto, segmento). Aceita `p_empresas`, `p_produtos`, `p_segmentos`, `p_ano_inicio`, `p_ano_fim` (todos opcionais, com `SUM(volume)` agregando UFs) |

## Tabelas

| Objeto | Volume | Populado por |
|---|---|---|
| `sindicom` | **0 linhas no momento** (espera primeiro run do workflow) | ETL `scripts/pipelines/sindicom_sync.py` (download via Playwright/Chromium do XLSX em `https://sindicom.com.br/download/combustiveis/?wpdmdl=1043`, parse + upsert idempotente) |

### Colunas de `sindicom`

`ano (smallint), mes (smallint), empresa (text), nome_produto (text), segmento (text — '' para nacional), uf (text — 'BR' para nacional), tipo (text), tipo_produto (text), regiao (text), volume (float8 — m³)`. PK: `(ano, mes, empresa, nome_produto, segmento, uf)`. Indexes: `(ano, mes)`, `(empresa)`, `(nome_produto)`.

### Migration relevante

- `20260504000004_lpc_sindicom.sql` — schema (junto com `anp_lpc`) + indexes + RLS + 2 RPCs + INSERT em `module_visibility('sindicom', true)`.

## Pipeline de origem

| Workflow | Schedule | Scripts |
|---|---|---|
| `.github/workflows/etl_sindicom.yml` | Dia 5 mensal 15:00 UTC (12:00 BRT) + `workflow_dispatch` | `scripts/pipelines/sindicom_sync.py` |

Comportamento do scraper:
- Download via Playwright Chromium (locale pt-BR) — necessário porque o site usa Cloudflare que rejeita `requests` com User-Agent normal.
- Parse XLSX via pandas (multi-sheet por mês), normalização de mês/produto/empresa.
- Batch upsert: 500 linhas por request via supabase-py.
- Idempotente: re-rodar não duplica (PK composite + upsert).

> ### Bloqueio Cloudflare em IP local — CRÍTICO
>
> O Cloudflare do `sindicom.com.br` **rejeita IPs residenciais brasileiros** (incluindo Vivo, Claro, Oi, etc), retornando challenge HTML em vez do XLSX mesmo via Playwright. Tentar rodar `python scripts/pipelines/sindicom_sync.py` em máquina local da equipe **vai falhar** com `ValueError: Recebeu HTML em vez de XLSX (anti-bot)`.
>
> **Solução:** disparar o workflow via GitHub Actions:
>
> 1. GitHub → Actions → `SINDICOM — Sync (dados do setor combustíveis)`
> 2. Botão `Run workflow` (na branch `main`)
> 3. Aguardar ~2–3 minutos
> 4. Refresh da página `/sindicom` (frontend ganha vida automaticamente)
>
> Os IPs do GitHub Actions runner (Azure US/EU) passam pelo Cloudflare normalmente. Não tente VPN/proxy local — perda de tempo.

## Filtros disponíveis (UI)

| Filtro | Componente | Comportamento |
|---|---|---|
| Produto | checkboxes c/ swatch de cor | client-side; mínimo 1 sempre selecionada; botão "Limpar" restaura todas; counter `(N/total)` (total dinâmico vindo da RPC) |
| Segmento | checkboxes | client-side; mínimo 1 sempre selecionada; botão "Limpar" restaura todas; counter `(N/total)` |
| Período | `rc-slider` range (anos) | server-side em `get_sindicom_serie` (debounced 400ms) via `p_ano_inicio`/`p_ano_fim` |
| Market Share — Produto | `<select>` único | client-side (recálculo do agrupamento por empresa via `useMemo`) |

## Charts esperados (2)

1. **Volume Mensal por Produto (m³)** — chart de linha múltipla, 1 trace por produto selecionado. Cor por `PRODUTO_COLORS` (fallback para `PALETTE` rotativa). Eixo Y: `Volume (m³)`. Soma volumes através de empresas e segmentos selecionados.
2. **Market Share por Empresa — {produto} (Top 15)** — chart de barras horizontais com percentuais. Cor `#2196F3` (consistente com bar charts azuis). Agrega por empresa client-side (soma de volume sobre o período selecionado), top 15, percentual sobre total dos top 15.

## Estado vazio (tabela `sindicom` com 0 linhas)

Quando `filtros.produtos.length === 0` (= tabela vazia), a página não exibe charts vazios — exibe um **card central de empty state** com:

- Mensagem: "Aguardando dados — pipeline ainda não rodou."
- Instrução: como disparar o workflow `etl_sindicom.yml` via GitHub Actions
- Link para este sub-PRD para detalhes do bloqueio Cloudflare

Sidebar continua renderizada (filtros vazios + slider escondido), mas sem barrel infinito travando a UI.

## Componentes consumidos

- `PlotlyChart` — 2 charts (linha múltipla + barras horizontais).
- `rc-slider` — slider de período (anos).
- `NavBar`.
- `useModuleVisibilityGuard("sindicom")` — guard de role.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| ETL (`sindicom_sync`) | Popula `sindicom` mensalmente. **Roda apenas via GitHub Actions (Cloudflare bloqueia local).** |
| Subgerente APP | Schema/migration de `sindicom` e RPCs |
| Designer | Cores fixas por produto, palette rotativa para extras, Arial, padrão de chart de linha múltipla + barra horizontal |
| Supabase | RLS habilitado em `sindicom` (read-only via anon authenticated); 2 RPCs SECURITY DEFINER |
| `worker_dash-admin` | Visibilidade do módulo (`module_visibility.sindicom`) e imagem da home |

## Performance

- **Tabela esperada: ~10–30k linhas/ano** (após primeiro run) × N anos histórico → algumas centenas de milhares quando estabilizada.
- **`get_sindicom_serie` agrega** por (ano, mes, empresa, nome_produto, segmento) somando UFs — reduz ainda mais o payload.
- **Período via `p_ano_inicio`/`p_ano_fim`** — empurra filtragem para o servidor.
- **Filtragem por produto e segmento** é client-side via `useMemo` (lista finita, sem refetch).
- **Agregação por empresa** (Market Share) é client-side via `useMemo` sobre as linhas filtradas.
- **Debounce 400ms** no fetch ao mudar slider — evita rajadas durante drag.

## Anti-padrões

- Query direta em `sindicom` do front — sempre via RPC.
- Refetch sem debounce — usar 400ms.
- Filtrar série inteira client-side por período — empurrar para RPC via `p_ano_inicio`/`p_ano_fim`.
- Permitir `selectedProdutos.length === 0` ou `selectedSegmentos.length === 0` — sempre manter ao menos 1 em cada.
- Resetar `yearRange` em mudança de produto/segmento — slider é setado uma vez no mount.
- Bloquear página inteira com barrel em `serieLoading` — barrel é só pro `loading` inicial; subsequentes usam indicador inline + opacity 0.5.
- Bloquear página inteira com barrel quando tabela está vazia — usar empty state amigável com instrução.
- Mexer em `scripts/pipelines/sindicom_sync.py` — pertence ao ETL.
- Tentar debugar Cloudflare localmente — perda de tempo. Disparar via GitHub Actions e verificar o log lá.

## Export

Tier 1 — download direto via `<ExportPanel>` (ver [`docs/app/PRD.md`](PRD.md) → "Export padronizado").

- Excel: `downloadGenericExcel<T>` em [`src/lib/exportExcel.ts`](../../src/lib/exportExcel.ts) — workbook single-sheet com título brand orange, header preto, dados Arial 10.
- CSV: `downloadCsv<T>` em [`src/lib/exportCsv.ts`](../../src/lib/exportCsv.ts) (RFC4180, UTF-8).
- Filename pattern: `Sindicom_DD-MM-YY.<xlsx|csv>`.
- Dados exportados: linhas atualmente em estado da página (saída de `get_sindicom_serie` aplicada com filtros de período + produtos + segmentos selecionados).
- Quando a tabela está vazia (Cloudflare ainda não permitiu pipeline rodar), o `<ExportPanel>` é renderizado mas os botões ficam desabilitados.
