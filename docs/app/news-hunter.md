# Sub-PRD — `/news-hunter`

Dashboard de News Hunter (radar de notícias). Owner: [`worker_dash-news-hunter`](../../.claude/agents/worker_dash-news-hunter.md).

> Único dashboard que **coordena com um repo externo** ([`IBBAOG/news-hunter-scanner`](https://github.com/IBBAOG/news-hunter-scanner)).

## Escopo de código

```
src/app/(dashboard)/news-hunter/
  page.tsx
  page.module.css                   Estilos scoped (não polui globals.css)
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
  fetch.ts          fetchHtml (optional Cookie header) + Wayback fallback (no TLS impersonation)
  scrape.ts         scrape() orchestrator — Wayback also covers fetch failures
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
3. **POST /api/clipping/scrape** — rota Admin-gated (mirror do padrão de auth em `upload-card-preview/route.ts`). Cap de 15 URLs, 12s timeout por URL, `maxDuration = 60`.
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

#### Curl shell-out fallback (Cloudflare TLS fingerprint bypass)

Node's `undici` fetch has a TLS ClientHello fingerprint that Cloudflare rejects with 403, even with fresh valid cookies. The bundled `curl-impersonate` binary impersonates Chrome 131's full TLS profile (ciphers, curves, extensions, HTTP/2 settings, browser headers) — Cloudflare accepts it.

When `fetchHtml` (undici) fails with a `fetch_failed` reason, `scrape()` retries via `fetchHtmlViaCurl` before falling through to Wayback:

```
undici fetch → 403/network error
  → fetchHtmlViaCurl (child_process.execFile, no shell, args as array)
    → success: return { status: "ok", via: "curl" }
    → paywall or failure: try Wayback Machine
      → success: return { status: "ok", via: "wayback" }
      → failure: return { status: "fetch_failed", error: "undici: ...; curl_impersonate: ...; wayback: ..." }
```

Implementation details:
- `child_process.execFile` (not `exec`) — URL and cookies are separate args, no shell injection risk.
- `--max-time 20` + `maxBuffer: 10 MB` + `timeout: 22_000` ms in the Node wrapper.
- Status code extracted from stdout via `-w "\n---STATUS:%{http_code}"` marker.
- `FetchResult` has an optional `detail` field on all failure paths for debugging (e.g. `curl_impersonate_http_403`, `curl_impersonate_not_found`, `wayback_no_snapshot`). When all three paths fail, `ScrapeResult.error` concatenates all three details: `"undici: <d>; curl_impersonate: <d>; wayback: <d>"`.
- Paywall is NOT retried via curl-impersonate — if the site returned a paywall over undici, curl-impersonate would return the same gate page. Wayback remains the only paywall fallback.
- `isImpersonate` flag: when the resolved path ends with `curl_chrome131`, manual `-A`/`-H Accept`/`-H Accept-Language`/`-H Referer` args are omitted — the wrapper already injects them. On dev (system curl), headers are added manually.

The ClippingModal Status tab shows a blue "via curl" badge for articles retrieved this way, and "via Wayback" for Wayback snapshots.

#### Bundled curl-impersonate binaries (`vendor/curl-impersonate` + `vendor/curl_chrome131`)

Vercel's Amazon Linux 2 minimal runtime does not have `curl` in PATH. The fix: bundle `curl-impersonate` with the Chrome 131 wrapper script.

**Binaries**:
- `vendor/curl-impersonate` — [lexiforest/curl-impersonate](https://github.com/lexiforest/curl-impersonate) v1.1.0, ELF 64-bit, dynamically linked (requires glibc + dynamic linker, present on Vercel Amazon Linux 2). Size: ~4.1 MB.
- `vendor/curl_chrome131` — bash wrapper script (~1.9 KB) that calls `${0%/*}/curl-impersonate` with exact Chrome 131 TLS flags (ciphers, curves, HTTP/2 settings, browser headers). Both files must be in the same directory.

**Bundling**: `next.config.ts` uses `outputFileTracingIncludes` to include both files in the `/api/clipping/scrape` Vercel function bundle. Without this, Next.js file tracing would omit them.

**Path resolution** (`resolveCurlImpersonatePath()` in `fetch.ts`):
- **Linux (Vercel prod)**: checks `process.cwd()/.next/server/vendor/curl_chrome131`, then `process.cwd()/vendor/curl_chrome131`, then `/var/task/...`. Runs `chmod 0o755` on both `curl_chrome131` and `curl-impersonate` in the same dir in case Vercel stripped exec bits on deploy.
- **Non-Linux (dev — Windows/macOS)**: uses `"curl"` (system binary from PATH, no TLS impersonation).
- Result is cached in module-level promise (resolved once per process lifetime).

**Limitation**: Linux x86_64 only. Vercel does not currently use ARM for Node.js functions.

**Updating the binary** (new curl-impersonate release):
1. Download tarball from [lexiforest/curl-impersonate releases](https://github.com/lexiforest/curl-impersonate/releases).
2. Extract `curl-impersonate` and `curl_chrome131` (or the Chrome version you want).
3. `chmod +x vendor/curl-impersonate vendor/curl_chrome131`
4. Commit both files directly (no Git LFS needed — no LFS configured in this repo).
5. Update version note in this doc.

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
- Colunas: `created_at`
- **RLS:** cada user gerencia só as próprias.
- Scanner lê **UNION dedupada de TODOS os users** (cross-user implícito por design — keywords não são private).

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
