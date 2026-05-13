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
}

/** Snapshot stored in localStorage for selection persistence. */
export interface ArticleSnapshot {
  url: string;
  title: string;
  source_name: string;
  published_at: string;
}
