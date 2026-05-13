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
  /** True when the content was retrieved from Wayback Machine (live fetch failed or paywalled). */
  via_wayback?: boolean;
}

/** Snapshot stored in localStorage for selection persistence. */
export interface ArticleSnapshot {
  url: string;
  title: string;
  source_name: string;
  published_at: string;
}
