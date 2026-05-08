# Sub-PRD — `/anp-cdp-diaria`

Dashboard ANP CDP Diária — Produção Diária por Campo / Instalação / Poço (Oil & Gas). Owner: [`worker_dash-anp-cdp-diaria`](../../.claude/agents/worker_dash-anp-cdp-diaria.md).

> Item do dropdown "Oil & Gas" da NavBar (irmão de `/anp-cdp`). Distinção crítica: `/anp-cdp` é mensal por **poço** (formulário CDP); `/anp-cdp-diaria` é diário e cobre **três níveis de granularidade** (campo, instalação, poço) via Power BI ANP.

## Escopo de código

```
src/app/(dashboard)/anp-cdp-diaria/
  page.tsx
```

RPC wrappers: seções "ANP CDP Diária" + "ANP CDP Diária — Installation level" + "ANP CDP Diária — Well level" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

Heurística de tamanho de export: chaves `anp_cdp_diaria` (field), `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco` em [`src/lib/exportSizeHeuristics.ts`](../../src/lib/exportSizeHeuristics.ts).

## Produto

Visualização da **produção diária de petróleo e gás natural** declarada no Power BI público da ANP em **3 níveis de granularidade**, escolhidos via toggle no topo dos filtros (`SegmentedToggle` "pill deslizante laranja"):

| Nível | Label UI | Tabela alvo | Páginas Power BI |
|---|---|---|---|
| `field` | **Field** | `anp_cdp_diaria` | Página 4 |
| `installation` | **Installation** | `anp_cdp_diaria_instalacao` | Página 5 |
| `well` | **Well** | `anp_cdp_diaria_poco` | Página 6 |

Por nível, o usuário pode:

- Selecionar **bacias** (apenas Field/Well — installation não tem bacia) via `MultiSelectFilter` (server-side via `p_bacias`).
- Selecionar **campos** via `SearchableMultiSelect`.
- Selecionar **instalações** (apenas Installation) via `SearchableMultiSelect`.
- Selecionar **poços** (apenas Well) via `SearchableMultiSelect`.
- Restringir o **período** via `PeriodSlider` em modo `dates` (server-side).
- Ver duas séries temporais (Petróleo `bbl/dia` e Gás `Mm³/dia`) para a "dimensão" do nível atual (Top 10 por média se sem seleção, ou exatos selecionados).
- Inspecionar a tabela de produção mais recente (até 500 linhas).
- Exportar Excel/CSV via `ExportPanel` Tier 2 (`ExportModal` com calculadora de tamanho).

Header: título e sub variam por nível ("ANP CDP — Produção Diária por Campo/Instalação/Poço").

### Diferença vs `/anp-cdp`

| | `/anp-cdp` | `/anp-cdp-diaria` |
|---|---|---|
| Granularidade temporal | Mensal | Diária |
| Granularidades possíveis | Poço × campo (mensal) | Field, Installation, Well (diário, toggle) |
| Fonte | Formulário CDP (Selenium + CAPTCHA, mensal) | Power BI ANP (3×/dia automático) |
| Tabela | `anp_cdp_producao` | `anp_cdp_diaria` + `anp_cdp_diaria_instalacao` + `anp_cdp_diaria_poco` |
| Range | Histórico longo (dezenas de anos) | Começa em 2025-11-30 (limitação da fonte) |

## Filtros UI por nível

Os filtros visíveis na sidebar dependem do `granularity`:

| Nível | Filtros visíveis |
|---|---|
| **Field** | Bacia (server), Campo (client), Período (server) |
| **Installation** | Campo (server, push se selecionado), Instalação (client), Período (server) |
| **Well** | Bacia (server), Campo (client), Poço (client), Período (server) |

A troca de nível (`onChange` do `SegmentedToggle`) **reseta todas as seleções de filtros** para evitar carregar termos estranhos entre vocabulários (ex: poço selecionado quando ainda estava no nível Field).

## RPCs consumidas

| Wrapper TS | RPC PostgreSQL | Retorno |
|---|---|---|
| `rpcGetAnpCdpDiariaFiltros` | `get_anp_cdp_diaria_filtros()` | `{ campos[], bacias[], data_min, data_max }` |
| `rpcGetAnpCdpDiariaSerie` | `get_anp_cdp_diaria_serie(p_campos, p_bacias, p_data_inicio, p_data_fim)` | `Array<{ data, campo, bacia, petroleo_bbl_dia, gas_mm3_dia }>` |
| `rpcGetAnpCdpDiariaInstalacaoFiltros` | `get_anp_cdp_diaria_instalacao_filtros()` | `{ campos[], instalacoes[], data_min, data_max }` |
| `rpcGetAnpCdpDiariaInstalacaoSerie` | `get_anp_cdp_diaria_instalacao_serie(p_campos, p_instalacoes, p_data_inicio, p_data_fim)` | `Array<{ data, campo, instalacao, petroleo_bbl_dia, gas_mm3_dia }>` |
| `rpcGetAnpCdpDiariaPocoFiltros` | `get_anp_cdp_diaria_poco_filtros()` | `{ campos[], bacias[], pocos[], data_min, data_max }` |
| `rpcGetAnpCdpDiariaPocoSerie` | `get_anp_cdp_diaria_poco_serie(p_campos, p_bacias, p_pocos, p_data_inicio, p_data_fim)` | `Array<{ data, campo, bacia, poco, petroleo_bbl_dia, gas_mm3_dia }>` |

Tabelas e RPCs dos níveis Installation e Well foram criadas pela migration `20260508120001_anp_cdp_diaria_levels.sql`.

## Schema das tabelas alvo

Todas com `RLS: SELECT TO authenticated USING (true)` — padrão Phase 3.

### `anp_cdp_diaria` (Field — pré-existente)

| Coluna | Tipo | PK? |
|---|---|---|
| `data` | DATE | ✓ |
| `campo` | TEXT | ✓ |
| `bacia` | TEXT | ✓ |
| `petroleo_bbl_dia` | REAL | |
| `gas_mm3_dia` | REAL | |

### `anp_cdp_diaria_instalacao` (Installation — novo)

| Coluna | Tipo | PK? |
|---|---|---|
| `data` | DATE | ✓ |
| `campo` | TEXT | ✓ |
| `instalacao` | TEXT | ✓ |
| `petroleo_bbl_dia` | REAL | |
| `gas_mm3_dia` | REAL | |

### `anp_cdp_diaria_poco` (Well — novo)

| Coluna | Tipo | PK? |
|---|---|---|
| `data` | DATE | ✓ |
| `campo` | TEXT | ✓ |
| `bacia` | TEXT | ✓ |
| `poco` | TEXT | ✓ |
| `petroleo_bbl_dia` | REAL | |
| `gas_mm3_dia` | REAL | |

## Pipeline de origem

- **Script**: `scripts/extractors/anp_cdp_powerbi.py` (extrator Power BI — owner: `worker_etl-pipelines`). Estendido para extrair as 3 páginas (4, 5, 6).
- **Workflow**: `.github/workflows/etl_anp_cdp_diaria.yml`
- **Schedule**: 3×/dia (10:00, 15:00, 20:00 UTC)
- **Range**: dataset começa em **2025-11-30** (limite da fonte Power BI)

> Installation e Well começam vazios até o primeiro run pós-deploy do ETL atualizado. UI lida bem com `data: []` (mensagem amigável "Sem dados de produção <level> ainda. O ETL desta granularidade roda 3×/dia — aguarde primeiro pull pós-deploy.").

## Charts esperados (todos os níveis)

| Chart | Tipo Plotly | Source RPC | Top-N agrupador |
|---|---|---|---|
| Petróleo (bbl/dia) | line (multi-trace) | RPC do nível atual | campo / instalacao / poco |
| Gás (Mm³/dia) | line (multi-trace) | RPC do nível atual | campo / instalacao / poco |
| Production by ... (tabela) | HTML table com sticky thead | mesma série | colunas por nível |

A tabela "Production by ..." muda colunas por nível:

| Nível | Colunas |
|---|---|
| Field | Date · Bacia · Campo · Oil · Gas |
| Installation | Date · Campo · Instalação · Oil · Gas |
| Well | Date · Bacia · Campo · Poço · Oil · Gas |

## Padrões consolidados aplicados

- [x] Header: `<DashboardHeader title sub period>` com `<hr>` separator
- [x] Period badge: condicional ao `hasDates` (`[string, string] | null`)
- [x] Push período + bacia (Field/Well) ou campos (Installation) para RPC server-side
- [x] Debounce 400ms via `useDebouncedFetch`
- [x] Loading: `<BarrelLoading>` no init; `<ChartSection loading>` inline durante refetch
- [x] Filtros: `<MultiSelectFilter>` (Bacia) + `<SearchableMultiSelect>` (Campo, Instalação, Poço) com counter `(N/total)`
- [x] **`<SegmentedToggle>` (Field/Installation/Well) no topo dos filtros**, abaixo do "TBD" e acima da seção "Filtros"
- [x] Empty state amigável (chart e tabela) quando filtros sem dados, e mensagem específica quando o ETL ainda não populou Installation/Well
- [x] Identidade visual: `#FF5000` first color, Arial, padrão `COMMON_LAYOUT` + `AXIS_LINE`, pill desliza laranja
- [x] pt-BR consistente (labels, hovertemplate, números via `Intl.NumberFormat("pt-BR")`)
- [x] Visibility guard: `useModuleVisibilityGuard("anp-cdp-diaria")`

## Definition of Done

1. **`npx tsc --noEmit` clean** — passou (zero erros).
2. **`npx eslint src/app/(dashboard)/anp-cdp-diaria` clean** — passou (zero warnings).
3. **Smoke test em dev server**: toggle alterna entre Field/Installation/Well, filtros do nível populam, charts e tabela renderizam (ou empty state coerente quando Installation/Well vazios pré-ETL).
4. **Self-QA estática**: comparado com `/anp-glp` (granularidade temporal), `/anp-lpc` (slider de datas), `/anp-precos-distribuicao` (export modal Tier 2), `/sales-volumes` (uso do `SegmentedToggle` para View Mode).
5. **Sub-PRD (este arquivo)** atualizado.

## Dependências cross-departamentais

- **Schema/RPCs (`worker_supabase`)**: criou `anp_cdp_diaria` + 2 RPCs originais (Phase 3) + migration `20260508120001_anp_cdp_diaria_levels.sql` adicionando `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco` + 4 RPCs novas + RLS.
- **Pipeline ETL (`worker_etl-pipelines`)**: extrator estendido para processar páginas 5 e 6 do Power BI; workflow já roda 3×/dia. Tabelas Installation/Well começam vazias até primeiro pull pós-deploy.
- **Admin (`worker_dash-admin`)**: slug `anp-cdp-diaria` em `module_visibility` (default visível) — sem mudança nesta tarefa.

## Anti-padrões / decisões técnicas

- **Sem RPC dedicada `get_anp_cdp_diaria_*_export_count`**: para a primeira versão usamos heurística (refetch + length) por nível. TODO: virar RPC se export pesado virar gargalo.
- **Filtro de "dimensão" não é empurrado pra RPC do chart no nível Field e Well**: queremos buscar todos os campos/poços no período/bacia para que a Top-N (defaults) seja estável — só o slider de período e o filtro de bacia disparam refetch debounced. Filtro de dimensão é client-side.
- **No nível Installation, push de campos para RPC**: como instalação não pertence a uma bacia explícita e o universo de instalações pode ser denso, o filtro de campos é empurrado server-side para reduzir payload. Filtro de instalação é client-side.
- **Reset de filtros ao trocar nível**: vocabulários diferentes (bacia só existe em Field/Well, instalação só em Installation, poço só em Well) — manter seleções antigas após troca causaria filtros vazios silenciosos.
- **Linha unificada (`UnifiedRow`) para chart/table**: cada nível projeta seu shape específico para `{ data, campo, bacia, dimension, ... }` antes de alimentar `pickTopDimensions` e `buildSerieChart`, mantendo o downstream level-agnostic.

## Performance

- **Field**: `anp_cdp_diaria` é pequena (~16.5k inicial); fetch sem filtros traz tudo (~3MB descomprimido).
- **Installation**: tamanho similar a Field × ~N instalações por campo; primeiros runs mostrarão a magnitude real.
- **Well**: nível mais profundo — pode crescer rápido (centenas de poços × dia). Fetch de série pode pular de "wide" para "narrow filter required" se passar de ~100k linhas. TODO: monitorar e adicionar filtro obrigatório de período se necessário.
- **Top 10 client-side via `useMemo`** — sem refetch ao mudar seleção de campos/instalações/poços.
- **Debounce 400ms** no fetch ao mudar slider de datas ou filtro server-side.
- **Paginação PostgREST**: cada wrapper usa `.range(offset, offset+999)` em loop até esgotar.

## Limitação: filtro Campo em Installation/Well mostra 76 (vs 94 em Field)

<!-- editado por worker_documentador 2026-05-08 — agent dash-anp-cdp-diaria não invocável nesta sessão -->

A discrepância vem da fonte (Power BI ANP), não do nosso ETL.

- **Field** usa a entity `v_campos_detalhe` → atribuição **N:N** (mesma produção atribuída a múltiplos campos via rateio ANP). Retorna **94 campos**.
- **Installation / Well** usam a entity `v_poco_instalacao_sigep_ultimo` → atribuição **1:1** ("último" mapping — cada poço linka a apenas UM campo principal contratual). Retornam **76 campos**.

Os 19 campos ausentes em Installation/Well são todos casos onde 100% dos poços são compartilhados com outro campo "principal", e `v_poco_instalacao_sigep_ultimo` mapeia cada poço apenas ao principal.

### Exemplos confirmados (cross-check com `anp_cdp_producao` mensal)

| Poço representativo | Campo principal (Well/Installation) | Campo(s) "perdidos" (Field-only) |
|---|---|---|
| `7-BUZ-10-RJS` | BÚZIOS | TAMBUATÁ (32 poços compartilhados) |
| `7-LL-100-RJS` | TUPI | AnC_TUPI (51 poços) |
| `7-MRO-10B-RJS` | MERO | AnC_MERO |
| `7-SPH-1-SPS` | SAPINHOÁ | NE / SO / NO de SAPINHOÁ (14 poços) |
| `7-PRG-76HB-RJS` | PEREGRINO | PITANGOLA (9 poços) |
| `7-PM-21D-RJS` | PAMPO | LINGUADO (4 poços) |
| `7-BAC-1-SPS` | BACALHAU | BACALHAU NORTE |
| `6-BRSA-770D-RJS` | MARLIM | ESPADIM + VOADOR |
| `7-JUB-57DPA-ESS` | JUBARTE | AnC_Jubarte_Nordeste/Sudoeste |

Os 19 campos faltantes representam ~0,3% da produção nacional (maioria são buckets `AnC_*` ou produção zerada).

**Decisão:** documentar e manter como está. Implementar atribuição N:N de fato exigiria criar tabela de mapping `(poco, campo, share_pct)` derivada de `anp_cdp_producao` (mensal × poço × campo, PK composta suporta N:N nativamente) — fora de escopo.

## Histórico

- `2026-05-08` — Implementação inicial (Field-only).
- `2026-05-08` — **Adicionada granularidade Installation e Well via `SegmentedToggle`**. 4 RPC wrappers novos, 2 chaves novas em export heuristics, sub-PRD atualizado. Migration `20260508120001_anp_cdp_diaria_levels.sql` aplicada via supabase_deploy.yml.
