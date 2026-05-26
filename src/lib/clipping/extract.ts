// Port of clipinator.py lines 142–211: extraction helpers using cheerio.
// Mirrors _strip_noise, _title_from_meta, _paragraphs_from, _first_matching, _extract.

import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { EXTRACTORS, matchesNoiseAttr, isNoisyContainer, hasCustomSelectors } from "./sources";
import { cleanTitle, cleanParagraphs } from "./clean";
import type { ScrapeDebug } from "./types";
import { extractWithReadability } from "./extractReadability";

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
  // Phase 4 additions (2026-05-26): per-site fixture audit surfaced additional patterns.
  // media__description — Globo group (G1, Valor, Globo Rural): photo captions rendered as <p>
  // headlines — Estadão: related-article teaser blocks inside news-body
  // loading-text — Estadão: AI-generated summary placeholder ("Gerando resumo")
  "media__description",
  "headlines",
  "loading-text",
];

type CheerioRoot = ReturnType<typeof cheerio.load>;

function stripNoise($: CheerioRoot, container: cheerio.Cheerio<AnyNode>): void {
  // Remove noise tags.
  container.find("figure, figcaption, aside, script, style, iframe, form, nav").remove();
  // Remove elements whose class/id contains noise substrings, or whose data-*/role
  // attributes match noise patterns (Phase 2: matchesNoiseAttr).
  //
  // Phase 5 fix: exclude Tailwind arbitrary-variant tokens (e.g. `[&_.gallery]:mb-4`)
  // from the combined string before substring matching. These tokens start with `[` and
  // contain substrings like "gallery", "related", "category", etc. as selector targets —
  // not as semantic class names on the element itself. Without this filter, CNN Brasil's
  // article body div (which has `[&_.gallery]:mb-4` in its class) was falsely removed
  // by the "gallery" noise substring, producing zero paragraphs → paywall false-positive.
  container.find("*").each((_, el) => {
    const $el = $(el);
    const classTokens = ($el.attr("class") ?? "").split(/\s+/);
    // Only include tokens that are plain class names (not Tailwind arbitrary variants).
    // Arbitrary-variant tokens start with `[` (e.g. `[&_.gallery]:mb-4`,
    // `[#id_&]:flex`, `group-has-[.foo]:w-full`).
    const plainTokens = classTokens.filter((t) => !t.startsWith("[") && !t.includes("["));
    const id = $el.attr("id") ?? "";
    const combined = [...plainTokens, id].join(" ").toLowerCase();
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

// ---------------------------------------------------------------------------
// Internal cheerio-based extraction helper (shared by the main path and
// the Readability comparison branch).
// ---------------------------------------------------------------------------

/**
 * Runs the cheerio-based extraction pipeline for a given domain against
 * pre-parsed HTML. Returns the raw {title, paragraphs} pair WITHOUT
 * attaching debug metadata (the caller owns the recorder).
 *
 * Exposed as a named internal to allow the Readability comparison branch
 * to call it separately and pick the better result.
 */
function runCheerioExtraction(
  html: string,
  domain: string,
  rec?: ReturnType<typeof createDebugRecorder>,
): { title: string; paragraphs: string[] } | null {
  const selectors = EXTRACTORS[domain];
  if (!selectors) return null;

  const $ = cheerio.load(html);
  const title = cleanTitle(titleFromMeta($));

  // Phase 2: if the matched container is noisy (too many nav/aside children),
  // skip it and try the next selector — avoids grabbing sidebar + article together.
  let chosenSelector: string | null = null;
  let container: cheerio.Cheerio<AnyNode> | null = null;

  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length === 0) continue;
    if (isNoisyContainer(el)) continue;
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
    return { title, paragraphs: [] };
  }

  rec?.record("containerHtmlByteSize", (container.html() ?? "").length);

  const debugSink = rec
    ? (sample: string) => rec.pushNoiseSample(sample)
    : undefined;

  const rawPs = paragraphsFrom($, container, rec);
  const cleanedPs = cleanParagraphs(rawPs, debugSink);

  rec?.record("pCountAfterClean", cleanedPs.length);

  return { title, paragraphs: cleanedPs };
}

// ---------------------------------------------------------------------------
// Phase 3: apply Phase-2 noise filters to Readability paragraph output.
// Readability cleans structural noise (ads, nav, sidebars) but does NOT
// handle inline pt-BR noise patterns (e.g. "Leia também: X | Y | Z") or
// link-density patterns. We run cleanParagraphs() on top to catch those.
// ---------------------------------------------------------------------------

/**
 * Applies the Phase-2 text-level noise filters (cleanParagraphs) to a raw
 * paragraph list produced by Readability. The link-density / isMostlyLinks
 * guards already ran at the DOM level inside runCheerioExtraction — they
 * are not re-applied here because Readability's output is plain text nodes,
 * not DOM elements. cleanParagraphs covers the remaining inline noise.
 */
function applyNoiseFilters(
  paragraphs: string[],
  debugSink?: (sample: string) => void,
): string[] {
  return cleanParagraphs(paragraphs, debugSink);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract title + paragraphs from raw HTML for the given domain.
 *
 * Phase 3 (2026-05-26): when CLIPPING_USE_READABILITY=1 is set AND the domain
 * falls into AUTO_SELECTORS (no custom tuning), both the cheerio path and
 * Mozilla Readability are executed. The result with more joined content is
 * preferred, unless Readability fragments the text ≥3× more than cheerio
 * (sign of bad paragraph splitting), in which case cheerio wins.
 *
 * Custom-selector domains (the 28 well-tuned sites) are never sent through
 * Readability — their selectors are already precise, and Readability could
 * regress them.
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

  // ── Cheerio-based extraction (always runs) ────────────────────────────────
  const cheerioResult = runCheerioExtraction(html, domain, rec) ?? {
    title: "",
    paragraphs: [],
  };

  // ── Phase 3: Readability fallback for AUTO_SELECTORS domains ─────────────
  const useReadability =
    process.env.CLIPPING_USE_READABILITY === "1" &&
    !hasCustomSelectors(domain); // custom domains skip Readability entirely

  if (useReadability) {
    const readabilityRaw = extractWithReadability(html);

    if (readabilityRaw) {
      // Apply Phase-2 text-level filters to Readability's paragraph output.
      const debugSink = rec
        ? (sample: string) => rec.pushNoiseSample(sample)
        : undefined;
      const cleanedReadabilityParagraphs = applyNoiseFilters(
        readabilityRaw.paragraphs,
        debugSink,
      );

      const currentJoinedLength = cheerioResult.paragraphs.join("").length;
      const readabilityJoinedLength = cleanedReadabilityParagraphs.join("").length;

      // Fragmentation guard: if Readability produced ≥3× more paragraphs than
      // cheerio, it split sentences too aggressively — prefer cheerio.
      const fragmentationRatio =
        cleanedReadabilityParagraphs.length /
        Math.max(1, cheerioResult.paragraphs.length);

      if (fragmentationRatio >= 3) {
        rec?.record(
          "selectorUsed",
          `auto-vs-readability:rejected(frag=${fragmentationRatio.toFixed(1)})`,
        );
        // Fall through to cheerio result below.
      } else if (readabilityJoinedLength > currentJoinedLength) {
        // Readability produced more content — use it.
        rec?.record("selectorUsed", "readability");
        const result = {
          title: (readabilityRaw.title ?? cheerioResult.title) as string,
          paragraphs: cleanedReadabilityParagraphs,
        };
        return debug
          ? { ...result, debug: rec!.build() }
          : result;
      }
      // else: cheerio had more content — fall through.
    }
    // Readability returned null or cheerio won — fall through to cheerio result.
  }

  // ── Return cheerio result ─────────────────────────────────────────────────
  return debug
    ? { ...cheerioResult, debug: rec!.build() }
    : cheerioResult;
}
