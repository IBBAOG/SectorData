"use client";

// ExpandedRow — inline panel shown when a SourceRow is expanded.
// Displays schedule details, next estimated run, action buttons,
// and a Download Raw Data button (logged-in users only).

import { useState } from "react";
import Link from "next/link";
import DashboardPicker from "./DashboardPicker";
import type { DataSource } from "../../../data/dataSources";
import type { SourceFreshness } from "./useDataSourcesFreshness";
import styles from "./DataSourcesTable.module.css";
import ExportModal from "../../dashboard/ExportModal";

interface ExpandedRowProps {
  src: DataSource;
  info: SourceFreshness | undefined;
  isLoggedIn: boolean;
}

/**
 * Estimates the next run for cron-based sources.
 * Returns a human-readable string like "in 4h 12m" or "in 3 days".
 * Returns null for ad-hoc / real-time sources.
 */
function estimateNextRun(
  cronUtc: string | null,
  lastUpdate: Date | null,
  staleAfterHours: number,
): string | null {
  if (!cronUtc) return null;
  if (!lastUpdate) return null;

  // Use staleAfterHours as a proxy for the cron interval
  const intervalMs = (staleAfterHours / 1.5) * 3_600_000;
  const nextMs = lastUpdate.getTime() + intervalMs;
  const diffMs = nextMs - Date.now();

  if (diffMs <= 0) return "due now";

  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays >= 2) return `in ${diffDays} days`;
  if (diffHours >= 1) {
    const rem = diffMinutes % 60;
    return rem > 0 ? `in ${diffHours}h ${rem}m` : `in ${diffHours}h`;
  }
  return `in ${diffMinutes} min`;
}

// Dummy count fetcher for ExportModal — the table download for the home page is
// a raw full-table export so we reuse rowCount from freshness data directly.
async function noopCountFetcher(): Promise<number> {
  return 0;
}

export default function ExpandedRow({
  src,
  info,
  isLoggedIn,
}: ExpandedRowProps): React.ReactElement {
  const [exportOpen, setExportOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const nextRun = estimateNextRun(
    src.cronUtc,
    info?.lastUpdate ?? null,
    src.staleAfterHours,
  );

  function handleCopyTable(e: React.MouseEvent) {
    e.stopPropagation();
    if (!src.supabaseTable) return;
    navigator.clipboard.writeText(src.supabaseTable).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 1500);
    });
  }

  function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (!isLoggedIn) return;
    setExportOpen(true);
  }

  return (
    <div className={styles.expandedRow}>
      {/* Description */}
      <p className={styles.expandedDesc}>{src.description}</p>

      {/* Schedule info */}
      <div className={styles.expandedMeta}>
        <span className={styles.expandedMetaLabel}>Schedule:</span>
        <span className={styles.expandedMetaValue}>{src.cronDescription}</span>
      </div>

      {src.cronUtc && nextRun && (
        <div className={styles.expandedMeta}>
          <span className={styles.expandedMetaLabel}>Next run:</span>
          <span className={styles.expandedMetaValue}>{nextRun}</span>
        </div>
      )}

      {info?.rowCount != null && info.rowCount > 0 && (
        <div className={styles.expandedMeta}>
          <span className={styles.expandedMetaLabel}>Rows in DB:</span>
          <span className={styles.expandedMetaValue}>
            {info.rowCount.toLocaleString("en-US")}
          </span>
        </div>
      )}

      {/* Action buttons */}
      <div className={styles.expandedActions}>
        {/* View source */}
        {src.sourceUrl ? (
          <a
            href={src.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.actionBtn}
            onClick={(e) => e.stopPropagation()}
            title="Open upstream data source"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            View source
          </a>
        ) : (
          <span
            className={styles.actionBtnDisabled}
            title="No upstream URL (local file)"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            View source
          </span>
        )}

        {/* View dashboard */}
        {src.dashboards.length === 1 && (
          <Link
            href={`/${src.dashboards[0].slug}`}
            className={styles.actionBtn}
            onClick={(e) => e.stopPropagation()}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
            View dashboard
          </Link>
        )}
        {src.dashboards.length >= 2 && (
          <DashboardPicker dashboards={src.dashboards} />
        )}
        {src.dashboards.length === 0 && null}

        {/* Copy table name */}
        {src.supabaseTable && (
          <button
            type="button"
            className={styles.actionBtn}
            onClick={handleCopyTable}
            title={`Copy table name: ${src.supabaseTable}`}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {copyFeedback ? "Copied!" : `Copy table: ${src.supabaseTable}`}
          </button>
        )}

        {/* Download raw data */}
        {src.supabaseTable && (
          <button
            type="button"
            className={
              isLoggedIn ? styles.actionBtn : styles.actionBtnDisabled
            }
            onClick={handleDownload}
            title={
              isLoggedIn ? "Download raw table data" : "Sign in to download"
            }
            aria-disabled={!isLoggedIn}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {isLoggedIn ? "Download raw data" : "Sign in to download"}
          </button>
        )}
      </div>

      {/* ExportModal (Tier 2) — opens for logged-in users */}
      {src.supabaseTable && isLoggedIn && exportOpen && (
        <ExportModal
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          title={`Export — ${src.name}`}
          datasetKey={src.supabaseTable}
          filters={
            <p style={{ fontSize: 13, color: "#555", margin: 0 }}>
              Full table export — no filters available for raw source data.
            </p>
          }
          currentFilters={{}}
          countFetcher={noopCountFetcher}
          onExportExcel={() => {
            /* full-table Excel not implemented for raw source tables */
          }}
          onExportCsv={() => {
            /* full-table CSV not implemented for raw source tables */
          }}
        />
      )}
    </div>
  );
}
