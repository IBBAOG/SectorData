// Port of clipinator.py lines 142–211: extraction helpers using cheerio.
// Mirrors _strip_noise, _title_from_meta, _paragraphs_from, _first_matching, _extract.

import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { EXTRACTORS, matchesNoiseAttr, isNoisyContainer } from "./sources";
import { cleanTitle, cleanParagraphs } from "./clean";
import type { ScrapeDebug } from "./types";

// ---------------------------------------------------------------------------
// Debug recorder — zero overhead when debug=false (recorder is never created).
// ---------------------------------------------------------------------------

/**
 * Returns a recorder/builder pair for collecting ScrapeDebug counters during
 * a single extract() call. Only instantiated when debug=true.
 */
function createDebugRecorder(): {
  record: <K extends keyof ScrapeDebug>(key: K, value: ScrapeDebug[K]) => void;
  pushNoiseSample: (text: string) => void;
  build: () => ScrapeDebug;
} {
  const acc: Partial<ScrapeDebug> = { noiseRemovedSamples: [], viaCascade: [] };
  return {
    record<K extends keyof ScrapeDebug>(key: K, value: ScrapeDebug[K]) {
      (acc as Record<string, unknown>)[key] = value;
    },
    pushNoiseSample(text: string) {
      if ((acc.noiseRemovedSamples!.length) < 3) {
        acc.noiseRemovedSamples!.push(text.slice(0, 200));
      }
    },
    build(): ScrapeDebug {
      return {
        selectorUsed: acc.selectorUsed ?? null,
        containerHtmlByteSize: acc.containerHtmlByteSize ?? 0,
        pCountRaw: acc.pCountRaw ?? 0,
        pCountAfterStripNoise: acc.pCountAfterStripNoise ?? 0,
        pCountAfterClean: acc.pCountAfterClean ?? 0,
        noiseRemovedSamples: acc.noiseRemovedSamples ?? [],
        viaCascade: acc.viaCascade ?? [],
      };
    },
  };
}

// ---------------------------------------------------------------------------

const NOISE_CLASS_SUBSTRINGS: string[] = [
  "advertisement",
  "publicidade",
  "newsletter",
  "related",
  "relacionad",
  "leia-tambem",
  "leia-mais",
  "recomend",
  "share-",
  "social-share",
  "tags-list",
  "author-box",
  "byline",
  "sponsor",
  "subscribe",
  "breadcrumb",
  "comments",
  "content-ads",
  "tag-manager-publicidade",
  "read-more",
  "mc-read-more",
  "recommend-theme",
  "box-seja-assinante",
  "seja-assinante",
  "assine-",
  "paywall-wrap",
  "subscription",
  "premium-content-wall",
  // Phase 2 additions (2026-05-26): expand noise-class coverage based on common
  // patterns found across BR news sites (related articles, ad networks, captions,
  // taxonomy widgets, structural complementary blocks).
  "caption",
  "figcaption",
  "credit",
  "gallery",
  "slideshow",
  "footnote",
  "note-",
  "tag-",
  "topic-",
  "category-",
  "tax-",
  "widget",
  "module-related",
  "aside-",
  "promo",
  "sponsored",
  "outbrain",
  "taboola",
  "mgid",
  "dianomi",
  "next-article",
  "previous-article",
  "more-from",
  "most-read",
  "trending",
  "popular-",
  "also-read",
  "further-reading",
];

type CheerioRoot = ReturnType<typeof cheerio.load>;

function stripNoise($: CheerioRoot, container: cheerio.Cheerio<AnyNode>): void {
  // Remove noise tags.
  container.find("figure, figcaption, aside, script, style, iframe, form, nav").remove();
  // Remove elements whose class/id contains noise substrings, or whose data-*/role
  // attributes match noise patterns (Phase 2: matchesNoiseAttr).
  container.find("*").each((_, el) => {
    const $el = $(el);
    const classes = ($el.attr("class") ?? "").split(/\s+/);
    const id = $el.attr("id") ?? "";
    const combined = [...classes, id].join(" ").toLowerCase();
    if (
      NOISE_CLASS_SUBSTRINGS.some((sub) => combined.includes(sub)) ||
      matchesNoiseAttr(el as Element)
    ) {
      $el.remove();
    }
  });
}

function titleFromMeta($: CheerioRoot): string {
  const ogTitle = $('meta[property="og:title"]').attr("content");
  if (ogTitle) return ogTitle.trim();
  const twTitle = $('meta[name="twitter:title"]').attr("content");
  if (twTitle) return twTitle.trim();
  const itemprop = $('meta[itemprop="headline"]').attr("content");
  if (itemprop) return itemprop.trim();
  const h1 = $("h1").first().text().trim();
  if (h1) return h1;
  const titleTag = $("title").text().trim();
  return titleTag;
}

// ---------------------------------------------------------------------------
// Paragraph-level noise guards (Phase 2, 2026-05-26)
// ---------------------------------------------------------------------------

/**
 * Returns true if ≥80% of the paragraph's visible text comes from <a> descendants.
 * Covers <p><a>…</a><br><a>…</a></p>, <p>  <a>…</a></p>, and wrapper variants
 * that the old children.every(tagName==="a") guard misses.
 * An empty paragraph is also treated as "mostly links" and dropped.
 */
function isMostlyLinks($p: cheerio.Cheerio<AnyNode>, $: cheerio.CheerioAPI): boolean {
  const total = $p.text().trim().length;
  if (total === 0) return true; // empty <p> with only links → drop
  const linkText = $p.find("a").toArray()
    .map((a) => $(a).text().trim().length)
    .reduce((sum, n) => sum + n, 0);
  return linkText / total >= 0.8;
}

/**
 * Returns true if the paragraph is dominated by link text — likely a "Leia também" /
 * navigation block / related-news strip masquerading as a <p>.
 * Threshold: >60% of text comes from <a> descendants AND ≥2 links in the paragraph.
 * Complements isMostlyLinks (lower threshold, requires ≥2 links for specificity).
 */
function isLinkHeavy($p: cheerio.Cheerio<AnyNode>, $: cheerio.CheerioAPI): boolean {
  const totalText = $p.text().trim();
  if (totalText.length < 20) return false; // too short to judge meaningfully
  const $links = $p.find("a");
  if ($links.length < 2) return false;
  const linkTextLength = $links.toArray()
    .map((a) => $(a).text().trim().length)
    .reduce((sum, n) => sum + n, 0);
  return linkTextLength / totalText.length > 0.6;
}

function paragraphsFrom(
  $: CheerioRoot,
  container: cheerio.Cheerio<AnyNode>,
  rec?: ReturnType<typeof createDebugRecorder>,
): string[] {
  // Snapshot raw <p> count before stripNoise mutates the DOM.
  const rawPs = container.find("p");
  rec?.record("pCountRaw", rawPs.length);

  stripNoise($, container);

  // Count after noise nodes have been removed.
  const psAfterStrip = container.find("p");
  rec?.record("pCountAfterStripNoise", psAfterStrip.length);

  const paragraphs: string[] = [];
  psAfterStrip.each((_, el) => {
    const $p = $(el);

    // Guard 1: paragraph where ≥80% of text is anchor text (Phase 2 rewrite of the
    // fragile children.every(tagName==="a") guard — covers <br>, whitespace, wrappers).
    if (isMostlyLinks($p, $)) {
      rec?.pushNoiseSample($p.text().trim());
      return;
    }

    // Guard 2: link-density filter — paragraph dominated by links even when plain
    // text nodes are present (e.g. "Leia também: X | Y | Z" with inline separators).
    if (isLinkHeavy($p, $)) {
      rec?.pushNoiseSample($p.text().trim());
      return;
    }

    const txt = $p.text().replace(/\s+/g, " ").trim();
    if (txt) paragraphs.push(txt);
  });
  return paragraphs;
}

function firstMatching($: CheerioRoot, selectors: string[]): cheerio.Cheerio<AnyNode> | null {
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length > 0) return el;
  }
  return null;
}

/**
 * Extract title + paragraphs from raw HTML for the given domain.
 *
 * @param html    Full HTML string from any fetcher.
 * @param domain  Hostname key (must exist in EXTRACTORS).
 * @param debug   When true, attaches a ScrapeDebug object to the return value.
 *                Defaults to false — no recorder is created, zero overhead.
 */
export function extract(
  html: string,
  domain: string,
  debug = false,
): { title: string; paragraphs: string[]; debug?: ScrapeDebug } {
  const selectors = EXTRACTORS[domain];
  if (!selectors) {
    return { title: "", paragraphs: [] };
  }

  const rec = debug ? createDebugRecorder() : undefined;

  const $ = cheerio.load(html);
  const title = cleanTitle(titleFromMeta($));

  // Determine which selector was chosen and record it.
  // Phase 2: if the matched container is noisy (too many nav/aside children),
  // skip it and try the next selector — avoids grabbing sidebar + article together.
  let chosenSelector: string | null = null;
  let container: cheerio.Cheerio<AnyNode> | null = null;

  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length === 0) continue;
    if (isNoisyContainer(el)) continue; // skip: grabbed sidebar along with article
    chosenSelector = sel;
    container = el;
    break;
  }

  if (!container || container.length === 0) {
    // Fallback: try <article> (mirrors original firstMatching fallback).
    const articleEl = $("article").first();
    if (articleEl.length > 0) {
      chosenSelector = "<article> (fallback)";
      container = articleEl;
    }
  }

  rec?.record("selectorUsed", chosenSelector);

  if (!container || container.length === 0) {
    return debug
      ? { title, paragraphs: [], debug: rec!.build() }
      : { title, paragraphs: [] };
  }

  rec?.record("containerHtmlByteSize", (container.html() ?? "").length);

  // Build debug sink: collects discarded paragraph samples from cleanParagraphs.
  const debugSink = rec
    ? (sample: string) => rec.pushNoiseSample(sample)
    : undefined;

  const rawPs = paragraphsFrom($, container, rec);
  const cleanedPs = cleanParagraphs(rawPs, debugSink);

  rec?.record("pCountAfterClean", cleanedPs.length);

  return debug
    ? { title, paragraphs: cleanedPs, debug: rec!.build() }
    : { title, paragraphs: cleanedPs };
}
