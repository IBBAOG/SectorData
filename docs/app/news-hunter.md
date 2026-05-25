# Sub-PRD — `/news-hunter`

Dashboard de News Hunter (radar de notícias). Owner: [`worker_dash-news-hunter`](../../.claude/agents/worker_dash-news-hunter.md).

> Único dashboard que **coordena com um repo externo** ([`IBBAOG/news-hunter-scanner`](https://github.com/IBBAOG/news-hunter-scanner)).

## Dual-view structure (added 2026-05-20)

`/news-hunter` follows the canonical dual-view pattern (CLAUDE.md § Dual-view policy):

```
src/app/(dashboard)/news-hunter/
  page.tsx                  Viewport router — useIsMobile() → DesktopView | MobileView
  useNewsHunterData.ts      SINGLE BRAIN: polling + watermark, keyword CRUD,
                              topic filter, search, bookmarks, mobileTab state.
                              Both Views consume this hook; no direct Supabase
                              calls inside View files.
  desktop/View.tsx          Desktop UX (≥769px) — verbatim body of old page.tsx
                              + admin clipping flow (Selection Mode).
  mobile/View.tsx           Mobile UX (≤768px) — per mockups/news-hunter-mobile.html.
                              Components: MobileTopBar, MobileBottomTabBar (Feed/Search/
                              Saved/Settings), filter pills (keywords as topic pills),
                              KeywordsSection (compact chip row), ArticleCard
                              (favicon circle + headline + snippet + kw pills),
                              BottomSheet (keyword editor), FAB (+), live status row.
```

### Decision: admin clipping feature is desktop-only (Phase 1 mobile)

The clipping flow (SelectionSidebar + ClippingModal + POST /api/clipping/scrape) was
intentionally NOT ported to mobile/View.tsx in this wave. It requires multi-select UX,
a large modal, and relies on desktop real estate. Tag: `[mobile-only-deferred-clipping]`.
When clipping lands on mobile, the hook already exposes all article data needed.

### Mobile tab navigation

Four tabs in `MobileBottomTabBar`:
- **Feed** — filtered article list with topic pills and keyword section
- **Search** — same list but focused on search (filter pills hidden)
- **Saved** — articles bookmarked locally (localStorage `nh_bookmarks_v1`)
- **Settings** — full keyword add/remove management

Bookmarks are local-only (no DB column). The `toggleBookmark` callback in
`useNewsHunterData` manages `bookmarkedUrls: Set<string>` persisted to
`localStorage (nh_bookmarks_v1)`.

## Escopo de código

```
src/app/(dashboard)/news-hunter/
  page.tsx                  Viewport router (useIsMobile)
  useNewsHunterData.ts      Shared data + state hook
  page.module.css           Scoped styles (desktop view — não polui globals.css)
  desktop/View.tsx          Desktop presentation layer
  mobile/View.tsx           Mobile presentation layer
  _components/
    SelectionSidebar.tsx            Admin-only: clipping queue panel
    ClippingModal.tsx               Admin-only: preview + download modal
  _hooks/
    useClippingSelection.ts         Admin-only: ordered selection state hook

src/lib/clipping/
  types.ts          ClippingItem, ScrapeResult, ArticleSnapshot
  sources.ts        SOURCE_NAMES + EXTRACTORS (~80 domains, port of clipinator.py)
  extract.ts        cheerio-based extraction (port of clipinator.py _extract)
  clean.ts          cleanTitle, cleanParagraphs, looksPaywalled
  cookies.ts        parseNetscapeCookies + buildCookieHeader + canonicalDomain
  fetch.ts                fetchHtml (undici) + fetchHtmlViaCurl + fetchHtmlViaImpersonate + fetchFromWayback
  fetchHtmlViaHeadless.ts playwright-core + @sparticuz/chromium headless tier (4th cascade layer)
  scrape.ts               scrape() orchestrator — 5-tier cascade (undici/curl/impersonate/headless/wayback)
  buildHtml.ts      buildHtml() — email HTML template
  buildPlainText.ts buildPlainText() — plain-text alternative
  buildEml.ts       buildEml() — hand-rolled RFC 5322 multipart/alternative

src/app/api/clipping/scrape/route.ts   POST route (Admin-gated, nodejs runtime)
```

RPC wrapper: seção "news_hunter" em [`src/lib/rpc.ts`](../../src/lib/rpc.ts).

## Produto

Lista de **notícias** publicadas que matchearam keywords salvas pelo user. Atualização em tempo (quase) real via polling. Funcionalidades:
- Visualização cronológica (`found_at` / `published_at`).
- Filtros por keyword, domínio, fonte.
- Gestão de keywords (adicionar / remover).
- Snapshot/excerpt de cada artigo + link pra fonte.

### Admin-only: Clipping (port do Clipinator)

Admins têm uma funcionalidade extra de **clipping de notícias**:

1. **Selection Mode toggle** — aparece no top row para Admins. Ativa checkboxes em cada artigo.
2. **SelectionSidebar** — painel direito com artigos selecionados em ordem, controles de reordenação (↑/↓), botão "Generate Clipping".
3. **POST /api/clipping/scrape** — rota Admin-gated (mirror do padrão de auth em `upload-card-preview/route.ts`). Cap de 15 URLs, 12s timeout por URL, `maxDuration = 180` (bumped from 60 to accommodate headless tier worst-case).
4. **ClippingModal** — modal com:
   - Aba "Preview": iframe renderizando o HTML do clipping (Calibri 11pt, header laranja #FF5000, "Main Headlines" TOC, TEAM_BLOCK com 3 emails).
   - Aba "Status": pills por artigo (ok/paywall/fetch_failed/etc) + textarea manual para sites bloqueados.
   - Botões: **Download .eml** (RFC 5322 multipart/alternative, hand-rolled), **Copy HTML**, **Regenerate preview**.
5. **Rendering é client-side** — build_html/buildPlainText/buildEml rodam no browser, sem round-trip ao servidor para re-renderizar.

#### Template do clipping (fidelidade ao clipinator.py)

- Header: `*** IBBA Oil & Gas News – DD Month YYYY ***` (18pt bold laranja, centrado; `–` U+2013)
- "Main Headlines" subheader 14pt laranja + bullet list `<título> (<fonte>)`
- TEAM_BLOCK hardcoded:
  - Itaú BBA Oil & Gas Team (laranja)
  - Monique Greco Natal / monique.greco@itaubba.com
  - Eric de Mello / eric.mello@itaubba.com
  - Eduardo Mendes / eduardo.mendes@itaubba.com
- Por artigo: 14pt bold `título (fonte)`, parágrafos, `Fonte: <link>`
- Arquivo salvo como `ibba_oil_gas_news_YYYY-MM-DD.eml`

#### SSRF guard

A rota só processa URLs cujo domínio está no `EXTRACTORS` whitelist (~80 domínios jornalísticos). Domínio desconhecido → `{ status: "unknown_domain" }` sem fazer fetch.

#### Authenticated paywall bypass (cookies por domínio)

A tabela `clipping_cookies` armazena cookies em formato Netscape HTTP Cookie File por domínio canônico (sem `www.`). A route consulta essa tabela antes de iniciar o scrape:

1. Coleta todos os domínios únicos do batch via `canonicalDomain(url)`.
2. Faz um único SELECT `clipping_cookies WHERE domain IN (...)` usando o service-role client.
3. Para cada row, parseia os cookies com `parseNetscapeCookies` (filtrando expirados), monta o header com `buildCookieHeader`, e passa o resultado para `scrape()` como argumento `cookieHeader`.
4. `fetchHtml` injeta o header `Cookie:` na request live quando recebido.

Quando os cookies expirarem, um Admin deve fazer re-seed diretamente na tabela `clipping_cookies` (uma UI de upload é follow-up). Cookies de sessão (`expires = 0` no arquivo Netscape) nunca expiram pela lógica de parsing e são mantidos.

Domínios atualmente com cookies seedados: `valor.globo.com`, `brasilenergia.com.br`.

#### Wayback Machine fallback — fetch failure e paywall

O fallback para o Wayback Machine agora dispara em **dois** cenários:

1. **Paywall detectado** (comportamento original): fetch teve sucesso, mas `looksPaywalled(paragraphs)` retornou true após extração.
2. **Fetch failure** (novo): fetch retornou 403/4xx/5xx ou lançou erro de rede/timeout. Antes de retornar `fetch_failed`, `scrape()` tenta buscar a URL no Wayback. Se o snapshot existir e não estiver paywalled, retorna `status: "ok"` com `via_wayback: true`.

Quando um artigo vem do Wayback, o modal exibe um badge "via Wayback" azul ao lado do pill de status na aba Status. Isso cobre Reuters e outros sites com bot blocking forte que não têm cookies disponíveis. O campo `via` em `ScrapeResult` rastreia a origem: `"curl"` | `"wayback"` | omitido (fetch direto).

#### Fetch cascade (Cloudflare / bot-detection / JS-challenge bypass)

Node's `undici` fetch has a TLS ClientHello fingerprint that many sites reject with 403. A 4-tier cascade covers the full spectrum:

```
undici fetch
  ↓ fetch_failed (403 / network error)
fetchHtmlViaCurl  — plain static curl 8.20.0 (musl, 10 MB)
  Sends manual -A / -H browser headers. Covers most sites (BE Globo, Reuters, etc.)
  ↓ fetch_failed (or paywall → skip to Wayback directly)
fetchHtmlViaImpersonate  — curl-impersonate chrome131 (4.1 MB ELF + wrapper)
  Full Chrome 131 TLS fingerprint (ciphers, curves, extensions, HTTP/2, browser headers).
  Covers Cloudflare sites that use TLS fingerprinting (plain TLS impersonation sufficient).
  ↓ fetch_failed
fetchHtmlViaHeadless  — playwright-extra + puppeteer-extra-plugin-stealth + @sparticuz/chromium (~62 MB serverless Chromium)
  Executes JavaScript — passes Cloudflare Bot Management JS challenge (Investing.com, etc.)
  that static TLS impersonation alone cannot. Stealth plugin overrides navigator.webdriver,
  chrome.runtime, navigator.plugins, languages and other signals inspected by Cloudflare.
  Confirmed working: 3 sequential runs against Investing.com ~14s each, status 200.
  Waits 3s after 403/429/503 for challenge JS to resolve, then 1.5s for body hydration.
  Browser instance cached module-level (browserPromise); fresh BrowserContext per request.
  ↓ fetch_failed
fetchFromWayback
  ↓ fetch_failed
return fetch_failed  (all details concatenated in ScrapeResult.error)
```

`via` field values: `"curl"` | `"curl_impersonate"` | `"headless"` | `"wayback"`.

Final error string format: `"undici: <d>; curl: <d>; curl_impersonate: <d>; headless: <d>; wayback: <d>"`.

Paywall logic: if any tier returns OK but `looksPaywalled`, **skip directly to Wayback** — paywall is an auth problem, not a fingerprint/JS problem. Headless would see the same gate.

Implementation details:
- `child_process.execFile` (not `exec`) — URL and cookies passed as array args, no shell injection.
- `--max-time 20` + `maxBuffer: 10 MB` + `timeout: 22_000` ms.
- HTTP status extracted via `-w "\n---STATUS:%{http_code}"` marker in stdout.
- `fetchHtmlViaImpersonate` does NOT send `-A`/`-H Accept*`/`-H Referer` — the `curl_chrome131` wrapper already injects them. Cookie header is still passed.
- Path resolution is cached in module-level promises (resolved once per process lifetime).
- On non-Linux (dev Windows/macOS): `resolveCurlStaticPath` returns `"curl"` (system); `resolveCurlImpersonatePath` returns `null` → `curl_impersonate_not_found`.

The ClippingModal Status tab shows:
- Blue (`#e8f4fd`) "via curl" badge for articles from plain static curl.
- Orange-tinted (`#fff0e6`) "via curl-impersonate" badge for articles from chrome131 impersonate.
- Green (`#e6f9ee`) "via headless" badge for articles retrieved via headless Chromium.
- Blue (`#e8f4fd`) "via Wayback" badge for Wayback snapshots.

#### Bundled binaries / libs

| Artifact | Size | Source | Purpose |
|---|---|---|---|
| `vendor/curl-static-amd64` | ~10 MB | [curl/curl releases](https://github.com/curl/curl/releases) — musl static-pie ELF | Plain curl (tier 1 fallback). |
| `vendor/curl-impersonate` | ~4.1 MB | [lexiforest/curl-impersonate](https://github.com/lexiforest/curl-impersonate) v1.1.0 ELF | Binary called by `curl_chrome131` wrapper. |
| `vendor/curl_chrome131` | ~1.9 KB | Same release | Bash wrapper — injects Chrome 131 TLS fingerprint + browser headers. |
| `node_modules/@sparticuz/chromium/bin/` | ~62 MB | [@sparticuz/chromium](https://github.com/Sparticuz/chromium) | Serverless Chromium for playwright-core (tier 3 headless). |
| `playwright-core` (npm) | ~5 MB | [microsoft/playwright](https://github.com/microsoft/playwright) | Browser automation API (no bundled browser — uses sparticuz). |
| `playwright-extra` (npm) | ~0.5 MB | [berstend/puppeteer-extra](https://github.com/berstend/puppeteer-extra) | Wraps playwright-core's chromium with plugin support. |
| `puppeteer-extra-plugin-stealth` (npm) | ~0.5 MB | Same repo | Stealth overrides: navigator.webdriver, chrome.runtime, plugins, languages — required to pass Cloudflare Bot Management. |

Estimated bundle total: ~100–120 MB + ~3 MB (stealth deps) ≈ ~113 MB (Vercel Pro limit: 250 MB unzipped).

**If Vercel reports bundle size exceeded**: switch from `@sparticuz/chromium` to `@sparticuz/chromium-min` — it downloads Chromium at runtime from CDN instead of bundling it (smaller bundle, ~2s extra cold start on first use).

**Bundling**: `next.config.ts` `outputFileTracingIncludes` includes all four vendor paths. `serverExternalPackages` prevents webpack from trying to bundle `@sparticuz/chromium` and `playwright-core` — they must be `require()`d at runtime.

**Path resolution**:
- `resolveCurlStaticPath()` — checks `.next/server/vendor/curl-static-amd64` → `vendor/curl-static-amd64` → `/var/task/...`. Non-Linux → `"curl"` (system).
- `resolveCurlImpersonatePath()` — checks `.next/server/vendor/curl_chrome131` → `vendor/curl_chrome131` → `/var/task/...`. Chmods both `curl_chrome131` and `curl-impersonate` in the same dir. Non-Linux → `null`.

**Limitation**: Linux x86_64 only. Vercel does not currently use ARM for Node.js functions.

**Updating binaries**:
- `curl-static-amd64`: download new static musl build from [curl releases](https://github.com/curl/curl/releases), replace `vendor/curl-static-amd64`, commit.
- `curl-impersonate` + `curl_chrome131`: download tarball from [lexiforest/curl-impersonate releases](https://github.com/lexiforest/curl-impersonate/releases), extract, replace both files in `vendor/`, commit. Update version note here.

#### Estado de seleção

- Vive em `page.tsx` (NÃO no NewsHunterContext).
- Persistido em `localStorage` com chave versionada `nh_clipping_selection_v1`.
- Hook: `useClippingSelection` (em `_hooks/useClippingSelection.ts`).

## Arquitetura cross-repo

```
+----------------------------+   service_key   +-----------------+   anon+RLS    +--------------+
| GitHub Actions             |  --- push --->  | Supabase        | <--- read --- | Vercel       |
| IBBAOG/news-hunter-        |                 | news_articles   |               | /news-hunter |
|   scanner                  |                 | news_hunter_    |               | poll 60s     |
| cron-job.org → ~5min       |                 |   keywords      |               | filter local |
| workflow_dispatch          |                 | RLS on          |               |              |
+----------------------------+                 +-----------------+               +--------------+
```

Doc detalhado: [`docs/etl-pipelines/news-hunter-architecture.md`](../etl-pipelines/news-hunter-architecture.md).

### Componentes do sistema

1. **Scanner** (repo separado, não acessível a partir daqui):
   - Roda via cron-job.org cada ~5min.
   - `python news_hunter_service.py --once`.
   - Lê keywords da UNION dedupada de `news_hunter_keywords`.
   - Fallback: `DEFAULT_KEYWORDS` local quando tabela vazia ou Supabase off.
   - Escreve em `news_articles`.

2. **Frontend** (este dashboard):
   - Polling cada 60s no `news_articles`.
   - Filtro incremental por `found_at > <last_seen>` (watermark).
   - Filtros adicionais (keyword, domínio) rodam no cliente.
   - Gestão de keywords via UI.

### Cadastro de fontes novas (cross-repo)

Fontes vivem **hardcoded** em `IBBAOG/news-hunter-scanner` (Python). O Supabase **não** tem tabela `news_hunter_sources`. Para cadastrar uma fonte nova:

1. Faça WebFetch da URL alvo e descubra o formato (RSS clássico, sitemap Google News, sitemap WordPress padrão, ou só HTML).
2. Edite no repo `news-hunter-scanner`:
   - `news_hunter/sources.py` — adicione a chave de domínio em `RSS_FEEDS` (RSS/sitemap Google News), `STANDARD_SITEMAPS` (sitemap WordPress padrão), ou `HOMEPAGE_SCRAPERS` (sem feed, scraping de listagem). Se a URL não casa com nenhum dos `SITEMAP_URL_MARKERS` mas é um sitemap, adicione um marker.
   - `news_hunter/_clipinator_shim.py` — adicione `SOURCE_NAMES[<dominio>] = "<nome legivel>"`.
3. Abra PR. Após merge, a próxima execução do cron (~5 min) já passa a varrer a fonte.

Observação: o dashboard **não precisa de mudança** quando uma nova fonte é cadastrada — `/news-hunter` agrupa por `source_name` dinamicamente.

### Fontes cadastradas explicitamente por este dashboard

| Data | Fonte | Dominio | Mecanismo | PR/commit |
|---|---|---|---|---|
| 2026-05-20 | ANS (Agência Nacional de Saúde Suplementar) | `www.gov.br` (path `/ans/pt-br/assuntos/noticias`) | Google News sitemap em `/sitemap.xml` (mesmo formato Valor/OGlobo/Estadão) | [PR #1](https://github.com/IBBAOG/news-hunter-scanner/pull/1) |

> Pegadinha conhecida: a chave `www.gov.br` em `RSS_FEEDS` é multi-tenant (cobre /ans, /anp, /mme, /bcb, etc.). Hoje só a ANS está registrada. Se uma futura fonte gov.br/<outro-órgão> for adicionada, o mapping `www.gov.br → "ANS"` em `SOURCE_NAMES` vira ambíguo e `source_name_for()` precisará virar path-aware.

## RPCs

| RPC | Função |
|---|---|
| `seed_my_news_hunter_keywords` | Popula keywords default pro user logado (chamada no first-login pelo `worker_dash-admin`) |

## Tabelas

### `news_articles`
- PK: `url`
- Colunas: `domain, source_name, title, snippet, published_at, found_at, matched_keywords text[]`
- **Populada apenas pelo scanner externo** (service key).
- **RLS:** read-only para authenticated.

### `news_hunter_keywords`
- PK: `(user_id, keyword)`
- Columns: `created_at`, `match_type` (added 2026-05-20)
- **RLS:** each user manages only their own rows.
- Scanner reads **deduplicated UNION across ALL users** (cross-user by design — keywords aren't private).

#### `match_type` (added 2026-05-20)

`text NOT NULL DEFAULT 'substring' CHECK (match_type IN ('substring','exact'))`.

| Value | Meaning |
|---|---|
| `substring` (default) | Case-insensitive substring match. `ANS` will hit `trANSporte`. |
| `exact` | Case-insensitive whole-word match (`\b{kw}\b`). `ANS` will hit "ANS divulga relatorio" but NOT `trANSporte`. |

Hard cases:
- **Multi-token** (`saude suplementar` exact): `\b` falls at the outer edges; the internal space is a literal. Matches "Agencia Nacional de Saude Suplementar".
- **Hyphenated** (`pre-sal` exact): the hyphen is literal. Matches `pre-sal` in text, NOT `pre sal`.
- **Accents**: keyword and text are both NFKD-normalized + lowercased before matching, so `saúde` and `saude` are interchangeable on both sides.

UI semantics (`/news-hunter`):
- Add-keyword form has an **Exact match** toggle. Default off (= `substring`). Toggle resets to off after each add to prevent slip-ups.
- Existing chips show an `EXACT` badge + tinted background when `match_type = 'exact'`.
- Both desktop and mobile expose the toggle + badge (binding sync rule).

**Cross-repo coordination**: `IBBAOG/news-hunter-scanner` PR https://github.com/IBBAOG/news-hunter-scanner/pull/2 teaches the scanner to honor the column. Until merged, the scanner still defaults to its previous behaviour (`\b`-bounded for all keywords); once merged, the scanner defaults to substring for all keywords without the `exact` flag.

## Polling padrão

```ts
// Cada 60s
const last = state.maxFoundAt;
const novas = await getNewsArticles({ found_at_gt: last });
state.merge(novas);
```

Nunca baixe a tabela inteira. Sempre incremental.

## Dependências cross-dept

| Origem | Como depende |
|---|---|
| News Hunter scanner (repo separado) | Popula `news_articles` |
| ETL (responsabilidade indireta) | Documenta o scanner em `docs/etl-pipelines/news-hunter-architecture.md` |
| Subgerente APP | Schema de `news_articles` e `news_hunter_keywords` |
| dash-admin | Chama `seed_my_news_hunter_keywords` no first-login |
| Designer | UI de keyword management, listagem |

## Estilos

`page.module.css` (CSS Module) — único módulo do app que usa esse padrão. **Não polua `globals.css`**.

Classes adicionadas para a feature de clipping:
- `.themeBtnActive` — botão "Exit Selection Mode" com destaque laranja
- `.checkbox` — checkbox de seleção por artigo
- `.selected` — fundo tintado em artigos selecionados

## Anonymous-visitor mode (added 2026-05-21)

`/news-hunter` supports three viewer tiers — Admin, Client and Anon — sharing the same UI
shell with progressively richer affordances. Anon visitors get a read-only experience:

| Behavior | Anon | Client | Admin |
|---|---|---|---|
| See the headline feed (filtered by keywords) | Yes | Yes | Yes |
| Search and topic-pill filters | Yes | Yes | Yes |
| Bookmarks (localStorage only) | Yes | Yes | Yes |
| Add / remove keywords | No | Yes | Yes |
| Clipping / Selection Mode | No | No | Yes |

### Data path (single source of truth)

- **Anon**: `NewsHunterContext` calls `rpcGetDefaultNewsKeywords()` →
  `get_default_news_keywords()` RPC →
  `news_hunter_default_keywords` table (curated set, ~27 keywords) →
  fallback to hardcoded `FALLBACK_KEYWORDS` if the RPC fails. The
  `seed_my_news_hunter_keywords()` RPC is skipped entirely (it requires
  `auth.uid`).
- **Authenticated**: unchanged — selects from `news_hunter_keywords`
  filtered by RLS to the current user, seeding via
  `seed_my_news_hunter_keywords()` on first visit.

Article polling (`news_articles`) is identical for both — the table now has
an anon `SELECT` policy (migration `20260522000001_anonymous_access.sql`
section 10).

### Read-only contract

`NewsHunterContext` exposes `readOnly: boolean` (set during keyword
bootstrap from the result of `supabase.auth.getSession()`). The
`useNewsHunterData` hook re-exports `readOnly`; both Views consume it:

- **Desktop (`desktop/View.tsx`)** — renders `<AnonCTA>` above the
  keyword panel, swaps the "Keywords" heading for "Default keywords",
  hides the add form and the `×` button on each chip, and replaces the
  help text with a one-line sign-in nudge.
- **Mobile (`mobile/View.tsx`)** — renders `<AnonCTA>` above the
  `KeywordsSection` on the Feed tab and (full-bleed) on the Settings
  tab. Hides the FAB, the Add button inside `KeywordsSection`, and
  un-mounts the `KeywordSheet` entirely. Chips become static `<span>`s
  with no tap-to-remove affordance. The Settings tab replaces its form
  with the AnonCTA banner + a read-only list of the default keywords.

`addKeyword` and `removeKeyword` are defensive no-ops when `readOnly` is
true (the RLS policies on `news_hunter_keywords` would deny the writes
anyway, but the early return keeps the contract clean and avoids
surfacing a 401-shaped error to the UI).

### Why `readOnly` lives in the context, not just the view

The keyword loader and the mutation guards both need the same anon
signal. Centralizing it in `NewsHunterContext` (set once during
bootstrap) means both Views never branch on session state directly, and
TypeScript propagates the field through `useNewsHunterData` to both
Views by construction.

## Mudanças que cruzam fronteira (cuidado especial)

### Schema de `news_articles`
- Mudança quebra o scanner (que escreve com schema antigo).
- **Sequência obrigatória**: (1) coordenar com `worker_etl-pipelines` quem mantém doc do scanner, (2) atualizar repo `news-hunter-scanner` PRIMEIRO, (3) deploy do scanner, (4) só então criar migration aqui.

### Schema de `news_hunter_keywords`
- Mesma lógica.

### Mudança visual
- Consulte `worker_designer`.

## Anti-padrões

- Polling sem watermark (vai matar o Supabase).
- Disparar o scanner do frontend (você só lê).
- Mexer no repo `news-hunter-scanner` daqui.
- Misturar estilos no `globals.css` em vez do `page.module.css`.
- Mostrar keywords cross-user (quebra o conceito de RLS).
- `buildHtml`/`buildEml` no servidor — eles rodam no cliente, mantendo o servidor pequeno.
- Adicionar domínios ao scraper sem adicionar ao `EXTRACTORS` — o SSRF guard usa `EXTRACTORS` como allowlist.

## Anonymous UX (2026-05-25)

- Anonymous visitors see the article feed and the quick-search chips but not the keyword list/editor — a "Log in to customize" CTA replaces it, framing keyword personalization as a login incentive.
- Quick-search chips above the search input fill the input with one of 8 preset terms (Petrobras, PRIO, Vibra, Ultrapar, Cosan, Petróleo, Gasolina, Diesel) so common queries are one click away.

## List virtualization (2026-05-25)

The article list is virtualized via `react-window` v2 (only ~15–20 visible cards in DOM at any time) so broad filters returning thousands of articles render in constant time. The article row/card component is wrapped in `React.memo` to enable node recycling without re-rendering unchanged rows.

- **Desktop**: `FixedSizeList` (`List` in v2), `rowHeight=33px` (single-line row — `white-space:nowrap` + `text-overflow:ellipsis` enforces uniform height). Container height is `min(count × 33, 600)px`.
- **Mobile**: `FixedSizeList`, `rowHeight=120px` (expanded `MobileDataCard` with 2-line-clamped snippet + keyword pills). Container height is `min(count × 120, 70dvh)`.
- Scroll resets to top on filter changes via `key={articles.length}` on the container.
- Lib: `react-window` v2 (`^2.2.7`) — v2 API uses `rowComponent`/`rowProps`/`rowCount`/`rowHeight`; the v1 `FixedSizeList` API is no longer available.

## Search performance (2026-05-25)

Search input uses `useDeferredValue` so typing stays instant while the filter runs at lower priority. Article haystacks (`title + source_name + snippet + matched_keywords`) are pre-normalized (lowercase + stripAccents) once per `articles` change inside the shared hook, eliminating ~320k `normalize("NFD")` calls per keystroke at current scale (~16k articles × 20 keywords).

Implementation details:
- `searchDraft` / `deferredSearch` in `useNewsHunterData.ts` — public API still exports `searchTerm`/`setSearchTerm` (Option A alias, no View churn).
- `normalizedHaystacks` memo: two pre-computed strings per article — `full` (keyword filter + topic pill) and `titleSource` (search filter).
- `keywordHitsNormalized(normalizedHaystack, kw, mode)` — new variant that skips haystack normalization (only normalizes the keyword needle). `keywordHits()` delegates to it.
- `filteredArticles` memo uses index-based filtering over `normalizedHaystacks` instead of rebuilding haystacks per predicate.
