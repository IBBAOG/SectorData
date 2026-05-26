"use client";

// DataSourcesTable — live table showing freshness of all data sources.
//
// Renders 5 category sections with a sticky translucent header and
// per-row expand/collapse. Refreshes freshness data every 60 seconds.
//
// This component is DESKTOP-ONLY. The mobile view does NOT render it.
// Note: "vessels" category is no longer rendered — navios_diesel and
// vessel_positions were moved to "proprietary" (Fix 1, 2026-05-26).

import { useState } from "react";
import { DATA_SOURCES, type DataSourceCategory } from "../../../data/dataSources";
import { useDataSourcesFreshness } from "./useDataSourcesFreshness";
import SectionHeader from "./SectionHeader";
import SourceRow from "./SourceRow";
import styles from "./DataSourcesTable.module.css";

// Ordered list of categories as they appear in the table.
// "vessels" is intentionally absent — no entries use it any more.
const CATEGORY_ORDER: DataSourceCategory[] = [
  "anp-production",
  "anp-distribution",
  "imports",
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
        DATA SOURCES
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
