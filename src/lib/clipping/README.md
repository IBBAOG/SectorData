# Clipping Pipeline — Maintenance Playbook

Owner: `worker_dash-news-hunter`. This document is the single reference for adding new sites,
debugging noise problems, and understanding how the extraction pipeline works.

---

## 1. Pipeline Overview

```
POST /api/clipping/scrape?debug=<0|1>
  │
  ├─ Admin auth + rate limit  (route.ts)
  │
  └─ scrape(url, signal, manualBody?, cookieHeader?, debug)   ← scrape.ts
       │
       ├─ SSRF guard: domain must be in EXTRACTORS (sources.ts)
       │
       ├─ Cookie lookup: SELECT FROM clipping_cookies WHERE domain IN (...)
       │
       └─ Fetch cascade (first success wins):
            1. undici (Node.js native fetch)
            2. fetchHtmlViaCurl  — static musl curl 8.20.0 (vendor/curl-static-amd64)
            3. fetchHtmlViaImpersonate  — curl-impersonate chrome131 (full TLS fingerprint)
            4. fetchHtmlViaHeadless  — playwright-core + @sparticuz/chromium (JS challenge bypass)
            5. fetchFromWayback  — Wayback Machine CDX snapshot
            │
            ↓ html (raw HTML string)
            │
       extract(html, domain, debug?)   ← extract.ts
            │
            ├─ if domain has custom selectors in EXTRACTORS (28 well-tuned domains):
            │    runCheerioExtraction(html, domain, rec?)
            │         ├─ cheerio.load(html)
            │         ├─ titleFromMeta() — og:title / twitter:title / itemprop / h1 / <title>
            │         ├─ firstMatching(selectors) — try each CSS selector, skip noisy containers
            │         │    isNoisyContainer(): skip if container has >3 nav/aside children
            │         └─ paragraphsFrom(container):
            │               stripNoise() — remove figure/aside/script/style/nav + noise-class elements
            │               isMostlyLinks() — drop <p> where ≥80% text is in <a>
            │               isLinkHeavy() — drop <p> where >60% text is <a> AND ≥2 links
            │               cleanParagraphs(rawPs, debugSink?):
            │                 splitOnInlineMarkers() — "X | Y | Z" inline splitter
            │                 _NOISE_REGEX (37 patterns) — full-paragraph noise match
            │                 consecutive-dedup
            │
            └─ if domain uses AUTO_SELECTORS (~47 domains) AND CLIPPING_USE_READABILITY=1:
                 runCheerioExtraction() AS ABOVE
                 extractWithReadability(html)  ← extractReadability.ts
                      linkedom + @mozilla/readability
                      cleanParagraphs() applied to Readability output too
                 fragmentation guard: if Readability produced ≥3× more paragraphs → cheerio wins
                 otherwise: pick whichever result has more joined-content characters
            │
            ↓ { title, paragraphs, debug? }
            │
       Paywall check: looksPaywalled(paragraphs)
            if paywalled AND direct fetch succeeded → try Wayback once
            if still paywalled → status: "paywall"
            │
       buildHtml(items) + buildPlainText(items) + buildEml(html, text)   (client-side, browser)
            │
       → .eml download
```

**Key invariant**: `EXTRACTORS` in `sources.ts` is the SSRF allowlist. A domain not in
`EXTRACTORS` is rejected before any network fetch happens.

---

## 2. How to Add a New Site

| Step | What to do |
|------|-----------|
| 1 | Identify the canonical domain (e.g. `www.example.com.br`). It must match the `hostname` of article URLs exactly. |
| 2 | Open `src/lib/clipping/sources.ts`. |
| 3 | Add a human-readable name in `SOURCE_NAMES`: `"www.example.com.br": "Example Publication"`. |
| 4 | Decide: does the site have a reliable, specific CSS selector for the article body? |
| 4a | **YES (custom selector)** — find it with DevTools (F12 → inspect the `<div>` wrapping only article text). Good candidates: classes starting with `article-body`, `entry-content`, `post-content`, `news-content`, `[itemprop="articleBody"]`, or site-specific names like `div.m-news__body`. Add the domain to `EXTRACTORS` with an array of selectors (most-specific first, `article` as last fallback). |
| 4b | **NO (use AUTO_SELECTORS)** — simply add `"www.example.com.br": AUTO_SELECTORS` in `EXTRACTORS`. The generic selectors cover most WordPress/common CMSes. With `CLIPPING_USE_READABILITY=1`, Readability will also run as a fallback for AUTO_SELECTORS domains. |
| 5 | If custom: example entry from the codebase: |

```ts
// sources.ts — EXTRACTORS section
"www.example.com.br": [
  "div.article__content",   // most specific — use DevTools to find this
  "div.entry-content",      // common WordPress class
  "article",                // broad fallback
],
```

| Step | What to do |
|------|-----------|
| 6 | Capture a fixture HTML file. Save a real article page as raw HTML: `curl -A "Mozilla/5.0" "https://www.example.com.br/artigo-slug" > src/lib/clipping/__tests__/fixtures/example/artigo-slug.html`. Alternatively use DevTools → Network → right-click request → "Save as HAR" or "Save Page" in Chrome. **Before committing: scrub any Google OAuth tokens, API keys, or auth cookies that appear in inline `<script>` tags.** |
| 7 | Create the `.expected.json` file alongside the HTML (see template below). |
| 8 | Add the domain to `DOMAIN_HOSTS` in `src/lib/clipping/__tests__/extract.test.ts`: `"example": "www.example.com.br"`. |
| 9 | Run `npm test` and verify the new fixture passes. |
| 10 | Commit both `sources.ts` and the fixture files. |

**Note**: both `www.example.com.br` and `example.com.br` (without `www`) often need separate
entries in `SOURCE_NAMES` and `EXTRACTORS`, because browsers/curl may follow redirects that
change the hostname. Check which hostname appears in real article URLs.

### Fixture `.expected.json` template

```json
{
  "title": null,
  "minParagraphCount": 3,
  "maxParagraphCount": 50,
  "firstParagraphContains": "first 30-50 words of the actual article lead paragraph",
  "lastParagraphContains": "last 30-50 words of the last substantive paragraph",
  "noNoiseMarkers": ["Leia também", "Compartilhe", "Assine", "Newsletter", "Publicidade"],
  "noiseMustNotAppearAnywhere": true
}
```

**Field notes:**
- `title: null` — accept any non-empty title. Use the exact string only if you want a strict match.
- `minParagraphCount` / `maxParagraphCount` — set conservatively; articles change over time.
- `firstParagraphContains` — text must appear somewhere in the first 5 paragraphs (allows for 1-2
  leading noise paragraphs that slip through).
- `lastParagraphContains` — text must appear in the last paragraph.
- `noNoiseMarkers` — strings that must never appear anywhere in the extractor output. These are your
  regression guards. Add whatever you see as noise in the actual output.
- `noiseMustNotAppearAnywhere: true` — when set, all `noNoiseMarkers` are checked against every
  paragraph, not just the first/last.

---

## 3. How to Debug a Site with Residual Noise

### Quick diagnostic command

```
POST https://<your-vercel-domain>/api/clipping/scrape?debug=1
Authorization: Bearer <admin-session-token>
Content-Type: application/json

{ "urls": ["https://www.example.com.br/artigo-problemático"] }
```

The response includes a `debug` object per article. Use it as your first diagnostic step.

### Diagnostic decision tree

| Symptom | Check in `debug` | Likely cause | Fix |
|---------|-----------------|-------------|-----|
| `.eml` full of "Leia também", related-article links | `selectorUsed` — container too broad? | Container selector catches sidebar along with article body | Move domain to custom selector in `EXTRACTORS`; use a more specific selector |
| Many paragraphs truncated or split in odd places | `pCountAfterStripNoise` >> `pCountAfterClean` | `cleanParagraphs` regex matching partial paragraphs, or `splitOnInlineMarkers` splitting valid prose | Read `noiseRemovedSamples` to see exactly what was discarded; check if a regex in `_NOISE_PATTERNS` (clean.ts) is too broad |
| Empty article output (zero paragraphs) | `containerHtmlByteSize == 0` | Selector matched nothing | Open the fixture HTML in a browser or run cheerio locally; find the actual class/id wrapping the article text; update `EXTRACTORS` |
| Paragraphs are correct but title is wrong | `selectorUsed` (not related) | `og:title` missing or contains site suffix | `cleanTitle()` strips known suffixes automatically; if the suffix is new, add it to `_uniqueNames` in `clean.ts` |
| Article always fails to fetch | `viaCascade` shows all fetchers tried | Bot detection / hard paywall / Cloudflare JS challenge | Check if Wayback Machine has a snapshot (try `https://web.archive.org/web/*/ARTICLE_URL`); if not, the site may require cookies — seed them in the `clipping_cookies` table |
| "Anúncio" / "Publicidade" / ad-network text leaks through | `noiseRemovedSamples` shows other noise IS being filtered | The specific ad class/pattern is not in `NOISE_CLASS_SUBSTRINGS` | Add the class/id substring (lowercased) to `NOISE_CLASS_SUBSTRINGS` in `extract.ts` |
| Photo captions appear as paragraphs | Same as above | Caption class not in noise list | Add the caption class substring to `NOISE_CLASS_SUBSTRINGS` |
| Readability produces worse output than cheerio | `selectorUsed` shows `"readability"` | Readability's paragraph splitting algorithm fragments the content | The fragmentation guard threshold is `3×` — if the ratio is close, it may be letting bad output through; either lower the threshold in `extract.ts` or add the domain to a Readability exception list |

### Reading the `debug` object

```json
{
  "selectorUsed": "div.mc-article-body",
  "containerHtmlByteSize": 14832,
  "pCountRaw": 42,
  "pCountAfterStripNoise": 28,
  "pCountAfterClean": 21,
  "noiseRemovedSamples": [
    "Leia também: BP anuncia corte de empregos | Petrobras reajusta preços",
    "Compartilhe este conteúdo",
    "[inline-split] removed from: Texto válido. Leia também: X | Y | Z"
  ],
  "viaCascade": ["undici", "curl"]
}
```

- `pCountRaw → pCountAfterStripNoise`: how many `<p>` tags `stripNoise()` removed (structural noise: figure, aside, noise-class elements).
- `pCountAfterStripNoise → pCountAfterClean`: how many paragraphs `cleanParagraphs()` dropped (regex + inline splitter).
- `noiseRemovedSamples`: up to 3 examples of text that was discarded. The prefix `[inline-split]` means the `splitOnInlineMarkers` function fired.
- `viaCascade`: ordered list of fetchers used. `["undici"]` = direct hit. `["undici","curl","curl_impersonate"]` = first two failed.

---

## 4. NOISE_CLASS_SUBSTRINGS — Annotated List

These substrings are matched (case-insensitive, substring match) against the combined
`class` and `id` attributes of every DOM element inside the article container.
Matching elements are removed before paragraph extraction.

**Source file**: `src/lib/clipping/extract.ts` — `NOISE_CLASS_SUBSTRINGS` array.

### Original (ported from clipinator.py)

| Substring | Category | Removes |
|-----------|----------|---------|
| `advertisement` | Ads | Generic ad container classes |
| `publicidade` | Ads | Portuguese word for "advertising" |
| `content-ads` | Ads | Ad blocks inside content area |
| `tag-manager-publicidade` | Ads | Google Tag Manager ad wrappers (common in BR CMS) |
| `sponsor` | Ads | Sponsored content blocks |
| `newsletter` | Subscribe prompts | Newsletter signup forms and banners |
| `subscribe` | Subscribe prompts | English subscription CTAs |
| `assine-` | Subscribe prompts | Portuguese "assine" (subscribe) prefix |
| `box-seja-assinante` | Subscribe prompts | Paywall nudge boxes |
| `seja-assinante` | Subscribe prompts | Paywall nudge text containers |
| `paywall-wrap` | Paywall | Paywall gate wrapper |
| `subscription` | Paywall | Subscription gate |
| `premium-content-wall` | Paywall | Premium paywall container |
| `related` | Related articles | Related/recommended article blocks |
| `relacionad` | Related articles | Portuguese "relacionadas" (related) prefix |
| `leia-tambem` | Related articles | "Leia também" (read also) sections |
| `leia-mais` | Related articles | "Leia mais" (read more) sections |
| `recomend` | Related articles | Recommendation widgets |
| `read-more` | Related articles | English read-more blocks |
| `mc-read-more` | Related articles | Globo group read-more components |
| `recommend-theme` | Related articles | Themed recommendation panels |
| `share-` | Social | Social share button containers |
| `social-share` | Social | Social sharing widgets |
| `tags-list` | Navigation/taxonomy | Tag listing blocks at article end |
| `author-box` | Byline | Author bio/avatar boxes |
| `byline` | Byline | Article byline containers |
| `breadcrumb` | Navigation | Breadcrumb navigation bars |
| `comments` | Comments | Reader comment sections |

### Phase 2 additions (2026-05-26)

| Substring | Category | Removes |
|-----------|----------|---------|
| `caption` | Photo captions | Image caption containers |
| `figcaption` | Photo captions | `<figcaption>` elements (also removed by tag in `stripNoise`) |
| `credit` | Photo captions | Photo credit lines ("Crédito: Reuters") |
| `gallery` | Media | Photo gallery widgets (⚠️ false-positive on CNN Brasil Tailwind `[&_.gallery]:mb-4` — see known issues) |
| `slideshow` | Media | Slideshow/carousel containers |
| `footnote` | Notes | Article footnotes |
| `note-` | Notes | Inline note/callout boxes |
| `tag-` | Taxonomy | Tag/topic pill containers |
| `topic-` | Taxonomy | Topic navigation links |
| `category-` | Taxonomy | Category label blocks |
| `tax-` | Taxonomy | Taxonomy term wrappers (WordPress `tax-` prefix) |
| `widget` | Structural | Generic sidebar/widget blocks |
| `module-related` | Related articles | Modular related-content panels |
| `aside-` | Structural | Aside/sidebar blocks |
| `promo` | Ads | Promotional content blocks |
| `sponsored` | Ads | Sponsored/native advertising content |
| `outbrain` | Ad networks | Outbrain recommendation widgets |
| `taboola` | Ad networks | Taboola recommendation widgets |
| `mgid` | Ad networks | MGID native advertising |
| `dianomi` | Ad networks | Dianomi financial content ads |
| `next-article` | Navigation | "Next article" navigation links |
| `previous-article` | Navigation | "Previous article" navigation links |
| `more-from` | Related articles | "More from this author/section" blocks |
| `most-read` | Related articles | "Most read" / trending article lists |
| `trending` | Related articles | Trending article widgets |
| `popular-` | Related articles | Popular/trending article panels |
| `also-read` | Related articles | "Also read" recommendation strips |
| `further-reading` | Related articles | Further reading sections |

### Phase 4 additions (2026-05-26, per-site fixture audit)

| Substring | Category | Removes | Site |
|-----------|----------|---------|------|
| `media__description` | Photo captions | Photo caption `<p>` elements (Globo group double-underscore BEM naming) | G1, Valor, Globo Rural |
| `headlines` | Related articles | Related-article headline teaser blocks inside news body | Estadão |
| `loading-text` | AI content | AI-generated summary placeholder text ("Gerando resumo") | Estadão |

### CNN Brasil + Tailwind arbitrary variants — fixed (Phase 5, 2026-05-26)

CNN Brasil uses Tailwind CSS arbitrary variant classes like `[&_.gallery]:mb-4` on the
article body `<div>`. The string `gallery` appeared inside the class attribute, triggering
the noise filter and removing the entire article content container → zero paragraphs →
`looksPaywalled()` returned `true` (false positive).

**Fix applied (two layers):**
1. `stripNoise()` in `extract.ts` now excludes Tailwind arbitrary-variant tokens (tokens
   containing `[`) from the combined class string before substring matching. This prevents
   `[&_.gallery]:mb-4` from matching the `"gallery"` noise substring.
2. `www.cnnbrasil.com.br` and `cnnbrasil.com.br` moved from `AUTO_SELECTORS` to a custom
   extractor using `[data-single-content="true"]` — a stable data attribute on the article
   body div, immune to class-name churn from Tailwind utility changes.

Both CNN Brasil fixtures are now enabled in the test suite (no more `skip`).

---

## 5. Feature Flags

| Flag | Default | Effect | When to enable / disable |
|------|---------|--------|--------------------------|
| `CLIPPING_USE_READABILITY` | Off (unset) | Enables Mozilla Readability as a competing extractor for `AUTO_SELECTORS` domains (~47 domains). When on, both cheerio and Readability run; the result with more content wins (subject to the 3× fragmentation guard). | Enable in Vercel Production env vars to reduce noise on sites without custom selectors. Disable by removing the env var if you observe a regression on a specific AUTO_SELECTORS site. |

**Setting it**: in Vercel dashboard → Project → Settings → Environment Variables →
add `CLIPPING_USE_READABILITY` = `1` for Production. No code deploy needed — the flag is
read at runtime from `process.env`.

**Rollback**: remove the variable in Vercel. Takes effect on the next function invocation.

**Debugging which path won**: `POST /api/clipping/scrape?debug=1` → inspect
`ScrapeDebug.selectorUsed`:
- `"readability"` — Readability won.
- `"auto-vs-readability:rejected(frag=X.X)"` — Readability was rejected (fragmentation
  ratio shown).
- Any CSS selector string (e.g. `"div.article__content"`) — cheerio won.

---

## 6. Running Tests

```bash
# Run all clipping fixture tests
npm test

# Run only the clipping suite (faster, skips other tests if any)
npm test -- clipping

# Run with the Readability flag on (tests both extraction paths)
CLIPPING_USE_READABILITY=1 npm test

# Watch mode (re-runs on file save — useful during fixture authoring)
npm run test:watch
```

**Test framework**: vitest. Config: `vitest.config.ts` at project root.

**Fixture location**: `src/lib/clipping/__tests__/fixtures/<domain-slug>/`

**Adding a fixture**: see Section 2 (steps 6–9).

**Updating a fixture**: if a site's HTML structure changes and the existing fixture breaks,
re-capture the HTML (step 6 of Section 2), update `.expected.json` if paragraph counts
or anchor text changed, and run `npm test` to confirm green.

**Fixtures should be refreshed quarterly**: sites silently change their HTML. A green
test with a 12-month-old fixture means you are testing against a stale snapshot, not the
live site.

---

## 7. Fetch Cascade Reference

| Tier | Binary / Library | When it runs | Covers |
|------|-----------------|-------------|--------|
| 1. `undici` | Node.js built-in | Always first | Most open sites |
| 2. `fetchHtmlViaCurl` | `vendor/curl-static-amd64` (~10 MB musl ELF) | After undici 403/timeout | Sites that reject Node's TLS fingerprint |
| 3. `fetchHtmlViaImpersonate` | `vendor/curl-impersonate` + `vendor/curl_chrome131` (~6 MB total) | After curl failure | Sites using TLS fingerprinting (e.g. some Cloudflare sites) |
| 4. `fetchHtmlViaHeadless` | `playwright-core` + `@sparticuz/chromium` (~62 MB) | After impersonate failure | Cloudflare Bot Management JS challenge (Investing.com, etc.) |
| 5. `fetchFromWayback` | HTTP to `web.archive.org` CDX API | After any failure OR paywall detected | Articles with Wayback snapshots |

**Non-Linux note**: tiers 2–3 fall back to system `curl` / return `null` on Windows/macOS
(dev machines). Tier 4 is also Linux-only. Tests and local development rely on tier 1.

**Updating vendor binaries**:
- `curl-static-amd64`: download from [curl/curl releases](https://github.com/curl/curl/releases),
  replace `vendor/curl-static-amd64`, commit.
- `curl-impersonate` + `curl_chrome131`: download from
  [lexiforest/curl-impersonate releases](https://github.com/lexiforest/curl-impersonate/releases),
  extract both files, replace in `vendor/`, commit, update version note in `docs/app/news-hunter.md`.

---

## 8. Authenticated Paywall Bypass (Cookies)

Sites behind a paywall can be bypassed by seeding Netscape-format cookies in the
`clipping_cookies` Supabase table (direct DB insert via Supabase Studio — no UI yet).

The route reads cookies before the fetch cascade and passes them as a `Cookie:` header.

**Currently seeded domains**: `valor.globo.com`, `brasilenergia.com.br`.

When cookies expire: re-seed them by exporting fresh session cookies from the browser
(DevTools → Application → Cookies → right-click → "Save as JSON" then convert format,
or use a browser extension that exports Netscape format).

**Format expected**: Netscape HTTP Cookie File (`# Netscape HTTP Cookie File\n...`).
Use `parseNetscapeCookies()` in `cookies.ts` to validate before inserting.

---

## 9. SSRF Guard

Only domains present in `EXTRACTORS` (`sources.ts`) are processed. Any URL whose
`hostname` is not a key in `EXTRACTORS` receives `{ status: "unknown_domain" }` without
any network request being made.

This means **you must add a domain to `EXTRACTORS` before the scraper will process it**,
even if you only want to use the generic AUTO_SELECTORS. This is intentional.
