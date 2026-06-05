# Sub-PRD — `/anp-cdp-diaria`

Dashboard Daily Production — **company-first** (PRIO / Petrobras net production) with a demoted granular surface (Field / Installation / Well). Oil & Gas. Owner: [`worker_dash-anp-cdp-diaria`](../../.claude/agents/worker_dash-anp-cdp-diaria.md). Source: ANP Power BI (`anp_cdp_diaria`, `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco`) + admin-curated `field_stakes` (company net).

> Item do dropdown "Oil & Gas" da NavBar (irmão de `/anp-cdp`). Distinção crítica: `/anp-cdp` é mensal por **poço** (formulário CDP); `/anp-cdp-diaria` é diário. O nível Company cruza a produção diária do campo com o stake (working interest) curado pelo admin em `/admin-panel → Field Stakes` para produzir **produção líquida no stake** por empresa.

## Information architecture — Two-Tier Tabs (2026-06-05)

A IA foi redesenhada (escolha consciente do usuário — **Two-Tier Tabs**, não a recomendação do design panel). Uma **barra de abas primárias** no topo da coluna de conteúdo:

```
[ PRIO ]   [ Petrobras ]   [ Explore raw data ]
```

- **Default = PRIO**, já renderizada no mount (zero cliques) — é a visão principal "na cara do usuário ao entrar".
- **PRIO / Petrobras** = visão de empresa (produção líquida no stake): renderiza o `CompanyContent` — **oil-only** desde 2026-06-05 (**stacked bar mensal de óleo líquido por campo** (kbpd, MtD-aware, **rótulo de total no topo de cada barra**) → chart de linha Net Oil kbpd total laranja + linhas por campo → **matriz diária de óleo líquido por campo** (colunas = `CAMPO (stake%)`, linhas = um dia cada, desc) → nota "Not yet in the daily feed: WAHOO (100%)"). **A faixa de 4 KPI cards foi removida (2026-06-05)** — o total mensal da empresa agora vive como rótulo no topo das barras do stacked bar (a info de "fields awaiting" já está na nota de cobertura). **O chart de Net Gas foi removido**.
- **Top 6 campos + "Others" (2026-06-05)**: a visão de empresa é um **resumo** — mostra os **6 maiores campos por net oil avg** (`TOP_N_COMPANY = 6`, ordenação canônica `orderCompanyFieldDims`, net oil avg desc) e colapsa todos os campos restantes num único bucket **"Others (N)"** (cinza neutro `#7F7F7F`, N = nº de campos colapsados). Aplica-se aos **3 surfaces** de forma idêntica por construção (helper único `companyDisplayBuckets` no hook): stacked bar (6 segmentos + Others), linha (Company total + 6 linhas + Others), matriz diária (Date + 6 colunas + Others). **Generaliza por contagem**: empresa com ≤6 campos (PRIO = 6) **não** mostra Others (todos os campos, comportamento atual intacto); só >6 campos (Petrobras = 37) gera o bucket (com os 31 restantes). O **total no topo da barra permanece o total da empresa** (top6 + Others = todos). Detalhe campo-a-campo está na aba "Explore raw data".
- **Explore raw data** = superfície granular (demovida): sub-abas `[ Field ] [ Installation ]` + um afixo discreto **"Well-level (advanced) ›"** (#888, 12px, dashed underline) que revela o nível Well. Well fica a **3 cliques** (Explore → Field/Installation → "Well-level advanced") e é **desktop-only** (não aparece no mobile). Caption no topo do Explore: **"Unweighted ANP daily feed — all operators"** (sinaliza bruto vs líquido).

A aba ativa **deriva do estado**: se `granularity==='company'` → aba ativa = `selectedEmpresa` (PRIO/Petrobras); se `granularity ∈ {field,installation,well}` → aba ativa = "Explore raw data". Toda a IA nova é **apresentação** sobre `setGranularity` + `setSelectedEmpresa`; o enum `Granularity` (`'field'|'installation'|'well'|'company'`) é preservado intacto.

### `FIXED_COMPANIES` (empresas fixas)

`export const FIXED_COMPANIES = ['PRIO','Petrobras'] as const;` — o universo de empresas é **fixo** a essas duas escolhas proeminentes. O **seletor dinâmico foi cortado**: a RPC `get_anp_cdp_diaria_empresas` (e seu wrapper `rpcGetAnpCdpDiariaEmpresas`) **não é mais consumida** pelo frontend (a função permanece no DB, sem uso). `selectedEmpresa` inicializa em `FIXED_COMPANIES[0]` (PRIO).

### Lazy-mount (regra dura)

A `granularity` inicial é `'company'` e permanece assim enquanto o usuário **não** abrir a aba/sheet Explore. Só ao clicar "Explore raw data" é que `setGranularity('field')` dispara — então os RPCs pesados de nível (especialmente Well, ~180k linhas) **nunca disparam na landing de empresa**. Verificado em smoke test: na landing PRIO só `get_anp_cdp_diaria_filtros` + `get_anp_cdp_diaria_empresa_campos` + `get_anp_cdp_diaria_empresa_serie` disparam; trocar PRIO↔Petrobras não dispara RPC de nível; `get_anp_cdp_diaria_serie` (Field) só dispara ao abrir Explore; `poco_serie` (Well) só ao clicar o afixo "Well-level (advanced)".

> O reset-effect que limpa seleções depende de `[supabase, granularity]` (NÃO de `selectedEmpresa`), então trocar PRIO↔Petrobras (ambos `granularity==='company'`) não dispara reset/flicker. O reset de estado de empresa (`selectedEmpresa`/`empresaCampos`/`companySerieRows`) só ocorre ao **sair** de company (nova granularidade ≠ company) — ao **entrar** em company a View já setou a empresa e o effect a preserva.

### Export sempre visível (decisão do usuário)

`<ExportButton spec={anpCdpDiariaExport} />` fica no `DashboardHeader.rightSlot` em **todas as abas** (company e Explore). O export continua exportando os níveis Field/Installation/Well (nível-editável no modal). **Não é WYSIWYG na aba de empresa** — a produção líquida por empresa **não** é exportável por ora (Company-level export é **P2**, intencional). Documentado abaixo na seção Export.

## Escopo de código

```
src/app/(dashboard)/anp-cdp-diaria/
├── page.tsx                  ← viewport router (useIsMobile)
├── useAnpCdpDiariaData.ts    ← single brain hook (RPCs, filters, ranking, export)
├── desktop/View.tsx          ← desktop UX (sidebar + multi-column grid + table)
└── mobile/View.tsx           ← mobile UX (product tabs + chart card + ranking cards)
```

RPC wrappers: seções "ANP CDP Diária" + "ANP CDP Diária — Installation level" + "ANP CDP Diária — Well level" + "ANP CDP Diária — Company level (stake-weighted net)" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

Export spec: [`src/lib/export/dashboards/anpCdpDiaria.ts`](../../src/lib/export/dashboards/anpCdpDiaria.ts) (unified export library, see [`docs/app/export-library-contract.md`](export-library-contract.md)). Count helper: `rpcGetAnpCdpDiariaExportCount(nivel, filtros)` wrapping `get_anp_cdp_diaria_export_count(p_nivel, p_filtros)`. The legacy heuristic chaves in `src/lib/exportSizeHeuristics.ts` are no longer consumed by this dashboard.

## Dual-view structure (Phase 2 — 2026-05-20)

Both Views consume the shared hook `useAnpCdpDiariaData`. Views are pure presentation; they never call Supabase or derive metrics on their own.

### Hook surface (single source of truth)

`useAnpCdpDiariaData()` returns:
- All 6 RPCs already wired (`rpcGetAnpCdpDiariaSerie` + Installation + Well wrappers + the 3 Company-level wrappers)
- Filter state for every dimension (campos, instalacoes, pocos, dateRange) — Basin filter was removed from the UI on 2026-05-28; the per-row `bacia` field is still displayed in tables and badges
- Granularity (`granularity` + `setGranularity`) — `"field" | "installation" | "well" | "company"`, **initial = `"company"`** (Two-Tier Tabs landing). Presentation maps the primary tabs to it: PRIO/Petrobras → `"company"`; Explore → `"field"` (lazy); Well affordance → `"well"`.
- Product toggle (`product` + `setProduct`) — `"oil" | "gas"`, drives mobile chart/ranking + the Company per-field ranking sort
- Derived: `petroleoChart`, `gasChart` (full multi-trace, kbpd / Mm³/d), `defaultPetroleoDims`, `defaultGasDims`, `ranking` (DimensionAggregate[] sorted by avg of current product)
- `tableRows` (top 500 most recent records)
- **Company level**: `selectedEmpresa` + `setSelectedEmpresa` (single-select, fixed to `FIXED_COMPANIES`), `empresaCampos` (stake coverage), `companySerieRows` (raw net serie), `companyFieldAggregates` (per-field net avg/latest + stake — **mobile ranking cards only** since 2026-06-05), `companyDailyOilMatrix` (**daily net-oil matrix** — fields × days, for the desktop table), `companyFieldsNoData` (stake-held fields without daily data), `companyPetroleoChart` (bold "Company total" headline + per-field net OIL lines, kbpd) and `companyMonthlyOilChart` (**stacked bar mensal de óleo líquido médio por campo**, kbpd, MtD-aware, **com rótulo de total no topo de cada barra**). All NET values = gross × stake/100, computed server-side; the hook only sums/aggregates. **No `empresas` field** — the dynamic list was retired (Two-Tier Tabs IA). **Oil-only (2026-06-05)**: `companyGasChart` was pruned — there is no gas chart in either view. **KPI cards removed (2026-06-05)**: `companyTotalOilNetAvg` / `companyTotalGasNetAvg` were **pruned from the hook** (the monthly total now lives as the on-bar label; "fields awaiting" lives in the coverage note). `companyFieldAggregates` stays (mobile ranking + `explicitCount`); `companyFieldsNoData` stays (coverage note).
  - **Top 6 + Others split (single source of truth)**: o helper `companyDisplayBuckets(orderedFields)` → `{ topFields, othersFields, showOthers }` (top = `slice(0, TOP_N_COMPANY=6)`; others = o resto; `showOthers` só quando há >6) + `bucketOf(field, topSet, othersDisplayLabel)` + `othersLabel(n)` ("Others (N)") são consumidos pelos **3 builders** (`buildCompanyChart` linha, `buildCompanyMonthlyOilByField`/`buildCompanyMonthlyOilStacked` barra, `buildCompanyDailyOilMatrix` matriz) — **não há lógica de top-6 duplicada em builder algum**; os 6 campos + Others são idênticos nos 3 lugares por construção. Constantes no hook: `TOP_N_COMPANY=6`, `OTHERS_LABEL="Others"`, `OTHERS_COLOR="#7F7F7F"` (cinza canônico de Others, espelha `COUNTRY_COLORS.Others` + PALETTE pos 14 em `plotlyDefaults`). Cor de Others = grey, nunca uma cor de campo da PALETTE nem o laranja-marca (reservado à linha "Company total"); sem "(stake%)" no rótulo (agregado de stakes mistos). PRIO (6 campos) → sem Others; Petrobras (37) → 6 + Others (31). O ranking mobile usa `capCompanyFieldAggregates` (mesmo cap: top 6 + 1 card "Others (N)").
  - **Daily net-oil matrix derivation** (single source of truth in the hook): `buildCompanyDailyOilMatrix(companySerieRows)` → `CompanyDailyOilMatrix { fields: { campo, stakePct, label, isOthers?, othersFieldNames? }[], rows: { data, values: Record<campo, number|null> }[] }`. Pivot por `(data × campo)` com **net oil em kbpd** (`÷1000` via `bblDiaToKbpd`). **Colunas** = os 6 maiores campos (ordem canônica `orderCompanyFieldDims`, avg net oil desc; header com stake `fieldLabelWithStake` → "PEREGRINO (80%)") + 1 coluna **"Others (N)"** (`isOthers=true`, sem stake, com `othersFieldNames` p/ tooltip nativo) quando >6 campos. **Célula Others** = soma do net oil/dia dos campos colapsados. **Linhas** uma por dia presente na série, ordenadas **descendente** (mais recente no topo). Dia sem dado → `null` ("—"). **Oil only**. Consumida pela tabela desktop `CompanyDailyOilMatrixTable` (**desktop-only**; o mobile mantém os ranking cards `companyFieldAggregates`, também capeados em top 6 + Others).
  - **Monthly stacked-bar derivation** (single source of truth in the hook): `buildCompanyMonthlyOilByField(companySerieRows)` → `CompanyMonthlyOilByField { months[], fieldOrder[], valueByMonth, partialMonth, fullFieldOrder[], othersBucketLabel }`. `fieldOrder` já vem **colapsado** (top 6 + "Others (N)" quando >6); `valueByMonth[m][bucket]` soma os campos do Others; `fullFieldOrder` (ordem canônica completa antes do colapso) colore os top6 idênticos à linha e `othersBucketLabel` marca o segmento grey. **O rótulo de total no topo da barra continua = total da empresa** (soma de `Object.values(valueByMonth[m])` = top6 + Others = todos os campos). Per `(mês, campo)` value = `soma(net oil bbl/dia naquele mês) / (nº de dias em que o campo reportou no mês)` — **a MESMA metodologia de "média sobre dias reportados"** de `companyFieldAggregates.avgOil`, só que bucketizada por mês. `buildCompanyMonthlyOilStacked(monthly, height, scale, labelFontSize)` produz o `{ data, layout }` (Plotly `barmode: 'stack'`, 1 trace/campo, Y kbpd, sem trace "Company total" — o total é a própria pilha). **O total mensal vira `layout.annotations`** (1 por mês, `y = altura da pilha`, `yshift: 8`, `showarrow:false`, Arial, cor `#1a1a1a`, texto = total em kbpd pt-BR ex.: "160,7"); `margin.t` foi alargado (28 desktop / 22 mobile) pros rótulos não cortarem. O mês parcial (MtD) **não** repete "(MtD)" no rótulo (o tick já mostra). `labelFontSize` (default 11) é reduzido a 10 no mobile pra caber 7 rótulos num chart ~260px.
  - **Cor por campo idêntica nos dois charts**: `orderCompanyFieldDims(rows, metric)` (ordem por média net desc) + `companyFieldColorMap(orderedDims)` (`PALETTE[(i+1)%len]`, posição 0/laranja reservada à linha de total) são **helpers compartilhados** consumidos por `buildCompanyChart` (linha) E `buildCompanyMonthlyOilStacked` (barra) — garante que cada campo (ex.: PEREGRINO) tenha a mesma cor nos dois.
  - **Mês vigente = MtD**: como a média só vê os dias existentes, o mês mais recente já é naturalmente month-to-date. `partialMonth` é setado ao mês da `data` máxima **apenas se** essa data for anterior ao último dia de calendário do mês — então um mês completo (dados terminando em 2026-05-31 → Maio cheio) rende `partialMonth = null` (sem marcador MtD), e o primeiro dia parcial de Junho ativa o marcador sozinho. O bucket MtD renderiza com `marker.opacity` reduzida (0.55), tick rotulado `"Mon YYYY (MtD)"` e sufixo "(month-to-date)" no hover.
- Export modal state + handlers (`handleExportExcel`, `handleExportCsv`, `estimateExportRows`) — vestigial, no longer consumed (desktop uses `<ExportButton spec={anpCdpDiariaExport} />`)
- Visibility guard already applied (`useModuleVisibilityGuard("anp-cdp-diaria")`)

### Desktop view (`desktop/View.tsx`)

Two-Tier Tabs (2026-06-05). Layout:
- **Sidebar**: BrandLogo + **Period slider only** + the note "Net = field daily production × the company's stake". The level multi-selects moved out of the sidebar into the Explore surface; the 4-pill granularity toggle and the `CompanySelector` (featured pills + `<select>`) were **deleted**.
- **Primary tab bar** (top of content column, below `DashboardHeader`): `[PRIO] [Petrobras]` (left) … `[Explore raw data]` (right, secondary styling). True tabs (orange underline + text on active), not the sliding-pill `SegmentedToggle`.
- **Company tab (PRIO / Petrobras)**: `CompanyContent` — **oil-only** (2026-06-05) — `DashboardHeader` ("Daily Net Production — <Company>") + **monthly stacked bar "Net Oil — Monthly Average by Field (kbpd)"** (subtítulo "Stake-weighted · current month is month-to-date", 1 barra empilhada/campo, MtD-aware, **rótulo de total no topo de cada barra**) → **Net Oil line chart** (bold "Company total" + per-field net OIL lines, labels carry stake e.g. "PEREGRINO (80%)") → **daily net-oil matrix** "Daily net oil by field — <Company>" (caption "Net oil (kbpd), stake-weighted · one row per day"): **colunas** = `Date` (1ª, sticky-left) + uma por campo `CAMPO (stake%)` (ordem canônica dos charts); **linhas** = uma por dia, **descendente** (mais recente no topo); **célula** = net oil do campo naquele dia em kbpd (1 casa, pt-BR), dia sem dado → "—". Container scroll horizontal + vertical (`overflow-x/y:auto`, `maxHeight 480`), header row **sticky-top** + coluna Date **sticky-left** (z-index 3 no canto, 1 no corpo). Petrobras tem ~37 colunas de campo (scroll horizontal real, `scrollWidth ≫ clientWidth`). → coverage note ("Not yet in the daily feed: WAHOO (100%)"). Ordem final: stacked bar → linha de óleo → matriz diária → nota. **A faixa de 4 KPI cards foi removida (2026-06-05)** (o `KpiCard`/`.metric-card` foi deletado do arquivo); o total mensal agora é o rótulo no topo das barras. **O chart de Net Gas foi removido**. The `!selectedEmpresa` empty branch was removed — PRIO is always selected; only the "no daily data in period" branch remains.
- **Explore tab**: caption "Unweighted ANP daily feed — all operators" + sub-tabs `[Field|Installation]` (`SegmentedToggle`) + advanced affordance "Well-level (advanced) ›" (toggles Well; shows "← Back to Field / Installation" when Well is active) + the relocated level `SearchableMultiSelect` (Field/Installation/Well) + 2 line charts (Oil kbpd, Gas Mm³/day) + "Production by Level" recent-records table (sticky thead, max 500 rows).
- `<ExportButton spec={anpCdpDiariaExport} />` in `DashboardHeader.rightSlot` on **all tabs**.

### Mobile view (`mobile/View.tsx`)

Two-Tier Tabs mobile adaptation (2026-06-05). Layout:

**Company landing (default — PRIO, zero clicks):**
- Page heading "Daily Production" / "Stake-weighted net production by field" (MobileTopBar provided by MobileShell — NOT imported here).
- **Hero `[PRIO | Petrobras]` `SegmentedToggle`** in the heading (drives `setSelectedEmpresa` + ensures `granularity==='company'`).
- Sticky period preset pills (1M / 3M / 6M / 1Y / All).
- `CompanyMobileContent` — **oil-only** (2026-06-05): **"Net Oil — Monthly Avg by Field" stacked bar** (`MobileChart` ~260px, consome `companyMonthlyOilChart` do hook, mesmas cores por campo do desktop, **top 6 campos + Others (N)** em cinza herdados do hook, **rótulo de total no topo de cada barra** — annotations passadas do layout do hook com fonte reduzida pra 10px e `margin.t` 22) + **Net Oil total line chart** (single bold "Company total" net line, `MobileChart` ~240px) + "By Field — Net" `MobileDataCard` ranking **capeado em top 6 + 1 card "Others (N)"** (`companyFieldAggregates` já vem capeado pelo hook via `capCompanyFieldAggregates`; o card Others soma os net avg/latest dos campos colapsados e **não** mostra badge de stake — agregado de stakes mistos) + coverage note ("Not yet in the daily feed: WAHOO (100%)"). **A grade de 2 células de resumo (Net Oil avg / Net Gas avg) foi removida (2026-06-05)** (o `SummaryCell` foi deletado do arquivo) — o total mensal agora é o rótulo no topo das barras (binding sync com o desktop). **O chart de Net Gas foi removido**.
- Below the company content: a discreet **full-width dashed button "Explore raw data (Field, Installation) ›"**.

**Explore sheet (BottomSheet 90vh):**
- Caption "Unweighted ANP daily feed — all operators" + sub-tabs `[Field|Installation]` + Period slider + Field chip cloud (Field level) + Oil/Gas `MobileChart` charts + Top 10 `RankingCard` list + "See all N" (nested BottomSheet). **Well NOT reachable on mobile.** Closing the sheet returns to the company landing (restores `selectedEmpresa` + `granularity='company'`).

NOT on mobile (intentional `[mobile-only]` decisions):
- No `ExportFAB` / `ExportModal` — export is desktop-only (plan § 3.4)
- No `MobileTabBar` for Oil/Gas — both charts stacked, always visible
- **Well level — NOT reachable on mobile** (desktop-only; the "Well-level advanced" affordance is desktop-only) `[mobile-only]`
- **Installation only inside the Explore sheet** (desktop has it as a primary sub-tab; mobile gates it behind the sheet) `[mobile-only]`
- No recent-records HTML table — wrong shape for phones

### Binding sync

Any new filter / chart / KPI / copy here must land in BOTH Views in the same commit, or the commit must declare `[desktop-only]` / `[mobile-only]` (see `CLAUDE.md` § Dual-view policy). The Two-Tier Tabs IA (2026-06-05) shipped in **both** Views in the same commit. Aspects intentionally desktop-only:
- **Well level** — not reachable on mobile (hardcore/desktop surface)
- The recent-records table (500 rows of HTML table — wrong shape for phone)
- **The company "Daily net oil by field" matrix** (up to ~37 field columns × ~204 day rows — wide daily matrix is desktop-shaped; mobile keeps the "By Field — Net" `MobileDataCard` ranking instead) `[desktop-only]`
- ExportFAB / ExportModal — export is desktop-only per plan § 3.4 (and Company-level export is P2 even on desktop)

Mobile-only:
- Period preset pills (1M/3M/6M/1Y/All) replacing the PeriodSlider in the heading (the slider still appears inside the Explore sheet)
- Top 10 ranking card list + "See all N" BottomSheet (desktop has the dense table instead)
- Company net charts collapse to a single "Company total" line per product (desktop also draws per-field lines); the per-field detail is in the "By Field — Net" `MobileDataCard` list
- The granular surface lives inside a BottomSheet (desktop has it as a first-class tab); Installation is sheet-gated

## Produto

Visualização da **produção diária de petróleo e gás natural** declarada no Power BI público da ANP em **4 níveis de granularidade**, escolhidos via toggle no topo dos filtros (`SegmentedToggle` "pill deslizante laranja"):

| Nível | Label UI | Tabela alvo | Páginas Power BI |
|---|---|---|---|
| `field` | **Field** | `anp_cdp_diaria` | Página 4 |
| `installation` | **Installation** | `anp_cdp_diaria_instalacao` | Página 5 |
| `well` | **Well** | `anp_cdp_diaria_poco` | Página 6 |
| `company` | **Company** | `anp_cdp_diaria` × `field_stakes` | — (derivado: campo diário × stake) |

Por nível, o usuário pode:

- Selecionar **campos** via `SearchableMultiSelect`.
- Selecionar **instalações** (apenas Installation) via `SearchableMultiSelect`.
- Selecionar **poços** (apenas Well) via `SearchableMultiSelect`.
- Restringir o **período** via `PeriodSlider` em modo `dates` (server-side).
- Ver duas séries temporais (Petróleo `kbpd` e Gás `Mm³/dia`) para a "dimensão" do nível atual (Top 10 por média se sem seleção, ou exatos selecionados).
- Inspecionar a tabela de produção mais recente (até 500 linhas).
- Exportar Excel/CSV via `<ExportButton spec={anpCdpDiariaExport} />` do unified export library (Tier 2, modal com calculadora de tamanho server-side).

Header: título e sub variam por nível ("Daily Production by Field/Installation/Well"; Company → "Daily Net Production — <Company>").

### Company level — produção diária líquida por empresa (2026-06-05)

O nível **Company** responde à pergunta "como está a produção diária da PRIO (ou Petrobras, etc.)?". O usuário seleciona **uma empresa** (single-select) e vê a **produção líquida no stake**: para cada campo da empresa, `net = produção bruta do campo × stake_pct/100`.

Decisões de produto (travadas pelo CTO — atualizado 2026-06-05 com a IA Two-Tier Tabs):
- **Empresas fixas (`FIXED_COMPANIES`)**: somente **PRIO e Petrobras**, como abas primárias proeminentes. O **seletor dinâmico foi cortado** — a RPC `get_anp_cdp_diaria_empresas` não é mais consumida (fica no DB sem uso). `selectedEmpresa` inicializa em PRIO.
- **Somente produção líquida** (campo × stake/100). **Sem toggle bruta.** `stake_pct` é usado apenas como rótulo ("PEREGRINO (80%)") / coluna de tabela / badge.
- **Single-select** — uma empresa por vez (a aba ativa).

Modelo de dados:
- **net = bruta × stake** — computado server-side por `get_anp_cdp_diaria_empresa_serie` (`petroleo_bbl_dia_net`, `gas_mm3_dia_net`). O frontend apenas soma/agrega.
- **Total da empresa** (linha "Company total", laranja, bold, no chart de **óleo**): por dia, soma de `*_net` entre todos os campos. **Oil-only (2026-06-05)**: não há mais chart de gás.
- **Stacked bar mensal de óleo (2026-06-05)**: 1 trace por campo, X = meses, Y = kbpd. The bar stacks each field's monthly net daily oil average (over the days that field reported in the month), so the total bar height ≈ the company's net daily oil average for that month — exact only when every field reports the same set of days; if a field is missing days the stacked total diverges slightly from the daily "Company total" average (benign — the per-field-over-reported-days mean is the intended methodology, identical to `companyFieldAggregates.avgOil` and the per-field table). Valor por (mês, campo) = média diária do óleo líquido naquele mês (soma net oil nos dias reportados / nº desses dias) — mesma metodologia do agg, bucketizada por mês. **Total no topo de cada barra (2026-06-05)**: a altura da pilha (= soma dos campos no mês) vira `layout.annotations` (1 por mês, kbpd pt-BR, ex.: "160,7"; `yshift: 8`, `showarrow:false`, Arial, `#1a1a1a`; mobile reduz a fonte pra 10px). Substitui a antiga faixa de KPI cards. Mês vigente é MtD (marcador de opacidade reduzida + tick "(MtD)" + hover suffix; ativa sozinho quando chegar dado parcial; o rótulo de total **não** repete "(MtD)"). Cores por campo idênticas às do chart de linha (helpers `orderCompanyFieldDims` + `companyFieldColorMap`).
- **Por campo**: linhas individuais net (óleo), label com stake.
- **Matriz diária de óleo (desktop, 2026-06-05)**: colunas = `Date` (sticky-left) + `CAMPO (stake%)` por campo (ordem canônica dos charts); linhas = uma por dia, **descendente** (mais recente no topo); célula = net oil do campo naquele dia em kbpd. Substitui a antiga tabela "Net production by field" (linhas = campos). Derivação `companyDailyOilMatrix` no hook. **Desktop-only** (matriz larga é desktop-shaped).
- **Ranking por campo (mobile)**: Field · Stake% · Net Oil avg · Latest net · Latest date (`companyFieldAggregates`, ordenado pela média do produto ativo) — alimenta os `MobileDataCard` "By Field — Net" do mobile.
- **Cobertura**: `get_anp_cdp_diaria_empresa_campos` retorna todos os campos do stake com flag `has_daily_data`. Os `false` viram a nota "Not yet in the daily feed: …".

Exemplo confirmado (PRIO, smoke test 2026-06-05): Frade/Polvo/Tubarão Martelo (100%), Albacora Leste (90%), Peregrino/Pitangola (80%) — todos com dado diário; **Wahoo (100%) — no daily data yet** (FPSO ainda fora do feed). Net Oil avg ≈ 157,5 kbpd. Peregrino latest net 72,5 kbpd = bruta 90,7 kbpd × 0,8 (confere).

Limitações conhecidas:
- **Wahoo / FPSO Frade** e campos onshore da Petrobras podem não estar no feed diário Power BI → aparecem na nota de cobertura, não nos charts/tabela. O INNER JOIN do `get_anp_cdp_diaria_empresa_serie` exclui campos sem dado diário.
- A discrepância "Field 94 vs Installation/Well 76 campos" (ver seção própria) **não** afeta Company, pois Company usa `anp_cdp_diaria` (Field-level, entity `v_campos_detalhe`).
- A produção líquida depende da curadoria de `field_stakes` no `/admin-panel`. Stakes desatualizados → net incorreto. Não é módulo novo (project_new_module_admin_requirements não se aplica) — é um modo dentro de um módulo existente; a curadoria de stakes já é feita no admin.

### Diferença vs `/anp-cdp`

| | `/anp-cdp` | `/anp-cdp-diaria` |
|---|---|---|
| Granularidade temporal | Mensal | Diária |
| Granularidades possíveis | Poço × campo (mensal) | Field, Installation, Well, **Company** (diário, toggle) |
| Fonte | Formulário CDP (Selenium + CAPTCHA, mensal) | Power BI ANP (3×/dia automático) + `field_stakes` (Company) |
| Tabela | `anp_cdp_producao` | `anp_cdp_diaria` + `anp_cdp_diaria_instalacao` + `anp_cdp_diaria_poco` (+ `field_stakes` p/ Company) |
| Range | Histórico longo (dezenas de anos) | Começa em 2025-11-30 (limitação da fonte) |

## Filtros UI por nível

Os filtros visíveis na sidebar dependem do `granularity`:

| Nível | Onde | Filtros visíveis |
|---|---|---|
| **Company** (PRIO/Petrobras tab) | landing | Empresa (aba primária, fixa), Período (sidebar/sticky) — sem filtro de campo (o universo é o stake da empresa) |
| **Field** | Explore sub-tab | Campo (client, dentro do Explore), Período |
| **Installation** | Explore sub-tab | Instalação (client), Período (campos push server quando selecionado) |
| **Well** | Explore advanced (desktop-only) | Poço (client), Período |

A troca de nível **reseta as seleções de dimensão** (campos/instalações/poços) para evitar carregar termos estranhos entre vocabulários. O reset de estado de empresa só ocorre ao **sair** de company (nova granularidade ≠ company); ao entrar/trocar entre PRIO↔Petrobras (ambos company) **não** há reset (deps do effect = `[supabase, granularity]`).

> **Basin filter removed (2026-05-28)** — not relevant for the analyst workflow. The backend RPCs `get_anp_cdp_diaria_serie` and `get_anp_cdp_diaria_poco_serie` still accept `p_bacias` for compatibility, but the frontend wrapper now pins it to `NULL`. The per-row `bacia` column remains in chart hovertemplates, the desktop recent-records table, the mobile ranking card badge, and Excel/CSV exports — only the input filter is gone.

## RPCs consumidas

| Wrapper TS | RPC PostgreSQL | Retorno |
|---|---|---|
| `rpcGetAnpCdpDiariaFiltros` | `get_anp_cdp_diaria_filtros()` | `{ campos[], data_min, data_max }` (backend also returns `bacias[]`; dropped by wrapper since 2026-05-28) |
| `rpcGetAnpCdpDiariaSerie` | `get_anp_cdp_diaria_serie(p_campos, p_bacias, p_data_inicio, p_data_fim)` | `Array<{ data, campo, bacia, petroleo_bbl_dia, gas_mm3_dia }>` — wrapper pins `p_bacias = NULL` since 2026-05-28 |
| `rpcGetAnpCdpDiariaInstalacaoFiltros` | `get_anp_cdp_diaria_instalacao_filtros()` | `{ campos[], instalacoes[], data_min, data_max }` |
| `rpcGetAnpCdpDiariaInstalacaoSerie` | `get_anp_cdp_diaria_instalacao_serie(p_campos, p_instalacoes, p_data_inicio, p_data_fim)` | `Array<{ data, campo, instalacao, petroleo_bbl_dia, gas_mm3_dia }>` |
| `rpcGetAnpCdpDiariaPocoFiltros` | `get_anp_cdp_diaria_poco_filtros()` | `{ campos[], pocos[], data_min, data_max }` (backend also returns `bacias[]`; dropped by wrapper since 2026-05-28) |
| `rpcGetAnpCdpDiariaPocoSerie` | `get_anp_cdp_diaria_poco_serie(p_campos, p_bacias, p_pocos, p_data_inicio, p_data_fim)` | `Array<{ data, campo, bacia, poco, petroleo_bbl_dia, gas_mm3_dia }>` — wrapper pins `p_bacias = NULL` since 2026-05-28 |
| ~~`rpcGetAnpCdpDiariaEmpresas`~~ | ~~`get_anp_cdp_diaria_empresas()`~~ | **Não consumida desde 2026-06-05** (IA Two-Tier Tabs — empresas fixas em `FIXED_COMPANIES`). Wrapper TS e RPC SQL permanecem definidos mas mortos; podem ser removidos numa limpeza futura. |
| `rpcGetAnpCdpDiariaEmpresaSerie` | `get_anp_cdp_diaria_empresa_serie(p_empresa, p_data_inicio, p_data_fim)` | `Array<{ data, campo, bacia, stake_pct, petroleo_bbl_dia, gas_mm3_dia, petroleo_bbl_dia_net, gas_mm3_dia_net }>` — 1 linha por (data, campo), INNER JOIN (campos sem dado diário não vêm) |
| `rpcGetAnpCdpDiariaEmpresaCampos` | `get_anp_cdp_diaria_empresa_campos(p_empresa)` | `Array<{ campo, stake_pct, has_daily_data }>` (ordenado has_daily_data DESC, stake DESC) — cobertura do stake |

Tabelas e RPCs dos níveis Installation e Well foram criadas pela migration `20260508120001_anp_cdp_diaria_levels.sql`. As 3 RPCs do nível Company foram criadas pela migration `20260609000000` (todas `SECURITY DEFINER`, anon-safe).

> ⚠️ **Parsing das RPCs Company**: as colunas `numeric` (`stake_pct`, `petroleo_bbl_dia_net`, `gas_mm3_dia_net`) chegam como **string** no supabase-js. Os wrappers fazem `Number()` antes de retornar (tipos limpos: `*_net` como `number | null`). As colunas `real` (`petroleo_bbl_dia`, `gas_mm3_dia`) já chegam como number.

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
| `instalacao` | TEXT | ✓ |
| `campo` | TEXT NOT NULL | |
| `petroleo_bbl_dia` | REAL | |
| `gas_mm3_dia` | REAL | |

### `anp_cdp_diaria_poco` (Well — novo)

| Coluna | Tipo | PK? |
|---|---|---|
| `data` | DATE | ✓ |
| `poco` | TEXT | ✓ |
| `campo` | TEXT nullable | |
| `bacia` | TEXT nullable | |
| `instalacao` | TEXT nullable | |
| `petroleo_bbl_dia` | REAL | |
| `gas_mm3_dia` | REAL | |

## Pipeline de origem

<!-- editado por worker_documentador 2026-05-08 — agent dash-anp-cdp-diaria não invocável nesta sessão -->

- **Script**: `scripts/extractors/anp_cdp_powerbi.py` (extrator Power BI — owner: `worker_etl-pipelines`). Estendido para extrair as 3 páginas (4, 5, 6).
- **Workflow**: `.github/workflows/etl_anp_cdp_diaria.yml`
- **Schedule**: 3×/dia (10:00, 15:00, 20:00 UTC)
- **Range**: dataset começa em **2025-11-09** (base point — primeira data com dados Power BI; `--start` default ajustado em commit `397a108c`)

### Semântica de upload — append-only (desde 2026-05-08)

Upload usa `ignore_duplicates=True` (PostgREST `Prefer: resolution=ignore-duplicates` → SQL `ON CONFLICT DO NOTHING`). Comportamento:

| Caso | Resultado |
|---|---|
| (data, dim) inédito | INSERT |
| (data, dim) já existe | SKIP — valor original preservado |

Aplica-se às 3 tabelas (`anp_cdp_diaria`, `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco`) — todas passam pela mesma `upload_to_supabase()`.

**Trade-off:** revisões retroativas do Power BI ANP não são refletidas (ex: se a ANP revisar a produção de um poço de Nov/2025 em Jun/2026, o valor original persiste). Decisão explícita do usuário — snapshot histórico tem prioridade sobre fidelidade a revisões.

> Installation e Well começam vazios até o primeiro run pós-deploy do ETL atualizado. UI lida bem com `data: []` (mensagem amigável "Sem dados de produção <level> ainda. O ETL desta granularidade roda 3×/dia — aguarde primeiro pull pós-deploy.").

## Charts esperados (todos os níveis)

| Chart | Tipo Plotly | Source RPC | Top-N agrupador |
|---|---|---|---|
| Petróleo (kbpd) | line (multi-trace) | RPC do nível atual | campo / instalacao / poco |
| Gás (Mm³/dia) | line (multi-trace) | RPC do nível atual | campo / instalacao / poco |
| Production by ... (tabela) | HTML table com sticky thead | mesma série | colunas por nível |

A tabela "Production by ..." muda colunas por nível:

| Nível | Colunas |
|---|---|
| Field | Date · Bacia · Campo · Oil · Gas |
| Installation | Date · Campo · Instalação · Oil · Gas |
| Well | Date · Bacia · Campo · Poço · Oil · Gas |

## Display units (kbpd vs raw bbl/day)

The petroleum trace, the table column "Petróleo", and the chart Y-axis label are rendered in **kbpd** (thousand barrels per day). The underlying column `petroleo_bbl_dia` returned by all three level RPCs (`get_anp_cdp_diaria_serie`, `*_instalacao_serie`, `*_poco_serie`) is still in **bbl/day**; the page divides by 1000 at display time via `bblDiaToKbpd()` from [`src/lib/units.ts`](../../src/lib/units.ts). Excel/CSV exports keep the raw bbl/day column header for data fidelity. Gas remains in its native `Mm³/dia`.

## Padrões consolidados aplicados

- [x] Header: `<DashboardHeader title sub period>` com `<hr>` separator
- [x] Period badge: condicional ao `hasDates` (`[string, string] | null`)
- [x] Push período (Field/Well) ou período + campos (Installation) para RPC server-side
- [x] Debounce 400ms via `useDebouncedFetch`
- [x] Loading: `<BarrelLoading>` no init; `<ChartSection loading>` inline durante refetch
- [x] Filtros: `<SearchableMultiSelect>` (Campo, Instalação, Poço) com counter `(N/total)`
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

- **RPC `get_anp_cdp_diaria_export_count(p_nivel, p_filtros)` é o oráculo de tamanho do modal** desde a migração para o unified export library (2026-05-28). Substitui a heurística `refetch + length` por nível. Wrapper TS: `rpcGetAnpCdpDiariaExportCount(nivel, filtros)`.
- **Filtro de "dimensão" não é empurrado pra RPC do chart no nível Field e Well**: queremos buscar todos os campos/poços no período para que a Top-N (defaults) seja estável — só o slider de período dispara refetch debounced. Filtro de dimensão é client-side.
- **No nível Installation, push de campos para RPC**: como instalação não pertence a uma bacia explícita e o universo de instalações pode ser denso, o filtro de campos é empurrado server-side para reduzir payload. Filtro de instalação é client-side.
- **Reset de filtros ao trocar nível**: vocabulários diferentes (instalação só existe em Installation, poço só em Well) — manter seleções antigas após troca causaria filtros vazios silenciosos.
- **Basin filter removido (2026-05-28)**: o filtro de bacia foi removido da sidebar (desktop) e do FilterDrawer (mobile) por não ser relevante para a análise diária. Os wrappers TS continuam aceitando o parâmetro internamente (pinned a NULL) e o backend não foi tocado.
- **Linha unificada (`UnifiedRow`) para chart/table**: cada nível projeta seu shape específico para `{ data, campo, bacia, dimension, ... }` antes de alimentar `pickTopDimensions` e `buildSerieChart`, mantendo o downstream level-agnostic.

## Export (unified library)

Migrated to the unified export library on 2026-05-28 (contract: [`docs/app/export-library-contract.md`](export-library-contract.md)). Spec file: [`src/lib/export/dashboards/anpCdpDiaria.ts`](../../src/lib/export/dashboards/anpCdpDiaria.ts).

> **Company-level export is P2 (not shipped 2026-06-05).** The export modal stays pinned to the 3 nível options (Campo / Instalação / Poço). The Company net serie is not yet a candidate sheet — the company feature shipped without touching the export spec to avoid blocking it. Add a `empresa` nível + a net-columns sheet when prioritized.

| Field | Value |
|---|---|
| `filename` | `DailyProduction` (library appends `_{nivel}_DD-MM-YY.<ext>`) |
| `tier` | 2 (modal with size estimator) |
| `filterSource` | `"modal-editable"` — filters drawn from zero in the modal, **not** WYSIWYG of dashboard state. The dashboard's `granularity` sidebar toggle does **not** propagate into the export; the user picks the nível inside the modal. |
| Sheets / files | Spec declares 3 candidate sheets (`"Campo"` / `"Instalação"` / `"Poço"`); only the one matching the chosen `nivel` carries rows (see "Multi-sheet behavior — P1" below). |
| CSV mode | `single` — same row set as the active sheet |
| Charts | None |

### Multi-sheet behavior — P1 (2026-05-28)

`ExcelBuilder.downloadExcel` iterates **all** declared sheets unconditionally, so every download materializes the 3 sheets. To avoid triggering the 3 RPC pulls per click (including the ~180k-row Poço one), each sheet's `rowsAsync` short-circuits with `[]` when `filters.nivel` does not match its own level. The resulting workbook contains 3 tabs — only the one matching the chosen `nivel` has rows; the other two are empty tabs. Mirrors the `flow` short-circuit pattern used by `/imports-exports`. **Phase 2** will collapse the workbook to a single sheet via an `ExcelBuilder` enhancement that honors the `segmented` sheet-selection convention documented below.

### Modal filters

| Key | Type | Default | Notes |
|---|---|---|---|
| `nivel` | `segmented` | `"campo"` | Field / Installation / Well — selects which sheet (and which columns) is materialized |
| `period` | `date-range` | Last 30 days (today − 30 → today) | |
| `campos` | `multi-select` (options from `rpcGetAnpCdpDiariaFiltros`) | `[]` (= all) | Always visible |
| `instalacoes` | `multi-select` (options from `rpcGetAnpCdpDiariaInstalacaoFiltros`) | `[]` (= all) | Library should show only when `nivel = instalacao` |
| `poco` | `search` | empty | Library should show only when `nivel = poco`; wrapper passes the typed string as a single-element `pocos` array |

### Sheet columns per nível

| Nível | Sheet name | Columns |
|---|---|---|
| `campo` | `"Campo"` | Date · Field · Basin · Oil (bbl/day) · Gas (Mm³/day) |
| `instalacao` | `"Instalação"` | Date · Installation · Field · Oil (bbl/day) · Gas (Mm³/day) |
| `poco` | `"Poço"` | Date · Well · Field · Basin · Installation · Oil (bbl/day) · Gas (Mm³/day) |

### Size estimator

Server-side count via `rpcGetAnpCdpDiariaExportCount(nivel, filtros)` → `get_anp_cdp_diaria_export_count(p_nivel text, p_filtros jsonb)`. Filter payload keys: `data_inicio`, `data_fim`, `campos`, `instalacoes`, `pocos`. Unknown keys silently ignored by the SQL function. The legacy heuristic in `src/lib/exportSizeHeuristics.ts` (`anp_cdp_diaria`, `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco`) is no longer consumed by this dashboard, but the keys remain in the file for backward compatibility until the cleanup wave.

### Sheet-selection convention

When `filterSource === "modal-editable"` and the modal declares a `segmented` filter with `key = "nivel"`, the library materializes only the matching sheet at download time (mapping `campo → "Campo"`, `instalacao → "Instalação"`, `poco → "Poço"`). The unified library author (`worker_subgerente-app`) is responsible for wiring this selection — see the binding header comment in the spec file.

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
- `2026-05-27` — **Mobile reform v2 (Onda 3)**. `mobile/View.tsx` reescrito: período preset pills (1M/3M/6M/1Y/All) no chip row sticky; dois charts (Oil + Gas) empilhados verticalmente sempre visíveis (sem tab Oil/Gas); ranking Top 10 com `MobileDataCard` + botão "See all N fields" abre `BottomSheet` (90vh) com lista completa pesquisável; production summary card 2×3; `ExportFAB`/`ExportModal` removidos (export é desktop-only); `MobileTabBar` de produto removido. Commit `b29914ff`, branch `worktree-agent-ae3d7c80602ee09fb`.
- `2026-05-28` — **Export migrado para o unified export library** ([contract](export-library-contract.md)). Novo spec em `src/lib/export/dashboards/anpCdpDiaria.ts`; `desktop/View.tsx` agora consome `<ExportButton spec={anpCdpDiariaExport} />` em `DashboardHeader.rightSlot`. Estado de export modal/handlers removidos do hook do desktop (modal-editable filters: período default last 30d, todos os campos). Novo wrapper TS `rpcGetAnpCdpDiariaExportCount(nivel, filtros)` em `src/lib/rpc.ts` envelopando `get_anp_cdp_diaria_export_count(p_nivel, p_filtros)` (shipped por worker_supabase). Heurística em `exportSizeHeuristics.ts` deprecada para este dashboard.
- `2026-06-05` — **Nível Company (produção diária líquida no stake por empresa)**. 4º modo no `Granularity` (`"company"`). Seletor dinâmico (PRIO/Petrobras em destaque + dropdown/BottomSheet das demais), single-select, somente net (campo × stake/100). Desktop: KPI strip + 2 charts net (total + por campo, labels com stake) + tabela net por campo + nota "no daily data yet" (ex.: Wahoo). Mobile (binding sync, mesmo commit): switch `Fields | Companies`, pills PRIO/Petrobras + BottomSheet, charts do total net, ranking `MobileDataCard` por campo com stake%, nota de cobertura. 3 wrappers TS novos (`rpcGetAnpCdpDiariaEmpresas`, `rpcGetAnpCdpDiariaEmpresaSerie`, `rpcGetAnpCdpDiariaEmpresaCampos`) com `Number()` das colunas numeric-as-string. Backend: 3 RPCs `SECURITY DEFINER` da migration `20260609000000` (commit `9caefb28`, worker_supabase). Export Company P2 (não tocado). Smoke test (Preview MCP): PRIO → 6 campos net + Wahoo na nota; Petrobras → 37 campos net. `tsc`/`eslint` clean.
- `2026-06-05` — **Redesign de IA: Two-Tier Tabs** (feedback do usuário; escolha consciente, não a recomendação do design panel). O toggle de 4 pills (Field/Installation/Well/Company) **substituído** por uma barra de abas primárias `[PRIO] [Petrobras] [Explore raw data]` no topo da coluna de conteúdo. **PRIO/Petrobras viram a visão principal** (landing default = PRIO, zero cliques). **Cortado o seletor dinâmico e todas as outras empresas** — novo `FIXED_COMPANIES = ['PRIO','Petrobras']`; `rpcGetAnpCdpDiariaEmpresas`/`get_anp_cdp_diaria_empresas` **não mais consumidas** (mortas no DB). Field/Installation/Well demovidos para a aba "Explore raw data" (sub-abas `[Field|Installation]` + afixo "Well-level (advanced)"; **Well a 3 cliques, desktop-only**; caption "Unweighted ANP daily feed — all operators").
- `2026-06-05` — **Company view oil-only: stacked bar mensal de óleo + remoção do chart de gás**. (1) **Removido** o chart "Net Gas (Mm³/day)" da `CompanyContent` (desktop) e o `MobileChart` de gás da `CompanyMobileContent` (mobile); a derivação `companyGasChart` foi **podada** do hook. O KPI/cell "Net Gas (avg)" e `companyTotalGasNetAvg` foram **mantidos** (número de referência; oil-only total fica trivial de obter depois). (2) **Adicionado** um stacked bar mensal **acima** do chart de linha de óleo (ordem final: KPIs → stacked bar → linha de óleo → tabela → nota): Plotly `barmode: 'stack'`, 1 trace/campo, X = meses, Y = kbpd; valor por (mês, campo) = média diária do óleo líquido sobre os dias reportados naquele mês (mesma metodologia do KPI "Net Oil avg"/`companyFieldAggregates`, bucketizada por mês). **MtD-aware**: o mês da `data` máxima vira marcador month-to-date (opacidade 0.55 + tick "Mon YYYY (MtD)" + hover "(month-to-date)") **só** se a data máxima for anterior ao fim de calendário do mês — com dados até 2026-05-31, Maio é completo → sem marcador (verificado: ticktext = "…May 2026" sem "(MtD)", opacidades = 1). Derivação nova no hook: `buildCompanyMonthlyOilByField` → `CompanyMonthlyOilByField` + builder `buildCompanyMonthlyOilStacked`; cor por campo via helpers compartilhados `orderCompanyFieldDims` + `companyFieldColorMap` (consumidos também por `buildCompanyChart`), garantindo cor idêntica nos dois charts. Binding sync: ambas as views no mesmo commit (mobile consome `companyMonthlyOilChart` do hook). Smoke test (Preview MCP, landing PRIO): gás sumiu (2 plots, era 3); stacked bar acima do de linha; **cores batem 100%** nos 6 campos (PEREGRINO=#FFAE66, FRADE=#000512, ALBACORA LESTE=#0EA5E9, TUBARÃO MARTELO=#000000, POLVO=#1D4080, PITANGOLA=#73C6A1); **cross-check (Regra F)**: barra de Maio = 160,73 kbpd === média diária de Maio da linha "Company total" (160,73 kbpd, 31 dias) — match exato; KPI "Net Oil (avg)" = 157,5 kbpd ≈ média geral da linha (157,47); totais mensais 147,95–168,61 kbpd com a média do período no meio (coerente); Maio NÃO marcado MtD. `tsc`/`eslint` clean. Commit `feat(anp-cdp-diaria): company view oil-only — add monthly stacked-bar (net oil avg by field, MtD-aware), remove gas chart`. Hook: `granularity` inicial flipado `'field'→'company'`, `selectedEmpresa` inicial `null→'PRIO'`; reset-effect de empresa condicionado a sair de company (deps `[supabase, granularity]`, sem flicker em PRIO↔Petrobras); `empresas` removido do return. Desktop: deletado `SegmentedToggle` de 4 + `CompanySelector` + branch `!selectedEmpresa`; sidebar só logo+period; filtros de nível relocados pro Explore. Mobile (binding sync, mesmo commit): deletado switch `Fields|Companies` + company picker BottomSheet; hero `[PRIO|Petrobras]` na landing + botão dashed "Explore raw data (Field, Installation) ›" abre BottomSheet 90vh com sub-abas `[Field|Installation]` (**Well e Installation-no-sheet são `[mobile-only]`**: Well não acessível, Installation sheet-gated). Export `<ExportButton>` **sempre visível** em todas as abas; export de empresa-líquida segue **P2** (modal exporta níveis Field/Installation/Well, não-WYSIWYG na aba de empresa — intencional). Smoke test (Preview MCP, desktop + mobile via forcemobile): landing cai em PRIO (157,5 kbpd, 6 fields, 1 awaiting) sem clique; Petrobras troca sem reset/RPC de nível (37 fields, 29 awaiting); Explore lazy-mounta Field (`get_anp_cdp_diaria_serie`); Installation OK; Well revelado pelo afixo (`poco_serie`, 1230 wells); back→PRIO restaura; mobile landing PRIO + sheet Field/Installation sem Well + close volta pra PRIO. `tsc`/`eslint` clean. Commit `refactor(anp-cdp-diaria): two-tier tabs IA`.
- `2026-06-05` — **Company table → daily net-oil matrix (fields × days)** (feedback do usuário: "ela deverá conter em cada coluna o nome dos campos seguido de '(stake)' e nas linhas a produção diária de petróleo por dia"). A antiga tabela "Net production by field — <Company>" (linhas = campos; colunas = Field/Basin/Stake/Net Oil avg/Net Gas avg/Latest…/Date) foi **transposta** numa matriz diária de óleo líquido: **colunas** = `Date` (1ª, sticky-left) + uma por campo `CAMPO (stake%)` (ex.: PEREGRINO (80%), FRADE (100%)…), na **mesma ordem canônica dos charts** (`orderCompanyFieldDims`); **linhas** = uma por dia, **descendente** (mais recente no topo); **célula** = net oil do campo naquele dia em **kbpd** (÷1000, 1 casa, pt-BR), dia sem dado → "—". **Oil only** (sem colunas de gás). Título "Daily net oil by field — <Company>" + caption "Net oil (kbpd), stake-weighted · one row per day"; nota de cobertura ("Not yet in the daily feed: WAHOO (100%)") mantida. **Usabilidade (Petrobras ~37 campos)**: container scroll horizontal + vertical (`overflow-x/y:auto`, `maxHeight 480`), header row **sticky-top** (z-index 2/canto 3) + coluna Date **sticky-left** (z-index 1). Derivação nova no hook (fonte única): `buildCompanyDailyOilMatrix(companySerieRows)` → `CompanyDailyOilMatrix { fields[], rows[] }` + tipos `CompanyDailyOilField` / `CompanyDailyOilMatrixRow`; exposta como `companyDailyOilMatrix`. `companyFieldAggregates` **mantida** (consumida só pelos ranking cards do mobile agora); `buildCompanyFieldAggregates` segue no hook. **`[desktop-only]`** (justificativa no commit): matriz diária larga é desktop-shaped — o `CompanyMobileContent` mantém os cards "By Field — Net" intactos (mesmo precedente da recent-records table). Smoke test (Preview MCP, eval/computed-style — screenshot trava nessa página): landing PRIO → header `Date` + 6 colunas `CAMPO (stake%)` na ordem PEREGRINO/FRADE/ALBACORA LESTE/TUBARÃO MARTELO/POLVO/PITANGOLA; 204 linhas, desc (topo 2026-05-31, base 2025-11-09). **Cross-check (Regra F)**: 1ª linha (2026-05-31) = PEREGRINO **72,5** · FRADE **53,6** · ALBACORA LESTE **21,8** · TUBARÃO MARTELO **7,6** · POLVO **6,1** · PITANGOLA **3,4** — bate 100% com os "Latest Net Oil" anteriores. Petrobras: **37** colunas de campo (todas com stake — BÚZIOS (100%), TUPI (65%), MERO (40%)…), 204 linhas, scroll horizontal real (`scrollWidth 5341 ≫ container`), Date sticky-left confirmado. Coverage note presente. `tsc`/`eslint` clean. Commit `feat(anp-cdp-diaria): company table -> daily net-oil matrix (fields x days, stake-labeled cols) [desktop-only]`.
- `2026-06-05` — **Company view: top 6 campos + "Others" (charts, tabela, ranking mobile)** (feedback do usuário: "a visão para a Petrobras deve ser 6 maiores campos e o resto é Others na tabela e nos gráficos; o detalhamento está em Explore raw data"). A visão de empresa virou um **resumo top-6**: os 6 maiores campos por net oil avg (`TOP_N_COMPANY=6`, ordenação canônica `orderCompanyFieldDims` desc) + 1 bucket **"Others (N)"** (soma do net oil dos demais; cinza neutro `#7F7F7F`, N campos colapsados, sem stake no rótulo). **Helper único no hook** (`companyDisplayBuckets` + `bucketOf` + `othersLabel`) consumido pelos **3 builders** — `buildCompanyChart` (linha: Company total + 6 + Others), `buildCompanyMonthlyOilByField`/`buildCompanyMonthlyOilStacked` (barra: 6 segmentos + Others), `buildCompanyDailyOilMatrix` (matriz: Date + 6 colunas + Others) — sem duplicar a lógica de top-6 em builder algum; os 6 + Others são idênticos por construção. Novos campos no `CompanyMonthlyOilByField` (`fullFieldOrder`, `othersBucketLabel`) p/ colorir os top6 idênticos à linha; `CompanyDailyOilField` ganhou `isOthers?`/`othersFieldNames?` (coluna Others lê grey + tooltip nativo listando os campos). Mobile (binding sync, mesmo commit): charts herdam top6+Others do hook automaticamente; ranking "By Field — Net" capeado via novo `capCompanyFieldAggregates` (top 6 + 1 card "Others (N)", sem badge de stake). **Generaliza por contagem**: ≤6 campos (PRIO=6) → SEM Others (comportamento atual intacto); >6 (Petrobras=37) → 6 + Others (31). **O rótulo de total no topo da barra permanece o total da empresa** (top6 + Others = todos). Caption opcional na matriz desktop ("…top 6 fields; rest grouped as Others (full breakdown in Explore raw data)"). Detalhe campo-a-campo: aba "Explore raw data" (sem nova affordance de drill-down). Constantes novas: `TOP_N_COMPANY`, `OTHERS_LABEL`, `OTHERS_COLOR`. Smoke test (Preview MCP, eval — screenshot trava nessa página): **PRIO** (6 campos) → NENHUM "Others" (bar 6 segmentos, linha total+6, matriz 6 colunas); rótulo de Maio **160,7 kbpd** (= soma dos 6 segmentos 160,73) — comportamento atual preservado. **Petrobras** (37) → 6 campos (BÚZIOS 100% · TUPI 65% · MERO 40% · JUBARTE 100% · ITAPU 100% · SÉPIA 100%) + **Others (31)** grey `#7F7F7F` nos 3 surfaces, cores batendo bar↔linha. **Cross-checks (Regra F)**: (a) rótulo de Maio Petrobras **2.781,9 kbpd** === soma dos 7 segmentos (2781,92) === média diária de Maio da linha "Company total" (2781,92, 31 dias) — match exato, total preservado com Others incluído; (b) coluna "Others (31)" da 1ª linha da matriz (2026-05-31) = **687,6 kbpd** === (Company total do dia 2685,7 − soma dos 6 top 1998,0 = **687,7**, dif 0,1 por arredondamento de 1 casa) — Others = soma dos 31 campos não-top daquele dia, confirmado. `tsc`/`eslint` clean. Commit `feat(anp-cdp-diaria): company view shows top 6 fields + Others (charts, table, mobile ranking)`.
- `2026-06-05` — **Company view: remoção dos KPI cards + total mensal como rótulo no topo das barras** (feedback do usuário: "retire esses cards e ponha o total no gráfico de média mensal"). (1) **Removida** a faixa de 4 KPI cards da `CompanyContent` (desktop) — o componente `KpiCard` e o uso de `.metric-card` foram **deletados do arquivo**; e as 2 células de resumo (Net Oil avg / Net Gas avg) da `CompanyMobileContent` (mobile) — o componente `SummaryCell` foi **deletado**. A nota de cobertura ("Not yet in the daily feed: WAHOO (100%)") foi **mantida** (cobre a info de "fields awaiting"). (2) **Podadas** as derivações órfãs `companyTotalOilNetAvg` / `companyTotalGasNetAvg` do hook (memo + 2 campos do return + 2 da interface) — só alimentavam os KPIs/cells; `buildCompanyTotalSeries` permanece (usada por `buildCompanyChart`). `companyFieldAggregates` e `companyFieldsNoData` **mantidos** (tabela/ranking/`explicitCount`/nota). (3) **Adicionado** o **total mensal como rótulo no topo de cada barra** do stacked bar de óleo: `buildCompanyMonthlyOilStacked` agora computa o total por mês (soma dos campos) e emite `layout.annotations` (1 por mês, `y = altura da pilha`, `yshift: 8`, `showarrow:false`, Arial, `#1a1a1a`, texto kbpd pt-BR; sem repetir "(MtD)" no rótulo). `margin.t` alargado pra 28 (desktop). Novo param `labelFontSize` (default 11). Mobile (binding sync, mesmo commit): passa as annotations do `companyMonthlyOilChart.layout` com fonte reduzida pra 10px e `margin.t` 22 (cabe 7 rótulos num chart ~260px). Smoke test (Preview MCP, eval/computed-style — screenshot trava nessa página; landing PRIO desktop): **0 `.metric-card`** e nenhum texto "Net Oil (avg)"/"Fields awaiting" (KPIs sumiram); nota de cobertura presente; 2 plots; stacked bar (plot 0) com **7 annotations** dark `#1a1a1a` size 11, uma por mês — Nov 153,7 · Dec 155,1 · Jan 154,8 · Feb 147,9 · Mar 159,7 · Apr 168,6 · **May 160,7** (`y=160.733`); `margin.t=28`; ticktext "May 2026" SEM "(MtD)" (Maio completo). **Cross-check (Regra F)**: rótulo de Maio = **160,7 kbpd** === média diária de Maio da linha "Company total" já validada (160,73 kbpd) — match exato. Mobile verificado por source (grade de 2 cells removida; annotations mapeadas do hook com size 10, linha 1081) — render runtime não forçável (UA-spoof racy no harness) mas garantido por construção: ambas as views consomem o mesmo objeto `companyMonthlyOilChart` do hook, e `MobileChart` repassa `...layout` (annotations incluídas). `tsc`/`eslint` clean. Commit `feat(anp-cdp-diaria): drop company KPI cards, label monthly total on top of stacked bars`.
