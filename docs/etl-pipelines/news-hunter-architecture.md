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
    match_type text NOT NULL DEFAULT 'substring'
               CHECK (match_type IN ('substring','exact'))   -- added 2026-05-20
    created_at timestamptz
    PK (user_id, keyword)
RLS: cada user le/insere/deleta apenas as proprias linhas.

Tabela public.news_hunter_default_keywords:
    keyword    text PK
    match_type text NOT NULL DEFAULT 'substring'
               CHECK (match_type IN ('substring','exact'))   -- added 2026-05-25
    created_at timestamptz
RLS: read-only para anon + authenticated. Writes exclusivamente via
SECURITY DEFINER RPCs admin (sem policies INSERT/DELETE). Schema agora
simetrico com news_hunter_keywords (per-user) — ambas as tabelas carregam
match_type.

match_type semantics (added 2026-05-20 para per-user, migration
20260520000001; added 2026-05-25 para default, migration 20260525250000):
  substring (default): case-insensitive substring (legacy behaviour).
                       e.g. "ANS" matches "trANSporte".
  exact              : case-insensitive whole-word, regex \b{kw}\b.
                       e.g. "ANS" matches "ANS divulga relatorio" but NOT
                       "trANSporte".
Cross-repo: requires news-hunter-scanner PR #2 to be merged for the scanner
to honor the column. Before PR #2 the scanner still uses \b for everything
(its legacy behaviour). After PR #2 the scanner default flips to substring;
only keywords with match_type='exact' get \b-bounded.

RPC public.seed_my_news_hunter_keywords():
    Insere a lista default (27 termos) para o user autenticado.
    Idempotente (ON CONFLICT DO NOTHING). Chamada pelo front no primeiro
    visit quando a lista do user volta vazia.

RPC public.get_default_news_keywords():
    RETURNS text[]. Inalterada (retrocompat) — consumida por
    NewsHunterContext.tsx. Granted anon + authenticated.

RPC public.get_default_news_keywords_with_flags():   -- added 2026-05-25
    RETURNS TABLE(keyword text, match_type text).
    Exposta para o scanner repo (IBBAOG/news-hunter-scanner) consumir
    match_type per-keyword da lista default. Granted anon +
    authenticated. LANGUAGE sql STABLE SECURITY DEFINER.

  >>>  TODO no scanner repo (IBBAOG/news-hunter-scanner):
       Hoje o scanner consome a UNION de public.news_hunter_keywords
       (per-user, ja com match_type desde 2026-05-20) com fallback para
       DEFAULT_KEYWORDS local quando a tabela esta vazia / Supabase
       indisponivel. A lista default ANTES era hardcoded no SQL via
       seed_my_news_hunter_keywords, agora vive em
       news_hunter_default_keywords (single source of truth) e ja tem
       match_type.

       Acao requerida no scanner: substituir (ou complementar) a leitura
       de public.get_default_news_keywords (text[]) por
       public.get_default_news_keywords_with_flags (keyword + match_type),
       e aplicar:
         match_type='exact'    -> regex \b<keyword>\b case-insensitive
         match_type='substring'-> substring case-insensitive (legacy)
       Mesma logica que ja eh aplicada em news_hunter_keywords per-user
       (PR #2 do scanner). Default fallback in-memory pode permanecer
       como contingencia quando o Supabase estiver indisponivel.

RPCs admin (Admin Panel -> "Default News Keywords"):
    public.admin_list_default_news_keywords()
        RETURNS TABLE(keyword text, match_type text, created_at timestamptz).
        3 colunas (era 2 antes de 2026-05-25). Admin-only.
    public.admin_add_default_news_keyword(p_keyword text,
                                          p_match_type text DEFAULT 'substring')
        2 params (era 1 antes de 2026-05-25). Default 'substring' preserva
        chamadas pre-2026-05-25. Audit em app_events
        (event_type='admin.add_default_news_keyword', payload inclui
        match_type).
    public.admin_set_default_news_keyword_match_type(p_keyword text,
                                                     p_match_type text)
        Nova em 2026-05-25. UPDATE idempotente. Audit
        event_type='admin.set_default_news_keyword_match_type'.
    public.admin_remove_default_news_keyword(p_keyword text)
        Inalterada (signature mantida). Audit
        event_type='admin.remove_default_news_keyword'.

Visibilidade: INSERT em module_visibility ('news-hunter', true).

Migrations:
    supabase/migrations/20260424000008_news_hunter.sql
    supabase/migrations/20260424000009_news_hunter_keywords.sql
    supabase/migrations/20260520000001_news_hunter_keywords_match_type.sql
    supabase/migrations/20260522000001_anonymous_access.sql
        (cria news_hunter_default_keywords + get_default_news_keywords)
    supabase/migrations/20260525230000_admin_default_news_keywords_rpcs.sql
        (cria 3 RPCs admin originais)
    supabase/migrations/20260525250000_default_news_keywords_match_type.sql
        (adiciona match_type + 2 RPCs novas + 2 RPCs alteradas)


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
6.5. CADASTRO DE FONTES (HARDCODED NO REPO DO SCANNER)
================================================================================

Fontes do scanner NAO vivem no Supabase. Vivem hardcoded no repo
IBBAOG/news-hunter-scanner em dois arquivos:

  news_hunter/sources.py
    RSS_FEEDS[dominio] = [urls]     -- RSS classico ou sitemap Google News
    STANDARD_SITEMAPS[dominio]      -- sitemap WordPress padrao (urlset, sem news:)
    HOMEPAGE_SCRAPERS[dominio]      -- sem feed, scraping de pagina de listagem
    SITEMAP_URL_MARKERS             -- substrings que classificam URL como sitemap
                                       (vs. RSS feedparser); add aqui se a URL
                                       do sitemap nao casa com markers existentes

  news_hunter/_clipinator_shim.py
    SOURCE_NAMES[dominio]           -- nome legivel exibido no dashboard

Passos para adicionar uma fonte nova:
  1. WebFetch da URL alvo. Descobrir: SSR vs JS? Tem RSS / sitemap Google News
     (news:news) / sitemap padrao / so HTML?
  2. PR no repo news-hunter-scanner editando os dois arquivos acima.
  3. Apos merge, proxima execucao do cron (~5 min) ja varre a fonte.
  4. Verificar em Supabase: SELECT * FROM news_articles WHERE domain = '...'
     ORDER BY found_at DESC LIMIT 5.

Pegadinhas conhecidas:
- Para fontes hospedadas em portais gov.br (/<orgao>/pt-br/assuntos/noticias),
  o sitemap /sitemap.xml costuma ser urlset com xmlns:news (formato Google
  News) — entra no _fetch_sitemap, NAO no feedparser.
- A chave RSS_FEEDS["www.gov.br"] e multi-tenant: cobre /ans, /anp, /mme,
  etc. Hoje so a ANS esta registrada. Se uma segunda fonte gov.br for
  cadastrada, source_name_for() precisara virar path-aware.

Historico de cadastros via dashboard:
  2026-05-20  ANS  (PR #1: github.com/IBBAOG/news-hunter-scanner/pull/1)


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
