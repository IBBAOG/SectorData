// status.ts — Shared status-derivation helpers for the DataSourcesTable.
//
// Extracted so that StatusDot, SourceRow, and the header dot in index.tsx
// all use the same logic without duplication.

import type { DataSource } from "../../../data/dataSources";

export type SourceStatus = "fresh" | "stale" | "overdue" | "unknown";

const STATUS_RANK: Record<SourceStatus, number> = {
  unknown: -1,
  fresh: 0,
  stale: 1,
  overdue: 2,
};

/**
 * Derives a SourceStatus for one data source given its last-update timestamp.
 *
 * @param src        The DataSource definition (thresholds live here).
 * @param lastUpdate ISO timestamp string, or null if unknown.
 */
export function deriveStatus(
  src: DataSource,
  lastUpdate: string | null,
): SourceStatus {
  if (lastUpdate == null) {
    return src.isRealtime ? "fresh" : "unknown";
  }
  const ageMs = Date.now() - new Date(lastUpdate).getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours >= src.overdueAfterHours) return "overdue";
  if (ageHours >= src.staleAfterHours) return "stale";
  return "fresh";
}

/**
 * Aggregates an array of statuses into the single worst one.
 * Returns "unknown" for an empty array.
 */
export function aggregateStatus(statuses: SourceStatus[]): SourceStatus {
  if (statuses.length === 0) return "unknown";
  let worst: SourceStatus = "fresh";
  for (const s of statuses) {
    if (STATUS_RANK[s] > STATUS_RANK[worst]) worst = s;
  }
  return worst;
}

/**
 * Maps a SourceStatus to the matching CSS custom-property colour token.
 */
export function statusToTokenVar(status: SourceStatus): string {
  switch (status) {
    case "fresh":
      return "var(--ds-status-fresh)";
    case "stale":
      return "var(--ds-status-stale)";
    case "overdue":
      return "var(--ds-status-overdue)";
    case "unknown":
    default:
      return "var(--ds-glass-border-strong)";
  }
}
