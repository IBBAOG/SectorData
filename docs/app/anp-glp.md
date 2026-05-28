# Sub-PRD — `/anp-glp`

Dashboard ANP — Vendas de GLP por Recipiente (Fuel Distribution). Owner: [`worker_dash-anp-glp`](../../.claude/agents/worker_dash-anp-glp.md).

> Item do dropdown "Fuel Distribution" da NavBar.

## Escopo de código

```
src/app/(dashboard)/anp-glp/
  page.tsx
```

RPC wrappers: seção "ANP GLP" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts) (linhas ~1024–1090).

## Produto

Visualização das **vendas mensais de GLP** por distribuidora e por categoria de recipiente publicadas pela ANP. Permite ao usuário:

- Selecionar via checkbox quais **categorias** de recipiente comparar no chart Total Nacional (P13, Outros - GLP, Outros - Especiais) — ao menos 1 sempre marcada.
- Restringir o **período** via range slider (default: últimos 10 anos), aplicado server-side via RPC.
- Escolher uma **categoria** (select único) e ver o ranking **Top 15 Distribuidoras** acumulado no período em chart de barras horizontais.

Header: `ANP — Vendas de GLP por Recipiente` + sub `Vendas mensais de GLP por distribuidora e categoria de recipiente (P13, Outros - GLP, Outros - Especiais)` + badge de período quando dados existem.

Diferença vs `/anp-precos-produtores`: aqui o foco é **volume vendido** (kg) por recipiente, não preço. P13 (Botijão 13 kg) é o produto âncora do GLP residencial brasileiro.

## RPCs

| RPC | Tipo | Função |
|---|---|---|
| `get_anp_glp_filtros` | próprio | `distribuidoras`, `categorias`, `ano_min`, `ano_max` |
| `get_anp_glp_serie` | próprio | Série mensal por distribuidora/categoria. Aceita `p_distribuidoras`, `p_categorias`, `p_ano_inicio`, `p_ano_fim` (todos opcionais) |

## Tabelas

| Objeto | Volume | Populado por |
|---|---|---|
| `anp_glp` | ~3.106 linhas | ETL `scripts/pipelines/anp/glp_sync.py` (download XLS da ANP, parse + upsert) |

### Colunas de `anp_glp`

`ano (smallint), mes (smallint), distribuidora (text), categoria (text), vendas_kg (float8)`. PK: `(ano, mes, distribuidora, categoria)`.

### Migration relevante

- `20260504000002_anp_precos.sql` — schema + RLS + RPCs + INSERT em `module_visibility` (compartilhada com `/anp-precos-produtores`).

## Pipeline de origem

| Workflow | Schedule | Scripts |
|---|---|---|
| `.github/workflows/etl_anp_precos.yml` | Semanal segunda 12:00 UTC (09:00 BRT) | `scripts/pipelines/anp/glp_sync.py` (encadeado após `precos/01_ppi_sync.py` e `precos/02_precos_produtores_sync.py`) |

## Filtros disponíveis (UI)

| Filtro | Componente | Comportamento |
|---|---|---|
| Categoria (chart Total) | checkboxes c/ swatch de cor (3 fixas) | client-side; mínimo 1 sempre selecionada; botão "Limpar" restaura todas; counter `(N/3)` |
| Período | `rc-slider` range | server-side em `get_anp_glp_serie` (debounced 400ms) |
| Top Distribuidoras — Categoria | select único | client-side (recálculo do ranking via `useMemo` sobre `serieRows`) |

## Componentes consumidos

- `PlotlyChart` — 2 charts (linha múltipla mensal + barras horizontais Top 15).
- `rc-slider` — slider de período.
- `NavBar`.
- `useModuleVisibilityGuard("anp-glp")` — guard de role.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| ETL (`anp_precos_sync`) | Popula `anp_glp` semanalmente |
| Subgerente APP | Schema/migration de `anp_glp` e RPCs |
| Designer | Cores por categoria fixas client-side, Arial, padrão de chart de linha + barra horizontal |
| Supabase | RLS habilitado em `anp_glp` (read-only via anon authenticated) |

## Performance

- **`anp_glp` é pequena (~3k)** — `get_anp_glp_serie` com `p_ano_inicio/p_ano_fim` filtra a ~1k–2k linhas (10 anos × 12 meses × ~20 distribuidoras × 3 categorias) num único request, gzipped.
- **Filtragem por categoria** no chart Total é client-side via `useMemo` — sem refetch (3 opções fixas).
- **Top Distribuidoras** é agregado client-side via `useMemo` sobre `serieRows` (filtragem por `categoria === topDistCat`, `reduce` por distribuidora, sort desc, slice top 15).
- **Debounce 400ms** no fetch ao mudar slider de período — evita rajadas durante drag.

## Anti-padrões

- Query direta em `anp_glp` do front — sempre via RPC.
- Refetch sem debounce — usar 400ms.
- Filtrar série inteira client-side por período — empurrar para RPC via `p_ano_inicio/p_ano_fim`.
- Permitir `selectedCats.length === 0` — sempre manter ao menos 1.
- Resetar `yearRange` em mudança de categoria — slider é setado uma vez no mount a partir de `filtros.ano_min/ano_max`.
- Mostrar nome de categoria com label diferente da config (consistência: usar `CATEGORIA_INFO[c].label`).
- Bloquear página inteira com barrel em `serieLoading` — barrel é só pro `loading` inicial; subsequentes usam indicador inline + opacity 0.5.
- Mexer em `scripts/pipelines/anp/glp_sync.py` — pertence ao ETL.

## Export

Tier 1 — direct download via the unified `<ExportButton>` (contract: [`docs/app/export-library-contract.md`](export-library-contract.md)).

- Spec lives at [`src/lib/export/dashboards/anpGlp.ts`](../../src/lib/export/dashboards/anpGlp.ts) (`anpGlpExport`).
- Filename: `LPGSales_DD-MM-YY.<xlsx|csv>` (date appended by the library).
- `tier: 1`, `filterSource: "none"` — the export always returns the **full LPG sales history** regardless of the dashboard's period slider / category checkboxes / top-distributor select. Power users want the full dataset; the on-screen filters stay exploratory.
- Excel: 1 sheet `"LPG Sales"`, title `"ANP — LPG Sales by Distributor"` (brand orange row 1), navy header row, Arial 10 cells. Columns: Year, Month, Distributor, Category, Sales (kg) `#,##0`, Sales (thousand t) `0.000`.
- CSV: `mode: "single"`, same column set as Excel.
- Data source: `rpcGetAnpGlpSerie(supabase, {})` — empty params → all four `p_*` filters resolve to NULL server-side → full history.
- `vendas_mil_ton = vendas_kg / 1e6` computed in the spec via `kgToMilTon`; the raw `vendas_kg` is kept alongside for traceability.
- Plugged into desktop view's `DashboardHeader.rightSlot` via `<ExportButton spec={anpGlpExport} />`. No export on mobile (per Mobile reform v2).

## Dual-view structure

Refatorado em 2026-05-20 para o padrão dual-view. Mobile foi **descontinuado** na Mobile reform v2 (2026-05-27) — `/anp-glp` está na lista de rotas mobile-excluded; em mobile, `page.tsx` monta `<MobileExcludedRedirect slug="anp-glp" />` e o usuário é redirecionado para `/home?excluded=anp-glp`.

```
src/app/(dashboard)/anp-glp/
├── page.tsx            — desktop viewport: renders <DesktopView />; mobile: <MobileExcludedRedirect />
├── useAnpGlpData.ts    — THE BRAIN: RPCs, filter state, debounce, derivations
└── desktop/
    └── View.tsx        — sidebar layout, line chart + horizontal bar
```

### Hook contract (`useAnpGlpData`)

```ts
{
  serieRows: AnpGlpSerieRow[];
  allYears: number[];
  yMin: number | null;
  yMax: number | null;
  topDist: TopDistEntry[];          // Top 15 for filters.topDistCat, already in kt
  loading: boolean;                 // initial barrel
  serieLoading: boolean;            // debounced refetch indicator
  filters: AnpGlpFilters;           // yearRangeIdx, selectedCats, topDistCat
  setFilters: (next: Partial<AnpGlpFilters>) => void;
  toggleCat: (c: string) => void;   // min-1 guard included
}
```

> Note: the legacy `exportRows` field was removed when `/anp-glp` migrated to the unified export library (2026-05-28). The export now fetches full history independently of the hook's filter state — see Export section above.

### Mobile

Dashboard is **mobile-excluded** since Mobile reform v2 (see README.md § "Mobile reform 2026-05-27"). The binding sync rule with a mobile View does not apply — there is no mobile View. Future changes only need to be reflected in `desktop/View.tsx`.
