# Sub-PRD — `/anp-glp` (LPG Market Share)

Dashboard de **LPG Market Share (% de participação)** e **volume absoluto (thousand t)** por distribuidora, sobre a tabela `anp_glp`. Owner: [`worker_dash-anp-glp`](../../.claude/agents/worker_dash-anp-glp.md).

> Item do dropdown "Fuel Distribution" da NavBar. Rota mobile-eligible (dual-view).

> **Reconstruído em 2026-06-01** (commits `696be79a` migration + `b16a9388` frontend). O slug/rota `/anp-glp` foi reaproveitado — antes era "Vendas de GLP por Recipiente" (volume simples, desktop-only). Ver "Superseded" no fim deste arquivo.

Faithful clone de [`/market-share`](market-share.md): mesmo SHAPE de hook, mesma estrutura dual-view. Espelha aquele sub-PRD; diferenças de domínio listadas abaixo.

## Mapeamento de domínio (decidido pelo CTO — não mudar)

| `/market-share` | `/anp-glp` (LPG) |
|---|---|
| player (`classificacao` / `distribuidora`) | `distribuidora` |
| produto (`nome_produto`: Diesel B / Gasolina C / …) | `categoria` (P13 / Outros - GLP / Outros - Especiais) |
| sintético "Total (All Fuels)" | sintético **"Total (All LPG)"** (soma de todas as categorias) |
| Otto-Cycle | **não existe** |
| segmento Retail / B2B / TRR | **não existe** — segmento constante `'GLP'` |
| filtros Região / UF | **não existem** — `anp_glp` não tem dimensão geográfica |
| Big-3 (players de combustível hardcoded) | **Big-3 dinâmico** = top-3 distribuidoras por volume LPG |
| unidade "thousand m³" | **"thousand t"** (`vendas_kg / 1e6` → milhares de toneladas) |

## Dual-view structure

Promovido a dual-view em 2026-06-01 (antes era mobile-excluded). Segue o padrão canônico ([`docs/app/dual-view-pattern.md`](dual-view-pattern.md)): o hook compartilhado é o único cérebro; ambas as Views são camadas de apresentação.

```
src/app/(dashboard)/anp-glp/
  page.tsx                 ← viewport router (useIsMobile)
  useAnpGlpData.ts         ← THE BRAIN — RPCs, filtros, derivações, types
  desktop/
    View.tsx               ← UX desktop (sidebar + grid de charts por categoria)
  mobile/
    View.tsx               ← UX mobile (thumb-scroll layout, molde market-share v2)
```

RPC wrappers: seção "ANP GLP — LPG Market Share (`get_anp_glp_ms_*`)" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (linhas ~1168–1305).

## Produto

Visualização das duas narrativas clássicas de market share aplicadas ao GLP brasileiro:

- **% Share** (default): participação relativa por distribuidora ao longo do tempo.
- **thousand t**: volume absoluto vendido (`vendas_kg / 1e6`).

Toggle de unidade no topo chaveia entre os dois modos sem refetch — mesma RPC, derivação client-side em `buildAnpGlpLine`. Para cada **categoria** (incl. o sintético Total) há um line chart com as distribuidoras como linhas + tabela de comparação MoM/QTD/YoY/YTD.

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_anp_glp_ms_filtros` | próprio | `distribuidoras`, `categorias`, `ano_min`, `ano_max` |
| `get_anp_glp_ms_serie_fast` | próprio | Série mensal agregada por `(date, distribuidora, categoria)`. Colunas IDÊNTICAS a `get_ms_serie_fast` (`date`, `nome_produto`, `segmento='GLP'`, `classificacao`, `quantidade=SUM(vendas_kg)`) |
| `get_anp_glp_ms_serie_others` | próprio | Como acima + `agente_regulado` (= distribuidora). Aceita `p_excluir_distribuidoras` (exclui o top-N → tail = "Others") |
| `get_anp_glp_ms_others_players` | próprio | Lista completa de distribuidoras ranqueada por volume total DESC (`distribuidora`, `total_kg`) — fonte do Big-3 dinâmico e dos players de "Others" |
| `get_anp_glp_ms_export_count` | próprio | Calculadora live de tamanho do export (count de rows de `anp_glp`) |

Definidas em [`20260605000000_anp_glp_market_share_rpcs.sql`](../../supabase/migrations/20260605000000_anp_glp_market_share_rpcs.sql). **Todas SECURITY DEFINER + `SET search_path = public, pg_temp`** (Pegadinha #18 — `anp_glp` tem RLS `authenticated`-only; sem DEFINER, anon obtém `[]`). GRANT EXECUTE a `anon, authenticated`.

As colunas retornadas reusam o shape de `get_ms_*` de propósito, para que o tipo frontend `MsSerieRow` seja reaproveitado sem alteração. O sintético "Total (All LPG)" **não** é emitido pelas RPCs — é construído client-side em `makeTotalRows` (análogo ao `/market-share`).

> As RPCs legadas `get_anp_glp_serie` / `get_anp_glp_filtros` continuam no banco, mas o dashboard não as usa mais (ver "Superseded").

## Hook contract (`useAnpGlpData`)

Mesmo SHAPE do `useMarketShareData`, sem o eixo segmento e sem geo. Superfície consumida pelas duas Views:

- Raw: `serieRows`, `seriesLoading`, `seriesError`
- Options: `opcoes` (`distribuidoras`/`categorias`/`ano_min`/`ano_max`), `datas` (lista de anos do slider)
- Unit toggle: `unitMode` (`'share' | 'volume'`, default `'share'`), `setUnitMode`
- Filter state: `mode` (Individual / Big-3 / Others), `sliderRange`, `competidoresSelected`, `playersOptions`
- Applied: `appliedFilters`, `applyFilters()`, `clearFilters()`, `showToast`
- Derived: `big3`, `appliedMode`, `players`, `big3Members` (top-3 dinâmico), `latestDate`, `chartColors`, `othersPlayers`
- `productKeys` — Total primeiro, depois categorias reais em ordem `CATEGORY_ORDER` (`P13`, `Outros - GLP`, `Outros - Especiais`), extras no fim
- `charts: Record<string, ChartResult>` — 1 line chart por categoria (incl. Total)
- `compData: Record<string, CompRow[]>` — rows MoM/QTD/YoY/YTD por categoria
- `topPlayers: TopPlayerRow[]` — ranking top-5 (sobre Total)
- Mobile selector (additive): `selectedProduct` / `setSelectedProduct`, `activeChart`, `activeCompRows`, `topPlayersForSelected`
- Mobile Compare set (additive): `compareSet`, `setCompareSet`, `toggleCompareMember` (cap 3, seed com top-3)
- Export: `exportFilters` (`AnpGlpMsFilters`), `exportSizeEstimate` (via `useExportSize` + `getAnpGlpMsExportCount`)

Pure helpers exportados do arquivo do hook:
- `buildAnpGlpLine` — line chart por categoria (distribuidoras como linhas). Inclui anti-overlap pass nos labels end-of-line (mesmo algoritmo do MS; floor 1.6 pp em `share`, 4 % do span em `volume`). Ramifica eixo Y por `unitMode` (`Market Share (%)` ↔ `Volume (thousand t)`).
- `makeTotalRows` — sintetiza Total (All LPG) = soma de todas as categorias (1 cópia por row com `nome_produto:"Total"`).
- `buildComparisonData` — rows de comparação MoM/QTD/YoY/YTD, parametrizado por `unitMode`.

Constantes exportadas: `BIG3_LABEL`, `COLORS_BIG3`, `MODE_OPTIONS`, `GLP_SEGMENT`, `TOTAL_KEY`, `CATEGORY_LABEL` (English labels: `Total → "Total (All LPG)"`, `P13 → "P13 (13 kg cylinder)"`, `Outros - GLP → "Other - LPG"`, `Outros - Especiais → "Other - Special"`), `dynColor`, `MOBILE_PALETTE`.

## Tabelas

| Objeto | Volume | Populado por |
|---|---|---|
| `anp_glp` | ~3.1k linhas | ETL `scripts/pipelines/anp/glp_sync.py` (download XLS da ANP, parse + upsert) |

Colunas: `ano (smallint), mes (smallint), distribuidora (text), categoria (text), vendas_kg (float8)`. PK: `(ano, mes, distribuidora, categoria)`.

**Sem materialized view** — `anp_glp` é pequena, agregação direta por request é rápida (diferente de `/market-share`, que usa `mv_ms_serie_fast` por `vendas` ser grande).

## Pipeline de origem

| Workflow | Schedule | Scripts |
|---|---|---|
| `.github/workflows/etl_anp_precos.yml` | Semanal segunda 12:00 UTC (09:00 BRT) | `scripts/pipelines/anp/glp_sync.py` (encadeado após `precos/01_ppi_sync.py` e `precos/02_precos_produtores_sync.py`) |

## Filtros disponíveis (UI)

| Filtro | Componente | Comportamento |
|---|---|---|
| Unit | `SegmentedToggle` top-level | % Share / thousand t — derivação client-side, sem refetch |
| Período | range slider (anos) | server-side via `p_ano_inicio`/`p_ano_fim` |
| View Mode | Individual / Big-3 / Others | Big-3 = top-3 dinâmico; Others = tail fora do top-3 |
| Competidores (distribuidoras) | multi-select | Individual default = top-8 por volume; usuário escolhe quaisquer |

**Sem** Região / UF / segmento / mercado.

## Export

Tier 1 — direct download via o `<ExportButton>` unificado (contrato: [`docs/app/export-library-contract.md`](export-library-contract.md)).

- Spec em [`src/lib/export/dashboards/anpGlp.ts`](../../src/lib/export/dashboards/anpGlp.ts) (`anpGlpExport`).
- `tier: 1`, `filterSource: "none"` — sempre retorna o **histórico completo** de LPG, ignorando os filtros on-screen. Power users querem o dataset inteiro; filtros são exploratórios.
- Fonte: `rpcGetAnpGlpMsSerieFast` com filtros all-NULL → histórico completo.
- Filename: Excel `LPG Market Share DD-MM-YY.xlsx` / CSV `LPGMarketShare_DD-MM-YY.csv` (data adicionada pela lib).
- 1 sheet `"LPG Market Share"`, título `"ANP — LPG Market Share by Distributor"`. Colunas: Month, Distributor, Category, Sales (kg) `#,##0`, Sales (thousand t) `0.000` (`kgToMilTon`).
- Plugado no `DashboardHeader.rightSlot` da desktop View. **Desktop-only** (sem export em mobile, por política).

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| ETL (`etl_anp_precos`) | Popula `anp_glp` semanalmente |
| Subgerente APP | Schema/migration de `anp_glp` + as RPCs `get_anp_glp_ms_*` |
| Designer | Paleta discreta por rank (Individual), `COLORS_BIG3`, padrão de line chart |
| Supabase | RLS em `anp_glp` (`authenticated`-only) — RPCs SECURITY DEFINER para servir anon |

## Anti-padrões

- Query direta em `anp_glp` do front — sempre via RPC.
- Mudar `get_anp_glp_ms_*` sem revisar os derivados (`charts`, `compData`, `topPlayers`, export) — todos dependem de `unitMode`.
- Esquecer `unitMode` nas deps dos `useMemo` — leva a stale render no toggle.
- Hardcodar `ticksuffix: "%"` sem ramificar por `unitMode`.
- Hardcodar Big-3 com nomes de combustível (Vibra/Raizen/Ipiranga) — o Big-3 de LPG é dinâmico (top-3 por volume).
- Editar uma View sem refletir a outra no mesmo commit (regra de sync dual-view) — ou declarar `[desktop-only]`/`[mobile-only]` com justificativa.
- Recriar RPC com DROP+CREATE perdendo SECURITY DEFINER / search_path (Pegadinha #18).
- Mexer em `scripts/pipelines/anp/glp_sync.py` — pertence ao ETL.

---

## Superseded — "Vendas de GLP por Recipiente" (até 2026-06-01)

Até 2026-06-01 o `/anp-glp` era um dashboard de **volume simples, desktop-only**: charts de linha de vendas mensais por categoria (Total Nacional) + barras horizontais Top 15 distribuidoras, sobre as RPCs `get_anp_glp_filtros` / `get_anp_glp_serie` e a spec de export `LPGSales`. Era mobile-excluded.

Foi reconstruído como LPG Market Share (clone dual-view de `/market-share`) — ver topo deste arquivo. As RPCs antigas seguem no banco mas não são mais consumidas; podem ser dropadas num follow-up.
