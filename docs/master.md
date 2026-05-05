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
     │  (rota tarefas)                  (escreve docs)
     │
     ├─ APP                  (dono do Supabase / Next.js / Vercel)
     ├─ Dados Locais         (Excels manuais + scripts de upload)
     ├─ ETL / Pipelines      (scrapers automáticos + GitHub Actions)
     ├─ Alertas              (subsistema autocontido em alertas/)
     │
     └─ Revisor / QA         (transversal — audita diff antes do commit)
```

## Departamentos

| Dept | Slug do agente | Ownership de pastas | PRD |
|---|---|---|---|
| APP | [`app`](../.claude/agents/app.md) | `src/`, `public/`, `supabase/migrations/`, `.vercel/`, `next.config.ts`, `package.json` | [`docs/app/PRD.md`](app/PRD.md) |
| Dados Locais | [`dados-locais`](../.claude/agents/dados-locais.md) | `data/`, `upload_dg_margins.py`, `scripts/upload_price_bands.py` | [`docs/dados-locais/PRD.md`](dados-locais/PRD.md) |
| ETL / Pipelines | [`etl-pipelines`](../.claude/agents/etl-pipelines.md) | `DADOS/`, `output/`, `scripts/` (scrapers), `.github/workflows/` (scrapers), scripts Python na raiz (ais, vessel, navios, anp_watcher) | [`docs/etl-pipelines/PRD.md`](etl-pipelines/PRD.md) |
| Alertas | [`alertas`](../.claude/agents/alertas.md) | `alertas/` (autocontido) | [`docs/alertas/PRD.md`](alertas/PRD.md) |

## Papéis transversais (não donos de pasta)

| Papel | Slug | Quando entra |
|---|---|---|
| Gerente Geral | [`gerente-geral`](../.claude/agents/gerente-geral.md) | Início de qualquer tarefa nova ou ambígua. Roteia para o(s) dept(s) corretos. |
| Documentador | [`documentador`](../.claude/agents/documentador.md) | Após qualquer mudança que altere contrato. Mantém este `master.md` e os sub-PRDs vivos. |
| Revisor / QA | [`revisor-qa`](../.claude/agents/revisor-qa.md) | Antes do commit, sobre o diff staged. Aplica checklist de segurança, contratos e simplicidade. |

---

## Contratos cross-departamentais

São os pontos onde um departamento depende de outro. Mudanças nestes contratos **sempre** envolvem o Gerente + Documentador.

### Schema do Supabase

**Dono:** APP. Migrations vivem em `supabase/migrations/`.

| Quem consome | Como |
|---|---|
| APP | Lê via supabase-js (anon key) chamando RPCs em `src/lib/rpc.ts` |
| ETL | Escreve via supabase-py (service key) — popula `vendas`, `navios_diesel`, `news_articles`, etc. |
| Dados Locais | Escreve via supabase-py (service key) — popula `d_g_margins`, `price_bands` |
| Alertas | Lê via supabase-py — verifica mudanças em fontes monitoradas |

**Quando algum dept precisa de coluna/tabela nova:** abre solicitação ao APP via Gerente. APP cria migration. Documentador atualiza este arquivo + `docs/app/PRD.md`.

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

---

## Estado atual (snapshot inicial)

- 4 departamentos + 3 papéis transversais.
- Documentação inicial criada em **2026-05-05**.
- Pendências de limpeza física conhecidas (a confirmar com CEO):
  - `components/` na raiz (parece morto, só `__pycache__`)
  - `frontend-next/` na raiz (parece tentativa antiga)
  - `sql/` na raiz (provavelmente já em `supabase/migrations/`)
  - `news-hunter-handoff.txt` na raiz (deveria virar parte de doc)
  - Scripts Python soltos na raiz (poderiam ir para `scripts/` ou `pipelines/`)
  - Workflows `anp-watcher.yml`, `anp_fase3_sync.yml` (validar uso)
