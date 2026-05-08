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
     │   ├─ dash-sales-volumes            (/sales-volumes)
     │   ├─ dash-market-share             (/market-share)
     │   ├─ dash-navios-diesel            (/navios-diesel + sub-páginas futuras)
     │   ├─ dash-margins                  (/diesel-gasoline-margins)
     │   ├─ dash-price-bands              (/price-bands)
     │   ├─ dash-stocks                   (/stocks + Yahoo proxy + components/stocks/)
     │   ├─ dash-news-hunter              (/news-hunter — coord. com repo scanner)
     │   ├─ dash-admin                    (/home + /profile + /admin-panel)
     │   ├─ dash-anp-cdp                  (/anp-cdp — Oil & Gas)
     │   ├─ dash-anp-cdp-bsw             (/anp-cdp-bsw — Oil & Gas)
     │   ├─ dash-anp-ppi                  (/anp-ppi — Fuel Distribution)
     │   ├─ dash-anp-precos-produtores    (/anp-precos-produtores — Fuel Distribution)
     │   ├─ dash-anp-glp                  (/anp-glp — Fuel Distribution)
     │   ├─ dash-mdic-comex               (/mdic-comex — Oil & Gas / Fuel Distribution)
     │   ├─ dash-anp-lpc                  (/anp-lpc — Fuel Distribution)
     │   ├─ dash-sindicom                 (/sindicom — Fuel Distribution)
     │   ├─ dash-anp-daie                 (/anp-daie — Oil & Gas / Fuel Distribution)
     │   ├─ dash-anp-desembaracos         (/anp-desembaracos — Oil & Gas / Fuel Distribution)
     │   ├─ dash-anp-painel-importacoes   (/anp-painel-importacoes — Oil & Gas / Fuel Distribution)
     │   ├─ dash-anp-precos-distribuicao  (/anp-precos-distribuicao — Fuel Distribution)
     │   ├─ dash-anp-cdp-diaria          (/anp-cdp-diaria — Oil & Gas)
     │   └─ dash-admin-analytics          (/admin-analytics — Admin-only, sem module_visibility)
     │
     ├─ Supabase / DB    (schema Postgres, migrations, RLS, RPCs SQL,
     │                    materialized views, supabase_deploy workflow)
     ├─ Dados Locais     (Excels manuais + scripts de upload)
     ├─ ETL / Pipelines  (scrapers automáticos + GitHub Actions)
     ├─ Alertas          (subsistema autocontido em alertas/)
     │
     ├─ Designer         (transversal — identidade visual + boas práticas;
     │                    consultado pelos dash-* antes de mudança visual)
     │
     └─ Revisor / QA     (transversal — audita diff antes do commit)
```

## Departamentos

| Dept | Slug do agente | Ownership de pastas | PRD |
|---|---|---|---|
| APP (Subgerente) | [`worker_subgerente-app`](../.claude/agents/worker_subgerente-app.md) | `src/` (infra compartilhada), `public/`, `.vercel/`, configs Next/TS | [`docs/app/PRD.md`](app/PRD.md) |
| Supabase / DB | [`worker_supabase`](../.claude/agents/worker_supabase.md) | `supabase/migrations/`, `supabase/config.toml`, `sql/` (legado), `supabase_deploy.yml` | [`docs/supabase/PRD.md`](supabase/PRD.md) |
| Dados Locais | [`worker_dados-locais`](../.claude/agents/worker_dados-locais.md) | `data/`, `scripts/manual/dg_margins_upload.py`, `scripts/manual/price_bands_upload.py` | [`docs/dados-locais/PRD.md`](dados-locais/PRD.md) |
| ETL / Pipelines | [`worker_etl-pipelines`](../.claude/agents/worker_etl-pipelines.md) | `DADOS/`, `output/`, `scripts/pipelines/` (todos os scrapers), `.github/workflows/` dos scrapers | [`docs/etl-pipelines/PRD.md`](etl-pipelines/PRD.md) |
| Alertas | [`worker_alertas`](../.claude/agents/worker_alertas.md) | `alertas/` (autocontido) | [`docs/alertas/PRD.md`](alertas/PRD.md) |

## Sub-agentes do APP (donos de dashboard)

Cada um possui um módulo (ou bundle, no caso de admin). Cada um auto-documenta seu sub-PRD em `docs/app/<slug>.md`.

| Slug | Cobertura | Sub-PRD |
|---|---|---|
| [`worker_dash-sales-volumes`](../.claude/agents/worker_dash-sales-volumes.md) | `/sales-volumes` | [`docs/app/sales-volumes.md`](app/sales-volumes.md) |
| [`worker_dash-market-share`](../.claude/agents/worker_dash-market-share.md) | `/market-share` | [`docs/app/market-share.md`](app/market-share.md) |
| [`worker_dash-navios-diesel`](../.claude/agents/worker_dash-navios-diesel.md) | `/navios-diesel` (+ sub-páginas) | [`docs/app/navios-diesel.md`](app/navios-diesel.md) |
| [`worker_dash-margins`](../.claude/agents/worker_dash-margins.md) | `/diesel-gasoline-margins` | [`docs/app/diesel-gasoline-margins.md`](app/diesel-gasoline-margins.md) |
| [`worker_dash-price-bands`](../.claude/agents/worker_dash-price-bands.md) | `/price-bands` | [`docs/app/price-bands.md`](app/price-bands.md) |
| [`worker_dash-stocks`](../.claude/agents/worker_dash-stocks.md) | `/stocks` + Yahoo proxy + `components/stocks/` | [`docs/app/stocks.md`](app/stocks.md) |
| [`worker_dash-news-hunter`](../.claude/agents/worker_dash-news-hunter.md) | `/news-hunter` (coord. com repo scanner) | [`docs/app/news-hunter.md`](app/news-hunter.md) |
| [`worker_dash-admin`](../.claude/agents/worker_dash-admin.md) | `/home` + `/profile` + `/admin-panel` | [`docs/app/admin.md`](app/admin.md) |
| [`worker_dash-anp-cdp`](../.claude/agents/worker_dash-anp-cdp.md) | `/anp-cdp` | [`docs/app/anp-cdp.md`](app/anp-cdp.md) |
| [`worker_dash-anp-cdp-bsw`](../.claude/agents/worker_dash-anp-cdp-bsw.md) | `/anp-cdp-bsw` (Oil & Gas) | [`docs/app/anp-cdp-bsw.md`](app/anp-cdp-bsw.md) |
| [`worker_dash-anp-ppi`](../.claude/agents/worker_dash-anp-ppi.md) | `/anp-ppi` | [`docs/app/anp-ppi.md`](app/anp-ppi.md) |
| [`worker_dash-anp-precos-produtores`](../.claude/agents/worker_dash-anp-precos-produtores.md) | `/anp-precos-produtores` | [`docs/app/anp-precos-produtores.md`](app/anp-precos-produtores.md) |
| [`worker_dash-anp-glp`](../.claude/agents/worker_dash-anp-glp.md) | `/anp-glp` | [`docs/app/anp-glp.md`](app/anp-glp.md) |
| [`worker_dash-mdic-comex`](../.claude/agents/worker_dash-mdic-comex.md) | `/mdic-comex` | [`docs/app/mdic-comex.md`](app/mdic-comex.md) |
| [`worker_dash-anp-lpc`](../.claude/agents/worker_dash-anp-lpc.md) | `/anp-lpc` | [`docs/app/anp-lpc.md`](app/anp-lpc.md) |
| [`worker_dash-sindicom`](../.claude/agents/worker_dash-sindicom.md) | `/sindicom` | [`docs/app/sindicom.md`](app/sindicom.md) |
| [`worker_dash-anp-daie`](../.claude/agents/worker_dash-anp-daie.md) | `/anp-daie` | [`docs/app/anp-daie.md`](app/anp-daie.md) |
| [`worker_dash-anp-desembaracos`](../.claude/agents/worker_dash-anp-desembaracos.md) | `/anp-desembaracos` | [`docs/app/anp-desembaracos.md`](app/anp-desembaracos.md) |
| [`worker_dash-anp-painel-importacoes`](../.claude/agents/worker_dash-anp-painel-importacoes.md) | `/anp-painel-importacoes` | [`docs/app/anp-painel-importacoes.md`](app/anp-painel-importacoes.md) |
| [`worker_dash-anp-precos-distribuicao`](../.claude/agents/worker_dash-anp-precos-distribuicao.md) | `/anp-precos-distribuicao` | [`docs/app/anp-precos-distribuicao.md`](app/anp-precos-distribuicao.md) |
| [`worker_dash-anp-cdp-diaria`](../.claude/agents/worker_dash-anp-cdp-diaria.md) | `/anp-cdp-diaria` | [`docs/app/anp-cdp-diaria.md`](app/anp-cdp-diaria.md) |
| [`worker_dash-admin-analytics`](../.claude/agents/worker_dash-admin-analytics.md) | `/admin-analytics` (Admin-only — sem `module_visibility`; backed por `app_events`) | [`docs/app/admin-analytics.md`](app/admin-analytics.md) |

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
| ETL | Escreve via supabase-py (service key) — popula `vendas`, `navios_diesel`, `news_articles`, `mdic_comex`, `anp_ppi`, `anp_precos_produtores`, `anp_glp`, `anp_daie`, `anp_desembaracos`, `anp_painel_imp_dist`, `anp_lpc`, `sindicom`, `anp_cdp_producao`, `anp_precos_distribuicao`, `anp_cdp_diaria`, `anp_cdp_diaria_instalacao`, `anp_cdp_diaria_poco`. |
| Dados Locais | Escreve via supabase-py (service key) — popula `d_g_margins`, `price_bands` |
| Alertas | Lê via supabase-py — verifica mudanças em fontes monitoradas |

**Tabela de eventos de uso (`app_events`):** criada pela feature Admin Analytics. Ingestão exclusivamente via RPC `track_event(event_type, route, payload)` — o SQL captura `auth.uid()` internamente; INSERT direto do frontend é bloqueado por RLS. SELECT restrito a Admin via RLS. Admins são excluídos dos agregados pelo filtro `role <> 'Admin'` dentro das RPCs read.

| RPC de ingestion | Chamado por |
|---|---|
| `track_event(event_type, route, payload)` | `(dashboard)/layout.tsx` (login, page_view) + `ExportPanel` / `ExportModal` (export) |

| RPC Admin read-only | Retorna |
|---|---|
| `get_analytics_kpis(period)` | DAU/WAU/MAU, total users, active users, exports, page views, logins |
| `get_analytics_by_dashboard(period)` | Engajamento agregado por rota |
| `get_analytics_by_user(period)` | Engajamento por usuário |
| `get_analytics_user_timeline(user_id, period)` | Timeline de eventos de um usuário específico |
| `get_analytics_heatmap(period)` | Matriz dia-da-semana × hora |

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

Workflows ativos para as tabelas novas: `etl_mdic_comex.yml`, `etl_anp_precos.yml` (PPI + preços produtores + GLP), `etl_anp_fase3.yml` (DAIE + desembaraços + painel importações), `etl_anp_lpc.yml`, `etl_sindicom.yml`, `etl_anp_cdp.yml` (CDP), `etl_anp_precos_distribuicao.yml` (preços de distribuição), `etl_anp_cdp_diaria.yml` (produção diária 3 níveis — campo/instalação/poço — 3×/dia, CLI `--level all --upload`). Ver `docs/etl-pipelines/PRD.md` para schedules e scripts.

---

## Convenções gerais

### Padrão de Export (Fase B — 2026-05)

Todos os dashboards com dataset tabular exportam Excel + CSV. Dois tiers conforme volume estimado:

| Tier | Critério | UX | Componentes |
|---|---|---|---|
| **Tier 1** | Dataset < 50k linhas (download imediato seguro) | Botões diretos no `ExportPanel` | [`ExportPanel.tsx`](../src/components/dashboard/ExportPanel.tsx) + [`exportExcel.ts`](../src/lib/exportExcel.ts) + [`exportCsv.ts`](../src/lib/exportCsv.ts) |
| **Tier 2** | Dataset >= 50k linhas (export pode ser pesado) | Modal com filtros ativos + calculadora live de tamanho | `ExportPanel` com `mode="modal"` + [`ExportModal.tsx`](../src/components/dashboard/ExportModal.tsx) + [`useExportSize.ts`](../src/hooks/useExportSize.ts) |

**Dashboards Tier 2:** `/market-share`, `/sales-volumes` (dataset `vendas`), `/mdic-comex`, `/anp-cdp`, `/anp-lpc`.

**Dashboards Tier 1:** `/diesel-gasoline-margins`, `/price-bands`, `/navios-diesel`, `/anp-glp`, `/anp-daie`, `/anp-desembaracos`, `/anp-precos-produtores`, `/sindicom`, `/anp-ppi`, `/anp-painel-importacoes`.

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
- **Todo módulo novo** tem (a) controle de visibilidade no admin panel e (b) upload de imagem de home.
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
- 22 dashboards ativos (8 originais + 11 adicionados na Fase 3 + 1 Admin Analytics + 1 ANP CDP Diária + 1 ANP CDP BSW).
- Documentação inicial criada em **2026-05-05**.

### Limpeza inicial (2026-05-05)

Resolvido:
- `components/` na raiz — deletado (só tinha `__pycache__`).
- `frontend-next/` na raiz — deletado (tentativa antiga abandonada). Referência stale em `src/app/login/page.tsx:96` corrigida.
- `news-hunter-handoff.txt` na raiz — movido para [`docs/etl-pipelines/news-hunter-architecture.md`](etl-pipelines/news-hunter-architecture.md).
- Workflows `etl_anp_vendas.yml` e `etl_anp_fase3.yml` — confirmados ATIVOS (anp-watcher é trigger externo via cron-job.org; etl_anp_fase3 roda mensal). Adicionados aos PRDs do ETL.

Tech debt conhecido (não resolvido):
- **`sql/` na raiz contém DDL aplicado direto no Supabase Dashboard, NÃO versionado em `supabase/migrations/`.** Tabelas afetadas: `price_bands`, `profiles`, `module_visibility`. Recriar o DB apenas das migrations resultaria em DB incompleto. **Ação futura**: APP deve converter os 3 arquivos em migrations próprias, depois remover `sql/`.
- **Scripts Python na raiz** (`ais_*.py`, `pipelines/navios/01_lineup_scrape.py`, `vessel_*.py`, `pipelines/navios/04_cabotage_cleanup.py`, `pipelines/anp/vendas_watch.py`, `scripts/manual/dg_margins_upload.py`) convivem com `scripts/`. Mover requer atualizar workflows correspondentes — feito quando houver janela.
