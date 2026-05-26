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
     │   ├─ dash-imports-exports          (/imports-exports — Fuel Distribution; substitui /anp-daie + /anp-desembaracos + /anp-painel-importacoes; absorveu /mdic-comex via Panel C "Import Price" em 2026-05-25)
     │   ├─ dash-anp-cdp-diaria          (/anp-cdp-diaria — Oil & Gas)
     │   ├─ dash-subsidy-tracker          (/subsidy-tracker — Fuel Distribution, dados proprietários)
     │   ├─ dash-admin-analytics          (/admin-analytics — Admin-only, sem module_visibility)
     │   └─ dash-alerts                   (/alerts — User-Facing Email Subscriptions, anon+client+admin)
     │
     ├─ Supabase / DB    (schema Postgres, migrations, RLS, RPCs SQL,
     │                    materialized views, supabase_deploy workflow)
     ├─ Dados Locais     (Excels manuais + scripts de upload)
     ├─ ETL / Pipelines  (scrapers automáticos + GitHub Actions)
     ├─ Alertas          (subsistema autocontido em alertas/ — LOCAL-ONLY,
     │                    single-recipient Eduardo via Gmail API; coexiste com
     │                    Alerts Product durante cutover)
     ├─ Alerts Product   (cloud, multi-recipient — scripts/alerts/, detection +
     │                    fanout + delivery via Resend, consumido por /alerts)
     │
     ├─ Designer         (transversal — identidade visual + boas práticas;
     │                    consultado pelos dash-* antes de mudança visual)
     │
     └─ Revisor / QA     (transversal — audita diff antes do commit)
```

## 📱 Dual-view (web + mobile) — princípio cross-cutting

A partir de 2026-05-20, todo dashboard tem 2 views (`desktop/View.tsx` + `mobile/View.tsx`) consumindo um hook compartilhado `use<Slug>Data.ts`. Mobile = mesma análise, roupagem adaptada. **Regra de sync binding**: edição em uma view exige equivalente na outra no mesmo commit, ou tag explícita `[desktop-only]` / `[mobile-only]` na mensagem. Vide `CLAUDE.md` § "Dual-view (web + mobile) policy" e `docs/app/PRD.md` § "Dual-view foundation".

## Departamentos

| Dept | Slug do agente | Ownership de pastas | PRD |
|---|---|---|---|
| APP (Subgerente) | [`worker_subgerente-app`](../.claude/agents/worker_subgerente-app.md) | `src/` (infra compartilhada), `public/`, `.vercel/`, configs Next/TS | [`docs/app/PRD.md`](app/PRD.md) |
| Supabase / DB | [`worker_supabase`](../.claude/agents/worker_supabase.md) | `supabase/migrations/`, `supabase/config.toml`, `sql/` (legado), `supabase_deploy.yml` | [`docs/supabase/PRD.md`](supabase/PRD.md) |
| Dados Locais | [`worker_dados-locais`](../.claude/agents/worker_dados-locais.md) | `data/`, `scripts/manual/dg_margins_upload.py`, `scripts/manual/price_bands_upload.py` | [`docs/dados-locais/PRD.md`](dados-locais/PRD.md) |
| ETL / Pipelines | [`worker_etl-pipelines`](../.claude/agents/worker_etl-pipelines.md) | `DADOS/`, `output/`, `scripts/pipelines/` (todos os scrapers), `.github/workflows/` dos scrapers | [`docs/etl-pipelines/PRD.md`](etl-pipelines/PRD.md) |
| Alertas (legado, local-only) | [`worker_alertas`](../.claude/agents/worker_alertas.md) | `alertas/` (autocontido, gitignored) | [`docs/alertas/PRD.md`](alertas/PRD.md) |
| Alerts Product (cloud, multi-recipient) | [`worker_alerts-product`](../.claude/agents/worker_alerts-product.md) | `scripts/alerts/`, `src/app/api/alerts/`, `.github/workflows/alerts_*.yml`, email templates | [`docs/alerts/PRD.md`](alerts/PRD.md) |
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
| [`worker_dash-anp-cdp`](../.claude/agents/worker_dash-anp-cdp.md) | `/anp-cdp` | [`docs/app/anp-cdp.md`](app/anp-cdp.md) |
| [`worker_dash-anp-cdp-bsw`](../.claude/agents/worker_dash-anp-cdp-bsw.md) | `/anp-cdp-bsw` (Oil & Gas) | [`docs/app/anp-cdp-bsw.md`](app/anp-cdp-bsw.md) |
| [`worker_dash-anp-cdp-depletion`](../.claude/agents/worker_dash-anp-cdp-depletion.md) | `/anp-cdp-depletion` (Oil & Gas) | [`docs/app/anp-cdp-depletion.md`](app/anp-cdp-depletion.md) |
| [`worker_dash-anp-glp`](../.claude/agents/worker_dash-anp-glp.md) | `/anp-glp` | [`docs/app/anp-glp.md`](app/anp-glp.md) |
| [`worker_dash-anp-prices`](../.claude/agents/worker_dash-anp-prices.md) | `/anp-prices` (substitui `/anp-precos-produtores` + `/anp-precos-distribuicao` + `/anp-lpc` retirados em 2026-05-26; UNION ALL server-side das 3 tabelas com normalização de produto/unidade/região, fallback Diesel S10→S500, GLP normalizado para R$/13kg) | [`docs/app/anp-prices.md`](app/anp-prices.md) |
| [`worker_dash-imports-exports`](../.claude/agents/worker_dash-imports-exports.md) | `/imports-exports` (substitui `/anp-daie` + `/anp-desembaracos` + `/anp-painel-importacoes`; consolida importações por país e por importador a partir da `anp_desembaracos` enriquecida + exportações via `anp_daie`) | [`docs/app/imports-exports.md`](app/imports-exports.md) |
| [`worker_dash-anp-cdp-diaria`](../.claude/agents/worker_dash-anp-cdp-diaria.md) | `/anp-cdp-diaria` | [`docs/app/anp-cdp-diaria.md`](app/anp-cdp-diaria.md) |
| [`worker_dash-subsidy-tracker`](../.claude/agents/worker_dash-subsidy-tracker.md) | `/subsidy-tracker` (Fuel Distribution — dados proprietários) | [`docs/app/subsidy-tracker.md`](app/subsidy-tracker.md) |
| [`worker_dash-admin-analytics`](../.claude/agents/worker_dash-admin-analytics.md) | `/admin-analytics` (Admin-only — sem `module_visibility`; backed por `app_events`) | [`docs/app/admin-analytics.md`](app/admin-analytics.md) |
| [`worker_dash-alerts`](../.claude/agents/worker_dash-alerts.md) | `/alerts` (User-Facing Email Subscriptions — anon double opt-in, hybrid per-source granularity, instant cadence, Resend delivery via `worker_alerts-product`) | [`docs/app/alerts.md`](app/alerts.md) |

## Papéis transversais (não donos de pasta)

| Papel | Slug | Quando entra |
|---|---|---|
| Gerente Geral | [`worker_gerente-geral`](../.claude/agents/worker_gerente-geral.md) | Início de qualquer tarefa nova ou ambígua. Roteia para o(s) dept(s) corretos. |
| Documentador | [`worker_documentador`](../.claude/agents/worker_documentador.md) | Após qualquer mudança que altere contrato cross-dept. Mantém `master.md` + PRDs de departamento. (Sub-PRDs por dashboard são auto-mantidos pelo `dash-*` correspondente.) |
| Designer | [`worker_designer`](../.claude/agents/worker_designer.md) | Antes de qualquer mudança visual ou em `globals.css`. Carrega [`docs/design/identity.md`](design/identity.md) e [`docs/design/best-practices.md`](design/best-practices.md). |
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
| ETL | Escreve via supabase-py (service key) — popula `vendas`, `navios_diesel`, `news_articles`, `mdic_comex`, `anp_precos_produtores`, `anp_glp`, `anp_daie`, `anp_desembaracos` (enriquecida com `importador`, `cnpj`, `uf_cnpj`), `anp_lpc`, `anp_cdp_producao`, `anp_precos_distribuicao`, `anp_cdp_diaria`, `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco`, `anp_voip`, `anp_subsidy_diesel_reference`, `anp_subsidy_commercialization` (HTML scrape stage adicionado em 2026-05-27). `anp_subsidy_caps` é mantida manualmente (cardinalidade muito baixa). |
| Dados Locais | Escreve via supabase-py (service key) — popula `d_g_margins`, `price_bands` |
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
| `compute_subsidy_reimbursement(date, tipo_agente)` | RPC interna `LANGUAGE sql STABLE SECURITY DEFINER` + `SET search_path = public, pg_temp`. Retorna AVG das 5 regiões de `MIN(MAX(ref − comm, 0), cap)`, ou NULL se faltar input. Granted to anon + authenticated. |
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
| `data/d_g_margins.xlsx` | `d_g_margins` |
| `data/price_bands.xlsx` | `price_bands` |
| `data/Liquidos_Vendas_Atual.csv` | (verificar uso atual) |

ETL **não toca** em `data/` — esses arquivos são manuais por design.

### Histórico de alertas

**Dono:** Alertas. Arquivo: `DADOS/historico_alertas.csv` (append-only).

ETL pode ler para análise; somente Alertas escreve.

### Workflows GitHub Actions

**Dono:** ETL (e APP, no caso do `supabase_deploy.yml`).

Cada workflow novo precisa: secrets registrados no GitHub, schedule cron, e linha no `docs/etl-pipelines/PRD.md`.

Workflows ativos para as tabelas novas: `etl_mdic_comex.yml`, `etl_anp_precos.yml` (preços produtores + GLP), `etl_anp_fase3.yml` (2 steps: DAIE + desembaraços enriquecidos com `importador`/`cnpj`/`uf_cnpj`; o antigo step `03_painel_imp_sync.py` foi deletado em 2026-05-25 junto com a tabela `anp_painel_imp_dist` na reforma `/imports-exports` — migration `20260525000010_imports_exports_enrichment.sql`), `etl_anp_lpc.yml`, `etl_anp_cdp.yml` (CDP), `etl_anp_precos_distribuicao.yml` (preços de distribuição), `etl_anp_cdp_diaria.yml` (produção diária 3 níveis — campo/instalação/poço — 3×/dia, CLI `--level all --upload`), `etl_anp_voip.yml` (VOIP por campo — anual, 1º de maio, source BAR/ANP), `etl_anp_subsidy_diesel.yml` (referência de preços subsídio diesel — diário 11:30 UTC, script `pipelines/anp/subsidy_diesel_sync.py`, target `anp_subsidy_diesel_reference`). Ver `docs/etl-pipelines/PRD.md` para schedules e scripts.

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
- 15 dashboards ativos (7 originais — `/sales-volumes` retirado em 2026-05-26 e absorvido por `/market-share` via toggle % Share ↔ thousand m³ — + 2 da Fase 3 remanescentes: `/anp-cdp`, `/anp-glp` + 6 novos: `/anp-prices` (consolida `/anp-precos-produtores` + `/anp-precos-distribuicao` + `/anp-lpc` retirados em 2026-05-26), `/imports-exports` (consolida `/anp-daie` + `/anp-desembaracos` + `/anp-painel-importacoes` retirados em 2026-05-25; absorveu `/mdic-comex` via Panel C "Import Price" no mesmo dia — `mdic_comex` table e workflow ETL permanecem ativos alimentando Panel C), `/anp-cdp-diaria`, `/anp-cdp-bsw`, `/anp-cdp-depletion`, `/subsidy-tracker` + `/admin-analytics` (Admin-only, sem `module_visibility`)).
- Documentação inicial criada em **2026-05-05**.

### Data Sources live table na `/home` (2026-05-26)

`/home` desktop ganhou tabela live "Data Sources" no lado direito (split 50/50; mobile mantém só cards via `[desktop-only]`). Backend: nova RPC `get_data_sources_freshness()` (migration `20260526200000_data_sources_freshness.sql`) retornando `(source_key, last_update, row_count)` para 22 tabelas alimentadas por ETL; SECURITY DEFINER + search_path locked; `GRANT EXECUTE TO anon, authenticated`; polled 60s pelo front. Curadoria das fontes (categoria, cron, descrição, dashboards consumidores) vive em `src/data/dataSources.ts` (23 entries — 22 tabelas + Yahoo Finance). UI components em `src/components/home/DataSourcesTable/` (8 arquivos: `index.tsx`, `SectionHeader`, `SourceRow`, `ExpandedRow`, `StatusDot`, `LastUpdateCell`, `DashboardPicker`, `useDataSourcesFreshness`). Design tokens novos em `src/app/globals.css` (`--ds-cat-*`, `--ds-status-*`, `--ds-glass-*`, `--ds-pulse-*` + keyframe `ds-pulse-dot` + classe `.ds-pulse`). Visível para todos os tiers (Anon + Client + Admin) — transparência do produto. Detalhes em [`docs/app/admin.md`](app/admin.md) § "Data Sources live table".

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
- Workflows `etl_anp_vendas.yml` e `etl_anp_fase3.yml` — confirmados ATIVOS (anp-watcher é trigger externo via cron-job.org; etl_anp_fase3 roda mensal). Adicionados aos PRDs do ETL.

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
- **Scripts Python na raiz** (`ais_*.py`, `pipelines/navios/01_lineup_scrape.py`, `vessel_*.py`, `pipelines/navios/04_cabotage_cleanup.py`, `pipelines/anp/vendas_watch.py`, `scripts/manual/dg_margins_upload.py`) convivem com `scripts/`. Mover requer atualizar workflows correspondentes — feito quando houver janela.
