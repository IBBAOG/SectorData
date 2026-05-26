// Types shared between the scrape route, lib modules, and the frontend components.

export type ScrapeStatus =
  | "ok"
  | "paywall"
  | "fetch_failed"
  | "unknown_domain"
  | "skipped"
  | "error";

export interface ClippingItem {
  url: string;
  source: string;
  title: string;
  paragraphs: string[];
}

/**
 * Observability payload attached to ScrapeResult when ?debug=1 is passed.
 * Populated by extract() and propagated through scrape(). Zero overhead in production
 * (the recorder is never created when debug=false).
 */
export interface ScrapeDebug {
  /** Which CSS selector from sources.ts was chosen, or null if nothing matched. */
  selectorUsed: string | null;
  /** Byte length of the innerHTML of the chosen container element. */
  containerHtmlByteSize: number;
  /** Number of <p> elements found inside the container before stripNoise ran. */
  pCountRaw: number;
  /** Number of <p> elements remaining after stripNoise removed noise nodes. */
  pCountAfterStripNoise: number;
  /** Number of paragraphs that survived cleanParagraphs (noise regex + dedup). */
  pCountAfterClean: number;
  /**
   * Up to 3 paragraph texts (truncated to 200 chars each) that were discarded by
   * either stripNoise (entire container node removed) or cleanParagraphs (regex match).
   */
  noiseRemovedSamples: string[];
  /**
   * Ordered list of fetcher names that were actually invoked, ending with the one
   * that produced usable HTML. e.g. ["undici"] for a direct hit, or
   * ["undici", "curl", "curl_impersonate"] if the first two failed.
   */
  viaCascade: string[];
}

export interface ScrapeResult {
  url: string;
  status: ScrapeStatus;
  item?: ClippingItem;
  error?: string;
  /**
   * How the content was retrieved when the primary undici fetch failed or was paywalled.
   * - "curl"             — plain static curl 8.20.0 (musl) succeeded.
   * - "curl_impersonate" — curl-impersonate chrome131 (full TLS fingerprint) succeeded.
   * - "headless"         — playwright-core + @sparticuz/chromium headless browser succeeded.
   * - "wayback"          — Wayback Machine snapshot.
   * Omitted for direct (undici) fetches.
   */
  via?: "wayback" | "curl" | "curl_impersonate" | "headless";
  /** @deprecated Use `via === "wayback"` instead. Kept for backwards compat. */
  via_wayback?: boolean;
  /** Present only when the request includes ?debug=1. */
  debug?: ScrapeDebug;
}

/** Snapshot stored in localStorage for selection persistence. */
export interface ArticleSnapshot {
  url: string;
  title: string;
  source_name: string;
  published_at: string;
}
