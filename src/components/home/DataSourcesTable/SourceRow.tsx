"use client";

// SourceRow — single collapsed data source row.
// Clicking anywhere (except action icons) toggles the ExpandedRow.
// Displays: Name · Source · Last update · Action icons.

import Link from "next/link";
import LastUpdateCell from "./LastUpdateCell";
import ExpandedRow from "./ExpandedRow";
import type { DataSource, DataSourceCategory } from "../../../data/dataSources";
import type { SourceFreshness } from "./useDataSourcesFreshness";
import styles from "./DataSourcesTable.module.css";

// CSS variable names per category (must align with globals.css tokens)
const CAT_VAR: Record<DataSourceCategory, string> = {
  "anp-production": "anp-production",
  "anp-distribution": "anp-distribution",
  imports: "imports",
  proprietary: "proprietary",
  news: "news",
};

interface SourceRowProps {
  src: DataSource;
  info: SourceFreshness | undefined;
  freshnessLoading: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

export default function SourceRow({
  src,
  info,
  freshnessLoading,
  isExpanded,
  onToggle,
}: SourceRowProps): React.ReactElement {
  const catVar = CAT_VAR[src.category];

  return (
    <div
      className={styles.sourceRowWrapper}
      style={{
        // CSS custom property trick: pass category to CSS so hover BG can use it
        ["--row-cat-soft" as string]: `var(--ds-cat-${catVar}-soft)`,
        ["--row-cat-hover" as string]: `var(--ds-cat-${catVar}-hover)`,
        ["--row-cat-text" as string]: `var(--ds-cat-${catVar}-text)`,
      }}
    >
      {/* ── Collapsed row ────────────────────────────────────────────────── */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        className={styles.sourceRow}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
      >
        {/* Name — direct link if single dashboard, static text otherwise */}
        <span className={styles.colName}>
          {src.dashboards.length === 1 ? (
            <Link
              href={`/${src.dashboards[0].slug}`}
              className={styles.nameLink}
              onClick={(e) => e.stopPropagation()}
              title={`Open ${src.dashboards[0].title}`}
            >
              {src.name}
            </Link>
          ) : (
            <span className={styles.nameStatic} title={src.name}>
              {src.name}
            </span>
          )}
        </span>

        {/* Source label */}
        <span
          className={styles.colSource}
          style={{ color: `var(--ds-cat-${catVar}-text)` }}
        >
          {src.source}
        </span>

        {/* Last update */}
        <span className={styles.colLastUpdate}>
          <LastUpdateCell
            lastUpdate={info?.lastUpdate ?? null}
            loading={freshnessLoading && !info}
            isRealtime={src.isRealtime}
          />
        </span>

        {/* Actions */}
        <span className={styles.colActions} onClick={(e) => e.stopPropagation()}>
          {/* External source link */}
          {src.sourceUrl ? (
            <a
              href={src.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.iconBtn}
              title="Open source"
              tabIndex={0}
            >
              <svg
                width="13"
                height="13"
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
            </a>
          ) : (
            <span
              className={styles.iconBtnDisabled}
              title="No upstream URL"
              aria-hidden="true"
            >
              <svg
                width="13"
                height="13"
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
            </span>
          )}


          {/* Expand chevron */}
          <span
            className={styles.expandChevron}
            style={{ transform: isExpanded ? "rotate(90deg)" : "none" }}
            aria-hidden="true"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        </span>
      </div>

      {/* ── Expanded panel ─────────────────────────────────────────────────── */}
      {isExpanded && (
        <ExpandedRow src={src} info={info} />
      )}
    </div>
  );
}
