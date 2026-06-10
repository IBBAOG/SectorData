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
- Scanner LE keywords do Supabase: UNION da lista DEFAULT (via
  get_default_news_keywords_with_flags) com a per-user
  public.news_hunter_keywords (dedupada). Fallback para DEFAULT_KEYWORDS
  local apenas quando o Supabase esta indisponivel. (Ver secao 4.)
- Vercel: somente leitura via anon key + RLS. Nunca chama o scanner.

Matching scope (fast_mode + lede rescue):
- The only scheduled entry point is `news_hunter_service.py --once`, which
  runs in fast_mode. Fast_mode historically matched keywords against the
  article TITLE + RSS-summary (snippet) only and short-circuited BEFORE
  fetching the article body — so a keyword that appeared only in the body
  (e.g. the macro-oil headline whose lede mentioned "barris/dia") was
  silently dropped.
- Scanner PR #4 (merged 2026-06-09, squash commit 74633eff,
  "fix(scanner): match article lede for RSS near-misses") adds a bounded
  LEDE-RESCUE pass. RSS near-misses (item has title + published, but no
  keyword hit in title/summary) are diverted to a capped body fetch and
  re-validated against title + lede (first paragraph). Keywords that
  appear only in the article's opening paragraph can now match.
- Caps keep the ~5-min cadence / GHA timeout safe: 40 rescue fetches per
  scan (global), 8 per domain, 14s deadline, run on a separate thread pool
  AFTER the normal enrich phase. Re-validation still requires a real
  keyword hit — no relevance loosening, just a second look at the lede.


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

  >>>  Scanner active search set (IMPLEMENTED — was a TODO, done 2026-06-09):
       The scanner now reads the DEFAULT keyword table directly. In the
       scanner repo, store.py `_fetch_default_keywords` calls
       public.get_default_news_keywords_with_flags (keyword + match_type),
       with a fallback to a direct SELECT on public.news_hunter_default_keywords.
       The scanner then UNIONs that default set with the per-user
       public.news_hunter_keywords (each row carrying its own match_type
       since 2026-05-20).

       Resulting active search set per scan:
         get_default_news_keywords_with_flags  (default table, with match_type)
           UNION
         news_hunter_keywords                  (per-user, with match_type)
       with the local in-memory DEFAULT_KEYWORDS used ONLY as a contingency
       fallback when Supabase is unavailable.

       match_type application (same logic across both sources):
         match_type='exact'     -> regex \b<keyword>\b case-insensitive
         match_type='substring' -> substring case-insensitive (legacy)

       Consequence: adding a term to news_hunter_default_keywords DOES
       propagate to the scanner on its next run (<= 5 min) — no per-user
       re-seed needed. (Older migrations such as 20260615000000 still also
       backfill news_hunter_keywords for belt-and-suspenders; that backfill
       is now redundant for propagation but harmless.)

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
4. KEYWORDS — DEFAULT TABLE + PER-USER, UNIONED NO SCANNER
================================================================================

Scanner active search set (per scan) = DEFAULT list UNION per-user list:
    - DEFAULT: public.news_hunter_default_keywords, read by the scanner via
      get_default_news_keywords_with_flags (keyword + match_type). Single
      source of truth for the shipped watchlist; edited by admins in the
      Admin Panel.
    - PER-USER: public.news_hunter_keywords (RLS por auth.uid()). Adding/
      removing a chip in the dashboard inserts/deletes a row here.

Two ways a keyword reaches the scanner on its next run (<= 5 min):
    - Add to the DEFAULT table (admin) -> scanner reads it directly via
      get_default_news_keywords_with_flags. Propagates without any re-seed.
    - Add a personal chip in the dashboard -> scanner picks it up in the
      UNION. Removed-elsewhere caveat: other users also influence the set,
      because the scanner UNIONs every per-user list.

Logo: adicionar uma keyword (na lista default OU como chip pessoal)
REALMENTE muda o que o scanner busca no proximo scan.

Default watchlist (news_hunter_default_keywords; also seeded into a new
user's personal list on first visit via seed_my_news_hunter_keywords):
    petroleo, Petrobras, Vibra, Brava, Ultrapar, Ipiranga, PetroReconcavo,
    oil, gasolina, gas, diesel, combustivel, combustiveis, OceanPact,
    Cosan, Raizen, Braskem, Compass, PRIO, ANP, refit.
    + 2026-06-09 (migration 20260615000000_news_hunter_macro_oil_keywords):
      5 macro-oil terms added to the default table AND backfilled into
      existing users' news_hunter_keywords:
        oleo (substring), barril (substring), barris (substring),
        Brent (exact), WTI (exact).
      Rationale: the macro-oil headline "Guerra destruiu demanda de 5
      milhoes de barris/dia de oleo ..." (eixos.com.br) was being dropped
      because none of its title/subtitle terms were tracked.

Existe tambem FALLBACK_KEYWORDS in-memory em page.tsx (frontend) — usada
apenas se a query a news_hunter_keywords falhar (RLS / network). Read-only
nesse caso. O scanner tem o seu proprio DEFAULT_KEYWORDS in-memory, usado
so quando o Supabase esta indisponivel.


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
    BRASIL_ENERGIA_USER      (paying account email for Brasil Energia login)
    BRASIL_ENERGIA_PASS      (Brasil Energia account password)

    Brasil Energia auth: brasilenergia.com.br is a subscriber paywall. The
    scanner logs in with these credentials to fetch full article bodies (see
    section 6.5). Both secrets are also mirrored in the local gitignored .env
    for local probing; never commit them. The workflow scan.yml passes them in
    the run step's env: alongside SUPABASE_URL / SUPABASE_SERVICE_KEY. If they
    are absent, the scanner skips Brasil Energia gracefully (logged warning) and
    the rest of the scan still runs.


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
    IMPERSONATE_DOMAINS             -- domains that fetch_html routes through a
                                       non-default HTTP path (Brasil Energia ->
                                       authenticated session; otherwise curl_cffi)

  news_hunter/brasilenergia_auth.py  -- authenticated session for Brasil Energia

Authenticated source — Brasil Energia (added 2026-06-10):
  brasilenergia.com.br is a subscriber paywall (ASP.NET Core, NOT WordPress).
  Anonymous requests return HTTP 200 but with truncated article bodies plus a
  login link and "conteudo exclusivo / assinante" markers. The scanner now logs
  in with a paying account and fetches full bodies.

  Login flow (reverse-engineered against the live site):
    1. GET  /login?ReturnUrl=<path>  -> sets .AspNetCore.Antiforgery.* + be_uuid
       cookies; the login <form> carries a hidden __RequestVerificationToken.
    2. POST /login?ReturnUrl=<path>  (form-encoded) with fields:
         Tipo=login, LoginForm.Email, LoginForm.Password,
         LoginForm.AcceptTerms=true, g-recaptcha-response="" (the server accepts
         an empty reCAPTCHA token for this account), __RequestVerificationToken.
       Success -> HTTP 302 to ReturnUrl + Set-Cookie be-auth (the session).
       Failure -> HTTP 200 re-rendering the form, no be-auth cookie.

  Expiry signal (classic silent-expiry trap — a 200 that is really logged-out):
    an authenticated request returns 401/403, OR a 200 whose body still shows
    the login link (/login?ReturnUrl) or the paywall markers. The get() wrapper
    in brasilenergia_auth detects this, re-logs in once, and retries; if it
    still fails it logs and gives up so the rest of the scan keeps running.

  Wiring:
    - news_hunter/sources.py: HOMEPAGE_SCRAPERS["www.brasilenergia.com.br"] =
      ".../petroleoegas/ultimasnoticias" (the listing). The scraper collects
      article links; enrich fetches each page. Both go through fetch_html.
    - news_hunter/_clipinator_shim.py: fetch_html routes IMPERSONATE_DOMAINS
      (Brasil Energia) through brasilenergia_auth.get_auth().get(), which carries
      the be-auth cookie and auto-renews on expiry. If creds are absent it falls
      back to curl_cffi impersonation (anonymous, paywalled teasers only).
    - news_hunter/brasilenergia_auth.py: login(), authenticated get() with
      transparent re-login, in-memory session + best-effort on-disk cookie cache
      (.be_session.json, gitignored, ~6h TTL) so cloud runs reuse a session
      across the ~5 min cron invocations.
    - Credentials read from BRASIL_ENERGIA_USER / BRASIL_ENERGIA_PASS (env). No
      Brotli advertised in Accept-Encoding (gzip/deflate only) to avoid the
      undecoded-br silent-empty-page trap.

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

- Brasil Energia is an AUTHENTICATED source: it is not just an HTML scrape, it
  needs the be-auth session cookie (see "Authenticated source" above). Adding a
  similar paywalled source means writing a small auth module like
  brasilenergia_auth.py and routing its domain through fetch_html.

Historico de cadastros via dashboard:
  2026-05-20  ANS  (PR #1: github.com/IBBAOG/news-hunter-scanner/pull/1)
  2026-06-10  Brasil Energia re-enabled as an authenticated source (auto-renewing
              be-auth session); previously treated as 403-blocked / GNews-only


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

Verificar keywords ativas (default + per-user UNION):
    SELECT keyword, match_type FROM news_hunter_default_keywords
        ORDER BY keyword;
    SELECT DISTINCT keyword FROM news_hunter_keywords ORDER BY keyword;

Build local do dashboard:
    cd C:\Users\eduar\dashboard_projeto
    npm run dev


================================================================================
FIM
================================================================================
