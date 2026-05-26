/**
 * Mozilla Readability-based extraction — Phase 3 of the clipping noise-reduction plan.
 *
 * Used exclusively as a fallback for domains that resolve to AUTO_SELECTORS in
 * sources.ts. The 28 custom-selector domains skip this entirely — their selectors are
 * already well-tuned.
 *
 * Feature-flagged behind CLIPPING_USE_READABILITY=1 (Vercel env var). When the flag
 * is absent, this module is imported but extractWithReadability() is never called,
 * so there is zero runtime cost.
 *
 * Why linkedom instead of jsdom: ~10x smaller (~150 KB vs ~2 MB), pure JS with no
 * native bindings, compatible with Vercel serverless function size limits.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

/**
 * Attempts to extract article content from raw HTML using Mozilla Readability
 * (the engine behind Firefox Reader View).
 *
 * Returns null on failure (Readability could not identify article content, or
 * threw an exception). The caller is responsible for applying Phase-2 noise
 * filters (stripNoise / cleanParagraphs / link-density) on top of the result —
 * Readability is a starting point, not a final pass.
 *
 * Output shape matches the {title, paragraphs} shape used by extract() so both
 * branches can be compared and merged uniformly.
 */
export function extractWithReadability(
  html: string,
): { title: string | null; paragraphs: string[] } | null {
  try {
    // linkedom's parseHTML returns a Window-like object; .document is the DOM root.
    const win = parseHTML(html);
    const document = win.document as unknown as Document;

    const reader = new Readability(document, {
      // Require at least 250 chars before Readability considers the document
      // "article-like". Below this threshold it returns null — we then fall back
      // to the current AUTO_SELECTORS result.
      charThreshold: 250,
      // Do not preserve class names on output elements — we don't need them since
      // we only read textContent of <p> elements from the cleaned output.
      keepClasses: false,
      // Honor JSON-LD metadata (title, author) if present.
      disableJSONLD: false,
    });

    const article = reader.parse();

    if (!article || !article.content) return null;

    // Parse Readability's cleaned HTML output to extract paragraph text nodes.
    const articleWin = parseHTML(article.content as string);
    const articleDoc = articleWin.document as unknown as Document;

    const paragraphs: string[] = [];
    articleDoc.querySelectorAll("p").forEach((p) => {
      const text = (p.textContent ?? "").trim();
      if (text.length > 0) paragraphs.push(text);
    });

    return {
      title: article.title ?? null,
      paragraphs,
    };
  } catch {
    // Readability or linkedom threw — treat as extraction failure.
    return null;
  }
}
