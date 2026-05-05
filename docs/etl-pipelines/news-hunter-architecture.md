================================================================================
NEWS HUNTER — HANDOFF
================================================================================

Contexto rapido para uma nova sessao continuar o modulo News Hunter do
dashboard SectorData. Tudo abaixo reflete o estado real em main.

Repos:
  - SectorData (dashboard):       C:\Users\eduar\dashboard_projeto
                                  github.com/IBBAOG/SectorData
  - news-hunter-scanner (scanner): github.com/IBBAOG/news-hunter-scanner


================================================================================
1. ARQUITETURA — TRES PECAS
================================================================================

  +--------------------------+   service_role    +-------------------+   anon RLS    +-------------------+
  |  GitHub Actions          |  ---- push ---->  |  Supabase         |  <-- read --  |  Vercel           |
  |  IBBAOG/news-hunter-     |                   |  news_articles    |               |  /news-hunter     |
  |  scanner                 |                   |  news_hunter_     |               |  polling 60s      |
  |  cron-job.org -> ~5 min  |                   |  keywords         |               |  filtra no browser|
  |  workflow_dispatch       |                   |  RLS on           |               |                   |
  +--------------------------+                   +-------------------+               +-------------------+

- Scanner: workflow_dispatch acionado pelo cron-job.org a cada ~5 min.
  Cada run = `python news_hunter_service.py --once`. concurrency:
  cancel-in-progress: true (run novo cancela run em andamento).
- Scanner LE keywords da tabela public.news_hunter_keywords no Supabase
  (UNION dedupada de todos os users autenticados). Fallback para
  DEFAULT_KEYWORDS local quando a tabela esta vazia ou Supabase indisponivel.
- Vercel: somente leitura via anon key + RLS. Nunca chama o scanner.


================================================================================
2. SUPABASE
================================================================================

Tabela public.news_articles:
    url               text primary key
    domain            text not null
    source_name       text not null
    title             text not null
    snippet           text not null default ''
    published_at      timestamptz not null
    found_at          timestamptz not null default now()
    matched_keywords  text[] not null default '{}'
    created_at        timestamptz not null default now()
RLS: SELECT para authenticated; INSERT/UPDATE somente via service_role.

Tabela public.news_hunter_keywords:
    user_id    uuid (FK auth.users, on delete cascade)
    keyword    text
    created_at timestamptz
    PK (user_id, keyword)
RLS: cada user le/insere/deleta apenas as proprias linhas.

RPC public.seed_my_news_hunter_keywords():
    Insere a lista default (27 termos) para o user autenticado.
    Idempotente (ON CONFLICT DO NOTHING). Chamada pelo front no primeiro
    visit quando a lista do user volta vazia.

Visibilidade: INSERT em module_visibility ('news-hunter', true).

Migrations:
    supabase/migrations/20260424000008_news_hunter.sql
    supabase/migrations/20260424000009_news_hunter_keywords.sql


================================================================================
3. FRONTEND (Next.js 16.2.1)
================================================================================

Arquivos:
    src/app/(dashboard)/news-hunter/page.tsx
    src/app/(dashboard)/news-hunter/page.module.css
    src/components/NavBar.tsx          (link "News Hunter")
    src/app/(dashboard)/home/HomeClient.tsx  (card "News Hunter")

Padroes do repo (descobertos no codigo):
- Cliente Supabase via getSupabaseClient() — pode retornar null, sempre guard.
- Visibilidade via useModuleVisibilityGuard("news-hunter").
- NavBar no topo + grupo (dashboard) ja garante session check.
- CSS Module isola do Bootstrap global.

Constantes em page.tsx:
    POLL_INTERVAL_MS = 60_000   (refresh do front; alinhado a cadencia do scanner)
    AGE_TICK_MS      = 15_000   (re-render so para refrescar "ha X min")
    PAGE_LIMIT       = 500
    FLASH_DURATION_MS= 3400     (animacao "just-arrived" amarela)

Polling:
    fetchInitial(hours):
        SELECT * FROM news_articles
        WHERE published_at >= NOW() - hours
        ORDER BY published_at DESC
        LIMIT 500
        -> grava lastFoundAtRef = max(found_at)
        -> seta lastFoundAt (state) para exibir "ultima manchete ha X"
    fetchIncremental() [a cada 60s]:
        SELECT * FROM news_articles
        WHERE found_at > lastFoundAtRef
        ORDER BY found_at DESC LIMIT 500
        -> atualiza lastFoundAt apenas se vierem rows novas

"ultima manchete ha X" usa max(found_at) das rows que ja vimos — reflete
quando o scanner GHA pushou pela ultima vez, NAO quando o front fez fetch.


================================================================================
4. KEYWORDS — UMA UNICA LISTA NO SUPABASE
================================================================================

A lista do usuario em news_hunter_keywords e a unica fonte. Adicionar/
remover chip no painel:
    - Insere/deleta linha em news_hunter_keywords (RLS por auth.uid()).
    - O scanner GHA, no proximo run (<= 5 min), inclui/exclui essa keyword
      do search set (UNION com as keywords dos outros users).

Logo: adicionar uma keyword no Vercel REALMENTE muda o que o scanner busca,
no proximo scan. Removed-elsewhere caveat: outros users tambem influenciam,
porque o scanner faz UNION.

Lista default (27 termos) seedada via seed_my_news_hunter_keywords RPC no
primeiro visit:
    petroleo, petroleo, Petrobras, Vibra, Brava, Ultrapar, Ipiranga,
    PetroReconcavo, PetroReconcavo, oil, gasolina, gas, gas, diesel,
    combustivel, combustivel, combustiveis, combustiveis, OceanPact,
    Cosan, Raizen, Raizen, Braskem, Compass, PRIO, ANP, refit.

Existe tambem FALLBACK_KEYWORDS in-memory em page.tsx — usada apenas se a
query a news_hunter_keywords falhar (RLS / network). Read-only nesse caso.


================================================================================
5. CADENCIA REAL (resumo)
================================================================================

| Camada                                   | Cadencia       |
|------------------------------------------|----------------|
| cron-job.org -> workflow_dispatch        | ~5 min         |
| GHA scan (--once) -> Supabase UPSERT     | ~5 min (idem)  |
| Front polling fetchIncremental           | 60s            |
| Tick "ha X min" (re-render label)        | 15s            |

Front nunca chama o scanner. Scanner nunca le do front.


================================================================================
6. CHAVES E SECRETS
================================================================================

Frontend (.env.local — Vercel):
    NEXT_PUBLIC_SUPABASE_URL
    NEXT_PUBLIC_SUPABASE_ANON_KEY

Front (localStorage):
    news-hunter-theme    -> "light" | "dark"

Scanner (GitHub Actions secrets em IBBAOG/news-hunter-scanner):
    SUPABASE_URL
    SUPABASE_SERVICE_KEY     (BYPASSA RLS — nunca em qualquer outro lugar)


================================================================================
7. O QUE NAO FAZER
================================================================================

- NUNCA colocar SUPABASE_SERVICE_KEY no frontend, em NEXT_PUBLIC_*, ou
  qualquer commit.
- NAO criar mais um sistema de auth no News Hunter — (dashboard)/layout.tsx
  ja faz o guard.
- NAO assumir Next.js padrao (training data) — este repo usa Next 16.2.1
  com breaking changes; consultar node_modules/next/dist/docs/.
- NAO apagar o seed default de keywords (idempotente, reseta automatico
  para users que zerarem a lista).


================================================================================
8. DEBUG / OPERACOES
================================================================================

Forcar scan manual:
    Actions -> News Hunter scan -> Run workflow (em IBBAOG/news-hunter-scanner)

Conferir conteudo da tabela:
    SELECT count(*), max(published_at), max(found_at) FROM news_articles;
    SELECT source_name, title, published_at FROM news_articles
        ORDER BY published_at DESC LIMIT 10;

Verificar keywords ativas (UNION):
    SELECT DISTINCT keyword FROM news_hunter_keywords ORDER BY keyword;

Build local do dashboard:
    cd C:\Users\eduar\dashboard_projeto
    npm run dev


================================================================================
FIM
================================================================================
