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
  fetch.ts          fetchHtml + Wayback fallback (no TLS impersonation)
  scrape.ts         scrape() orchestrator
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

#### TLS impersonation (limitação conhecida)

`curl_cffi` não tem equivalente limpo em Node. Sites com Cloudflare/403 retornam `{ status: "fetch_failed" }`. O modal exibe textarea para o admin colar o corpo manualmente → Regenerate re-scrapa os outros e usa o body manual para os bloqueados.

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
