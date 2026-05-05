# PRD Mestre — dashboard_projeto

Plataforma analítica interna do Itaú BBA para o setor de Distribuição de Combustíveis e Petróleo & Gás no Brasil. Este documento descreve **a empresa-projeto** — sua estrutura organizacional (agentes), seus contratos cross-departamentais e suas convenções gerais.

> **Para detalhes técnicos do produto** (stack, módulos, schema, pipelines), veja `README.md` na raiz e os PRDs por departamento em `docs/<dept>/PRD.md`.

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
     │   ├─ dash-sales-volumes        (/sales-volumes)
     │   ├─ dash-market-share         (/market-share)
     │   ├─ dash-navios-diesel        (/navios-diesel + sub-páginas futuras)
     │   ├─ dash-margins              (/diesel-gasoline-margins)
     │   ├─ dash-price-bands          (/price-bands)
     │   ├─ dash-stocks               (/stocks + Yahoo proxy + components/stocks/)
     │   ├─ dash-news-hunter          (/news-hunter — coord. com repo scanner)
     │   └─ dash-admin                (/home + /profile + /admin-panel)
     │
     ├─ Supabase / DB    (schema Postgres, migrations, RLS, RPCs SQL,
     │                    materialized views, supabase-deploy workflow)
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
| APP (Subgerente) | [`subgerente-app`](../.claude/agents/subgerente-app.md) | `src/` (infra compartilhada), `public/`, `.vercel/`, configs Next/TS | [`docs/app/PRD.md`](app/PRD.md) |
| Supabase / DB | [`supabase`](../.claude/agents/supabase.md) | `supabase/migrations/`, `supabase/config.toml`, `sql/` (legado), `supabase-deploy.yml` | [`docs/supabase/PRD.md`](supabase/PRD.md) |
| Dados Locais | [`dados-locais`](../.claude/agents/dados-locais.md) | `data/`, `upload_dg_margins.py`, `scripts/upload_price_bands.py` | [`docs/dados-locais/PRD.md`](dados-locais/PRD.md) |
| ETL / Pipelines | [`etl-pipelines`](../.claude/agents/etl-pipelines.md) | `DADOS/`, `output/`, `scripts/` (scrapers), `.github/workflows/` (scrapers), scripts Python na raiz (ais, vessel, navios, anp_watcher) | [`docs/etl-pipelines/PRD.md`](etl-pipelines/PRD.md) |
| Alertas | [`alertas`](../.claude/agents/alertas.md) | `alertas/` (autocontido) | [`docs/alertas/PRD.md`](alertas/PRD.md) |

## Sub-agentes do APP (donos de dashboard)

Cada um possui um módulo (ou bundle, no caso de admin). Cada um auto-documenta seu sub-PRD em `docs/app/<slug>.md`.

| Slug | Cobertura | Sub-PRD |
|---|---|---|
| [`dash-sales-volumes`](../.claude/agents/dash-sales-volumes.md) | `/sales-volumes` | [`docs/app/sales-volumes.md`](app/sales-volumes.md) |
| [`dash-market-share`](../.claude/agents/dash-market-share.md) | `/market-share` | [`docs/app/market-share.md`](app/market-share.md) |
| [`dash-navios-diesel`](../.claude/agents/dash-navios-diesel.md) | `/navios-diesel` (+ sub-páginas) | [`docs/app/navios-diesel.md`](app/navios-diesel.md) |
| [`dash-margins`](../.claude/agents/dash-margins.md) | `/diesel-gasoline-margins` | [`docs/app/diesel-gasoline-margins.md`](app/diesel-gasoline-margins.md) |
| [`dash-price-bands`](../.claude/agents/dash-price-bands.md) | `/price-bands` | [`docs/app/price-bands.md`](app/price-bands.md) |
| [`dash-stocks`](../.claude/agents/dash-stocks.md) | `/stocks` + Yahoo proxy + `components/stocks/` | [`docs/app/stocks.md`](app/stocks.md) |
| [`dash-news-hunter`](../.claude/agents/dash-news-hunter.md) | `/news-hunter` (coord. com repo scanner) | [`docs/app/news-hunter.md`](app/news-hunter.md) |
| [`dash-admin`](../.claude/agents/dash-admin.md) | `/home` + `/profile` + `/admin-panel` | [`docs/app/admin.md`](app/admin.md) |

## Papéis transversais (não donos de pasta)

| Papel | Slug | Quando entra |
|---|---|---|
| Gerente Geral | [`gerente-geral`](../.claude/agents/gerente-geral.md) | Início de qualquer tarefa nova ou ambígua. Roteia para o(s) dept(s) corretos. |
| Documentador | [`documentador`](../.claude/agents/documentador.md) | Após qualquer mudança que altere contrato cross-dept. Mantém `master.md` + PRDs de departamento. (Sub-PRDs por dashboard são auto-mantidos pelo `dash-*` correspondente.) |
| Designer | [`designer`](../.claude/agents/designer.md) | Antes de qualquer mudança visual ou em `globals.css`. Carrega [`docs/design/identity.md`](design/identity.md) e [`docs/design/best-practices.md`](design/best-practices.md). |
| Revisor / QA | [`revisor-qa`](../.claude/agents/revisor-qa.md) | Antes do commit, sobre o diff staged. Aplica checklist de segurança, contratos e simplicidade. |

---

## Contratos cross-departamentais

São os pontos onde um departamento depende de outro. Mudanças nestes contratos **sempre** envolvem o Gerente + Documentador.

### Schema do Supabase

**Dono:** dept **Supabase / DB** (peer dos demais; não pertence ao APP). Migrations vivem em `supabase/migrations/`.

| Quem consome | Como |
|---|---|
| APP | Lê via supabase-js (anon key) chamando RPCs. Wrappers em `src/lib/rpc.ts` (este código é do APP, mas as RPCs em si pertencem ao Supabase) |
| ETL | Escreve via supabase-py (service key) — popula `vendas`, `navios_diesel`, `news_articles`, etc. |
| Dados Locais | Escreve via supabase-py (service key) — popula `d_g_margins`, `price_bands` |
| Alertas | Lê via supabase-py — verifica mudanças em fontes monitoradas |

**Regra de divisão:** SQL = `supabase`. JS chamando SQL = `subgerente-app` / `dash-*`.

**Quando algum dept precisa de coluna/tabela nova:** abre solicitação ao agente `supabase` via Gerente. `supabase` cria migration + RLS + (se for o caso) RPC. Avisa o dept consumidor pra atualizar wrapper JS / popular dados. Documentador atualiza este arquivo + `docs/supabase/PRD.md` + PRD do dept consumidor.

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

**Dono:** ETL (e APP, no caso do `supabase-deploy.yml`).

Cada workflow novo precisa: secrets registrados no GitHub, schedule cron, e linha no `docs/etl-pipelines/PRD.md`.

---

## Convenções gerais

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
2. Gerente cria `.claude/agents/<novo-dept>.md` (template = um agente existente).
3. Gerente cria `docs/<novo-dept>/PRD.md` com seções: Escopo, Ownership, Contratos, Convenções, Tarefas comuns, Anti-padrões.
4. Gerente atualiza este `master.md`: organograma + tabela de departamentos + contratos cross-dept (se houver).
5. Gerente atualiza tabela de roteamento em `gerente-geral.md`.
6. Documentador valida.

## Como adicionar um novo dashboard (não departamento)

Workflow controlado pelo **Subgerente APP** (não pelo Gerente Geral). Ver detalhes em `subgerente-app.md` → "Adicionar novo dashboard". Resumo:

1. Subgerente copia `template-module/` → novo módulo.
2. Cria migration + RPCs + RLS.
3. **Cria `.claude/agents/dash-<slug>.md`** (responsabilidade do Subgerente).
4. **Cria `docs/app/<slug>.md`** (sub-PRD).
5. **Dispara `dash-admin`** para registrar visibilidade + foto na home.
6. Atualiza tabelas em `subgerente-app.md` e `gerente-geral.md`.
7. Avisa Documentador para refletir em `master.md`.

---

## Estado atual (snapshot)

- 4 departamentos + 3 papéis transversais.
- Documentação inicial criada em **2026-05-05**.

### Limpeza inicial (2026-05-05)

Resolvido:
- `components/` na raiz — deletado (só tinha `__pycache__`).
- `frontend-next/` na raiz — deletado (tentativa antiga abandonada). Referência stale em `src/app/login/page.tsx:96` corrigida.
- `news-hunter-handoff.txt` na raiz — movido para [`docs/etl-pipelines/news-hunter-architecture.md`](etl-pipelines/news-hunter-architecture.md).
- Workflows `anp-watcher.yml` e `anp_fase3_sync.yml` — confirmados ATIVOS (anp-watcher é trigger externo via cron-job.org; anp_fase3_sync roda mensal). Adicionados aos PRDs do ETL.

Tech debt conhecido (não resolvido):
- **`sql/` na raiz contém DDL aplicado direto no Supabase Dashboard, NÃO versionado em `supabase/migrations/`.** Tabelas afetadas: `price_bands`, `profiles`, `module_visibility`. Recriar o DB apenas das migrations resultaria em DB incompleto. **Ação futura**: APP deve converter os 3 arquivos em migrations próprias, depois remover `sql/`.
- **Scripts Python na raiz** (`ais_*.py`, `navios_esperados.py`, `vessel_*.py`, `cabotage_cleanup.py`, `anp_watcher.py`, `upload_dg_margins.py`) convivem com `scripts/`. Mover requer atualizar workflows correspondentes — feito quando houver janela.
