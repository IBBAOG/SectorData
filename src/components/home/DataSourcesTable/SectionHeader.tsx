"use client";

// SectionHeader — translucent section divider "── ANP PRODUCTION ──"

import styles from "./DataSourcesTable.module.css";

const CATEGORY_LABELS: Record<string, string> = {
  "anp-production": "ANP Production",
  "anp-distribution": "ANP Distribution",
  imports: "Imports & Exports",
  proprietary: "Proprietary Data",
  news: "News & Markets",
};

export default function SectionHeader({
  category,
}: {
  category: string;
}): React.ReactElement {
  const label = CATEGORY_LABELS[category] ?? category;
  return (
    <div className={styles.sectionHeader} aria-hidden="true">
      <span className={styles.sectionHeaderLine} />
      <span className={styles.sectionHeaderLabel}>{label}</span>
      <span className={styles.sectionHeaderLine} />
    </div>
  );
}
