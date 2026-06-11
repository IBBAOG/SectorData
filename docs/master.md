# PRD Mestre — dashboard_projeto

Plataforma analítica interna do Itaú BBA para o setor de Distribuição de Combustíveis e Petróleo & Gás no Brasil. Este documento descreve **a empresa-projeto** — sua estrutura organizacional (agentes), seus contratos cross-departamentais e suas convenções gerais.

> **Para detalhes técnicos do produto** (stack, módulos, schema, pipelines), veja `README.md` na raiz e os PRDs por departamento em `docs/<dept>/PRD.md`.

---

## ⚠️ Princípio organizacional inviolável

**Toda tarefa de execução técnica é feita por um worker especializado, nunca pelo CTO.**

Isso vale para: aplicar migrations, editar código de domínio (`src/`, `scripts/`, `alertas/`, `supabase/`, `data/`), copiar arquivos entre worktrees, sincronizar `schema_migrations`, rodar pipelines locais, atualizar PRDs departamentais, disparar workflows GHA, etc. **Sem exceção.**

Se uma tarefa não tem worker qualificado, a resposta correta é **contratar um worker novo** (ver "Protocolo formal de contratação de novo worker" abaixo). Improvisar com "permissão excepcional" para um worker fora do domínio, ou pior, executar como CTO, são anti-patterns explicitamente proibidos no `CLAUDE.md`.

O CTO faz: pensar, delegar, integrar via `worker_orquestrador`, autorizar commits/push, contratar workers novos quando há gap, manter este `master.md` e o `CLAUDE.md` em dia. Nada além disso.

---

## Organograma

```
CEO (Eduardo)
 └─ CTO/COO  (Claude — direção, decisões estratégicas, fala apenas com o CEO)
     │
     ├─ Gerente Geral  ←──colabora──→  Documentador
     │  (rota tarefas)                  (escreve docs cross-dept)
     │
     ├─ Subgerente APP   (entry point pra qualquer coisa do produto web)
     │   ├─ dash-market-share             (/market-share — % Share ↔ thousand m³ toggle; absorveu /sales-volumes em 2026-05-26)
     │   ├─ dash-navios-diesel            (/navios-diesel + sub-páginas futuras)
     │   ├─ dash-margins                  (/diesel-gasoline-margins)
     │   ├─ dash-price-bands              (/price-bands)
     │   ├─ dash-stocks                   (/stocks + Yahoo proxy + components/stocks/)
     │   ├─ dash-news-hunter              (/news-hunter — coord. com repo scanner)
     │   ├─ dash-admin                    (/home + /profile + /admin-panel)
     │   ├─ dash-anp-cdp                  (/anp-cdp — Oil & Gas)
     │   ├─ dash-anp-cdp-bsw             (/anp-cdp-bsw — Oil & Gas)
     │   ├─ dash-anp-cdp-depletion       (/anp-cdp-depletion — Oil & Gas)
     │   ├─ dash-anp-glp                  (/anp-glp — Fuel Distribution)
     │   ├─ dash-anp-prices               (/anp-prices — Fuel Distribution; consolida /anp-precos-produtores + /anp-precos-distribuicao + /anp-lpc em 2026-05-26)
     │   ├─ dash-imports-exports          (/imports-exports — Fuel Distribution; substitui /anp-daie + /anp-desembaracos + /anp-painel-importacoes; absorveu /mdic-comex em 2026-05-25 — originalmente via Panel C "Import Price", removido em 2026-05-28; MDIC agora alimenta Panel D + Import/Export Price Summary)
     │   ├─ dash-anp-cdp-diaria          (/anp-cdp-diaria — Oil & Gas)
     │   ├─ dash-subsidy-tracker          (/subsidy-tracker — Fuel Distribution, dados proprietários)
     │   ├─ dash-stock-guide              (/stock-guide — Oil & Gas / Equities; comps + sensibilidade, mkt cap/upside/múltiplos derivados live via Yahoo proxy; Client+Admin)
     │   ├─ dash-admin-analytics          (/admin-analytics — Admin-only, sem module_visibility)
     │   └─ dash-alerts                   (/alerts — User-Facing Email Subscriptions, anon+client+admin)
     │
     ├─ Supabase / DB    (schema Postgres, migrations, RLS, RPCs SQL,
     │                    materialized views, supabase_deploy workflow)
     ├─ Dados Locais     (Excels manuais + scripts de upload)
     ├─ ETL / Pipelines  (scrapers automáticos + GitHub Actions)
     ├─ Alertas          (subsistema autocontido em alertas/ — LOCAL-ONLY,
     │                    single-recipient Eduardo via Gmail API; coexiste com
     │                    Client Alerts)
     ├─ Client Alerts    (cloud, só-logado — REBUILD 2026-06-02; scripts/client_alerts/,
     │                    event-driven via hook no fim de cada ETL + digest diário,
     │                    delivery via Gmail SMTP, consumido por /alerts. Substituiu
     │                    o produto antigo anon/double-opt-in/Resend, deletado)
     │
     ├─ Designer         (transversal — identidade visual + boas práticas;
     │                    dono do skill .claude/skills/design-standards/
     │                    — fonte única de charts/tabelas/cores;
     │                    consultado pelos dash-* antes de mudança visual)
     │
     └─ Revisor / QA     (transversal — audita diff antes do commit)
```

## 📱 Dual-view (web + mobile) — princípio cross-cutting

A partir de 2026-05-20, todo dashboard tem 2 views (`desktop/View.tsx` + `mobile/View.tsx`) consumindo um hook compartilhado `use<Slug>Data.ts`. Mobile = mesma análise, roupagem adaptada. **Regra de sync binding**: edição em uma view exige equivalente na outra no mesmo commit, ou tag explícita `[desktop-only]` / `[mobile-only]` na mensagem. Vide `CLAUDE.md` § "Dual-view (web + mobile) policy" e `docs/app/PRD.md` § "Dual-view foundation".

### Mobile reform 2026-05-27 (refinamento do princípio)

Reforma cross-cutting (Ondas 1–3, range `fac9e522..4ccca2b8`, ~30 commits) que firmou as seguintes políticas, todas detalhadas em `docs/app/PRD.md` § "Mobile reform 2026-05-27 — light-only paradigm":

- **Mobile é light-only** — sem dark mode; tokens `--mobile-*` em `globals.css` purgados de variantes dark.
- **Single floating Home pill** (`MobileHomePill`) substitui o tab bar de 4 ícones original.
- **Kebab menu top-right** (`MobileKebabMenu`) é a única superfície de logout no mobile; rota `/profile` excluída do mobile.
- **`(dashboard)/layout.tsx` é o switcher** — `DesktopShell` vs `MobileShell` via `useIsMobile()`. NavBar desktop é `hidden` em mobile.
- **Export é desktop-only** — `ExportFAB` não é montado em nenhum mobile View pós-reforma.
- **`MobileExcludedRedirect` pattern** — rotas excluídas montam o componente em `page.tsx` (`MobileExcludedRedirect` + `DesktopView` lado a lado); o redirect roda só no client mobile.
- **`app-toast` event channel** — `window.dispatchEvent(new CustomEvent("app-toast", ...))` capturado por `MobileToastHost` (global, mounted em `MobileShell`).
- **Last-visited memory** (`useTrackLastVisited`) — FIFO localStorage `sd_last_visited` (cap 4), consumido pela `/home v2` mobile.

**Cobertura mobile (estado atual):**

| Status | Rotas |
|---|---|
| **Mobile-eligible (14)** | `/home`, `/well-by-well`, `/stock-guide`, `/anp-cdp-bsw`, `/anp-cdp-depletion`, `/anp-cdp-diaria`, `/market-share`, `/anp-glp`, `/price-bands`, `/subsidy-tracker`, `/diesel-gasoline-margins`, `/imports-exports`, `/navios-diesel`, `/alerts` (dual-view desde o rebuild 2026-06-02) |
| **Mobile-excluded / desktop-only (7)** | `/stocks`, `/admin-panel`, `/admin-analytics`, `/news-hunter`, `/profile`, `/anp-cdp`, `/anp-prices` |

## Departamentos

| Dept | Slug do agente | Ownership de pastas | PRD |
|---|---|---|---|
| APP (Subgerente) | [`worker_subgerente-app`](../.claude/agents/worker_subgerente-app.md) | `src/` (infra compartilhada), `public/`, `.vercel/`, configs Next/TS | [`docs/app/PRD.md`](app/PRD.md) |
| Supabase / DB | [`worker_supabase`](../.claude/agents/worker_supabase.md) | `supabase/migrations/`, `supabase/config.toml`, `sql/` (legado), `supabase_deploy.yml` | [`docs/supabase/PRD.md`](supabase/PRD.md) |
| Dados Locais | [`worker_dados-locais`](../.claude/agents/worker_dados-locais.md) | `data/`, `scripts/manual/price_bands_upload.py`, `scripts/manual/field_stakes_upload.py` (`dg_margins_upload.py` retirado 2026-06-05 — `d_g_margins` migrou para ETL computado, dono `worker_etl-pipelines`) | [`docs/dados-locais/PRD.md`](dados-locais/PRD.md) |
| ETL / Pipelines | [`worker_etl-pipelines`](../.claude/agents/worker_etl-pipelines.md) | `DADOS/`, `output/`, `scripts/pipelines/` (todos os scrapers), `.github/workflows/` dos scrapers | [`docs/etl-pipelines/PRD.md`](etl-pipelines/PRD.md) |
| Alertas (legado, local-only — **RETIRED** 2026-06: `alertas_monitor.yml` desabilitado; capacidades re-homed em `freshness_monitor.yml` + `workflow_failure_monitor.yml`) | [`worker_alertas`](../.claude/agents/worker_alertas.md) | `alertas/` (autocontido, gitignored) | [`docs/alertas/PRD.md`](alertas/PRD.md) |
| Client Alerts (cloud, só-logado — rebuild 2026-06-02) | [`worker_alerts-product`](../.claude/agents/worker_alerts-product.md) | `scripts/client_alerts/`, `.github/workflows/client_alerts_digest.yml` + hook step nos ~15 ETLs, email templates. (Produto antigo `scripts/alerts/` + `alerts_*.yml` deletado.) Delivery via Gmail SMTP (`GMAIL_APP_PASSWORD`). | [`docs/app/alerts.md`](app/alerts.md) + [`docs/etl-pipelines/PRD.md`](etl-pipelines/PRD.md) § "Client Alerts" |
| Security | [`worker_pen-test`](../.claude/agents/worker_pen-test.md) (a contratar) | `docs/security/` — threat model, incident response, secret rotation, pen-test reports | [`docs/security/README.md`](security/README.md) |

## Sub-agentes do APP (donos de dashboard)

Cada um possui um módulo (ou bundle, no caso de admin). Cada um auto-documenta seu sub-PRD em `docs/app/<slug>.md`.

| Slug | Cobertura | Sub-PRD |
|---|---|---|
| [`worker_dash-market-share`](../.claude/agents/worker_dash-market-share.md) | `/market-share` (absorveu `/sales-volumes` em 2026-05-26 — expõe % Share ↔ thousand m³ via toggle top-level; `/sales-volumes` agora 301-redireciona para `/market-share?unit=volume`) | [`docs/app/market-share.md`](app/market-share.md) |
| [`worker_dash-navios-diesel`](../.claude/agents/worker_dash-navios-diesel.md) | `/navios-diesel` (+ sub-páginas) | [`docs/app/navios-diesel.md`](app/navios-diesel.md) |
| [`worker_dash-margins`](../.claude/agents/worker_dash-margins.md) | `/diesel-gasoline-margins` | [`docs/app/diesel-gasoline-margins.md`](app/diesel-gasoline-margins.md) |
| [`worker_dash-price-bands`](../.claude/agents/worker_dash-price-bands.md) | `/price-bands` | [`docs/app/price-bands.md`](app/price-bands.md) |
| [`worker_dash-stocks`](../.claude/agents/worker_dash-stocks.md) | `/stocks` + Yahoo proxy + `components/stocks/` | [`docs/app/stocks.md`](app/stocks.md) |
| [`worker_dash-news-hunter`](../.claude/agents/worker_dash-news-hunter.md) | `/news-hunter` (coord. com repo scanner); Admin-only clipping: selects articles → `POST /api/clipping/scrape` → .eml download + HTML preview | [`docs/app/news-hunter.md`](app/news-hunter.md) |
| [`worker_dash-admin`](../.claude/agents/worker_dash-admin.md) | `/home` + `/profile` + `/admin-panel` | [`docs/app/admin.md`](app/admin.md) |
| [`worker_dash-anp-cdp`](../.claude/agents/worker_dash-anp-cdp.md) | `/anp-cdp` (Label "Monthly Production" desde 2026-05-28 Round 5; era "Production by Well") | [`docs/app/anp-cdp.md`](app/anp-cdp.md) |
| [`worker_dash-anp-cdp-bsw`](../.claude/agents/worker_dash-anp-cdp-bsw.md) | `/anp-cdp-bsw` (Oil & Gas) | [`docs/app/anp-cdp-bsw.md`](app/anp-cdp-bsw.md) |
| [`worker_dash-anp-cdp-depletion`](../.claude/agents/worker_dash-anp-cdp-depletion.md) | `/anp-cdp-depletion` (Oil & Gas) | [`docs/app/anp-cdp-depletion.md`](app/anp-cdp-depletion.md) |
| [`worker_dash-anp-glp`](../.claude/agents/worker_dash-anp-glp.md) | `/anp-glp` | [`docs/app/anp-glp.md`](app/anp-glp.md) |
| [`worker_dash-anp-prices`](../.claude/agents/worker_dash-anp-prices.md) | `/anp-prices` (substitui `/anp-precos-produtores` + `/anp-precos-distribuicao` + `/anp-lpc` retirados em 2026-05-26; UNION ALL server-side das 3 tabelas com normalização de produto/unidade/região, fallback Diesel S10→S500, GLP normalizado para R$/13kg) | [`docs/app/anp-prices.md`](app/anp-prices.md) |
| [`worker_dash-imports-exports`](../.claude/agents/worker_dash-imports-exports.md) | `/imports-exports` (substitui `/anp-daie` + `/anp-desembaracos` + `/anp-painel-importacoes`; importações por país via `mdic_comex`/ComexStat — publica o mês M semanas antes da ANP — e por importador via `anp_desembaracos` enriquecida — única fonte com CNPJ; exportações via `mdic_comex`) | [`docs/app/imports-exports.md`](app/imports-exports.md) |
| [`worker_dash-anp-cdp-diaria`](../.claude/agents/worker_dash-anp-cdp-diaria.md) | `/anp-cdp-diaria` | [`docs/app/anp-cdp-diaria.md`](app/anp-cdp-diaria.md) |
| [`worker_dash-subsidy-tracker`](../.claude/agents/worker_dash-subsidy-tracker.md) | `/subsidy-tracker` (Fuel Distribution — dados proprietários) | [`docs/app/subsidy-tracker.md`](app/subsidy-tracker.md) |
| [`worker_dash-stock-guide`](../.claude/agents/worker_dash-stock-guide.md) | `/stock-guide` (Oil & Gas / Equities — comps + sensibilidade 2D por empresa; mkt cap/upside/múltiplos computados live via Yahoo proxy a partir de fundamentos armazenados; admin-curated, hide-aware; Client + Admin) | [`docs/app/stock-guide.md`](app/stock-guide.md) |
| [`worker_dash-admin-analytics`](../.claude/agents/worker_dash-admin-analytics.md) | `/admin-analytics` (Admin-only — sem `module_visibility`; backed por `app_events`) | [`docs/app/admin-analytics.md`](app/admin-analytics.md) |
| [`worker_dash-alerts`](../.claude/agents/worker_dash-alerts.md) | `/alerts` (Email Subscriptions — **só-logado** desde o rebuild 2026-06-02; toggle de base = inscrição, sem anon/double-opt-in; cadência read-only por source; dual-view; backend event-driven via `worker_alerts-product` + Gmail SMTP) | [`docs/app/alerts.md`](app/alerts.md) |

## Papéis transversais (não donos de pasta)

| Papel | Slug | Quando entra |
|---|---|---|
| Gerente Geral | [`worker_gerente-geral`](../.claude/agents/worker_gerente-geral.md) | Início de qualquer tarefa nova ou ambígua. Roteia para o(s) dept(s) corretos. |
| Documentador | [`worker_documentador`](../.claude/agents/worker_documentador.md) | Após qualquer mudança que altere contrato cross-dept. Mantém `master.md` + PRDs de departamento. (Sub-PRDs por dashboard são auto-mantidos pelo `dash-*` correspondente.) |
| Designer | [`worker_designer`](../.claude/agents/worker_designer.md) | Antes de qualquer mudança visual ou em `globals.css`. **Dono do skill canônico [`.claude/skills/design-standards/`](../.claude/skills/design-standards/SKILL.md)** — fonte única da verdade para charts, tabelas e cores (paleta oficial fechada desde 2026-06-10). Todo worker que gera decisão de chart/tabela/cor lê o skill primeiro. Mantém também [`docs/design/identity.md`](design/identity.md) (tokens mobile + componentes CSS) e [`docs/design/best-practices.md`](design/best-practices.md). |
| Revisor / QA | [`worker_revisor-qa`](../.claude/agents/worker_revisor-qa.md) | Antes do commit, sobre o diff staged. Aplica checklist de segurança, contratos e simplicidade. |
| Orquestrador | [`worker_orquestrador`](../.claude/agents/worker_orquestrador.md) | Após múltiplos workers finalizarem em worktrees paralelas. Mergeia N branches em main, sincroniza `schema_migrations.version`, valida tsc/lint, push, cleanup das worktrees. Único responsável por "merge ≥2 worktrees". |

---

## Contratos cross-departamentais

São os pontos onde um departamento depende de outro. Mudanças nestes contratos **sempre** envolvem o Gerente + Documentador.

### Schema do Supabase

**Dono:** dept **Supabase / DB** (peer dos demais; não pertence ao APP). Migrations vivem em `supabase/migrations/`.

| Quem consome | Como |
|---|---|
| APP | Lê via supabase-js (anon key) chamando RPCs. Wrappers em `src/lib/rpc.ts` (este código é do APP, mas as RPCs em si pertencem ao Supabase). Também **escreve** `app_events` via RPC `track_event` (fire-and-forget, auth.uid() capturado no SQL). |
| ETL | Escreve via supabase-py (service key) — popula `vendas`, `navios_diesel`, `news_articles`, `mdic_comex`, `anp_precos_produtores`, `anp_glp`, `anp_daie`, `anp_desembaracos` (enriquecida com `importador`, `cnpj`, `uf_cnpj`), `anp_lpc`, `anp_cdp_producao`, `anp_precos_distribuicao`, `anp_cdp_diaria`, `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco`, `anp_voip`, `anp_subsidy_diesel_reference`, `anp_subsidy_commercialization` (HTML scrape stage adicionado em 2026-05-27), `cepea_etanol_anidro`, `anp_producao_derivados` (D&G Margins automation, 2026-06-05) e (computado via RPC `recompute_dg_margins`) `d_g_margins`. `anp_subsidy_caps`, `fuel_tax_reference`, `fuel_blend_ratio` são mantidas manualmente (cardinalidade muito baixa). |
| Dados Locais | Escreve via supabase-py (service key) — popula `price_bands` (`d_g_margins` migrou para ETL computado em 2026-06-05) |
| Alertas | Lê via supabase-py — verifica mudanças em fontes monitoradas |

**Tabela de eventos de uso (`app_events`):** criada pela feature Admin Analytics. Ingestão exclusivamente via RPC `track_event(event_type, route, payload, visitor_id)` — o SQL captura `auth.uid()` internamente; INSERT direto do frontend é bloqueado por RLS. SELECT restrito a Admin via RLS. Admins são excluídos dos agregados pelo filtro `role <> 'Admin'` dentro das RPCs read. **Dual-actor:** desde `20260522000001`, `app_events.user_id` é nullable; nova coluna `visitor_id TEXT` cobre visitantes anônimos. CHECK `(user_id IS NOT NULL OR visitor_id IS NOT NULL)` garante atribuição. Analytics RPCs usam `COUNT(DISTINCT COALESCE(user_id::text, visitor_id))` para contar atores únicos atravessando ambos os tiers.

| RPC de ingestion | Chamado por |
|---|---|
| `track_event(p_event_type, p_route, p_payload, p_visitor_id)` | `(dashboard)/layout.tsx` (login, page_view) + `ExportPanel` / `ExportModal` (export). 4o param `p_visitor_id` é opcional (NULL para usuários autenticados); `GRANT EXECUTE TO anon, authenticated` |

| RPC Admin read-only | Retorna |
|---|---|
| `get_analytics_kpis(period)` | DAU/WAU/MAU, total users, active users, exports, page views, logins + `unique_visitors_period` (anônimos) + `unique_authenticated_period` |
| `get_analytics_by_dashboard(period)` | Engajamento agregado por rota |
| `get_analytics_by_user(period)` | Engajamento por usuário (autenticado; visitantes não aparecem aqui por design) |
| `get_analytics_user_timeline(user_id, period)` | Timeline de eventos de um usuário específico |
| `get_analytics_heatmap(period)` | Matriz dia-da-semana × hora (inclui anônimos) |
| `get_analytics_anon_summary(p_period_days)` | `(unique_visitors, total_page_views, top_routes JSONB)` — usado pela seção "Anonymous Activity" em `/admin-analytics` |

**Contrato `module_visibility` (APP ↔ Supabase):**

| RPC | Assinatura | Consumidor |
|---|---|---|
| `get_module_visibility` | `() → (module_slug, is_visible_for_clients, is_visible_on_home, is_visible_for_public)` | `UserProfileContext` — carregado no mount, callable por `anon` + `authenticated` |
| `set_module_visibility` | `(p_slug, p_is_visible)` | Admin Panel → aba Permissions (coluna "Clients") |
| `set_module_home_visibility` | `(p_slug, p_is_visible)` | Admin Panel → aba Card Images (Show on Home toggle) |
| `set_module_public_visibility` | `(p_slug, p_is_visible)` | Admin Panel → aba Permissions (coluna "Public"). Admin-only via `require_admin_mfa()` |

`is_visible_for_clients`: controla acesso do role Client ao módulo. Admin sempre acessa.
`is_visible_on_home`: controla exibição do card na galeria `/home` para TODOS os usuários (inclusive Admin). Default `true`.
`is_visible_for_public`: controla acesso anônimo (sem sessão) ao módulo. Default `true`. **Invariante:** `is_visible_for_public=true` implica `is_visible_for_clients=true` (CHECK + BEFORE trigger `trg_module_visibility_public_implies_clients` coerce automaticamente).

**Contrato `get_data_sources_freshness` (APP ↔ Supabase, adicionado 2026-05-26):**

RPC pública usada pela tabela live "Data Sources" da `/home` (desktop, split 50/50 — mobile mantém só cards). Retorna `(source_key text, last_update timestamptz, row_count bigint)` para 22 tabelas alimentadas por ETL (CDP diária × 3 níveis, CDP mensal, VOIP, vendas, produtores, GLP, LPC, distribuição, subsídio referência + histórico, MDIC, DAIE, desembaraços, navios, vessel_positions, port_arrivals, import_candidates, d_g_margins, price_bands, news_articles). `LANGUAGE sql STABLE SECURITY DEFINER` + `SET search_path = public, pg_temp`. `GRANT EXECUTE TO anon, authenticated`. Visível para Anon + Client + Admin (transparência do produto). Migration: `supabase/migrations/20260526200000_data_sources_freshness.sql`. Source-of-truth de curadoria (descrições, categorias, cron, dashboards consumidores) vive em `src/data/dataSources.ts` (23 entries — 22 + Yahoo Finance, que não tem tabela Supabase). Hook front: `useDataSourcesFreshness` (polling 60s) consumindo wrapper `rpcGetDataSourcesFreshness` em `src/lib/rpc.ts`. Detalhes de UI + lista completa de fontes em [`docs/app/admin.md`](app/admin.md) § "Data Sources live table".

**Contrato Reforma de Subsídio do Diesel (APP ↔ Supabase ↔ ETL, 2026-05-27):**

Migration `supabase/migrations/20260527200000_subsidy_reform.sql` (+ hotfix `20260527300000_data_sources_freshness_subsidy_fix.sql`). Substitui a fórmula errada anterior (que tratava `anp_subsidy_history.subsidio_brl_l` como diferença) pela mecânica real: o subsídio é um **teto** (`cap_brl_l`), e o reembolso por região é `MIN(MAX(ref_diária − comm_período, 0), cap_agente_vigente)`, depois agregado pela média das 5 regiões. Duas trilhas de agente coexistem (`importador` e `produtor`) com caps independentes desde 2026-04-07.

| Objeto | Mudança |
|---|---|
| `anp_subsidy_history` | **DROPADA** (`DROP TABLE ... CASCADE`). |
| `anp_subsidy_caps` | Tabela nova. PK `(vigente_desde, tipo_agente)`. Colunas: `cap_brl_l NUMERIC(10,4)`, `observacao`, `inserted_at`. Seed: 4 rows (2026-03-13 unificado em 0.32 + 2026-04-07 split `importador=1.52`/`produtor=1.12`). Mantida manualmente. |
| `anp_subsidy_commercialization` | Tabela nova. PK `(data_inicio, regiao, tipo_agente)`. Colunas: `data_fim`, `preco_comercializacao`, `ordinal`, `pdf_url`, `inserted_at`. Populada pelo stage HTML novo de `scripts/pipelines/anp/subsidy_diesel_sync.py`. RLS read-open para anon/authenticated; writes via service-role. |
| `compute_subsidy_reimbursement(date, tipo_agente)` | RPC interna `LANGUAGE sql STABLE SECURITY DEFINER` + `SET search_path = public, pg_temp`. **Desde 2026-06-01 (migration `20260613000000`, que supersede `20260608200000`) retorna valor FIXO `1.47` BRL/L (subsídio efetivo) para ambos os agentes — `1.12` da subvenção (MP 1.363) + `0.35` compensando o corte de refinaria da Petrobras / reativação de PIS-COFINS, mantendo a Petrobras inteira (3,30 + 1,47 = 4,77 = pré-reforma); para datas anteriores cai na fórmula histórica** AVG das 5 regiões de `MIN(MAX(ref − comm, 0), cap)`, ou NULL se faltar input. Granted to anon + authenticated. |
| 4 triggers em `price_bands` | (a) `populate_pb_w_subsidy_on_insert` BEFORE INSERT/UPDATE OF (date, product, bba_import_parity, petrobras_price) em `price_bands` para rows de Diesel — preenche `bba_import_parity_w_subsidy` e `petrobras_price_w_subsidy`. (b) `recompute_pb_on_reference_change` AFTER em `anp_subsidy_diesel_reference`. (c) `recompute_pb_on_comm_change` AFTER em `anp_subsidy_commercialization`. (d) `recompute_pb_on_caps_change` AFTER em `anp_subsidy_caps`. Os 3 AFTER refrescam os rows afetados em `price_bands` via self-UPDATE para re-disparar a BEFORE. |
| `get_subsidy_tracker_diesel()` | **REWRITE** (DROP+CREATE). Nova signature retorna 11 colunas: `date`, `ipp`, `ipp_adjusted`, `petrobras`, `petrobras_adjusted`, `anp_reference_importador`, `anp_reference_produtor`, `anp_commercialization_importador`, `anp_commercialization_produtor`, `regions_importador JSONB`, `regions_produtor JSONB`. Sufixos `_importador`/`_produtor` carregam as duas trilhas. `ipp_adjusted = ipp − reimb_importador`; `petrobras_adjusted = petrobras + reimb_produtor`. SECURITY DEFINER + `search_path = public, pg_temp` + GRANT anon + authenticated. |
| `get_data_sources_freshness()` | **Hotfix** (`20260527300000_data_sources_freshness_subsidy_fix.sql`). DROP+CREATE — removeu branch de `anp_subsidy_history` (DROPADA na reforma) e adicionou branches `anp_subsidy_caps` e `anp_subsidy_commercialization` (ambos por `MAX(inserted_at)`). Total: **23 sources** (era 22 pré-fix). |

**Quem consome o quê:**

| Dashboard | RPC | Comportamento |
|---|---|---|
| `/subsidy-tracker` | `get_subsidy_tracker_diesel` | 4 traces por grid. Grid Importador: IPP, IPP_adjusted (dashed), ANP Reference (importador), ANP Commercialization (importador). Grid Produtor: Petrobras, Petrobras_adjusted (dashed), ANP Reference (produtor), ANP Commercialization (produtor). |
| `/price-bands` | `get_price_bands_data` | Agora exibe trace `Petrobras Price w/ subsidy` (antes reservado). `BBA - Import Parity w/ subsidy` mantida. Ambas são auto-populadas pelos triggers — não vêm mais do upload Excel. |
| `/admin-panel` Data Input → Price Bands | (form CRUD) | Form Diesel simplificado: 4 colunas (Date, BBA Import Parity, BBA Export Parity, Petrobras Price). Sem as 2 colunas `_w_subsidy`. |
| `/home` Data Sources live table | `get_data_sources_freshness` | Catálogo `src/data/dataSources.ts` perdeu entry `anp_subsidy_history`, ganhou `anp_subsidy_caps` + `anp_subsidy_commercialization`. |

**Contrato `news_hunter_default_keywords` (APP ↔ Supabase):**

Tabela compartilhada entre dash-news-hunter (read pelo seed automático em `seed_my_news_hunter_keywords()` e por `get_default_news_keywords()` para anônimos) e dash-admin (write via Admin Panel). RLS é read-only para `anon` + `authenticated`; toda escrita atravessa SECURITY DEFINER (sem policies INSERT/DELETE).

Schema: `(keyword text PK, match_type text NOT NULL DEFAULT 'substring' CHECK IN ('substring','exact'), created_at timestamptz)`. Coluna `match_type` adicionada em `20260525250000` — schema simétrico com `news_hunter_keywords` (per-user, que tem essa coluna desde `20260520000001`). Semantics: `substring` (case-insensitive substring, default/legacy) | `exact` (case-insensitive whole-word, regex `\b{keyword}\b`).

| RPC | Assinatura | Consumidor |
|---|---|---|
| `get_default_news_keywords` | `() → TEXT[]` | `/news-hunter` (anon-safe seed) — callable por `anon` + `authenticated`. **Inalterada** por retrocompat (consumida por `NewsHunterContext.tsx`) |
| `get_default_news_keywords_with_flags` | `() → TABLE(keyword text, match_type text)` | Scanner repo (`IBBAOG/news-hunter-scanner`) + futuros consumidores que precisam de matching per-keyword. Callable por `anon` + `authenticated` |
| `admin_list_default_news_keywords` | `() → TABLE(keyword text, match_type text, created_at timestamptz)` | Admin Panel → seção "Default News Keywords". Admin-only via `is_admin()` + `require_admin_mfa()`. **3 colunas** (era 2 antes de `20260525250000`) |
| `admin_add_default_news_keyword` | `(p_keyword text, p_match_type text DEFAULT 'substring') → void` | Admin Panel — idempotente (`ON CONFLICT DO NOTHING`), trim + reject empty, valida CHECK `match_type IN ('substring','exact')`, audit em `app_events` (event_type `admin.add_default_news_keyword`, payload inclui `match_type`). **2 params** (era 1 antes de `20260525250000`) |
| `admin_set_default_news_keyword_match_type` | `(p_keyword text, p_match_type text) → void` | Admin Panel — UPDATE idempotente, audit em `app_events` (event_type `admin.set_default_news_keyword_match_type`). **Nova** em `20260525250000` |
| `admin_remove_default_news_keyword` | `(p_keyword text) → void` | Admin Panel — idempotente, audit em `app_events` (event_type `admin.remove_default_news_keyword`) |

**Contrato `field_stakes` (APP ↔ Supabase, adicionado 2026-05-26 — Fase 1 de Field Stakes & Production):**

Tabela admin-curated `field_stakes(campo, empresa, stake_pct)` registra a participação societária (working interest) por campo de petróleo × empresa. Usada para estimar produção atribuível por companhia (ex.: Petrobras detém 88.99% de Búzios). Schema: `(campo text, empresa text, stake_pct numeric(6,3) CHECK >0 AND <=100, updated_at timestamptz, updated_by uuid REFERENCES auth.users, PK (campo, empresa))`. RLS: SELECT aberto a `anon` + `authenticated`; sem policies INSERT/UPDATE/DELETE — writes exclusivamente via RPCs SECURITY DEFINER gated por `is_admin()`. Migration: `supabase/migrations/20260527600000_field_stakes.sql`. CRUD UI vive em nova seção do `/admin-panel` (Field Stakes — owner `worker_dash-admin`).

| RPC | Assinatura | Consumidor |
|---|---|---|
| `get_field_stakes_overview` | `() → TABLE(campo text, n_empresas int, soma_pct numeric, is_complete boolean, has_data_in_producao boolean, last_updated timestamptz)` | Admin Panel → seção Field Stakes (lista de campos com badge de status). Callable por `anon` + `authenticated` |
| `get_field_stakes` | `(p_campo text) → TABLE(empresa text, stake_pct numeric, updated_at timestamptz)` | Admin Panel → editor do campo selecionado. Callable por `anon` + `authenticated` |
| `get_field_stakes_empresas` | `() → TABLE(empresa text, n_campos int)` | Admin Panel → autocomplete de empresas no editor. Callable por `anon` + `authenticated` |
| `admin_upsert_field_stakes` | `(p_campo text, p_stakes jsonb) → void` | Admin Panel — replace-all atômico por campo, valida `SUM(stake_pct) = 100` antes de commitar (ERRCODE `23514` em caso contrário), gated por `is_admin()` (`forbidden` / ERRCODE `42501`). Callable por `authenticated` |
| `admin_delete_field_stakes` | `(p_campo text) → void` | Admin Panel — deleta todos stakes de um campo, gated por `is_admin()`. Callable por `authenticated` |

**Consumidor:** dashboard `/well-by-well` (Fase 2, entregue 2026-05-28; renomeado de `/production` no mesmo dia em Round 4 — ver contrato abaixo). Faz JOIN de `anp_cdp_producao` × `field_stakes` para renderizar produção atribuível por empresa (Brasil agregado, Petrobras agregado, top campos, FPSOs, YoY/MoM), espelhando o relatório mensal Well-by-Well.

**Contrato `/well-by-well` dashboard (APP ↔ Supabase, 2026-05-28 — Fase 2 de Field Stakes & Production; renomeado de `/production` em 2026-05-28 — Round 4):**

Dashboard `/well-by-well` (Label: "Brazil Production Summary"; renomeado de "Well by Well" em 2026-05-28 — ver Round 5 abaixo) é o sumário executivo de produção de petróleo & gás do Brasil. Espelha o relatório mensal *Well-by-Well* em 4 panels (Brasil agregado, empresa agregada via stakes — default Petrobras, top-N campos do mês, breakdown por FPSO/UEP) + tabela YoY/MoM/YTD. Migrations: `supabase/migrations/20260528000000_production_rpcs.sql` (Fase 2 inicial) + `supabase/migrations/20260528300000_well_by_well_round4.sql` (Round 4 — rename, canonical field grouping, live admin field list). Owner UI: `worker_subgerente-app` → `worker_dash-well-by-well` (renomeado de `worker_dash-production` em 2026-05-28). Coexiste com `/anp-cdp` (explorador granular well-by-well) — `/well-by-well` é a view C-level, `/anp-cdp` é a view de analista. Dual-view (desktop 2×2 + mobile tab bar), Tier 1 export.

**Dependência canonical-naming (Round 4):** as 5 RPCs `get_production_*` consolidam variantes de nomes de campo (Búzios / AnC_Búzios / Búzios_ECO etc.) em um único campo físico via helper SQL `canonical_field_name(text)` + tabela de override `field_canonical_names(field_raw, field_canonical)`. A consolidação acontece no dashboard layer — a UI admin Field Stakes (`worker_dash-admin`) preserva a granularidade source-level (variantes ficam separadas) para que o Eduardo registre stakes por nome ANP raw. A lista de campos disponíveis no admin é **live** — populada das últimas 2 meses de `anp_cdp_producao` diretamente (sem dependência de MV refresh), de modo que campos recém-produzindo aparecem sem reciclar ETL.

| RPC | Assinatura | Comportamento |
|---|---|---|
| `get_production_brazil_aggregate` | `(p_date_start date, p_date_end date, p_ambientes text[] DEFAULT NULL) → TABLE(ano int, mes int, ambiente text, oil_bbl_dia numeric, gas_mm3_dia numeric, water_bbl_dia numeric, hours_rate numeric)` | SUM por (ano, mes, ambiente) de `anp_cdp_producao` — sem JOIN com `field_stakes` (Brasil agregado é independente de stake) |
| `get_production_company_aggregate` | `(p_empresa text, p_date_start date, p_date_end date, p_ambientes text[] DEFAULT NULL) → TABLE(ano int, mes int, ambiente text, oil_bbl_dia numeric, gas_mm3_dia numeric, water_bbl_dia numeric, hours_rate numeric)` | **Stake-weighted.** JOIN `anp_cdp_producao × field_stakes` por campo; produção do campo é multiplicada por `stake_pct/100` para a empresa filtrada. **Filtro crítico:** apenas campos com `SUM(stake_pct)=100` em `field_stakes` entram no agregado — campos com lacunas (ver `docs/dados-locais/field_stakes_lacunas.md`) são silenciosamente excluídos para não inflar totais por stake parcial |
| `get_production_top_fields` | `(p_empresa text, p_date date, p_top_n int DEFAULT 10) → TABLE(campo text, stake_pct numeric, oil_bbl_dia_attributable numeric, gas_mm3_dia_attributable numeric, rank int)` | Top-N campos por produção atribuída à empresa em um único mês de referência |
| `get_production_by_installation` | `(p_empresa text, p_date date) → TABLE(instalacao text, campo text, oil_bbl_dia_attributable numeric, gas_mm3_dia_attributable numeric)` | Breakdown FPSO/UEP da produção atribuível à empresa no mês de referência |
| `get_production_yoy_table` | `(p_empresa text, p_date date) → TABLE(metric text, current numeric, prev_month numeric, prev_year numeric, ytd_current numeric, ytd_prev_year numeric, mom_pct numeric, yoy_pct numeric, ytd_yoy_pct numeric)` | Tabela resumo MoM / YoY / YTD da empresa para `p_date` |

Todas as 5 RPCs são `LANGUAGE sql STABLE SECURITY DEFINER` + `SET search_path = public, pg_temp`, `GRANT EXECUTE TO anon, authenticated` (consistente com `get_anp_cdp_*`).

**Dependência crítica:** `get_production_company_aggregate` e `get_production_top_fields` retornam dados consistentes **apenas se `field_stakes` está completo** (SUM=100 por campo). Em 2026-05-26, 304 campos foram seeded pela Fase 1; 240 lacunas (mais 2 nomes não-matchados, `Mariqui` e `Xisto São Mateus do Sul`) restam para o Admin (Eduardo) preencher manualmente via `/admin-panel → Field Stakes`. A lista completa está em `docs/dados-locais/field_stakes_lacunas.md` (mantida pelo `worker_documentador`). Até que o Admin complete o preenchimento, a produção atribuível subestima a real — preferimos subestimar do que inflar (decisão de design Fase 2).

**Visibilidade:** `INSERT INTO module_visibility VALUES ('well-by-well', is_visible_for_clients=true, is_visible_on_home=true, is_visible_for_public=false)` — Client + Admin enxergam; Anon não. Decisão: dados de produção stake-weighted são proprietary insight do produto, não material público.

**Contrato `/stock-guide` (APP ↔ Supabase ↔ Yahoo proxy, 2026-06-01):**

> **Redesign do modelo de sensibilidade (migration `supabase/migrations/20260606000000_stock_guide_sensitivity_model.sql`):** a grade 2D freeform 1:1 por empresa (`stock_guide_sensitivity` + RPCs `get_stock_guide_sensitivity` / `admin_*`) foi substituída por **tabelas de sensibilidade first-class** (`stock_guide_sensitivities`) alimentadas por um **registry central de drivers** macro (`stock_guide_drivers`). As tabelas suportam cross-company (ex.: FCFE × Brent sobre Petrobras/PRIO/RECV/BRAV), single-company 2D (driver×driver), por-ano e 1D, com value-modes derivados live no browser. A tabela antiga `stock_guide_sensitivity` + suas 3 RPCs ficam **dormentes** (não dropadas) para não quebrar o frontend deployado; cleanup posterior as remove. Detalhes do contrato no bloco abaixo.

Dashboard `/stock-guide` (Label "Stock Guide") é o módulo de equities research da cobertura O&G + Distribuição de Combustíveis. Duas análises sobre um hook único (`useStockGuideData.ts`): (1) tabela de **comps** (uma linha por empresa coberta — target price, recomendação OP/MP/UP, fundamentos price-independent + 4 múltiplos forward derivados live EV/EBITDA · P/E · FCFE Yield · Div Yield, mais EBITDA e Volumes, cada par split em `config.y1_label`/`config.y2_label`, ex.: 2026E/2027E) e (2) **tabelas de sensibilidade first-class** (cross-company, single-company 2D, por-ano ou 1D) ancoradas no registry de drivers macro. **Market cap, upside e os 4 múltiplos são computados live no browser** a partir do Yahoo proxy existente (`/api/stocks/quote`, reusando o hook `useStockQuote`) — nunca armazenados — via 1 quote batched para os tickers visíveis (fetch-once-on-load + refresh manual, sem polling). A tabela **não armazena mais múltiplos**; armazena fundamentos (em BRL mn): `net_debt_y1`/`net_debt_y2` (net debt por ano forward), `net_income_y1/y2` (reportado), opcional **por-ano-forward** `npv_tax_credit_y1` / `npv_tax_credit_y2` (BRL mn — NPV de créditos tributários reconhecidos por ano; **único mecanismo de tax credit** desde que as colunas `mcap_adj_y1/y2` foram dropadas em `20260621000000`; o escalar único `npv_tax_credit` foi split nas duas colunas por-ano em `20260622000000`; quando `npv_tax_credit_y1 > 0` OU `npv_tax_credit_y2 > 0` adiciona uma **linha companheira "{Empresa} ex-tax credit"** na tabela de comps com base **por ano** — múltiplos 26E sobre `market cap − npv_tax_credit_y1`, 27E sobre `market cap − npv_tax_credit_y2` (os dois anos podem diferir); o Market cap exibido da linha = a base y1; TP/Recomm/Upside repetidos, linha normal intocada, incluída nos exports), `fcfe_y1/y2` (valor de FCFE), `dividends_y1/y2`, além de `ebitda_y1/y2`, `volumes_y1/y2` e `shares_outstanding`. Derivação live: `Market cap = shares_outstanding × live price` (valor corrente único); a linha normal usa o market cap **cru** — `EV(ano) = Market cap + net_debt(ano)` (EV forward por ano); `EV/EBITDA(ano) = EV(ano) / ebitda(ano)`; `P/E(ano) = Market cap / net_income(ano)` (lucro reportado); `FCFE Yield(ano) = fcfe(ano) / Market cap`; `Div Yield(ano) = dividends(ano) / Market cap`; `Upside = target_price / preço − 1`. Sempre computado (sem override manual); "—" quando um fundamento falta. Todos os fundamentos de comps, as grades de sensibilidade, o toggle de hide por empresa e o config global são **inputs admin-only** numa nova seção do `/admin-panel` (Stock Guide). Migration: `supabase/migrations/20260603300000_stock_guide_fundamentals.sql` (rework de `20260603200000_stock_guide.sql` — dono: `worker_supabase`, já aplicada live). Owner UI: `worker_subgerente-app` → `worker_dash-stock-guide` (contratado nesta rodada; despachável na próxima sessão). Dual-view (desktop: tabela sticky larga + painel de sensibilidade; mobile: cards + BottomSheet), Tier 1 export (Excel + CSV da tabela visível computada, **desktop-only**). NavBar: entrada top-level própria ("Stock Guide"), ao lado de Market Watch / News Hunter — fora de qualquer dropdown.

| Objeto | Mudança |
|---|---|
| `stock_guide_companies` | Tabela nova. PK `ticker text`. Colunas: `company_name`, `yahoo_symbol`, `sector` (`oil_gas`/`fuel_distribution`), `volume_unit` (`kbpd`/`thousand_m3`), `shares_outstanding numeric`, `last_update date`, `target_price numeric`, `recommendation` (`OP`/`MP`/`UP`/NULL), **fundamentos price-independent (BRL mn)** `net_debt_{y1,y2}` (net debt por ano forward, net cash se negativo), `net_income_{y1,y2}` (reportado), opcional **por-ano-forward** `npv_tax_credit_y1` / `npv_tax_credit_y2 numeric` (nullable, BRL mn — NPV dos créditos tributários reconhecidos por ano; adicionadas em `20260622000000`, que **dropou o escalar `npv_tax_credit`** (nascido em `20260620000000`) e fez split nas duas colunas por-ano; **único mecanismo de tax credit** desde que `mcap_adj_{y1,y2}` foram dropadas em `20260621000000` — o dado existente (UGPA3) é `npv_tax_credit_y1 = 2746.575` / `npv_tax_credit_y2 = 2316.238` (y1 herdado do escalar pela migration idempotente, y2 restaurado do antigo `mcap_adj_y2`); quando `npv_tax_credit_y1 > 0` OU `npv_tax_credit_y2 > 0` o frontend renderiza uma **linha companheira "ex-tax credit"** com base **por ano** — múltiplos 26E sobre `market cap − npv_tax_credit_y1`, 27E sobre `market cap − npv_tax_credit_y2` (os dois anos podem diferir); Market cap exibido da linha = base y1; TP/Recomm/Upside repetidos, linha normal intocada sobre o market cap cru), `fcfe_{y1,y2}` (valor de FCFE, não yield), `dividends_{y1,y2}`, mais `ebitda_{y1,y2}` e `volumes_{y1,y2}`, `is_visible boolean DEFAULT true`, `display_order int`, `updated_at`, `updated_by uuid`. **Os 8 múltiplos armazenados (`ev_ebitda_{y1,y2}`, `pe_{y1,y2}`, `fcfe_yield_{y1,y2}`, `div_yield_{y1,y2}`) foram dropados em `20260603300000` — agora derivados live no browser, sem override admin.** **RLS habilitada com ZERO policies** (mais estrita que `field_stakes`) — PostgREST direto retorna `[]`; todo acesso atravessa RPCs SECURITY DEFINER. Seed: 10 empresas (6 visíveis PETR4/PRIO3/RECV3/OPCT3/VBBR3/UGPA3 + 4 restritas BRAV3/RAIZ4/CSAN3/BRKM4, `is_visible=false`); campos financeiros vazios no seed (preenchidos pelo Admin Panel). |
| `stock_guide_sensitivity` | Tabela 1:1 por empresa. PK `ticker text` FK→`stock_guide_companies` `ON DELETE CASCADE`. Coluna `grid jsonb` shape `{row_axis_title, col_axis_title, value_label, row_labels[], col_labels[], cells[][]}` (matriz 2D freeform). RLS habilitada, zero policies. **DORMANT desde `20260606000000`** — substituída por `stock_guide_sensitivities` + `stock_guide_drivers`; mantida (não dropada) para não quebrar o frontend deployado; cleanup posterior a remove. |
| `stock_guide_drivers` | Tabela nova (`20260606000000`). Registry central de variáveis macro/assumption (Brent, USD/BRL, etc.) — **não** company-sensitive. PK `id bigint GENERATED ALWAYS AS IDENTITY`. Colunas: `name` (ex.: `Brent average 2026E`), `unit` (ex.: `USD/bbl`), `current_value numeric`, `source text` (adicionada em `20260607000000` — NULL/`''` = driver **Static**, valor = `current_value` tipado pelo admin; chave do catálogo = driver **Dynamic**, valor computado **live no browser** a partir do Yahoo proxy), `display_order`, `updated_at`, `updated_by`. Sem CHECK em `source` (catálogo fica aberto/extensível no frontend). RLS habilitada, zero policies (não-sensível, mas acesso só via RPC SECURITY DEFINER). |
| `stock_guide_sensitivities` | Tabela nova (`20260606000000`). Tabelas de sensibilidade first-class. PK `id bigint GENERATED ALWAYS AS IDENTITY`. Colunas: `title`, `value_mode text CHECK IN ('absolute','yield','pe','ev_ebitda','upside')`, `metric_label`, `unit`, `companies text[]` (tickers que a tabela envolve — dirige drill-down + hide gating), `definition jsonb` (object: dois eixos `row_axis`/`col_axis` cada um `kind=driver|company|year` — driver carrega `driver_id` + `scenarios[]` per-table; company carrega `companies[]`; year carrega `years[]` — + `cells[][]` primário + `cells_secondary[][]` opcional só para `ev_ebitda`), `display_order`, `updated_at`, `updated_by`. RLS habilitada, zero policies. Cobre cross-company, single-company 2D (driver×driver), por-ano e 1D. **Bloco opcional `definition.grid` (malha de cenários multi-eixo × multi-métrica, multi-eixo desde `20260618200000`, multi-métrica desde `20260619000000`):** metadado **não-sensível** — `{ axes: [{driver_id, label, unit, tmin, tmax, tstep}] (1..3, ordem = x,y,z), outputs: [{key, mode, label}] }` — que **não nomeia empresa** (logo dispensa hide-strip; gravado **verbatim** pelo upsert). v2 (`20260619000000`): cada eixo carrega `driver_id` (qualquer driver do registry `stock_guide_drivers`, estático OU dinâmico — não só Brent/FX do catálogo) + `tmin`/`tmax`/`tstep` (a faixa Cartesiana do template); `outputs[]` (`[{key, mode ∈ upside|yield|pe|absolute, label}]`) substitui o `output` escalar legado (fallback ainda aceito) — **multi-métrica por tabela** (Target price→Upside, FCFE→FCFE yield, Dividends→Div yield, Net income→P/E), cada output mapeado a um `metric` na tabela relacional e derivado live reusando a matemática dos value modes. Marca a tabela como uma malha interpolada multilinearmente (1-D vira caso degenerado); os valores por papel `(coords → valor da métrica)` ficam na tabela relacional separada `stock_guide_scenario_grid` (não no jsonb), lidos via `get_stock_guide_scenario_grid`. O shape legado 1-D `{ x_driver_key, x_label, x_unit, output }` foi convertido para o bloco `axes` pela `20260618200000`; a `20260619000000` introduziu `driver_id` por eixo + `outputs[]`. **Substituiu o bloco linear `definition.compose` (elástica, `20260611000000`)** — o `compose` + o helper `_sg_strip_compose` continuam **dormentes** no banco (não dropados), mas o frontend não os renderiza mais. |
| `stock_guide_scenario_grid` | Tabela nova (1-D `20260612000000`, multi-eixo `20260618200000`, **multi-métrica `20260619000000`**). Malha de cenários multi-eixo (1..3 eixos) × multi-métrica. PK 6-col `(sensitivity_id bigint, ticker text, metric text, x_value numeric, y_value numeric, z_value numeric)`. `sensitivity_id` FK→`stock_guide_sensitivities` `ON DELETE CASCADE`. `metric text NOT NULL DEFAULT 'target_price'` (`20260619000000`) — a chave do output a que a célula pertence (`target_price`, `fcfe`, `dividends`, `net_income`, …); o DEFAULT backfilla o seed existente e deixa uploads 1-métrica omitirem a coluna. `x_value`/`y_value`/`z_value` = níveis do eixo (ordem = `definition.grid.axes`; agora qualquer driver do registry, não só Brent); `y_value`/`z_value` são `numeric NOT NULL DEFAULT 0` (eixo não usado = 0 permanente). `primary_value numeric` = valor da métrica daquele eixo naquele cenário (R$/ação para `target_price`, R$ mn para `fcfe`/`dividends`/`net_income`). Uma row por `(tabela de sensibilidade, ticker, métrica, combinação de coordenadas)` — o frontend lê a malha por `(ticker, métrica)` e **interpola multilinearmente** (2^d cantos) contra os níveis de driver ao vivo, depois aplica a derivação live do output (Target price→Upside, FCFE→FCFE yield, Dividends→Div yield, Net income→P/E). RLS habilitada, **zero policies** — leituras só via RPC `get_stock_guide_scenario_grid(p_sensitivity_id)` (SECURITY DEFINER, hide-aware); escritas só via service role (`scripts/manual/stock_guide_brent_grid_upload.py` v2 multi-aba, replace-total por `sensitivity_id` cobrindo todas as métricas, `on_conflict` 6-col, bypassa RLS). A migration `20260619000000` adicionou `metric` (`ADD COLUMN IF NOT EXISTS … DEFAULT 'target_price'`) + trocou o PK 5→6-col; preservou RLS/ownership/grants. O PK de 6 colunas cobre o read pattern (filtro por `sensitivity_id` + ordenação por `ticker, metric, x_value, y_value, z_value`) — sem índice extra. |
| `stock_guide_config` | Tabela nova singleton. PK `id int DEFAULT 1 CHECK (id=1)`. Colunas: `y1_label` (default `2026E`), `y2_label` (default `2027E`), `assumptions_note text`, `updated_at`, `updated_by`. RLS habilitada, zero policies. |

Todas as 10 RPCs são `SECURITY DEFINER SET search_path = public, pg_temp`; as admin começam com guard `is_admin()` (`RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'`).

| RPC | Assinatura / Comportamento | Acesso |
|---|---|---|
| `get_stock_guide_comps` | `() → TABLE(ticker, company_name, is_visible, display_order, sector, volume_unit, yahoo_symbol, shares_outstanding, net_debt_y1, net_debt_y2, last_update, target_price, recommendation, ebitda_y1/y2, net_income_y1/y2, npv_tax_credit_y1, npv_tax_credit_y2, fcfe_y1/y2, dividends_y1/y2, volumes_y1/y2)` (fundamentos, não múltiplos — os 4 múltiplos são derivados no browser sobre o market cap cru; `npv_tax_credit_y1` / `npv_tax_credit_y2` (logo após `net_income_y2`) alimentam a linha companheira "ex-tax credit" com base por ano. Recriada via DROP+CREATE em `20260622000000` trocando o escalar `npv_tax_credit` pelos dois campos por-ano (RETURNS TABLE mudou); `REVOKE ALL FROM PUBLIC` + `GRANT … TO anon, authenticated` re-assertados. **Hide-aware:** para linha oculta vista por não-admin, força a NULL todos os campos exceto `ticker`/`company_name`/`is_visible`/`display_order` (inclui `yahoo_symbol` + os fundamentos — restrito nunca chega ao browser, então o mkt cap também não vaza). Admin recebe tudo. | anon + authenticated |
| `get_stock_guide_sensitivity` | `(p_ticker text) → jsonb` grid (`{}` se oculto e caller não-admin) | anon + authenticated |
| `get_stock_guide_config` | `() → TABLE(y1_label, y2_label, assumptions_note)` | anon + authenticated |
| `admin_get_stock_guide_companies` | `() → TABLE(todas as colunas incl. ocultas — fundamentos `net_debt_y1`/`net_debt_y2`/`net_income_y1/y2`/`npv_tax_credit_y1`/`npv_tax_credit_y2`/`fcfe_y1/y2`/`dividends_y1/y2`/`ebitda_y1/y2`/`volumes_y1/y2` + `shares_outstanding` + `updated_at` + `updated_by`; sem múltiplos armazenados)` (recriada via DROP+CREATE em `20260622000000` com `npv_tax_credit_y1/y2`; `REVOKE ALL FROM PUBLIC` + **`REVOKE EXECUTE FROM anon`** (fecha o ACL default que o Supabase auto-concede a anon em toda função pública — QA `cfaf60df`) + `GRANT … TO authenticated`) | authenticated, `is_admin()` |
| `admin_get_stock_guide_sensitivity` | `(p_ticker text) → jsonb` | authenticated, `is_admin()` |
| `admin_upsert_stock_guide_company` | `(p_ticker text, p_data jsonb) → void` (lê as chaves de fundamentos `net_debt_y1`/`net_debt_y2`/`net_income_y1/y2`/`npv_tax_credit_y1` (opcional)/`npv_tax_credit_y2` (opcional)/`fcfe_y1/y2`/`dividends_y1/y2` em `p_data`; recriada via DROP+CREATE em `20260622000000` trocando a chave escalar `npv_tax_credit` pelas duas por-ano; `REVOKE ALL FROM PUBLIC` + **`REVOKE EXECUTE FROM anon`** (fecha o ACL default — QA `cfaf60df`) + `GRANT … TO authenticated`; não lê mais chaves de múltiplos) | authenticated, `is_admin()` |
| `admin_upsert_stock_guide_sensitivity` | `(p_ticker text, p_grid jsonb) → void` (valida dimensões da grade) | authenticated, `is_admin()` |
| `admin_set_stock_guide_visibility` | `(p_ticker text, p_is_visible boolean) → row atualizada` | authenticated, `is_admin()` |
| `admin_upsert_stock_guide_config` | `(p_y1 text, p_y2 text, p_note text) → void` | authenticated, `is_admin()` |
| `admin_delete_stock_guide_company` | `(p_ticker text) → void` (sensibilidade cascateia) | authenticated, `is_admin()` |

**Modelo de sensibilidade redesenhado (`20260606000000`) — 7 RPCs novas** (todas `SECURITY DEFINER SET search_path = public, pg_temp`; as admin com guard `is_admin()` → `RAISE EXCEPTION 'forbidden' ERRCODE='42501'`). Os value-modes são **derivados live no browser** a partir do quote Yahoo da empresa: `absolute` = valor tipado as-is; `yield` = tipado ÷ market cap ×100 (FCFE yield, div yield); `pe` = market cap ÷ tipado; `ev_ebitda` = `(market cap + net debt) ÷ EBITDA` (2 valores tipados por célula — EBITDA primário em `cells` + net debt em `cells_secondary`); `upside` = TP ÷ price − 1.

| RPC | Assinatura / Comportamento | Acesso |
|---|---|---|
| `get_stock_guide_drivers` | `() → TABLE(id, name, unit, current_value, source, display_order)` (coluna `source` adicionada após `current_value` em `20260607000000`) — assumptions macro, não-sensíveis (retorno completo a todos) | anon + authenticated |
| `get_stock_guide_sensitivity_tables` | `() → TABLE(id, title, value_mode, metric_label, unit, companies text[], definition jsonb, display_order)`. **Hide-aware:** para não-admin, cada empresa restrita é cirurgicamente removida server-side — eixo company tem as entries ocultas dropadas + as linhas/colunas correspondentes removidas de `cells`/`cells_secondary` (helpers `_sg_filter_rows`/`_sg_filter_cols`); tabela single-company de empresa oculta é omitida inteira; tabela sem nenhuma empresa visível é omitida. `definition.grid` (malha de cenários, `20260612000000`) não nomeia empresa → passa intacto. O bloco `compose` + `_sg_strip_compose` ficaram dormentes (não renderizados pelo frontend) mas o RPC ainda os strippa por defesa em profundidade. Valores tipados de empresa restrita **nunca** chegam ao browser. Admin recebe tudo unfiltered. | anon + authenticated |
| `get_stock_guide_scenario_grid` | `(p_sensitivity_id bigint) → TABLE(ticker, metric, x_value, y_value, z_value, primary_value)` ordenado por `ticker, metric, x_value, y_value, z_value` (1-D `20260612000000`, 5-col em `20260618200000`, **6-col +`metric` em `20260619000000`**). Malha multi-eixo (1..3) × multi-métrica de uma tabela de sensibilidade. **Hide-aware:** para não-admin, só retorna tickers `is_visible` em `stock_guide_companies` (`is_admin() OR EXISTS visible` — mesmo critério de `get_stock_guide_sensitivity_tables`); os níveis de uma empresa oculta nunca chegam ao browser. Recriada via **DROP+CREATE** em `20260619000000` (a `RETURNS TABLE` ganhou `metric`) com SECURITY DEFINER + `SET search_path = public, pg_temp` + GRANT anon/authenticated re-assertados (pegadinha #18). Migration: `supabase/migrations/20260619000000_stock_guide_scenario_grid_multi_metric.sql`. | anon + authenticated |
| `admin_get_stock_guide_sensitivity_tables` | `() → TABLE(… + updated_at, updated_by)` — todas as rows unfiltered (definition completa incl. ocultas) para o builder | authenticated, `is_admin()` |
| `admin_upsert_stock_guide_driver` | `(p_id bigint, p_data jsonb) → bigint` (NULL `p_id` → INSERT, senão UPDATE; retorna id). Lê `source = NULLIF(p_data->>'source','')` (`''` → NULL = static) em INSERT e UPDATE — desde `20260607000000` | authenticated, `is_admin()` |
| `admin_delete_stock_guide_driver` | `(p_id bigint) → void` | authenticated, `is_admin()` |
| `admin_upsert_stock_guide_sensitivity_table` | `(p_id bigint, p_data jsonb) → bigint` (valida `value_mode`, `companies` json array → text[], `definition` object; NULL `p_id` → INSERT) | authenticated, `is_admin()` |
| `admin_delete_stock_guide_sensitivity_table` | `(p_id bigint) → void` | authenticated, `is_admin()` |

Helpers internos `_sg_filter_rows(jsonb,text,int[])` / `_sg_filter_cols(jsonb,text,int[])` / `_sg_strip_compose(jsonb,text[])` (`IMMUTABLE SECURITY DEFINER`, **não** granted a anon/authenticated — chamados só de `get_stock_guide_sensitivity_tables`). `_sg_strip_compose` (adicionado em `20260611000000` para o hide-strip dos mapas elásticos per-ticker) ficou **dormente** junto com o bloco `compose` quando a sensibilidade migrou pra malha de cenários 1-D (`20260612000000`) — continua no banco e segue sendo chamado por defesa em profundidade, mas o frontend não renderiza mais `compose`. As 3 RPCs antigas de grade 1:1 (`get_stock_guide_sensitivity`, `admin_get_stock_guide_sensitivity`, `admin_upsert_stock_guide_sensitivity`) ficam **dormentes** pendente cleanup.

**Drivers dinâmicos (market-computed, `20260607000000`):** a coluna `stock_guide_drivers.source` (sem CHECK no DB) classifica cada driver em **Static** (`source` NULL/`''` → valor = `current_value` tipado pelo admin) ou **Dynamic** (`source` = chave do catálogo de mercado → `current_value` é ignorado e o valor é computado **live no browser** via Yahoo proxy). O catálogo é definido **client-side** (hook novo `src/hooks/useMarketDrivers.ts`, sem compute no DB — o DB só guarda a string `source`), com **6 métricas** (4 originais + `avg_brent_2028`/`avg_fx_2028` adicionadas em `20260611000000`):

| `source` | Label | Unidade | Computação (client-side) |
|---|---|---|---|
| `avg_brent_2026` | Avg Brent 2026 | USD/bbl | média mensal de 12 meses (realizado + forward) |
| `avg_brent_2027` | Avg Brent 2027 | USD/bbl | média mensal de 12 meses (todos forward; fallback spot) |
| `avg_brent_2028` | Avg Brent 2028 | USD/bbl | terceira janela forward; **spot-flat** se a curva não alcançar 2028 (típico) — adicionado `20260611000000` |
| `avg_fx_2026` | Avg FX (USD/BRL) 2026 | BRL/USD | média mensal de 12 meses (realizado + **spot-flat**) |
| `avg_fx_2027` | Avg FX (USD/BRL) 2027 | BRL/USD | spot, mantido flat (= spot) |
| `avg_fx_2028` | Avg FX (USD/BRL) 2028 | BRL/USD | spot-flat (sem FX forward no proxy) — adicionado `20260611000000` |

Inputs (3 GETs ao proxy existente, **1× no mount**, sem polling): `/api/stocks/futures-curve` (curva forward mensal do Brent), `/api/stocks/history?ticker=BZ=F` + `?ticker=USDBRL=X` (`range=1y` realizado diário), `/api/stocks/quote?tickers=BZ=F,USDBRL=X` (spot/fallback). **Brent** = média dos 12 meses, cada mês: passado → média mensal realizada; corrente → mês-a-mês `?? spot`; futuro → preço do contrato da curva `?? spot`. **FX** = aproximação **spot-flat** (não há FX forward no proxy): passado → realizado; corrente + futuro → spot mantido flat (2027 inteiro = spot). Null-safe → "—" quando os inputs faltam. O valor computado **substitui** o `current_value` estático nos drivers dinâmicos para o destaque/interpolação do eixo driver nas tabelas de sensibilidade (`resolveDriverValue` + `isDynamicSource`, reusados pelo hook do dashboard e pelo editor de drivers do `/admin-panel`). Sub-PRD: [`docs/app/stock-guide.md`](app/stock-guide.md) § "Dynamic drivers".

**Sensibilidade por malha de cenários multi-eixo × multi-métrica (1-D `20260612000000`, multi-eixo `20260618200000`, multi-métrica `20260619000000`, atual):** uma tabela de sensibilidade vira uma **malha interpolada** quando seu `definition` carrega um bloco `grid` (`{ axes: [{driver_id, label, unit, tmin, tmax, tstep}] (1..3, ordem = x,y,z), outputs: [{key, mode, label}] }` — metadado, **sem empresa**, gravado verbatim). Cada eixo referencia **qualquer driver do registry `stock_guide_drivers`** via `driver_id` (estático ou dinâmico — não mais restrito ao catálogo Brent/FX) e carrega a faixa Cartesiana do template (`tmin/tmax/tstep`); `outputs[]` declara as métricas da tabela (`key` = `target_price`/`fcfe`/`dividends`/`net_income`, `mode` ∈ `upside|yield|pe|absolute`) — multi-métrica numa única tabela. Os valores por papel **não** ficam no jsonb: ficam na tabela relacional `stock_guide_scenario_grid` (uma row por `(sensitivity_id, ticker, metric, x_value, y_value, z_value)` com `primary_value`; eixo não usado = 0). O dashboard renderiza **até 3 sliders** (um por eixo, com marcador "live") e, ao vivo no browser, faz **interpolação multilinear** (2^d cantos) por `(ticker, métrica)` → valor da métrica, depois aplica a derivação do output: Target price→**Upside** (`TP / preço_live − 1`), FCFE→**FCFE yield** (÷ market cap), Dividends→**Div yield** (÷ market cap), Net income→**P/E** (market cap ÷). Helpers `buildGridMesh` / `interpolateMesh` em `src/lib/stockGuideSensitivity.ts` (cobertos por testes vitest). Substitui o painel elástico anterior. **Contrato de segurança (cross-dept):** os valores por papel são lidos pelo RPC dedicado `get_stock_guide_scenario_grid(p_sensitivity_id)` (SECURITY DEFINER, hide-aware — só tickers `is_visible` para não-admin), não pelo jsonb; níveis de empresa oculta nunca chegam ao browser. O bloco `grid` não nomeia empresa → dispensa hide-strip. **Escrita (desde `20260619100000`):** 2 RPCs admin `is_admin()`-guarded (42501) — `admin_replace_stock_guide_scenario_grid(p_sensitivity_id, p_rows jsonb, p_first_chunk boolean)` (replace-total chunked: 1º chunk apaga, seguintes acumulam; NaN rejeitado; `ON CONFLICT` PK 6-col) + `admin_count_stock_guide_scenario_grid(p_sensitivity_id) → (total, by_metric)` (confirmação) — alimentam o upload **in-admin** (browser), com o script Python `stock_guide_brent_grid_upload.py` como fallback de automação.

**Fluxo de download/upload (Dados Locais):** o template Excel agora é **baixado do Admin Panel** — gerado **no browser via ExcelJS** a partir do bloco `definition.grid` (faixas `tmin/tmax/tstep` por eixo): **1 aba por output** (nome da aba = `key` do output), as primeiras `d` colunas são as **coordenadas POSICIONAIS na ordem dos eixos** (não mais nomeadas pelos driver_keys) + 1 coluna por ticker = valor da métrica. O analista preenche todas as combinações Cartesianas e **sobe a malha no próprio Admin Panel** (caminho principal, desde `20260619100000`): o browser parseia o Excel via ExcelJS + roda as validações client-side (`src/lib/stockGuideGridUpload.ts`, paridade com o uploader Python), emite relatório de erros/warnings, e envia em **chunks (~2000 rows)** via a RPC admin `admin_replace_stock_guide_scenario_grid(p_sensitivity_id, p_rows jsonb, p_first_chunk boolean)` (guard `is_admin()`; 1º chunk apaga todas as rows do alvo, seguintes acumulam; NaN rejeitado; `ON CONFLICT` PK 6-col idempotente), confirmando ao final por `admin_count_stock_guide_scenario_grid(p_sensitivity_id) → (total, by_metric)`. O script `scripts/manual/stock_guide_brent_grid_upload.py` v2 (owner: `worker_dados-locais`, service role) vira **fallback de automação** — leitor **multi-aba** que mapeia cada aba → `metric`, lê coordenadas posicionais (1..d primeiras colunas), valida completude Cartesiana por aba, grava `x/y/z_value` (eixo não usado = 0) + `metric` e faz **replace-total por `sensitivity_id`** (apaga todas as rows do alvo, todas as métricas, e reinsere; `on_conflict` 6-col; idempotente; bypassa RLS — a regra "nunca deletar mês parcial" **não se aplica**, é snapshot). O gerador Python `scripts/manual/make_brent_grid_template.py` está **DEPRECADO** (mantido só para o caso 1-métrica offline; o caminho canônico é o download do Admin). **Guidance de payload:** ≤15 níveis/eixo em 3-D (≈ 27k rows/output), ≤40×40 em 2-D, livre em 1-D. A "casca" (shell) que recebe a malha é uma linha em `stock_guide_sensitivities` marcada por `definition.grid`, criada pelo Admin Panel. Detalhe completo (sliders, interpolação, presets, UI dual-view): [`docs/app/stock-guide.md`](app/stock-guide.md); detalhe do loader: [`docs/dados-locais/PRD.md`](dados-locais/PRD.md).

> **Camada elástica anterior (`compose`, `20260611000000`) substituída:** o bloco `definition.compose` (base/anchors/by_company/slopes/scenarios) e o helper `_sg_strip_compose` ficaram **dormentes** — não removidos do banco, mas o frontend não renderiza mais o painel de sliders elástico. A composição linear `TP = base + Σ slope×(nível−âncora)` deu lugar à interpolação da malha por papel.

**Quem consome o quê:**

| Dashboard | RPC / Dependência | Comportamento |
|---|---|---|
| `/stock-guide` | `get_stock_guide_comps`, `get_stock_guide_config`, `get_stock_guide_drivers`, `get_stock_guide_sensitivity_tables` (via wrappers em `src/lib/rpc.ts` § "MODULE: Stock Guide") | Comps + tabelas de sensibilidade + drivers + config. Market cap = `shares_outstanding × live price (BRL)`; upside = `target_price / live price − 1`; `EV(ano) = Market cap + net_debt(ano)`; e os 4 múltiplos `EV/EBITDA(ano) = EV(ano)/ebitda(ano)`, `P/E = Market cap/net_income(ano)`, `FCFE Yield = fcfe(ano)/Market cap`, `Div Yield = dividends(ano)/Market cap` — todos computados no hook a partir do Yahoo proxy (`/api/stocks/quote`) + fundamentos, nunca no SQL; "—" se faltar fundamento. **Sensibilidade:** clicar numa empresa na tabela de comps revela todas as tabelas que a envolvem (single-company + cross-company), com a linha da empresa selecionada destacada; um eixo driver destaca a coluna no `current_value` do registry ou exibe marcador interpolado entre cenários. Empresas restritas saem da tabela de comps (footnote "Currently restricted") e são strippadas server-side das tabelas de sensibilidade. |
| `/admin-panel` → seção Stock Guide | RPCs admin (`admin_*_stock_guide_*`): comps + drivers + tabelas de sensibilidade + config + visibility | CRUD de comps, registry de drivers, tabelas de sensibilidade first-class, toggle de hide e config global (Y1/Y2 labels + assumptions note). Owner: `worker_dash-admin` (pass separado). |

**Dependência cross-módulo (Yahoo proxy):** `/stock-guide` reusa o proxy `/api/stocks/quote` e o hook `useStockQuote` (ambos owned por `worker_dash-stocks` / `worker_subgerente-app`). É a única coisa que `/stock-guide` empresta do Market Watch — **não** usa o tema scoped `.stocks-dark`/`.stocks-light`; usa a identidade padrão dos dashboards (laranja `#ff5000`, Arial, liquid glass). Sem polling: 1 fetch on-load + botão "Refresh quotes" (desktop-only).

**Visibilidade:** `INSERT INTO module_visibility VALUES ('stock-guide', is_visible_for_clients=true, is_visible_for_public=false, is_visible_on_home=true)` — Client + Admin enxergam; Anon não. Decisão: comps proprietárias de equities research não são material público.

### 3-tier visibility (Anon / Client / Admin) — adicionado 2026-05-22

A partir da migration `20260522000001_anonymous_access.sql`, o login é **opcional**. Três tiers de acesso ao dashboard:

| Tier | Como entra | Visibilidade controlada por |
|---|---|---|
| **Anon** | Sem sessão (visitante anônimo) | `module_visibility.is_visible_for_public` |
| **Client** | Logado, `profiles.role='Client'` | `module_visibility.is_visible_for_clients` |
| **Admin** | Logado, `profiles.role='Admin'`, AAL2 (MFA) | sempre visível, sem checagem |

O auth guard em `src/app/(dashboard)/layout.tsx` **não força redirect para `/login`** para Anons — apenas o MFA gate continua ativo para Admins logados sem AAL2. Visitantes anônimos recebem um cookie HttpOnly `sd_visitor_id` (UUID v4, SameSite=Lax, Secure, Max-Age 1 ano) emitido por `src/proxy.ts` (Next.js 16 renomeou `middleware.ts` → `proxy.ts`), usado pelo `track_event` para atribuição de analytics sem PII. Bots (UA `bot|crawler|spider|crawling|slurp`) não recebem cookie.

Componente compartilhado para CTA de upgrade: `src/components/AnonCTA.tsx` (banner "Sign in to ..." consumido por `/stocks`, `/news-hunter` e qualquer dashboard que exponha branch read-only para anon).

**Contrato clipping (`/news-hunter` → Next.js API):**

| Endpoint | Auth gate | Consumidor | Fonte de dados |
|---|---|---|---|
| `POST /api/clipping/scrape` | Admin-only (gated via `profiles.role` check server-side) | `worker_dash-news-hunter` (UI modal) | `news_articles` rows selected by Admin; ~80 domain extractors via cheerio |

**Regra de divisão:** SQL = `worker_supabase`. JS chamando SQL = `worker_subgerente-app` / `dash-*`.

**Quando algum dept precisa de coluna/tabela nova:** abre solicitação ao agente `worker_supabase` via Gerente. `worker_supabase` cria migration + RLS + (se for o caso) RPC. Avisa o dept consumidor pra atualizar wrapper JS / popular dados. Documentador atualiza este arquivo + `docs/supabase/PRD.md` + PRD do dept consumidor.

### Parquet/CSV consolidados em `DADOS/`

**Dono:** ETL. Cada subpasta `DADOS/<fonte>/` contém o consolidado (parquet) que serve como source-of-truth daquela fonte.

| Quem consome | Como |
|---|---|
| ETL | Reescreve in-place no scrape seguinte |
| Alertas | Pode ler para detectar mudanças |
| Scripts de upload (ETL) | Lêem parquet → upsertam no Supabase |

**Regra crítica (memória do CEO):** parquet é corrigido **in-place**, nunca deletado e refeito.

### Arquivos manuais em `data/`

**Dono:** Dados Locais. CEO edita manualmente.

| Arquivo | Tabela alvo |
|---|---|
| `data/price_bands.xlsx` | `price_bands` |
| `data/field_stakes_brasil.xlsx` | `field_stakes` (seed) |
| `data/Liquidos_Vendas_Atual.csv` | (verificar uso atual) |

> `data/d_g_margins.xlsx` foi retirado em 2026-06-05 — `d_g_margins` agora é computado pelo `etl_dg_margins.yml` (dono `worker_etl-pipelines`), não mais manual.

ETL **não toca** em `data/` — esses arquivos são manuais por design.

### Histórico de alertas

**Dono:** Alertas. Arquivo: `DADOS/historico_alertas.csv` (append-only).

ETL pode ler para análise; somente Alertas escreve.

### Workflows GitHub Actions

**Dono:** ETL (e APP, no caso do `supabase_deploy.yml`).

Cada workflow novo precisa: secrets registrados no GitHub, schedule cron, e linha no `docs/etl-pipelines/PRD.md`.

Workflows ativos para as tabelas novas: `etl_mdic_comex.yml`, `etl_anp_precos.yml` (preços produtores + GLP), `etl_anp_fase3.yml` (2 steps: DAIE + desembaraços enriquecidos com `importador`/`cnpj`/`uf_cnpj`; o antigo step `03_painel_imp_sync.py` foi deletado em 2026-05-25 junto com a tabela `anp_painel_imp_dist` na reforma `/imports-exports` — migration `20260525000010_imports_exports_enrichment.sql`), `etl_anp_lpc.yml`, `etl_anp_cdp.yml` (CDP), `etl_anp_precos_distribuicao.yml` (preços de distribuição), `etl_anp_cdp_diaria.yml` (produção diária 3 níveis — campo/instalação/poço — 3×/dia, CLI `--level all --upload`), `etl_anp_voip.yml` (VOIP por campo — anual, 1º de maio, source BAR/ANP), `etl_anp_subsidy_diesel.yml` (referência de preços subsídio diesel — diário 11:30 UTC, script `pipelines/anp/subsidy_diesel_sync.py`, target `anp_subsidy_diesel_reference`). Ver `docs/etl-pipelines/PRD.md` para schedules e scripts.

**Monitoring & testing (ops, 2026-06):** três monitores dão cobertura total da frota de ETL — `freshness_monitor.yml` (guardião de frescor: alerta quando uma base para de avançar mesmo com workflow verde — *stall silencioso*) + `workflow_failure_monitor.yml` (pager de falha: alerta em ≥3 falhas consecutivas não-canceladas de 16 workflows críticos — *falha barulhenta*; re-home do `etl_workflow_stuck`; inclui detector de *silêncio de dispatcher*: pagina quando workflow crítico de disparo externo — `etl_anp_vendas`, `etl_anp_cdp` — fica >26h sem iniciar run, pegando trigger externo morto: zero runs, invisível tanto ao streak de falhas quanto ao guardião de frescor) + `cdp_roster_canary.yml` (canário de completude upstream, diário 12:15 UTC: compara o roster de poços/instalações do último mês completo do CDP mensal contra o painel diário Power BI e emaila ops quando poços ausentes agregam >10 kbpd — pega *lag de dimensão do lado da ANP*, invisível aos outros dois; caso FPSO P-78). Mais `client_alerts_poll.yml` (poll a cada 20 min para bases Data Input sem hook) e `client_alerts_test.yml` (harness `run_base --test` production-safe). O monitor legado `alertas_monitor.yml` está **DESABILITADO** (reversível) e os 3 destinatários internos foram migrados para o Client Alerts. Detalhes em `docs/etl-pipelines/PRD.md` § "Monitoring & testing" / "Legacy `alertas/` monitor retirement".

---

## Convenções gerais

### Padrão de Export (Fase B — 2026-05)

Todos os dashboards com dataset tabular exportam Excel + CSV. Dois tiers conforme volume estimado:

| Tier | Critério | UX | Componentes |
|---|---|---|---|
| **Tier 1** | Dataset < 50k linhas (download imediato seguro) | Botões diretos no `ExportPanel` | [`ExportPanel.tsx`](../src/components/dashboard/ExportPanel.tsx) + [`exportExcel.ts`](../src/lib/exportExcel.ts) + [`exportCsv.ts`](../src/lib/exportCsv.ts) |
| **Tier 2** | Dataset >= 50k linhas (export pode ser pesado) | Modal com filtros ativos + calculadora live de tamanho | `ExportPanel` com `mode="modal"` + [`ExportModal.tsx`](../src/components/dashboard/ExportModal.tsx) + [`useExportSize.ts`](../src/hooks/useExportSize.ts) |

**Dashboards Tier 2:** `/market-share` (dataset `vendas` — serves both % Share and absolute volume modes since 2026-05-26), `/anp-cdp`, `/anp-lpc`.

**Dashboards Tier 1:** `/diesel-gasoline-margins`, `/price-bands`, `/navios-diesel`, `/anp-glp`, `/imports-exports`, `/anp-precos-produtores`.

**Skip (sem dataset tabular):** `/home`, `/profile`, `/admin-panel`, `/admin-analytics`, `/stocks`, `/news-hunter`.

**Como o tamanho é estimado (Tier 2):** RPC `get_*_export_count(filtros)` retorna `bigint` (count filtrado) → multiplicado pelo `AVG_BYTES_PER_ROW[datasetKey]` em [`exportSizeHeuristics.ts`](../src/lib/exportSizeHeuristics.ts) → `formatBytes(b)` formata para display. O debounce de 300ms está em [`useExportSize.ts`](../src/hooks/useExportSize.ts).

**Ao criar dashboard novo:** escolha o tier pelo volume esperado da tabela alvo. Para Tier 2, criar RPC `get_<domínio>_export_count(mesmos filtros do RPC de série)` no dept `worker_supabase` + wrapper JS em `src/lib/rpc.ts` + adicionar `datasetKey` em `AVG_BYTES_PER_ROW` em `exportSizeHeuristics.ts`.

### Idioma

- **UI**: português (`lang="pt-BR"` no root layout).
- **Comentários e docs**: português é OK; inglês também aceito.
- **Frontmatter `description` dos agentes**: **inglês** (Claude Code usa para decidir invocação).
- **Nomes de variáveis, funções, RPCs, tabelas, colunas**: **inglês ou português conforme já estabelecido na pasta** (não misture).

### Segurança

- **Frontend usa anon key** (RLS é a única defesa).
- **Pipelines usam service key** (bypassam RLS).
- Nunca confunda. Nunca comite secrets.
- Toda tabela nova **deve ter RLS habilitada**.
- Documentação operacional de segurança: [`docs/security/README.md`](security/README.md) — threat model, incident response playbook, secret rotation cadence, token storage decision.
- Pen-test externo (firma especializada): **trimestral**. Reports em `docs/security/pen-test-YYYY-MM.md`, gerados pelo `worker_pen-test`.

### Workflow padrão (ordem de qualquer tarefa)

```
CEO/CTO → Gerente Geral → dept(s) específico(s) → Documentador → Revisor/QA → commit + push
```

### Equipamento dos workers (responsabilidade do CTO)

Cada agente em `.claude/agents/worker_*.md` declara um campo `tools:` no frontmatter. Esse campo **filtra** quais ferramentas o agente enxerga em runtime — se a tool não está listada, o agente não consegue chamá-la mesmo que o harness tenha disponível.

| Worker | MCP tools obrigatórias |
|---|---|
| `worker_supabase` | Supabase MCP **completo** (apply_migration, execute_sql, list_tables, get_advisors, list_migrations, list_extensions, generate_typescript_types, search_docs, branches, edge_functions) |
| `worker_etl-pipelines` | Supabase MCP **read-only** (execute_sql, list_tables, list_migrations, get_advisors, get_logs) — para validar pós-pipeline |
| `worker_dados-locais` | Supabase MCP **read-only** (execute_sql, list_tables, get_advisors) — para validar pós-upload de Excel |
| `worker_alertas` | Supabase MCP **read-only** (execute_sql, list_tables, get_logs) + WebFetch — para checar dados base e APIs externas |
| `worker_subgerente-app` + `worker_dash-*` + `worker_designer` | Preview MCP (`preview_start`, `preview_screenshot`, `preview_eval`, `preview_console_logs`, etc) + Supabase RO — para smoke test visual e checar dados |
| `worker_gerente-geral` | Supabase RO + Preview RO — para auditorias cross-cutting |
| Todos | `ToolSearch` para carregar tools deferred sob demanda |

**Quando um worker reportar "MCP tool não disponível", a falha é do CTO** que não atualizou `.claude/agents/worker_*.md`. Edite o frontmatter, adicione a tool faltante, e dispare de novo.

### Protocolo formal de contratação de novo worker

Quando uma tarefa **não tem worker qualificado**, a resposta correta NÃO é "CTO faz". A resposta é **contratar**. Ordem de execução obrigatória:

#### 1. Decidir se é caso de contratação

Critérios:
- A tarefa é **recorrente** (não é one-off) E não cabe no escopo de nenhum worker existente.
- Worker existente está sobrecarregado com responsabilidades muito heterogêneas (split em sub-workers).
- Surge novo subdomínio (ex: novo dashboard → contratar `worker_dash-<slug>`).
- Worker fora do domínio está sendo "improvisado" pra preencher gap (sinal claro).

Se for **one-off** que não vai se repetir, escolha: deixar com worker mais próximo (sem permissão excepcional cross-domain) ou criar worker mesmo assim por princípio (preferível).

#### 2. Definir escopo do cargo

Antes de criar o arquivo, escreva:
- **Slug**: `worker_<categoria>-<area>` (ex: `worker_dash-anp-cdp`, `worker_etl-pipelines`).
- **Missão**: 1 frase em português explicando o problema que ele resolve.
- **Ownership de pasta(s)**: lista exata de paths dos quais ele é dono ÚNICO (não pode haver overlap com workers existentes — se houver, é hora de redefinir fronteiras).
- **Quando é invocado**: list 3-5 gatilhos típicos.
- **Quando NÃO é invocado**: explicitar para evitar duplicação.

#### 3. Identificar tools obrigatórias

Tabela mental:
- File ops básicos: `Read, Edit, Write, Glob, Grep, Bash` (todos têm)
- `Agent` se ele orquestra (subgerentes e gerentes)
- `TodoWrite` se ele gerencia múltiplas tarefas internas
- `WebFetch` se acessa APIs externas
- `ToolSearch` (todos têm — para carregar tools deferred sob demanda)
- **MCP Supabase**: lista da tabela acima (read-only ou full conforme escopo)
- **MCP Preview**: para workers de UI que precisam smoke test visual
- **MCP scheduled-tasks / mcp-registry**: workers raros

#### 4. Criar `.claude/agents/worker_<slug>.md`

Frontmatter completo:

```yaml
---
name: worker_<slug>
description: <em INGLÊS — usado pelo harness para decidir invocação automática. Liste sintomas de prompt que devem disparar este worker.>
tools: <comma-separated, incluindo MCP necessárias>
model: sonnet | opus
color: <cor para UI do harness>
---
```

Corpo Markdown obrigatório:
- Função em PT-BR
- Ownership exclusivo (paths)
- Princípios não-negociáveis (3-7 itens)
- Workflow padrão (passo a passo)
- Pegadinhas conhecidas (se herdadas de sessão anterior)
- Como o invocador deve passar contexto

#### 5. Atualizar este `docs/master.md`

- Adicionar linha na tabela de departamentos (se for novo dept) OU em "Sub-agentes" (se for sub de subgerente) OU em "Papéis transversais" (se for cross-dept).
- Atualizar organograma ASCII no topo do arquivo.

#### 6. Atualizar `CLAUDE.md` do CTO

- Adicionar linha na **lista negra** mapeando "tipo de operação → novo worker".
- Se introduzir nova categoria de tarefa, atualizar workflow obrigatório.

#### 7. Commit `feat(org): hire worker_<slug> — <missão>`

`.claude/agents/*.md` é gitignored, então o commit captura só `docs/master.md` + `CLAUDE.md`. O frontmatter do worker fica local — cada worktree precisa do seu.

#### 8. Aí sim, delega a tarefa ao worker recém-contratado

Atalho proibido: ❌ "vou fazer essa tarefa pequena eu mesmo, depois crio o worker". ✅ Contrate primeiro, delegue depois.

### worker_orquestrador (integração)

Após múltiplos workers finalizarem em worktrees paralelas, o CTO **delega a integração** ao `worker_orquestrador` em vez de copiar arquivos manualmente. Esse worker:

- Consolida changes de N worktrees em `main` num único commit
- Resolve conflitos triviais (ex: 2 agents criando mesmo shared component)
- Sincroniza `schema_migrations.version` após `apply_migration` MCP
- Valida `tsc + lint clean` pré-commit
- Limpa worktrees temporárias pós-merge

Foi criado em 2026-05-07 para eliminar o gargalo de "CTO virou merge engine" identificado na retrospectiva da sessão anterior. Antes dele, ~30% do tempo do CTO em rodadas paralelas era gasto fazendo `cp` entre worktrees + UPDATE em schema_migrations + git rm de arquivos legados.

### Paralelismo via worktrees git (responsabilidade do CTO)

Quando duas (ou mais) tarefas são **completamente independentes** (não tocam os mesmos arquivos, não dependem do output uma da outra), o CTO **deve** rodá-las em paralelo, cada uma em sua própria worktree.

**Como**: ao invocar `Agent`, passe `isolation: "worktree"`. O harness cria uma worktree git temporária, o agente trabalha lá, e ao final retorna o path + nome da branch. O CTO então mergeia cada branch em `main` na ordem que fizer sentido.

**Quando vale a pena**:
- Refactor cross-cutting + 3 backlogs técnicos pequenos (caso real da Fase 4 + housekeeping)
- 2 dashboards novos sendo refinados em paralelo (não tocam o mesmo `src/lib/rpc.ts`)
- Update de docs em departamentos diferentes simultaneamente

**Quando NÃO usar**:
- Tarefas com dependência (output da A é input da B) — sequencial
- Workers que tocam o mesmo arquivo simultaneamente
- Mudanças triviais onde o overhead de worktree não compensa

### Memórias persistentes do CEO (verificar sempre antes de agir)

Ver `C:/Users/eduar/.claude/projects/C--Users-eduar-dashboard-projeto/memory/MEMORY.md`. Resumo das regras vivas:

- **Sempre commit + push para `origin/main`** automaticamente após qualquer mudança de código (sem ser pedido).
- **Sempre fazer merge** de feature branch direto para main após commit (não esperar PR review).
- **Todo módulo novo** tem (a) controle de visibilidade no admin panel (`is_visible_for_clients` via Permissions tab + `is_visible_on_home` via Card Images tab) e (b) upload de imagem de home.
- **Parquet é corrigido in-place** — nunca delete e refaça.

---

## Como adicionar um novo departamento

Workflow controlado pelo Gerente Geral:

1. CEO decide criar `<novo-dept>` (ex: "Finanças").
2. Gerente cria `.claude/agents/worker_<novo-dept>.md` (mantenha o prefixo `worker_`; template = um agente existente).
3. Gerente cria `docs/<novo-dept>/PRD.md` com seções: Escopo, Ownership, Contratos, Convenções, Tarefas comuns, Anti-padrões.
4. Gerente atualiza este `master.md`: organograma + tabela de departamentos + contratos cross-dept (se houver).
5. Gerente atualiza tabela de roteamento em `worker_gerente-geral.md`.
6. Documentador valida.

## Como adicionar um novo dashboard (não departamento)

Workflow controlado pelo **Subgerente APP** (não pelo Gerente Geral). Ver detalhes em `worker_subgerente-app.md` → "Adicionar novo dashboard". Resumo:

1. Subgerente copia `template-module/` → novo módulo.
2. Solicita ao `worker_supabase` migration + RPCs + RLS.
3. **Cria `.claude/agents/worker_dash-<slug>.md`** (mantenha o prefixo `worker_`; responsabilidade do Subgerente).
4. **Cria `docs/app/<slug>.md`** (sub-PRD).
5. **Dispara `worker_dash-admin`** para registrar visibilidade + foto na home.
6. Atualiza tabelas em `worker_subgerente-app.md` e `worker_gerente-geral.md`.
7. Avisa Documentador para refletir em `master.md`.

---

## Estado atual (snapshot)

- 4 departamentos + 3 papéis transversais.
- 17 dashboards ativos (7 originais — `/sales-volumes` retirado em 2026-05-26 e absorvido por `/market-share` via toggle % Share ↔ thousand m³ — + 2 da Fase 3 remanescentes: `/anp-cdp`, `/anp-glp` + 8 novos: `/anp-prices` (consolida `/anp-precos-produtores` + `/anp-precos-distribuicao` + `/anp-lpc` retirados em 2026-05-26), `/imports-exports` (consolida `/anp-daie` + `/anp-desembaracos` + `/anp-painel-importacoes` retirados em 2026-05-25; absorveu `/mdic-comex` no mesmo dia — originalmente via Panel C "Import Price", removido em 2026-05-28; MDIC continua alimentando Panel D + as novas Import/Export Price Summary tables via as RPCs `get_imports_exports_imports_unit_price` / `get_imports_exports_exports_unit_price`; `mdic_comex` table e workflow ETL permanecem ativos), `/anp-cdp-diaria`, `/anp-cdp-bsw`, `/anp-cdp-depletion`, `/subsidy-tracker`, `/well-by-well` (Fase 2 de Field Stakes & Production — sumário executivo stake-weighted, Label "Brazil Production Summary" desde 2026-05-28 Round 5; renomeado de `/production` em 2026-05-28 Round 4), `/stock-guide` (Oil & Gas / Equities — comps + sensibilidade, mkt cap/upside/múltiplos derivados live via Yahoo proxy; 2026-06-01) + `/admin-analytics` (Admin-only, sem `module_visibility`)).
- Documentação inicial criada em **2026-05-05**.

### `/anp-cdp-diaria` blended company stakes — new dependency on the `/well-by-well` MV (2026-06-10)

Migration `20260618000000_anp_cdp_diaria_blended_stakes.sql` redefined `get_anp_cdp_diaria_empresa_serie` / `get_anp_cdp_diaria_empresa_campos` (signatures unchanged): `stake_pct` is now a per-(canonical field, month) **effective blended stake** (production-weighted tranche blend read from `mv_production_monthly.stake_pct_weighted`, with carry-forward + raw-stake fallback), fixing a ~185 kbpd Petrobras net-oil overstatement — the old raw-name `field_stakes` join weighted merged contract-split fields (BÚZIOS/ATAPU/SÉPIA) at the 100% ToR stake. **New cross-dashboard contract**: the `/anp-cdp-diaria` company RPCs now READ `mv_production_monthly` (the `/well-by-well` Round 5 MV) — any change to that MV involves `worker_supabase` + `worker_dash-well-by-well` + `worker_dash-anp-cdp-diaria`. Details: [`docs/supabase/PRD.md`](supabase/PRD.md) § "Blended company stakes for `/anp-cdp-diaria`", [`docs/app/anp-cdp-diaria.md`](app/anp-cdp-diaria.md) § "Blended effective stakes", [`docs/changelog.md`](changelog.md) (2026-06-10).

### Stock Guide — equities research dashboard (2026-06-01)

Novo dashboard `/stock-guide` (Oil & Gas / Equities): tabela de comps da cobertura O&G + Distribuição (target price, recomendação OP/MP/UP, fundamentos price-independent Y1/Y2 + 4 múltiplos forward derivados live EV/EBITDA · P/E · FCFE Yield · Div Yield) + grade de sensibilidade 2D freeform por empresa. **Market cap, upside e os 4 múltiplos computados live no browser** via Yahoo proxy (`/api/stocks/quote` + hook `useStockQuote`) + os fundamentos armazenados, nunca persistidos (fetch on-load + refresh manual, sem polling). A tabela armazena fundamentos em BRL mn (`net_debt_y1`/`net_debt_y2` por ano forward, `net_income_y1/y2`, `fcfe_y1/y2`, `dividends_y1/y2`, `ebitda_y1/y2`, `volumes_y1/y2`) — não múltiplos. Derivação: `Market cap = shares × price`; `EV(ano) = Market cap + net_debt(ano)`; `EV/EBITDA(ano) = EV(ano)/ebitda(ano)`; `P/E = Market cap/net_income(ano)`; `FCFE Yield = fcfe(ano)/Market cap`; `Div Yield = dividends(ano)/Market cap`; sempre computado (sem override), "—" se faltar fundamento. Backend: migration `supabase/migrations/20260603300000_stock_guide_fundamentals.sql` (rework de `20260603200000_stock_guide.sql` — dropa os 8 múltiplos armazenados, adiciona os fundamentos, reconstrói `get_stock_guide_comps` / `admin_get_stock_guide_companies` / `admin_upsert_stock_guide_company`) — 3 tabelas (`stock_guide_companies`, `stock_guide_sensitivity`, `stock_guide_config`, todas **RLS habilitada com zero policies** → acesso só via RPCs SECURITY DEFINER) + 10 RPCs (3 públicas + 7 admin). `get_stock_guide_comps()` é **hide-aware** — empresas ocultas têm financials (incl. os novos fundamentos) + `yahoo_symbol` nulados para não-admins, restando só o nome para o footnote "Currently restricted". Seed: 10 empresas (6 visíveis PETR4/PRIO3/RECV3/OPCT3/VBBR3/UGPA3 + 4 restritas BRAV3/RAIZ4/CSAN3/BRKM4). Comps/sensibilidade/hide/config são inputs admin-only numa nova seção do `/admin-panel` (Stock Guide — pass do `worker_dash-admin`). Dual-view (desktop tabela sticky + painel; mobile cards + BottomSheet), Tier 1 export desktop-only. NavBar: entrada top-level própria ("Stock Guide"), ao lado de Market Watch / News Hunter — fora de qualquer dropdown. Visibilidade: Client + Admin (`is_visible_for_public=false`). Owner UI: `worker_subgerente-app` → `worker_dash-stock-guide` (contratado nesta rodada; despachável na próxima sessão). DB layer pré-construído e aplicado live por `worker_supabase`. Contrato completo em § "Contrato `/stock-guide`" acima; sub-PRD em [`docs/app/stock-guide.md`](app/stock-guide.md).

**Drivers dinâmicos (2026-06-01, migration `20260607000000_stock_guide_driver_source.sql`):** `stock_guide_drivers` ganhou a coluna `source text` — um driver agora é **Static** (admin tipa `current_value`) OU **Dynamic** (bound a uma métrica de mercado pré-definida cujo valor é computado **live no browser** via Yahoo proxy, hook novo `src/hooks/useMarketDrivers.ts`). Catálogo client-side (4 métricas): `avg_brent_2026`/`avg_brent_2027` (USD/bbl — média mensal de 12 meses, realizado + curva forward do Brent) e `avg_fx_2026`/`avg_fx_2027` (BRL/USD — aproximação spot-flat, realizado YTD + spot mantido flat, sem FX forward no proxy). O valor computado dirige o destaque/interpolação do eixo driver nas tabelas de sensibilidade (substitui o `current_value` estático para drivers dinâmicos). `get_stock_guide_drivers()` retorna `source` (após `current_value`); `admin_upsert_stock_guide_driver` lê `source` (`''` → NULL = static). Detalhes em § "Contrato `/stock-guide`" acima e no sub-PRD § "Dynamic drivers".

### Reforma Mobile — light-only paradigm (2026-05-27)

Reforma cross-cutting do modo mobile do app entregue em 3 ondas (range `fac9e522..4ccca2b8`, ~30 commits). Resumo das mudanças firmadas (detalhes em `docs/app/PRD.md` § "Mobile reform 2026-05-27 — light-only paradigm" e `docs/app/dual-view-pattern.md`):

- **Onda 1 — Designer:** Liquid Glass v2 components (`MobileHomePill`, `MobileKebabMenu`, `MobileExcludedRedirect`, `MobileToastHost`, `MobileHomeCardPill`) + tokens `--mobile-*` em `globals.css` purgados de qualquer variante dark. Mobile é **light-only** definitivo.
- **Onda 2 — Shell:** `(dashboard)/layout.tsx` ganhou `DashboardShell` switcher (`DesktopShell` vs `MobileShell`). `MobileShell` monta `MobileTopBar` + `MobileHomePill` + `MobileToastHost`; `MobileTabBar` legado descontinuado. NavBar desktop é `hidden` em mobile. `useTrackLastVisited` (FIFO 4 slugs em `localStorage["sd_last_visited"]`) montado no shell. `/home` desktop intocado (split 50/50 cards + Data Sources); `/home v2` mobile reescrito do zero com `MobileHomeCardPill`. `/anp-prices` removido da lista mobile-eligible (cleanup pré-Onda 3).
- **Onda 3 — 10 dashboards refactored + 1 cleanup (`/anp-prices`):** Os 11 dashboards mobile-eligible (`/home`, `/well-by-well`, `/anp-cdp-bsw`, `/anp-cdp-depletion`, `/anp-cdp-diaria`, `/market-share`, `/price-bands`, `/subsidy-tracker`, `/diesel-gasoline-margins`, `/imports-exports`, `/navios-diesel`) ganharam `mobile/View.tsx` v2 (mobile-first, sem `ExportFAB`, design Liquid Glass v2). Os 9 mobile-excluded (`/stocks`, `/admin-panel`, `/admin-analytics`, `/news-hunter`, `/alerts`, `/profile`, `/anp-cdp`, `/anp-prices`, `/anp-glp`) tiveram `mobile/View.tsx` deletado e `page.tsx` reescrito com `MobileExcludedRedirect` + `DesktopView`. Cada `worker_dash-*` atualizou seu próprio `docs/app/<slug>.md` para refletir cobertura mobile.

**Export é desktop-only** — política dura firmada: nenhum download/export no mobile pós-reforma. Mobile é consumo; desktop é análise + download.

### Round 4 — Well by Well rename + canonical grouping + live admin field list (2026-05-28)

`/production` foi renomeado para `/well-by-well` (Label "Well by Well") para alinhar com a terminologia do relatório fonte. As 5 RPCs `get_production_*` foram estendidas com agrupamento canônico server-side via helper `canonical_field_name(text)` + tabela override `field_canonical_names(field_raw, field_canonical)` — variantes de nome de campo (Búzios / AnC_Búzios / Búzios_ECO etc.) são consolidadas em um único campo físico nos charts, top-fields e YoY do dashboard, enquanto a UI admin Field Stakes (`worker_dash-admin`) preserva a granularidade source-level para Eduardo registrar stakes por nome ANP raw. A lista de campos disponíveis no admin agora é **live** — populada das últimas 2 meses de `anp_cdp_producao` sem dependência de MV refresh, de modo que campos recém-produzindo aparecem sem reciclar ETL. Visibilidade preservada (`module_visibility.module_slug='well-by-well'`, Client + Admin only). Owner UI renomeado: `worker_dash-well-by-well` (era `worker_dash-production` — arquivo `.claude/agents/worker_dash-well-by-well.md` é local-only e gitignored, não aparece no commit). Sub-PRD renomeado: [`docs/app/well-by-well.md`](app/well-by-well.md) (era `docs/app/production.md`). Migration: `supabase/migrations/20260528300000_well_by_well_round4.sql`. Frentes: A (`worker_supabase` — DDL/RPC/MV), B (`worker_dash-well-by-well` — UI rename + sub-PRD), C (`worker_dash-admin` — admin Field Stakes live list), D (`worker_documentador` — README + master + agent rename).

### Round 5 — Brazil Production Summary + Monthly Production renames (2026-05-28)

Dashboards `/well-by-well` and `/anp-cdp` were renamed in all user-facing surfaces:
- "Well by Well" → "Brazil Production Summary" (executive view, `/well-by-well` slug unchanged)
- "Production by Well" → "Monthly Production" (analyst view, `/anp-cdp` slug unchanged)

Slugs, URLs, RPCs, tables and migrations untouched — UI-string-only rename.

### Data Sources live table na `/home` (2026-05-26)

`/home` desktop ganhou tabela live "Data Sources" no lado direito (split 50/50; mobile mantém só cards via `[desktop-only]`). Backend: nova RPC `get_data_sources_freshness()` (migration `20260526200000_data_sources_freshness.sql`) retornando `(source_key, last_update, row_count)` para 22 tabelas alimentadas por ETL; SECURITY DEFINER + search_path locked; `GRANT EXECUTE TO anon, authenticated`; polled 60s pelo front. Curadoria das fontes (categoria, cron, descrição, dashboards consumidores) vive em `src/data/dataSources.ts` (23 entries — 22 tabelas + Yahoo Finance). UI components em `src/components/home/DataSourcesTable/` (8 arquivos: `index.tsx`, `SectionHeader`, `SourceRow`, `ExpandedRow`, `StatusDot`, `LastUpdateCell`, `DashboardPicker`, `useDataSourcesFreshness`). Design tokens novos em `src/app/globals.css` (`--ds-cat-*`, `--ds-status-*`, `--ds-glass-*`, `--ds-pulse-*` + keyframe `ds-pulse-dot` + classe `.ds-pulse`). Visível para todos os tiers (Anon + Client + Admin) — transparência do produto. Detalhes em [`docs/app/admin.md`](app/admin.md) § "Data Sources live table".

### Production dashboard — Fase 2 de Field Stakes & Production (2026-05-26, renomeado em 2026-05-28 — ver Round 4 acima)

Fase 2 da iniciativa Field Stakes & Production entregue: dashboard `/production` (renomeado para `/well-by-well` em 2026-05-28 — Round 4) ativo com agregados stake-weighted por empresa (default Petrobras), 4 panels (Brasil agregado / empresa agregada / top campos / FPSO breakdown) + tabela YoY/MoM/YTD, dual-view (desktop 2×2 + mobile tab bar), Tier 1 export. Backend: 5 RPCs novas (`get_production_brazil_aggregate`, `get_production_company_aggregate`, `get_production_top_fields`, `get_production_by_installation`, `get_production_yoy_table`) em `supabase/migrations/20260528000000_production_rpcs.sql`, todas SECURITY DEFINER + search_path locked, granted to anon+authenticated. JOIN `anp_cdp_producao × field_stakes` com filtro `SUM(stake_pct)=100` por campo — campos com stakes parciais são silenciosamente excluídos para não inflar totais. Visibilidade: Client + Admin (Anon não enxerga; `is_visible_for_public=false`). Owners: schema `worker_supabase`; UI `worker_subgerente-app` → `worker_dash-well-by-well` (PRD em `docs/app/well-by-well.md`); admin panel `worker_dash-admin` (visibilidade + home image). TODO Eduardo: completar as 240 lacunas em `field_stakes` via `/admin-panel → Field Stakes` — lista categorizada em [`docs/dados-locais/field_stakes_lacunas.md`](dados-locais/field_stakes_lacunas.md). Até lá, agregados por empresa subestimam a real (decisão de design: preferir subestimar a inflar).

### Field Stakes admin input — Fase 1 de Field Stakes & Production (2026-05-26)

Nova tabela admin-curated `field_stakes(campo, empresa, stake_pct)` + nova seção CRUD no `/admin-panel` (Field Stakes). Permite ao Admin (Eduardo) registrar a participação societária de cada campo de petróleo por empresa — base para estimar produção atribuível por companhia (ex.: Petrobras 88.99% de Búzios). Migration: `supabase/migrations/20260527600000_field_stakes.sql`. 5 RPCs novas (`get_field_stakes_overview`, `get_field_stakes`, `get_field_stakes_empresas`, `admin_upsert_field_stakes`, `admin_delete_field_stakes`) — todas SECURITY DEFINER + search_path locked; reads abertas a anon+authenticated, writes gated por `is_admin()` com validação atômica `SUM(stake_pct) = 100` por campo. Owner do schema: `worker_supabase` (vide [`docs/supabase/PRD.md`](supabase/PRD.md)). Owner da UI: `worker_dash-admin` (vide [`docs/app/admin.md`](app/admin.md) § "Field Stakes"). **Fase 2 planejada (PRD separado, não implementada ainda):** dashboard `/well-by-well` (originalmente `/production`, renomeado em 2026-05-28) com charts replicando o relatório mensal Well-by-Well (Brasil agregado, Petrobras agregado via stakes, top campos, FPSOs, YoY/MoM), JOIN `anp_cdp_producao` × `field_stakes`.

### Consolidação Sales Volumes → Market Share (2026-05-26)

`/sales-volumes` foi retirado e suas funcionalidades absorvidas por `/market-share` via um toggle top-level "% Share" ↔ "thousand m³". O URL `/sales-volumes` agora 301-redireciona para `/market-share?unit=volume`. Owner único agora é `worker_dash-market-share`; o `worker_dash-sales-volumes` é aposentado. Sub-PRD antigo arquivado em [`docs/app/_deprecated/sales-volumes.md`](app/_deprecated/sales-volumes.md). Tabelas e RPCs `get_sv_*` / `get_ms_*` preservadas no DB; mudanças de RPC entregues pela Frente 2 (migration dedicada).

### Reforma de Subsídio do Diesel (2026-05-27)

`/subsidy-tracker` e `/price-bands` foram reescritos para refletir a mecânica real de subsídio do diesel. A tabela `anp_subsidy_history` (que tratava subsídio como diferença) foi DROPADA e substituída por duas tabelas novas: `anp_subsidy_caps` (teto do reembolso por `(vigente_desde, tipo_agente)`) e `anp_subsidy_commercialization` (preço de comercialização período × região × `tipo_agente`, populada por scrape HTML). A função `compute_subsidy_reimbursement(date, tipo_agente)` calcula `AVG(MIN(MAX(ref − comm, 0), cap))` sobre as 5 regiões, e 4 triggers em `price_bands` mantêm as colunas `bba_import_parity_w_subsidy` e `petrobras_price_w_subsidy` sempre coerentes com os inputs. RPC `get_subsidy_tracker_diesel()` foi reescrita com 11 colunas (sufixos `_importador`/`_produtor`, inclui `ipp_adjusted` e `petrobras_adjusted`). ETL `scripts/pipelines/anp/subsidy_diesel_sync.py` ganhou stage HTML novo (`_scrape_commercialization`) + CLI flags `--mode {incremental,backfill}`, `--skip-commercialization`, `--commercialization-only`. Upload Excel de `data/price_bands.xlsx` (`scripts/manual/price_bands_upload.py`) parou de enviar as 2 colunas `_w_subsidy` (agora auto-computadas via trigger). RPC `get_data_sources_freshness()` foi atualizada via hotfix (`20260527300000`) — 23 sources (era 22). Migrations: `supabase/migrations/20260527200000_subsidy_reform.sql` + `20260527300000_data_sources_freshness_subsidy_fix.sql`. Detalhes em `docs/supabase/PRD.md` § "Subsidy Reform (2026-05-27)" e `docs/etl-pipelines/PRD.md` § "Subsidy commercialization HTML scrape (2026-05-27)".

### Reforma ANP Prices (2026-05-26)

`/anp-prices` substitui os 3 dashboards retirados `/anp-precos-produtores`, `/anp-precos-distribuicao`, `/anp-lpc`. Backend: UNION ALL server-side das 3 tabelas (`anp_precos_produtores`, `anp_precos_distribuicao`, `anp_lpc`) via `get_anp_prices_serie`, com normalização de produto/unidade/região, fallback Diesel S10→S500 e GLP normalizado para R$/13kg. 3 RPCs novas (`get_anp_prices_filtros`, `get_anp_prices_serie`, `get_anp_prices_export_count`); 10 RPCs legadas dropadas. Tabelas-fonte e pipelines ETL intactos (`etl_anp_precos.yml`, `etl_anp_lpc.yml`, `etl_anp_precos_distribuicao.yml`). Sub-PRDs antigos arquivados em `docs/app/_deprecated/`. Migrations: `supabase/migrations/20260526000000_anp_prices_consolidation.sql` + `20260526000001_anp_prices_uf_fix.sql`. Owner: `worker_dash-anp-prices`.

### Limpeza inicial (2026-05-05)

Resolvido:
- `components/` na raiz — deletado (só tinha `__pycache__`).
- `frontend-next/` na raiz — deletado (tentativa antiga abandonada). Referência stale em `src/app/login/page.tsx:96` corrigida.
- `news-hunter-handoff.txt` na raiz — movido para [`docs/etl-pipelines/news-hunter-architecture.md`](etl-pipelines/news-hunter-architecture.md).
- Workflows `etl_anp_vendas.yml` e `etl_anp_fase3.yml` — confirmados ATIVOS (anp-watcher: dispatch externo via cron-job.org + cron interno de 2h como fallback, serializados pelo concurrency group `anp-vendas`; etl_anp_fase3 roda mensal). Adicionados aos PRDs do ETL.

## Compliance / LGPD

| Página | Rota | Tipo | Owner |
|---|---|---|---|
| Terms of Service | `/terms` | Página estática pública (sem auth) | `worker_subgerente-app` |
| Privacy Policy | `/privacy` | Página estática pública (sem auth) | `worker_subgerente-app` |

- Ambas as páginas são **públicas** (fora do grupo `(dashboard)`, sem auth guard).
- Footer com links para `/terms`, `/privacy` e `mailto:eduardo.mendes@itaubba.com` integrado em: `(dashboard)/layout.tsx`, `login/page.tsx`, `forgot-password/page.tsx`.
- Conteúdo é **DRAFT** — requer revisão jurídica antes de uso em produção.
- Em mudanças materiais (novos sub-processadores, novos dados coletados, alteração de retenção), o Documentador deve atualizar `src/app/privacy/page.tsx` e notificar usuários por email conforme seção 11 da Privacy Policy.
- DPO: eduardo.mendes@itaubba.com

Tech debt conhecido (não resolvido):
- **`sql/` na raiz contém DDL aplicado direto no Supabase Dashboard, NÃO versionado em `supabase/migrations/`.** Tabelas afetadas: `price_bands`, `profiles`, `module_visibility` (colunas: `module_slug PK`, `is_visible_for_clients`, `is_visible_on_home DEFAULT true`). Recriar o DB apenas das migrations resultaria em DB incompleto. **Ação futura**: APP deve converter os 3 arquivos em migrations próprias, depois remover `sql/`.
- **Scripts Python na raiz** (`ais_*.py`, `pipelines/navios/01_lineup_scrape.py`, `vessel_*.py`, `pipelines/navios/04_cabotage_cleanup.py`, `pipelines/anp/vendas_watch.py`) convivem com `scripts/`. Mover requer atualizar workflows correspondentes — feito quando houver janela.
