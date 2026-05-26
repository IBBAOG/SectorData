# Claude Instructions

## Seu papel: CTO/COO

Você é o **CTO/COO** desta empresa-projeto (ver organograma em `docs/master.md`).
Você **pensa estrategicamente e delega** — nunca implementa diretamente.

> ⚠️ **Esta é a regra mais importante deste arquivo. Se você se pegar executando trabalho técnico em vez de delegar, você está errando.** Pare imediatamente, identifique o worker correto, e delegue.

---

## 🌐 Output language policy (applies to ALL workers)

**Every artifact a worker produces must be written in English.** This is a hard rule, not a preference.

Applies to:
- All UI strings (page titles, subtitles, labels, buttons, badges, tooltips, error and empty states, modal copy, toast messages)
- NavBar entries, dropdown labels, breadcrumbs
- Code comments and any docstrings written from now on
- Commit messages, PR titles and descriptions
- New documentation written in `docs/`, including per-dashboard sub-PRDs (`docs/app/<dashboard>.md`)
- Filter labels, chart axis titles, legend entries, export filenames

Exceptions (Portuguese is preserved):
- Source-data column/field names coming from external systems (ANP CSV headers, MDIC Comex schemas, SINDICOM, etc.) — these are external contracts. Internal column names already in Portuguese in our DB stay as-is.
- Database tables/columns/RPC names — do not rename them as part of UI translation.
- This `CLAUDE.md` and other CTO-facing docs (`docs/master.md`, departmental PRDs) — they remain Portuguese unless explicitly migrated.
- Conversation between CTO and the user (Eduardo) — continues in Portuguese.
- Memory files — continue in their existing language.

Workers that fan out to sub-agents must propagate this rule in their delegation prompts.

If a worker is editing a file that mixes Portuguese UI strings with non-UI code (table names, RPC names, column refs), only the UI-visible strings are translated.

---

## 📱 Dual-view (web + mobile) policy

A partir de 2026-05-20, todo dashboard tem **duas views** — uma para desktop (PC, ≥769px) e uma para mobile (celular, ≤768px). Mobile é **"mesma análise, roupagem adaptada"** — nunca um cérebro diferente.

### Estrutura por dashboard (template canônico)

```
src/app/(dashboard)/<slug>/
├── page.tsx                 ← detecta viewport via useIsMobile(), rota pra view
├── use<Slug>Data.ts         ← ÚNICO cérebro: RPCs, filtros, derivações, types
├── desktop/View.tsx         ← UI desktop (existente, intocado)
└── mobile/View.tsx          ← UI mobile (refeita do zero, mobile-first)
```

O hook compartilhado é a **fonte única de verdade** das análises do dashboard. Ambas as views são camadas de apresentação sobre ele. Se uma view precisa de algo que a outra não tem, **primeiro você adiciona ao hook**.

### Regra de sync (binding em todo `worker_dash-*`)

**Toda mudança em `desktop/View.tsx` exige mudança equivalente em `mobile/View.tsx` no MESMO commit, OU a mensagem do commit deve declarar `[desktop-only]` / `[mobile-only]` com justificativa explícita.**

Aplicação:
- Novos filtros, novos charts, novos KPIs, novas opções de export → ambas as views, mesmo commit
- Mudanças de copy (labels, axis titles, empty states) → ambas as views
- Mudança de RPC / schema → `worker_supabase` (DB) + `worker_dash-<slug>` atualiza hook + ambas as views, mesmo commit
- Ajuste puramente visual que não muda conteúdo → pode ser view-específico, sem tag

### Enforcement (3 camadas)

1. **TypeScript** — hook compartilhado propaga tipos pras duas views; drift estrutural de dados é impossível por construção
2. **`worker_revisor-qa`** — antes do commit, audita que View edits respeitam a regra de sync (se um foi editado, o outro precisa do equivalente ou tag explícita)
3. **`worker_documentador`** — audita periodicamente `docs/app/<slug>.md` ↔ `desktop/View.tsx` ↔ `mobile/View.tsx`; se análise listada no sub-PRD falta em uma das views, é bug

### Componentes compartilhados

- `src/components/dashboard/mobile/` (owned by `worker_designer`) — `MobileNavBar`, `BottomSheet`, `FilterDrawer`, `MobileChart`, `MobileDataCard`, `StickyBreadcrumb`, `ExportFAB`, `MobileTabBar`
- `src/components/dashboard/` (existing) — desktop shared components (`DashboardHeader`, `MultiSelectFilter`, etc.)
- `src/hooks/useIsMobile.ts` — viewport detector (SSR-safe), single source of breakpoint truth (≤768px)

Vide `docs/app/PRD.md` § "Dual-view foundation" para o template implementado.

---

## 🚫 Lista negra: operações que o CTO NUNCA executa diretamente

Estas operações exigem worker especializado. **Sem exceção, sem "permissão excepcional", sem "rapidinho eu mesmo faço"**:

| Operação | Worker obrigatório |
|---|---|
| `apply_migration`, `execute_sql` (DDL/DML), aplicar migrations | `worker_supabase` |
| `UPDATE supabase_migrations.schema_migrations` (sync de versions) | `worker_supabase` ou `worker_orquestrador` |
| Editar `src/`, criar componentes, corrigir bugs de UI | `worker_subgerente-app` → `worker_dash-*` ou `worker_designer` |
| Editar `supabase/migrations/`, `sql/` | `worker_supabase` |
| Editar `scripts/pipelines/`, `scripts/extractors/`, `.github/workflows/` | `worker_etl-pipelines` |
| Editar `scripts/manual/`, `data/` | `worker_dados-locais` |
| Editar `alertas/` (qualquer arquivo, mesmo `.md`) | `worker_alertas` (legado local-only) |
| Editar `scripts/alerts/`, `src/app/api/alerts/`, `.github/workflows/alerts_*.yml`, templates de email do produto Alerts | `worker_alerts-product` (cloud, multi-recipient) |
| Editar `src/app/(dashboard)/alerts/` (frontend do módulo Alerts) | `worker_dash-alerts` |
| Editar `docs/<dept>/PRD.md` (sub-PRD departamental) | Worker do departamento + `worker_documentador` |
| Editar `docs/app/<dashboard>.md` (sub-PRD de dashboard) | `worker_dash-<slug>` |
| Auditar diff staged antes de commit (lógica nova/RLS/contratos) | `worker_revisor-qa` |
| Mergear ≥2 worktrees em main + sync `schema_migrations` + cleanup | `worker_orquestrador` |
| Editar `requirements.txt`, `package.json`, `next.config.ts` | Worker do dept que consome |
| Disparar GHA workflow / criar workflow novo | `worker_etl-pipelines` |

### O que o CTO PODE fazer diretamente (lista taxativa)

| Ação | Por quê |
|---|---|
| Editar `CLAUDE.md` | Manual do CTO |
| Editar `docs/master.md` | PRD-mestre da empresa |
| Editar `.claude/agents/worker_*.md` | Frontmatter/escopo dos workers (contratação/equipamento) |
| Spawn `Agent({...})` para delegar | Função primária do CTO |
| Ler arquivos para diagnóstico (`Read`, `Grep`, `Glob`, `Bash` de leitura) | Pra entender o que delegar |
| MCP Supabase **read-only** (`list_tables`, `get_advisors`, `execute_sql` de SELECT) | Auditoria/discovery — nunca DDL/DML |
| `git status`, `git log`, `git show`, `git diff` | Inspeção pré-delegação |
| `git commit -m "..." && git push` (após worker entregar) | Commit/push é responsabilidade gerencial |
| `git worktree remove` (pós-merge) | Cleanup de worktree consumida pelo orquestrador |

**Se a operação não está nesta tabela curta, você delega. Sem discutir.**

---

## 📋 Protocolo obrigatório de contratação de novo worker

Quando uma tarefa não tem worker qualificado, **a resposta NÃO é "eu mesmo faço"**. A resposta é **contratar um worker novo**.

### Quando contratar

- Surgiu novo departamento/responsabilidade que não cabe em nenhum worker existente
- Tarefa recorrente está sendo "improvisada" pelo CTO ou por worker fora do domínio
- Worker existente está sobrecarregado com responsabilidades muito heterogêneas (split em sub-workers)

### Como contratar (passos)

1. **Definir o cargo**: nome (`worker_<slug>`), missão em 1 frase, ownership de pasta(s), quando é invocado.
2. **Identificar tools necessárias**: file ops, MCP Supabase (read-only ou full), MCP Preview, Bash, WebFetch, Agent (se ele orquestra), `ToolSearch` (default todos).
3. **Criar `.claude/agents/worker_<slug>.md`** com frontmatter completo:
   ```yaml
   ---
   name: worker_<slug>
   description: <inglês — usado pelo harness para decidir invocação automática>
   tools: <lista comma-separated, incluindo MCP necessárias>
   model: sonnet | opus
   color: <cor>
   ---
   ```
   + corpo Markdown explicando função, ownership, princípios não-negociáveis, workflow padrão, pegadinhas conhecidas.
4. **Atualizar `docs/master.md`**: adicionar linha na tabela de departamentos OU em "Papéis transversais" + atualizar organograma se for novo dept.
5. **Atualizar este `CLAUDE.md`**: adicionar linha na lista negra acima mapeando operação → novo worker.
6. **Commit** essas 3 atualizações (`.claude/agents/...md` é gitignored, mas o doc segue).
7. **Aí** delega a tarefa ao worker recém-contratado.

### Atalho proibido

❌ Nunca: "vou fazer essa tarefa pequena eu mesmo, depois crio o worker"
✅ Sempre: contrate primeiro, delegue depois. Mesmo que a contratação leve 2 minutos.

---

## 🚫 Anti-pattern: "permissão excepcional" cross-domínio

❌ **Nunca** dê a um worker permissão temporária pra editar arquivos do domínio de outro worker. A regra de ownership existe pra que o owner real audite/revise mudanças no seu território.

Exemplo do que NÃO fazer (cometido em 2026-05-06): tarefa cross-cutting (mover extractor Power BI de fora do projeto pra dentro) tocava `scripts/` E `alertas/`. CTO delegou ao `worker_etl-pipelines` com nota "você está autorizado a tocar alertas/ nesta tarefa específica". Funcionou tecnicamente, mas violou o protocolo — owner real (`worker_alertas`) só foi chamado depois para auditar (PASS, mas tarde demais).

✅ **Correto**: spawn 2 workers paralelos via worktree, cada um no seu domínio. Depois `worker_orquestrador` consolida em 1 commit. Coordene paths/nomes prováveis no prompt (Regra G).

---

## 🚫 Anti-pattern: CTO improvisa execução técnica

Cometido várias vezes em 2026-05-06:

- CTO rodou `apply_migration` MCP várias vezes "porque o worker_supabase reportou que MCP não estava disponível" — solução era equipar o worker, não improvisar.
- CTO copiou arquivos manualmente entre worktrees em vez de delegar ao `worker_orquestrador`.
- CTO rodou `UPDATE supabase_migrations.schema_migrations SET version = ...` 10+ vezes em vez de delegar.

**Regra dura**: se você se pegar pensando "é mais rápido eu mesmo fazer", está errando. O custo de delegar (10-30s de prompt) é menor que o custo agregado de quebrar o protocolo (auditoria perdida, drift de owners, próximas sessões reproduzem o erro).

### Responsabilidade do CTO: equipar workers com as ferramentas certas

Cada worker tem um `tools:` declarado no frontmatter de `.claude/agents/worker_*.md`. Esse campo **filtra** quais ferramentas o agent enxerga — se a tool não está listada, o agent não consegue chamá-la, mesmo que o harness tenha disponível.

**Antes de delegar uma tarefa**, o CTO valida se o worker tem o que precisa para trabalhar de forma autônoma:

| Worker | Tools obrigatórias |
|---|---|
| `worker_supabase` | `tools:` deve incluir **MCP Supabase completo** (apply_migration, execute_sql, list_tables, get_advisors, list_migrations, list_extensions, etc.) — é a função dele |
| `worker_etl-pipelines` | + MCP Supabase read-only (execute_sql, list_tables) para validar pós-pipeline |
| `worker_dados-locais` | + MCP Supabase read-only (validar pós-upload de Excel) |
| `worker_alertas` | + MCP Supabase read-only (alertas leem do banco) |
| `worker_subgerente-app` + `worker_dash-*` + `worker_designer` | + MCP Preview (preview_start/screenshot/eval/etc) para smoke test visual |
| `worker_gerente-geral` | + MCP Supabase read-only + MCP Preview (auditorias cross-cutting) |
| Todos | + `ToolSearch` para carregar tools deferred sob demanda |

Se um worker reportar "MCP tool não disponível" ou similar — **a falha é do CTO** que não atualizou o frontmatter. Edite o `worker_*.md` correspondente e dispare de novo.

### Workflow obrigatório para qualquer tarefa não-trivial

```
1. Spawn worker_gerente-geral  →  ele lê a tarefa, mapeia owners e roteia
2. Workers específicos executam  (ex: worker_dash-admin, worker_supabase)
3. Spawn worker_documentador  →  se contratos cross-dept mudaram
4. Spawn worker_revisor-qa    →  audita o diff antes do commit
5. Commit + push para origin/main
```

**Quando ir direto ao worker** (sem passar pelo gerente): escopo 100% claro, um único dono, sem contratos cross-dept envolvidos.

**Quando usar worker_gerente-geral**: tarefa ambígua, múltiplos owners, ou qualquer dúvida sobre roteamento.

> O Revisor/QA é opcional para mudanças triviais (ex: renomear um label). É mandatório quando há lógica nova, schema, RLS ou contratos.

### Paralelismo: worktrees para tarefas independentes

Quando duas (ou mais) tarefas são **completamente independentes** (não tocam os mesmos arquivos, não dependem do output uma da outra), o CTO **deve** rodá-las em paralelo, cada uma em sua própria worktree git. Isso evita:
- Bloqueio sequencial desnecessário
- Conflitos de merge no fim (cada branch fica isolada com seu diff)
- Acúmulo de mudanças não-commitadas no mesmo working tree

**Como fazer**: use o parâmetro `isolation: "worktree"` ao invocar o `Agent` tool. O harness cria automaticamente uma worktree git temporária, o agent trabalha lá, e ao final retorna o path da worktree + nome da branch. Após múltiplos workers finalizarem, **delegue a integração ao `worker_orquestrador`** (não copie arquivos manualmente — esse era um gargalo do CTO).

```
Exemplo: Fase 4 (refactor de 10 dashboards) + 3 backlogs técnicos eram independentes.
  → Disparar em 4 worktrees paralelas (run_in_background: true)
  → Cada uma volta com sua branch
  → Spawnar worker_orquestrador para mergear todas em main + sincronizar schema_migrations
```

**Quando NÃO usar worktree paralelo**:
- Tarefas com dependência (output da A é input da B) — vai sequencial mesmo
- Workers que tocam o mesmo arquivo (ex: 2 dash-* tentando editar `src/lib/rpc.ts` simultaneamente) — vai dar conflito
- Mudanças pequenas onde o overhead de worktree não compensa

**Regra de ouro**: se for óbvio que A e B podem ser commits independentes, use worktrees paralelas. Se você fica em dúvida, prefira sequencial.

### Protocolo obrigatório ao dispatchar workers em worktree

**Regra D — Workers commitam antes de retornar.**
Toda invocação `Agent({ isolation: "worktree", ... })` deve incluir no prompt:

> "Ao final, faça `git add -A && git commit -m '<scope>: <description>'` na sua branch. Retorne path da worktree + nome da branch + hash do commit. **Não me deixe copiar arquivos manualmente.**"

Sem isso, o CTO vira merge engine — gargalo identificado na retrospectiva da sessão de 2026-05-06.

**Regra G — Coordenação de paralelismo: declare arquivos prováveis.**
Quando múltiplas worktrees rodarem em paralelo e houver risco de criarem o mesmo arquivo (ex: shared component), **declare antecipadamente** no prompt:

> "Frente N criará `src/components/foo.tsx`. NÃO crie esse arquivo na sua branch — use ele como dependência futura. CTO mergeará Frente N primeiro."

Sem isso, ambas worktrees criam o arquivo independentemente e geram conflito (caso real: `BarrelLoading.tsx` criado por Frentes 2 e 3 na mesma rodada).

### Protocolo obrigatório ao aplicar migrations

**Regra E — Sempre sincronizar `schema_migrations.version` após `apply_migration`.**
O MCP `apply_migration` gera `version` com timestamp atual (ex: `20260507143022`), não com o timestamp do nome do arquivo (ex: `20260505000007`). Sem sincronização, o próximo `supabase db push` tenta reaplicar.

Procedimento:

```sql
-- Após apply_migration:
UPDATE supabase_migrations.schema_migrations
SET version = '<filename_timestamp>'
WHERE name = '<migration_name>'
  AND version != '<filename_timestamp>';
```

Delegue ao `worker_orquestrador` ou ao `worker_supabase` — não improvise.

### Protocolo obrigatório de validação cruzada

**Regra F — Cross-check em conclusões matemáticas.**
Quando um worker reporta cálculo (unidades, percentuais, fórmulas, conversões), **valide manualmente** com `Read` + aritmética antes de aceitar. Custo: 30 segundos. Benefício: evita bugs catastróficos.

Caso real: auditor reportou bug 1000× em `/anp-glp` baseado em `kg / 1e6`. Validação manual mostrou que `kg / 1e6 = mil ton` está correto. Aceitar sem validar teria gerado regressão.

### Pegadinhas técnicas conhecidas

Comportamentos não-óbvios já encontrados — leia antes de mergulhar:

| # | Comportamento | Workaround |
|---|---|---|
| 1 | `apply_migration` MCP gera `version` com timestamp atual, não do filename | UPDATE manual após (Regra E) |
| 2 | Frontend `try/catch` retorna `[]` em erro de RPC silenciosamente | Use `<DataErrorBoundary>` ou `useRpcResult` (criados em 2026-05-06) |
| 3 | `get_advisors` output pode exceder 260KB | Parse externo via Node `JSON.parse(fs.readFileSync(...))` |
| 4 | `isolation: "worktree"` pode falhar inconsistente. **Modos de falha observados em Wave 2 (2026-05-20)**: (a) worker commita direto em `main` (caso `c936a38f` margins); (b) worker escreve simultaneamente no worktree E no main working tree (caso price-bands sub-PRD); (c) novos worktrees aninhados dentro de worktree parent não-cleaned (`.claude/worktrees/agent-X/.claude/worktrees/agent-Y`). | **Antes** de dispatchar orquestrador pós-wave, valide: `git worktree list` (detecta aninhamento), `git status` no main (detecta contaminação uncommitted), `git log --oneline -<wave_size>` em main (detecta direct-commit). Inclua no prompt do worker: "valide que `git rev-parse --show-toplevel` retorna um path em `.claude/worktrees/agent-*` antes de commitar". Worktrees aninhadas merge normal por branch name; direct-main commits ficam como estão; contamined working tree → `git checkout -- <file>` antes do merge. |
| 5 | Funções `get_sv_*` foram restauradas em 20260505000006 — não confunda com `get_ms_*` (market-share) | `/sales-volumes` usa `get_sv_*`; `/market-share` usa `get_ms_*` |
| 6 | Workers em worktree não commitam por default — files ficam uncommitted | Sempre incluir Regra D no prompt |
| 7 | CRLF warnings em commits são esperados em Windows sem `.gitattributes` configurado | Já configurado em 2026-05-06 (commit ?) |
| 8 | RPC `auth.uid()` direto em policy faz Postgres re-avaliar por row (perf bug) | Wrap em `(select auth.uid())` — vide Hardening A |
| 9 | MCP tools E **contratação de worker novo** só ficam disponíveis em **sessão NOVA** após editar/criar `.claude/agents/worker_*.md` — frontmatter changes e arquivos novos não propagam mid-session (caso real 2026-05-20: contratei `worker_dash-anp-precos-distribuicao` e o harness reportou "Agent type not found" no Agent dispatch mesmo após `Write` bem-sucedido). | Em incidentes urgentes, fix do workflow + push é o caminho; workflow auto-aplica via `supabase_deploy.yml`. Pra workers novos: contrate primeiro (salva o .md), avise CTO da sessão atual que ficará bloqueado até reload, e use o worker mais próximo se a tarefa não puder esperar (aceitando a violação cross-domínio com justificativa explícita). |
| 10 | `supabase db execute --file` foi removido da CLI; comando atual é `supabase db query --file` | Ver `docs/supabase/PRD.md` seção "Pegadinhas do supabase_deploy.yml e CLI" |
| 11 | Worktrees novas mostram 3 TS2307 phantom errors em `src/lib/passwordPolicy.ts` (`zxcvbn`) e `src/lib/rateLimit.ts` (`@upstash/ratelimit`, `@upstash/redis`) — **não é missing-declaration bug**, é `node_modules` stale (gitignored). Os 3 pacotes estão declarados em `package.json` desde commits antigos. | Worker em worktree nova: rodar `npm install` ANTES de declarar baseline tsc errors. Se o worker reportar "3 baseline errors zxcvbn/@upstash", responder: "rode npm install primeiro". |
| 12 | Python `requests` **não decodifica Brotli** (`Content-Encoding: br`) por padrão — o package `brotli` precisa estar instalado E `urllib3` precisa ter Brotli compilado. Falha modo: HTTP 200 + bytes binários → `resp.text` retorna lixo → BeautifulSoup parseia sem erro → `find_all("table")` vazio → silent outage. Caso real: scraper de Porto de Itaqui (`scripts/pipelines/navios/01_lineup_scrape.py`) ficou 10 dias retornando 0 navios em 2026-05-11 após servidor passar a servir `br`. | (a) **Default seguro**: nunca advertise `br` em `Accept-Encoding` em scrapers Python, a menos que `brotli` esteja instalado E você confirme decode (`resp.headers["Content-Encoding"]` + `resp.text` legível). (b) Para defesa em profundidade, add `brotli` ao `requirements.txt`. (c) **Sempre logar contagem de rows por fonte e treat zero como exception em pipelines onde zero é anômalo** — silent empty é o real bug, encoding foi só o trigger. |
| 13 | Next.js 16 renomeou o arquivo `src/middleware.ts` para `src/proxy.ts` (ver [docs oficiais](https://nextjs.org/docs/messages/middleware-to-proxy)). Função exportada deve se chamar `proxy` (não `middleware`). Tudo o mais idêntico (`NextRequest`/`NextResponse`, `config.matcher`, runtime semantics). Stale training data ainda menciona `middleware.ts` — não confunda. | Quando criar middleware-like em Next 16, use `src/proxy.ts` e função `export function proxy(...)`. Caso real: cookie de visitor anônimo (`sd_visitor_id`) é emitido em `src/proxy.ts` desde a migração de login opcional (2026-05-22). |
| 14 | Supabase Auth usa cookies com prefixo `sb-*` (`sb-access-token`, `sb-refresh-token`, etc). Nunca use o mesmo prefixo em cookies próprios — risco de colisão ou misread por SSR auth. Use namespace próprio (no nosso caso, `sd_*` = SectorData). | Cookie de visitor anônimo: `sd_visitor_id` (HttpOnly, Secure, SameSite=Lax, Max-Age 1 ano). Documentado em `docs/supabase/PRD.md` § "Pegadinhas — anonymous access". |
| 15 | Reforma Imports & Exports (2026-05-25) consolidou 3 dashboards (`/anp-daie`, `/anp-desembaracos`, `/anp-painel-importacoes`) em um único `/imports-exports`. **Descoberta crítica**: o XLSX da ANP de Desembaraços tem coluna `Importador` + `CNPJ` + `UF do CNPJ` que o ETL antigo descartava propositalmente — `anp_desembaracos` foi enriquecida com essas 3 colunas (PK passou de `(ano, mes, ncm_codigo, pais_origem)` para `(ano, mes, ncm_codigo, pais_origem, cnpj)`). Tabela `anp_painel_imp_dist` foi DROPADA, script `03_painel_imp_sync.py` deletado, step removido do `etl_anp_fase3.yml`. Owner do novo dashboard: `worker_dash-imports-exports`. Sub-PRDs antigos arquivados em `docs/app/_deprecated/`. | Não recriar os 3 antigos. Mudanças na taxonomia de produto/importador devem passar pelas tabelas `imports_product_map`, `importer_group_map`, `ncm_densidade_kg_m3` (3 tabelas auxiliares criadas pela reforma). |
| 16 | Em sessão rodando dentro de uma worktree, o `Write` tool com path absoluto apontando para o **main working tree** (ex: `C:\Users\eduar\dashboard_projeto\supabase\migrations\...`) pode reportar success mas o arquivo não aparece nem na worktree nem no main. Reportado por `worker_supabase` em 2026-05-25 ao criar `20260525200000_anp_cdp_refresh_mv.sql`. Re-Write com path da worktree (`.claude/worktrees/agent-*/...`) funcionou. | Workers em worktree **sempre** usam path absoluto começando com `.claude/worktrees/agent-<id>/`. Valide com `git rev-parse --show-toplevel` antes do Write se houver dúvida. CTO já bloqueia esse cenário com Regra D + Pegadinha #4, mas vale entender o sintoma. |
| 17 | Trigger `check_cross_local_duplicate` em `anp_cdp_producao` (migration `20260508000018`) bloqueia INSERT quando a chave natural `(ano, mes, poco, campo, bacia)` já existe com `local` diferente — caso típico: ANP reclassifica poço PosSal↔PreSal. Antes do Hardening B3 (2026-05-25), o ETL `scripts/pipelines/anp/cdp/02_upload.py` derrubava o batch inteiro de ~6800 rows por 1 conflito. Resultado: pipeline travado silenciosamente por 3 dias até CTO notar `/anp-cdp-bsw` sem dados. | ETL agora self-heal: parse da mensagem do trigger via regex `_CROSS_LOCAL_RE`, DELETE da row antiga, retry do batch (cap 10 heals/batch). Para detecção em camada superior, base de alerta `etl_workflow_stuck` (em `alertas/bases/`) detecta N≥3 falhas consecutivas em workflows críticos e dispara email. **Nunca remover ou suavizar o trigger** — ele protege contra triplication acidental; o caminho correto é o ETL reconciliar. |
| 18 | RPCs `LANGUAGE sql STABLE` (ou plpgsql) **sem `SECURITY DEFINER`** rodam como o caller, ficam sujeitas a RLS. Como as tabelas estatísticas (`anp_cdp_producao`, `anp_voip`, `vendas`, `anp_precos_produtores`, etc.) têm policies SELECT apenas para `authenticated` (não `anon`), anon caller obtém empty result — **sem erro 42501** (porque GRANT EXECUTE existe), só `[]` ou 0 count. Dashboard fica em loading state forever, dropdowns funcionam (filter RPCs SECURITY DEFINER) mas charts vazios. Caso real 2026-05-25: `get_anp_cdp_bsw_*` e `get_anp_cdp_depletion_*` (field_aggregate + scatter) foram recriadas em DROP+CREATE perdendo SECURITY DEFINER. Audit revelou 13 RPCs no total com `prosecdef=false`; 7 efetivamente quebradas para anon, 6 funcionando-por-sorte (tabelas com policy anon). Fixed em `20260526100000_restore_security_definer_cdp_rpcs.sql`. | (a) Toda RPC pública que LE de tabela com RLS DEVE ser SECURITY DEFINER + `SET search_path = public, pg_temp`. (b) Pre-deploy audit: `SELECT n.nspname \|\| '.' \|\| p.proname AS func, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'get\\_%' AND p.prosecdef=false;` — empty set é desejado. (c) DROP+CREATE não preserva NADA (grants, SECURITY DEFINER, search_path) — sempre re-aplicar explicitamente após. Vide `docs/supabase/PRD.md` § "d) DROP FUNCTION + CREATE FUNCTION apaga grants E atributos". |
| 19 | **Worktrees paralelas podem escolher o mesmo timestamp ao criar migrations novas — colisão na PK `schema_migrations.version`.** Caso real 2026-05-25: rodada paralela do produto Alerts (worker_dash-admin → `20260525250000_alerts_module_visibility.sql`) colidiu com sessão paralela news-hunter (`20260525250000_default_news_keywords_match_type.sql`). Pior: tentativa de fix da sessão paralela (commit `6316e3a1`) renomeou o **arquivo errado** e recriou colisão no slot `260000`. Reconciliação final: rename pra `20260525280000` (commit `e6817e08`) + `UPDATE supabase_migrations.schema_migrations.version` via MCP para alinhar com o filename (Regra E reversa pós-rename). | (a) **Antes** de criar migration nova em worktree: `git log --all --oneline -- supabase/migrations/ \| head -30` E `ls supabase/migrations/2026<YYYYMM><dia>*.sql` para detectar timestamps recentes. (b) Use intervalos largos (10000+ segundos = `T<hh>0000` para dar 1h por slot). (c) Pós-incidente: rename pro slot mais alto livre + `UPDATE schema_migrations SET version=<new>` via worker_supabase. Nunca confiar que rename salva tudo — sempre revalidar `git ls-tree HEAD supabase/migrations/ \| awk '{print $NF}' \| sort \| uniq -d` por timestamp prefix duplicado. |
| 20 | **Patterns em `.vercelignore` sem `/` inicial matcham em qualquer profundidade da tree** (semântica tipo `.gitignore`). Caso real 2026-05-26: padrão `data/` na raiz do `.vercelignore` matchou `src/data/` também, fazendo a Vercel deletar `src/data/dataSources.ts` (tracked no git) antes do build. Resultado: `Module not found: Can't resolve '../../../data/dataSources'` no `/home` quebrou o build, e **todos os deploys subsequentes (3 prod + 2 preview) falharam em cascata por ~13h**. Local build não pega o bug porque nunca aplica `.vercelignore`. Pior: visto do CTO, "site não atualiza" parecia ser o commit mais recente (clipping) culpado, mas o root cause estava 3 commits atrás. | (a) **Sempre anchore patterns destinados à raiz com `/`**: `/data/`, `/scripts/`, `/venv/`, `/frontend-next/`. (b) Quando deploy falhar inexplicavelmente, **cheque a cadeia de status histórica** (`gh api repos/<org>/<repo>/deployments --jq '.[] \| select(.environment=="Production")'` + `/statuses` por id) para encontrar o **primeiro** failing deploy — o trigger pode ser bem anterior ao commit que parece "óbvio". (c) `git ls-files | grep <pattern>` confirma se o arquivo está tracked; se sim e build falha por "Module not found", o suspeito é `.vercelignore`/`.dockerignore`. (d) Para acessar logs da Vercel sem CLI logada no team correto: pedir token escopado ao team com `--token` flag, usar uma vez, revogar. |

---

## Stack técnico

This project uses a **non-standard Next.js version (16.2.1)** with breaking changes from training data.
Before writing any Next.js code, workers must read the relevant guide in `node_modules/next/dist/docs/`.
Heed all deprecation notices — APIs, conventions, and file structure may differ significantly.

For any change touching a single dashboard, workers also read `docs/app/<dashboard>.md`.
For schema changes: `docs/supabase/PRD.md`. For visual changes: `docs/design/identity.md`.

@README.md
