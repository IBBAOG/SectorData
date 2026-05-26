// Port of clipinator.py lines 142–211: extraction helpers using cheerio.
// Mirrors _strip_noise, _title_from_meta, _paragraphs_from, _first_matching, _extract.

import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { EXTRACTORS } from "./sources";
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
];

type CheerioRoot = ReturnType<typeof cheerio.load>;

function stripNoise($: CheerioRoot, container: cheerio.Cheerio<AnyNode>): void {
  // Remove noise tags.
  container.find("figure, figcaption, aside, script, style, iframe, form, nav").remove();
  // Remove elements whose class/id contains noise substrings.
  container.find("*").each((_, el) => {
    const $el = $(el);
    const classes = ($el.attr("class") ?? "").split(/\s+/);
    const id = $el.attr("id") ?? "";
    const combined = [...classes, id].join(" ").toLowerCase();
    if (NOISE_CLASS_SUBSTRINGS.some((sub) => combined.includes(sub))) {
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
    // Skip paragraphs that consist only of anchor tags (navigation noise).
    const children = $p.children().toArray() as AnyNode[];
    if (
      children.length > 0 &&
      children.every((c) => (c as Element).tagName === "a")
    ) {
      const pText = $p.text().trim();
      const anchorText = children.map((c) => $(c).text().trim()).join(" ");
      if (pText === anchorText) {
        rec?.pushNoiseSample(pText);
        return;
      }
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
  let chosenSelector: string | null = null;
  let container: cheerio.Cheerio<AnyNode> | null = null;

  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length > 0) {
      chosenSelector = sel;
      container = el;
      break;
    }
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
