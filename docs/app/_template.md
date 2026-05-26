# Dashboard `/<slug>` — Sub-PRD

> Template canônico para sub-PRD de qualquer dashboard novo. Copie esse arquivo para `docs/app/<slug>.md`, preencha cada seção, e remova qualquer linha de **NOTA** ou parêntese tipo `(...)` ao publicar.

## Escopo

- **Slug**: `<slug-aqui>` — também o nome usado em `module_visibility.module_slug`, `useModuleVisibilityGuard("<slug>")`, e o card em `/home`.
- **Categoria NavBar**: `Oil & Gas` | `Fuel Distribution` | (especial — `Market Watch`, `News Hunter`)
- **Owner**: `worker_dash-<slug>` (`.claude/agents/worker_dash-<slug>.md`).
- **Page principal**: `src/app/(dashboard)/<slug>/page.tsx`
- **Wrappers RPC**: seção em `src/lib/rpc.ts` (linhas X–Y) — `rpcGet<Module>*`

## RPCs consumidas

(uma linha por wrapper TS chamada na page; bata com `src/lib/rpc.ts`)

| Wrapper TS | RPC PostgreSQL | Retorno (T) |
|---|---|---|
| `rpcGet<Module>Filtros` | `get_<module>_filtros()` | `{ produtos, regioes, ano_min, ano_max, ... }` |
| `rpcGet<Module>Serie` | `get_<module>_serie(p_X, p_Y, ...)` | `Array<{ ano, mes, ... }>` |
| ... | ... | ... |

## Schema da tabela alvo

Tabela: `<table_name>` (~N linhas, populada por `<pipeline_script>`).

| Coluna | Tipo | PK? | Notas |
|---|---|---|---|
| `ano` | smallint | ✓ | |
| `mes` | smallint | ✓ | |
| ... | ... | | |

**RLS**: `acesso autenticado` (SELECT TO authenticated USING (true)) — padrão Phase 3.

**Índices relevantes**: `idx_<...>_periodo`, `idx_<...>_<filtro>`, ...

## Pipeline de origem

- **Script**: `scripts/pipelines/<path>/<script>.py`
- **Workflow**: `.github/workflows/<workflow>.yml`
- **Schedule**: `<cron>` (UTC) — exemplo: `0 13 1 * *` (mensal dia 1° 13:00 UTC)
- **Última execução validada**: (data + linhas inseridas/atualizadas)
- **Atenção operacional**: (ex: bloqueio Cloudflare, requer Selenium, depende de CAPTCHA, etc.)

## Filtros UI

(componentes de `src/components/dashboard/` usados — diga qual)

- **Período**: `<PeriodSlider>` em modo `years` | `dates`
- **Multi-select X**: `<MultiSelectFilter>` com `swatch={...}` opcional
- **Toggle Y**: `<SegmentedToggle>` em variant `full` | `compact`
- **(outros filtros específicos do dashboard)**

## Charts esperados

(uma linha por chart visível na página)

| Chart | Tipo Plotly | Source RPC | Notas |
|---|---|---|---|
| Série mensal por X | line | `get_<module>_serie` | unidade Y, divisor Z, label "..." |
| Top 15 países | bar (h) | `get_<module>_top_paises` | ... |
| ... | | | |

**Coerência unidade↔label**: documente o divisor matemático e o label do eixo. Caso real histórico: o antigo `/anp-daie` (substituído por `/imports-exports` em 2026-05-25) tinha `volume_m3 / 1e6` com label "mil m³" — bug 1000×. Padrão correto: `kg → mil ton` é `/1e6`; `m³ → mil m³` é `/1e3`. Use helpers de `src/lib/units.ts` quando disponível.

## Padrões consolidados aplicados

(checklist — confirme antes de chamar dashboard de "pronto")

- [ ] Header: `<DashboardHeader title sub period>` com `<hr>` separator
- [ ] Period badge: condicional ao `hasYears`/`hasDates` (sem renderizar quando vazio)
- [ ] Push período para RPC server-side (não filtrar série inteira no client)
- [ ] Debounce 400ms via `useDebouncedFetch` ou padrão `useCallback + useRef + setTimeout`
- [ ] Loading: `<BarrelLoading>` no init; `serieLoading` inline "atualizando…" + `opacity: 0.5` durante refetch
- [ ] Filtros multi-select: `<MultiSelectFilter>` com Limpar + counter `(N/total)`
- [ ] `yearTuple = useMemo<[number, number]>` ref-stable para deps de hooks
- [ ] Empty state amigável quando tabela vazia ou filtros sem opções
- [ ] Error boundary para falhas de RPC (`<DataErrorBoundary>` ou `useRpcResult`)
- [ ] Identidade visual: `#ff5000`, Arial, liquid glass — `docs/design/identity.md`
- [ ] pt-BR consistente (a menos que dashboard seja em inglês — explicar motivo)
- [ ] Locale-aware capitalize (`toLocaleLowerCase("pt-BR")`) para nomes acentuados

## Definition of Done

(critérios mandatórios antes do CTO mergear)

1. **`npx tsc --noEmit` clean** — zero erros (warnings de `<img>` pré-existentes podem ser tolerados).
2. **`npx eslint src/app/(dashboard)/<slug>` clean** — só warnings pré-existentes.
3. **Smoke test em dev server** (`preview_start` + `preview_screenshot`):
   - Página carrega sem erros no console
   - Filtros populam com options reais (não vazio)
   - Pelo menos 1 chart renderiza com dados (após selecionar 1 filtro)
   - Period slider mostra range correto
4. **Self-QA estática**: comparado com 2 dashboards maduros (`/anp-cdp` e `/market-share`); padrões consolidados batem.
5. **Sub-PRD (este arquivo)** atualizado se o dashboard ganhou nova RPC/coluna/chart.

## Dependências cross-departamentais

- **Schema/RPCs (`worker_supabase`)**: criou tabela + N RPCs em `supabase/migrations/<version>_<name>.sql`. Versão validada e aplicada em prod.
- **Pipeline ETL (`worker_etl-pipelines`)**: `scripts/pipelines/<...>` schedule `<cron>`. Tabela populada com N linhas.
- **Admin (`worker_dash-admin`)**: slug em `module_visibility`; card em `/home`; toggle em `/admin-panel`.

## Anti-padrões / decisões técnicas

(documente o que evitou e por quê — útil pra futuros refactors saberem que não foi por preguiça)

- **Não usa componente compartilhado X**: motivo (ex: layout muito específico, drift visual aceitável).
- **Mantém estado local em vez de URL params**: motivo.
- **Filtragem 100% client-side**: motivo (ex: tabela < 1k linhas, latência irrelevante).

## Performance

- Tamanho médio da resposta da RPC principal: (linhas / KB)
- p95 de tempo de carregamento inicial: (medir)
- Quando o usuário muda filtros: re-fetch ou client-side?

## Histórico

- `YYYY-MM-DD` — Implementação inicial (commit `<hash>`)
- `YYYY-MM-DD` — Refactor para padrão consolidado (commit `<hash>`)
- ...
