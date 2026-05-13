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
   * - "curl"    — system curl shell-out succeeded (Cloudflare TLS fingerprint bypass)
   * - "wayback" — Wayback Machine snapshot
   * Omitted for direct (undici) fetches.
   */
  via?: "wayback" | "curl";
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
