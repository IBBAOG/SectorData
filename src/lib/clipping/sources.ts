// Port of clipinator.py lines 40–133 (SOURCE_NAMES) and 142–365 (EXTRACTORS).
// SOURCE_NAMES: domain → human-readable publication name.
// EXTRACTORS: domain → ordered list of CSS selectors (first match wins).
// Domains not in EXTRACTORS are rejected by the scrape route (SSRF guard).

export const SOURCE_NAMES: Record<string, string> = {
  "valor.globo.com": "Valor Econômico",
  "www.estadao.com.br": "Estadão",
  "estadao.com.br": "Estadão",
  "www1.folha.uol.com.br": "Folha de S. Paulo",
  "folha.uol.com.br": "Folha de S. Paulo",
  "brasilenergia.com.br": "Brasil Energia",
  "www.brasilenergia.com.br": "Brasil Energia",
  "www.metropoles.com": "Metrópoles",
  "metropoles.com": "Metrópoles",
  "www.poder360.com.br": "Poder360",
  "poder360.com.br": "Poder360",
  "www.infomoney.com.br": "InfoMoney",
  "infomoney.com.br": "InfoMoney",
  "www.bloomberglinea.com.br": "Bloomberg Línea",
  "bloomberglinea.com.br": "Bloomberg Línea",
  "noticias.r7.com": "R7",
  "g1.globo.com": "G1",
  "oglobo.globo.com": "O Globo",
  "agencia.petrobras.com.br": "Agência Petrobras",
  "agenciainfra.com": "Agência iNFRA",
  "www.agenciainfra.com": "Agência iNFRA",
  "braziljournal.com": "Brazil Journal",
  "www.braziljournal.com": "Brazil Journal",
  "eixos.com.br": "eixos",
  "www.eixos.com.br": "eixos",
  "monitormercantil.com.br": "Monitor Mercantil",
  "www.monitormercantil.com.br": "Monitor Mercantil",
  "timesbrasil.com.br": "Times Brasil",
  "www.timesbrasil.com.br": "Times Brasil",
  "visaoagro.com.br": "Visão Agro",
  "www.visaoagro.com.br": "Visão Agro",
  "www.theagribiz.com": "Agribiz",
  "theagribiz.com": "Agribiz",
  "aovivo.folha.uol.com.br": "Folha de S. Paulo",
  "estradao.estadao.com.br": "Estradão",
  "pipelinevalor.globo.com": "Pipeline (Valor)",
  "globorural.globo.com": "Globo Rural",
  "cbn.globo.com": "CBN",
  "www.cnnbrasil.com.br": "CNN Brasil",
  "cnnbrasil.com.br": "CNN Brasil",
  "veja.abril.com.br": "Veja",
  "investnews.com.br": "InvestNews",
  "www.investnews.com.br": "InvestNews",
  "neofeed.com.br": "NeoFeed",
  "www.neofeed.com.br": "NeoFeed",
  "www.cnbc.com": "CNBC",
  "exame.com": "Exame",
  "www.exame.com": "Exame",
  "istoedinheiro.com.br": "IstoÉ Dinheiro",
  "www.istoedinheiro.com.br": "IstoÉ Dinheiro",
  "www.brasil247.com": "Brasil 247",
  "brasil247.com": "Brasil 247",
  "observatorio.firjan.com.br": "Observatório Firjan",
  "megawhat.uol.com.br": "MegaWhat",
  "www.reuters.com": "Reuters",
  "reuters.com": "Reuters",
  "br.investing.com": "Investing.com",
  "www.correiobraziliense.com.br": "Correio Braziliense",
  "correiobraziliense.com.br": "Correio Braziliense",
  "veronoticias.com": "Vero Notícias",
  "www.veronoticias.com": "Vero Notícias",
  "diariodopoder.com.br": "Diário do Poder",
  "www.diariodopoder.com.br": "Diário do Poder",
  "www.conjur.com.br": "Conjur",
  "conjur.com.br": "Conjur",
  "www.argusmedia.com": "Argus Media",
  "argusmedia.com": "Argus Media",
  "operamundi.uol.com.br": "Opera Mundi",
  "claudiodantas.com.br": "Cláudio Dantas",
  "www.claudiodantas.com.br": "Cláudio Dantas",
  "br.tradingview.com": "TradingView",
  "www.theedgesingapore.com": "The Edge Singapore",
  "www12.senado.leg.br": "Senado Federal",
  "edition.cnn.com": "CNN",
  "www.cnn.com": "CNN",
  "clickpetroleoegas.com.br": "Click Petróleo e Gás",
  "www.clickpetroleoegas.com.br": "Click Petróleo e Gás",
  "ineep.org.br": "INEEP",
  "www.ineep.org.br": "INEEP",
  "tconline.com.br": "TC Online",
  "www.tconline.com.br": "TC Online",
  "obastidor.com.br": "O Bastidor",
  "www.obastidor.com.br": "O Bastidor",
  "noticias.uol.com.br": "UOL",
  "economia.uol.com.br": "UOL Economia",
  "www.terra.com.br": "Terra",
  "terra.com.br": "Terra",
  "www.moneytimes.com.br": "Money Times",
  "moneytimes.com.br": "Money Times",
  "visnoinvest.com.br": "Visno Invest",
  "www.visnoinvest.com.br": "Visno Invest",
  "tnonline.uol.com.br": "TNOnline",
  "www.tnonline.uol.com.br": "TNOnline",
};

import type { Element } from "domhandler";

// ---------------------------------------------------------------------------
// Noise-attribute helper (Phase 2, 2026-05-26)
// ---------------------------------------------------------------------------

/**
 * Patterns matched against "data-<name>=<value>" combined strings (lowercased).
 * Signals that an element is a noise block regardless of its class/id.
 */
const NOISE_DATA_ATTR_PATTERNS: RegExp[] = [
  /related/i,
  /newsletter/i,
  /promo/i,
  /ads?/i,
  /share/i,
  /author-(?:bio|widget)/i,
];

/**
 * Returns true if the element should be treated as noise based on ARIA role or
 * data-* attribute values. Used by stripNoise in addition to class/id matching.
 */
export function matchesNoiseAttr(el: Element): boolean {
  const role = (el.attribs?.role ?? "").toLowerCase();
  if (role === "complementary" || role === "banner" || role === "navigation") {
    return true;
  }
  for (const [name, value] of Object.entries(el.attribs ?? {})) {
    if (!name.startsWith("data-")) continue;
    const combined = `${name}=${value}`.toLowerCase();
    if (NOISE_DATA_ATTR_PATTERNS.some((re) => re.test(combined))) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// AUTO_SELECTORS — ordered most-specific → least-specific (Phase 2 reorder).
// Removed: div.body, div.content (too broad, captures sidebar + nav).
// ---------------------------------------------------------------------------

/**
 * Returns true when the chosen container looks like it grabbed sidebar content
 * along with the article body (too many nav/aside descendants).
 * Used by the AUTO_SELECTORS loop in extract.ts to skip noisy containers.
 */
export function isNoisyContainer(container: { find: (sel: string) => { length: number } }): boolean {
  return container.find("nav, aside").length > 3;
}

// Generic wide fallback — used for ex_auto domains.
// Order: itemprop → semantic class patterns → generic element selectors.
// div.body and div.content intentionally removed (Phase 2): they capture the
// full page skeleton including sidebar, nav, and widget columns.
// Exported so that hasCustomSelectors() can detect domains that share this
// reference (= no custom tuning, Phase 3 Readability fallback candidate).
export const AUTO_SELECTORS: string[] = [
  '[itemprop="articleBody"]',
  '[itemprop="mainEntityOfPage"]',
  ".entry-content",
  ".post-content",
  ".post-body",
  ".article-content",
  ".article-body",
  ".article__content",
  ".article__body",
  ".news-content",
  ".news-body",
  ".news__body",
  ".single-content",
  ".single__content",
  ".story-content",
  ".post-text",
  ".post__content",
  ".entry__content",
  "div.content-text",
  "div.news-text",
  "div.materia-conteudo",
  "div.conteudo-materia",
  "div.texto-materia",
  "div.texto",
  "div.main-content",
  "section.article-body",
  "main article",
  "article",
];

// Per-domain CSS selector lists. First match wins (same logic as _first_matching in Python).
// Domains present here but not in SOURCE_NAMES (or vice-versa) are still accepted —
// the scrape route uses presence in EXTRACTORS as the SSRF allowlist gate.
export const EXTRACTORS: Record<string, string[]> = {
  // Globo group
  "valor.globo.com": [
    "div.mc-article-body",
    "article .mc-article-body",
    "article .content-text__container",
    "article",
  ],
  "oglobo.globo.com": [
    "div.mc-article-body",
    "article .mc-article-body",
    "article .content-text__container",
    "article",
  ],
  "g1.globo.com": [
    "div.mc-article-body",
    "article .mc-article-body",
    "article .content-text__container",
    "article",
  ],
  "pipelinevalor.globo.com": [
    "div.mc-article-body",
    "article .mc-article-body",
    "article .content-text__container",
    "article",
  ],
  "globorural.globo.com": [
    "div.mc-article-body",
    "article .mc-article-body",
    "article .content-text__container",
    "article",
  ],
  "cbn.globo.com": [
    "div.mc-article-body",
    "article .mc-article-body",
    "article .content-text__container",
    "article",
  ],
  // Folha
  "www1.folha.uol.com.br": [
    "div.c-news__body",
    "article.c-news",
    "div.c-main-content",
    "article",
  ],
  "folha.uol.com.br": [
    "div.c-news__body",
    "article.c-news",
    "div.c-main-content",
    "article",
  ],
  "aovivo.folha.uol.com.br": [
    "div.c-news__body",
    "article.c-news",
    "div.c-main-content",
    "article",
  ],
  // Estadão
  "www.estadao.com.br": [
    "div.content-wrapper.news-body",
    "div.news-body",
    "div.template-reportagem",
    "div.n--noticia__content",
    "div.noticia__conteudo",
    "section.n--noticia__content",
    "article",
  ],
  "estadao.com.br": [
    "div.content-wrapper.news-body",
    "div.news-body",
    "div.template-reportagem",
    "div.n--noticia__content",
    "div.noticia__conteudo",
    "section.n--noticia__content",
    "article",
  ],
  "estradao.estadao.com.br": [
    "div.content-wrapper.news-body",
    "div.news-body",
    "div.template-reportagem",
    "div.n--noticia__content",
    "div.noticia__conteudo",
    "section.n--noticia__content",
    "article",
  ],
  // Brasil Energia
  "brasilenergia.com.br": [
    "div.editorial_",
    "div.descricao-noticia",
    "div.single-content",
    "div.entry-content",
    "article",
  ],
  "www.brasilenergia.com.br": [
    "div.editorial_",
    "div.descricao-noticia",
    "div.single-content",
    "div.entry-content",
    "article",
  ],
  // Metrópoles
  "www.metropoles.com": [
    "div.m-news__body",
    "div.texto-materia",
    "article .noticia-conteudo",
    "article",
  ],
  "metropoles.com": [
    "div.m-news__body",
    "div.texto-materia",
    "article .noticia-conteudo",
    "article",
  ],
  // Poder360
  "www.poder360.com.br": [
    "div.entry-content",
    "article .post-content",
    "article",
  ],
  "poder360.com.br": [
    "div.entry-content",
    "article .post-content",
    "article",
  ],
  // InfoMoney
  "www.infomoney.com.br": [
    "div.article__content",
    "div.single__content",
    "div.im-article",
    "article",
  ],
  "infomoney.com.br": [
    "div.article__content",
    "div.single__content",
    "div.im-article",
    "article",
  ],
  // Bloomberg Línea
  "www.bloomberglinea.com.br": [
    "div.article-content",
    "div.article-body",
    "article",
  ],
  "bloomberglinea.com.br": [
    "div.article-content",
    "div.article-body",
    "article",
  ],
  // R7
  "noticias.r7.com": [
    "div.b-article__body",
    "div.article-content",
    "article",
  ],
  // Agência Petrobras
  // Agência Petrobras (Liferay CMS — article body lives in div.news-content, Phase 4 fix)
  "agencia.petrobras.com.br": [
    "div.news-content",
    "div.entry-content",
    "article .post-content",
    "article",
  ],
  // Agência iNFRA
  "agenciainfra.com": [
    "div.entry-content",
    "article .post-content",
    "article",
  ],
  "www.agenciainfra.com": [
    "div.entry-content",
    "article .post-content",
    "article",
  ],
  // Brazil Journal
  "braziljournal.com": [
    "div.post-content-text",
    "section.post-content",
    "div.entry-content",
    "article",
  ],
  "www.braziljournal.com": [
    "div.post-content-text",
    "section.post-content",
    "div.entry-content",
    "article",
  ],
  // Eixos
  "eixos.com.br": [
    "div.entry-content",
    "div.post-content",
    "article .tdb-block-inner",
    "article",
  ],
  "www.eixos.com.br": [
    "div.entry-content",
    "div.post-content",
    "article .tdb-block-inner",
    "article",
  ],
  // Monitor Mercantil
  "monitormercantil.com.br": [
    "div.td-post-content",
    "div.entry-content",
    "article",
  ],
  "www.monitormercantil.com.br": [
    "div.td-post-content",
    "div.entry-content",
    "article",
  ],
  // Times Brasil
  "timesbrasil.com.br": [
    "div.article-content",
    "div.entry-content",
    "article",
  ],
  "www.timesbrasil.com.br": [
    "div.article-content",
    "div.entry-content",
    "article",
  ],
  // Visão Agro
  "visaoagro.com.br": [
    "div.entry-content",
    "div.post-content",
    "article",
  ],
  "www.visaoagro.com.br": [
    "div.entry-content",
    "div.post-content",
    "article",
  ],
  // CNN Brasil (Arc Publishing / Next.js — Tailwind arbitrary-variant classes)
  // The article body is identified by data-single-content="true", not a semantic class.
  // Using AUTO_SELECTORS was causing the entire content div to be removed by the "gallery"
  // noise filter (Tailwind token [&_.gallery]:mb-4 in the class attribute).
  "www.cnnbrasil.com.br": [
    "[data-single-content='true']",
    "[data-single-content]",
    "article",
  ],
  "cnnbrasil.com.br": [
    "[data-single-content='true']",
    "[data-single-content]",
    "article",
  ],
  // --- ex_auto (generic wide selectors) ---
  "theagribiz.com": AUTO_SELECTORS,
  "www.theagribiz.com": AUTO_SELECTORS,
  "veja.abril.com.br": AUTO_SELECTORS,
  "investnews.com.br": AUTO_SELECTORS,
  "www.investnews.com.br": AUTO_SELECTORS,
  "neofeed.com.br": AUTO_SELECTORS,
  "www.neofeed.com.br": AUTO_SELECTORS,
  "www.cnbc.com": AUTO_SELECTORS,
  "exame.com": AUTO_SELECTORS,
  "www.exame.com": AUTO_SELECTORS,
  "istoedinheiro.com.br": AUTO_SELECTORS,
  "www.istoedinheiro.com.br": AUTO_SELECTORS,
  "www.brasil247.com": AUTO_SELECTORS,
  "brasil247.com": AUTO_SELECTORS,
  "observatorio.firjan.com.br": AUTO_SELECTORS,
  "megawhat.uol.com.br": AUTO_SELECTORS,
  "www.reuters.com": AUTO_SELECTORS,
  "reuters.com": AUTO_SELECTORS,
  "br.investing.com": AUTO_SELECTORS,
  "www.correiobraziliense.com.br": AUTO_SELECTORS,
  "correiobraziliense.com.br": AUTO_SELECTORS,
  "veronoticias.com": AUTO_SELECTORS,
  "www.veronoticias.com": AUTO_SELECTORS,
  "diariodopoder.com.br": AUTO_SELECTORS,
  "www.diariodopoder.com.br": AUTO_SELECTORS,
  "www.conjur.com.br": AUTO_SELECTORS,
  "conjur.com.br": AUTO_SELECTORS,
  "www.argusmedia.com": AUTO_SELECTORS,
  "argusmedia.com": AUTO_SELECTORS,
  "operamundi.uol.com.br": AUTO_SELECTORS,
  "claudiodantas.com.br": AUTO_SELECTORS,
  "www.claudiodantas.com.br": AUTO_SELECTORS,
  "br.tradingview.com": AUTO_SELECTORS,
  "www.theedgesingapore.com": AUTO_SELECTORS,
  "www12.senado.leg.br": AUTO_SELECTORS,
  "edition.cnn.com": AUTO_SELECTORS,
  "www.cnn.com": AUTO_SELECTORS,
  "clickpetroleoegas.com.br": AUTO_SELECTORS,
  "www.clickpetroleoegas.com.br": AUTO_SELECTORS,
  "ineep.org.br": AUTO_SELECTORS,
  "www.ineep.org.br": AUTO_SELECTORS,
  "tconline.com.br": AUTO_SELECTORS,
  "www.tconline.com.br": AUTO_SELECTORS,
  "obastidor.com.br": AUTO_SELECTORS,
  "www.obastidor.com.br": AUTO_SELECTORS,
  // UOL — noticias.uol.com.br is a general aggregator (redirects ~93% to Folha);
  // kept as AUTO_SELECTORS for any original UOL articles that land here.
  "noticias.uol.com.br": AUTO_SELECTORS,
  // UOL Economia (economia.uol.com.br) — added to scanner in commit 3be0edb.
  // UOL's custom CMS uses class-based article body containers.
  // Selectors ordered most-specific → broad fallback.
  "economia.uol.com.br": [
    "div.content-text",
    "div.text-content",
    '[itemprop="articleBody"]',
    "div.conteudo-noticia",
    "div.noticia-conteudo",
    "div.texto",
    "div.article-content",
    "article",
  ],
  "www.terra.com.br": AUTO_SELECTORS,
  "terra.com.br": AUTO_SELECTORS,
  "www.moneytimes.com.br": AUTO_SELECTORS,
  "moneytimes.com.br": AUTO_SELECTORS,
  "visnoinvest.com.br": AUTO_SELECTORS,
  "www.visnoinvest.com.br": AUTO_SELECTORS,
  // TNOnline — Tribuna do Norte (Maringá-PR). Mundiware Elite CS CMS.
  // Article body is <article id="article-body"> inside <section class="article-content">.
  // ads-feed divs (with "CONTINUA DEPOIS DA PUBLICIDADE") are stripped by stripNoise via role="img"+aria-hidden.
  "tnonline.uol.com.br": [
    "article#article-body",
    "section.article-content article",
    "section.article-content",
    "article",
  ],
  "www.tnonline.uol.com.br": [
    "article#article-body",
    "section.article-content article",
    "section.article-content",
    "article",
  ],
};

// ---------------------------------------------------------------------------
// Custom-selector detection (Phase 3, 2026-05-26)
// ---------------------------------------------------------------------------

/**
 * Returns true when a domain has a hand-tuned selector list in EXTRACTORS
 * (i.e., its value is NOT the shared AUTO_SELECTORS array reference).
 *
 * Used by extract.ts to decide whether to offer the Readability fallback:
 * - Custom-selector domains → skip Readability (already well-tuned, risk of regression)
 * - AUTO_SELECTORS domains  → eligible for Readability comparison
 */
export function hasCustomSelectors(domain: string): boolean {
  const selectors = EXTRACTORS[domain];
  if (!selectors) return false;
  // Reference equality: custom domains have their own array literal, not AUTO_SELECTORS.
  return selectors !== AUTO_SELECTORS;
}
