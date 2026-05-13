// Port of clipinator.py lines 600–632: scrape() orchestrator.
// Ties together fetch → extract → clean → paywall-check → Wayback retry.

import { EXTRACTORS, SOURCE_NAMES } from "./sources";
import { extract } from "./extract";
import { cleanParagraphs, looksPaywalled } from "./clean";
import { fetchHtml, fetchFromWayback } from "./fetch";
import type { ScrapeResult } from "./types";

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Scrape one URL and return a ScrapeResult.
 * @param url      Article URL (must be in the EXTRACTORS allowlist).
 * @param signal   AbortController signal (caller sets a 12-second deadline).
 * @param manualBody  Optional manually-pasted article body text.
 */
export async function scrape(
  url: string,
  signal: AbortSignal,
  manualBody?: string,
): Promise<ScrapeResult> {
  const domain = getDomain(url);

  // SSRF guard: only process domains in the allowlist.
  if (!domain || !(domain in EXTRACTORS)) {
    return { url, status: "unknown_domain", error: `Domain not in allowlist: ${domain}` };
  }

  const source = SOURCE_NAMES[domain] ?? domain;

  // If the caller supplies a manual body, we still fetch the URL to extract <title>
  // (falls back to "" on failure), but body paragraphs come from manualBody — no body scraping.
  if (manualBody) {
    const { title } = await (async () => {
      const fetched = await fetchHtml(url, signal);
      if (fetched.ok) return extract(fetched.html, domain);
      return { title: "", paragraphs: [] };
    })();

    // Split manual body into paragraphs (double newline or single newline).
    let chunks = manualBody.trim().split(/\n\s*\n+/);
    if (chunks.length === 1) {
      chunks = manualBody
        .trim()
        .split("\n")
        .filter((c) => c.trim());
    }
    const paragraphs = cleanParagraphs(chunks.map((c) => c.trim()).filter(Boolean));

    if (!paragraphs.length) {
      return { url, status: "error", error: "Manual body yielded no paragraphs after cleaning." };
    }

    return {
      url,
      status: "ok",
      item: { url, source, title: title || url, paragraphs },
    };
  }

  // Normal path: fetch → extract.
  const fetchResult = await fetchHtml(url, signal);
  if (!fetchResult.ok) {
    return { url, status: "fetch_failed", error: "Could not fetch page (403/network error)." };
  }

  let { title, paragraphs } = extract(fetchResult.html, domain);

  // Paywall detected → try Wayback Machine once.
  if (looksPaywalled(paragraphs)) {
    const wbResult = await fetchFromWayback(url, signal);
    if (wbResult.ok) {
      const wbExtracted = extract(wbResult.html, domain);
      if (
        !looksPaywalled(wbExtracted.paragraphs) &&
        wbExtracted.paragraphs.length > paragraphs.length
      ) {
        paragraphs = wbExtracted.paragraphs;
        if (wbExtracted.title) title = wbExtracted.title;
      }
    }
  }

  // Still looks paywalled after Wayback attempt.
  if (looksPaywalled(paragraphs)) {
    return {
      url,
      status: "paywall",
      error: "Content appears to be behind a paywall. Paste the article body manually.",
      // Return whatever title we got so the UI can display it.
      item: title ? { url, source, title, paragraphs: [] } : undefined,
    };
  }

  if (!title) {
    return { url, status: "error", error: "Could not extract article title." };
  }

  return {
    url,
    status: "ok",
    item: { url, source, title, paragraphs },
  };
}
