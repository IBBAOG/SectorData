// Port of clipinator.py lines 142–211: extraction helpers using cheerio.
// Mirrors _strip_noise, _title_from_meta, _paragraphs_from, _first_matching, _extract.

import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { EXTRACTORS } from "./sources";
import { cleanTitle, cleanParagraphs } from "./clean";

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

function paragraphsFrom($: CheerioRoot, container: cheerio.Cheerio<AnyNode>): string[] {
  stripNoise($, container);
  const paragraphs: string[] = [];
  container.find("p").each((_, el) => {
    const $p = $(el);
    // Skip paragraphs that consist only of anchor tags (navigation noise).
    const children = $p.children().toArray() as AnyNode[];
    if (
      children.length > 0 &&
      children.every((c) => (c as Element).tagName === "a")
    ) {
      const pText = $p.text().trim();
      const anchorText = children.map((c) => $(c).text().trim()).join(" ");
      if (pText === anchorText) return;
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

/** Extract title + paragraphs from raw HTML for the given domain. */
export function extract(html: string, domain: string): { title: string; paragraphs: string[] } {
  const selectors = EXTRACTORS[domain];
  if (!selectors) {
    return { title: "", paragraphs: [] };
  }

  const $ = cheerio.load(html);
  const title = cleanTitle(titleFromMeta($));
  const container = firstMatching($, selectors) ?? $("article").first();

  if (!container || container.length === 0) {
    return { title, paragraphs: [] };
  }

  const paragraphs = cleanParagraphs(paragraphsFrom($, container));
  return { title, paragraphs };
}
