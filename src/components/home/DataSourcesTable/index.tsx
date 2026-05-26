"use client";

// DataSourcesTable — live table showing freshness of all 23 data sources.
//
// Renders 6 category sections with a sticky translucent header and
// per-row expand/collapse. Refreshes freshness data every 60 seconds.
//
// This component is DESKTOP-ONLY. The mobile view does NOT render it.

import { useState } from "react";
import { DATA_SOURCES, type DataSourceCategory } from "../../../data/dataSources";
import { useDataSourcesFreshness } from "./useDataSourcesFreshness";
import SectionHeader from "./SectionHeader";
import SourceRow from "./SourceRow";
import styles from "./DataSourcesTable.module.css";

// Ordered list of categories as they appear in the table
const CATEGORY_ORDER: DataSourceCategory[] = [
  "anp-production",
  "anp-distribution",
  "imports",
  "vessels",
  "proprietary",
  "news",
];

export default function DataSourcesTable(): React.ReactElement {
  const { freshness, loading } = useDataSourcesFreshness();

  // Track which row is expanded (only one at a time)
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  function handleToggle(key: string) {
    setExpandedKey((prev) => (prev === key ? null : key));
  }

  // Group sources by category in the canonical order
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    sources: DATA_SOURCES.filter((s) => s.category === cat),
  }));

  return (
    <div className={styles.tableRoot} aria-label="Data Sources">
      {/* ── Table header ──────────────────────────────────────────────────── */}
      <div className={styles.tableHeader}>
        DATA SOURCES{" "}
        <span
          aria-hidden="true"
          style={{ color: "rgba(0,0,0,0.3)", fontWeight: 400 }}
        >
          ·
        </span>{" "}
        LIVE{" "}
        <span
          className={`ds-pulse ${styles.headerLiveDot}`}
          title="Refreshes every 60 seconds"
          style={{ color: "var(--ds-status-fresh)", background: "var(--ds-status-fresh)" }}
        />
      </div>

      {/* ── Column headers ─────────────────────────────────────────────────── */}
      <div className={styles.colHeaders} aria-hidden="true">
        <span>Name</span>
        <span>Source</span>
        <span>Last update</span>
        <span />
      </div>

      {/* ── Category sections ─────────────────────────────────────────────── */}
      {grouped.map(({ category, sources }) => (
        <section key={category} aria-label={category}>
          <SectionHeader category={category} />
          {sources.map((src) => (
            <SourceRow
              key={src.key}
              src={src}
              info={freshness.get(src.key)}
              freshnessLoading={loading}
              isExpanded={expandedKey === src.key}
              onToggle={() => handleToggle(src.key)}

            />
          ))}
        </section>
      ))}
    </div>
  );
}
