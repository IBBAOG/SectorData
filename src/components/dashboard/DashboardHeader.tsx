"use client";

// Standard page header for dashboard modules.
//
// Renders the same .page-header-title / .page-header-sub structure used
// across Phase 3 dashboards, plus an optional "Período: yMin–yMax" badge
// and the divider <hr> beneath. Visual output matches the previous inline
// markup byte-for-byte.
//
// Phase 4 Bis additions (back-compat — defaults preserve old behavior):
//   • lang?: "pt" | "en"        — toggles "Período" vs "Period" label.
//   • extraBadge?: ReactNode    — arbitrary node rendered after the period
//                                  badge (e.g. "Last update: ...", date
//                                  filter chip).
//   • rightSlot?: ReactNode     — content rendered on the right side of the
//                                  header (e.g. Export Data card). When set,
//                                  the title block becomes flex-aligned.
//   • hideDivider?: boolean     — suppress the trailing <hr>.

import type { ReactNode } from "react";

export interface DashboardHeaderProps {
  title: ReactNode;
  sub?: ReactNode;
  /** Optional [yMin, yMax] tuple. When truthy, renders a small grey badge. */
  period?: [number | string, number | string] | null;
  /** Localizes the "Período/Period:" label of the period badge. Default "pt". */
  lang?: "pt" | "en";
  /** Extra inline badge/chip rendered after the period badge inside .page-header-sub. */
  extraBadge?: ReactNode;
  /** Optional right-side content (e.g. Export panel). Header becomes a flex row. */
  rightSlot?: ReactNode;
  /** Suppress the bottom divider — useful when the page draws its own section title right after. */
  hideDivider?: boolean;
}

export default function DashboardHeader({
  title,
  sub,
  period,
  lang = "pt",
  extraBadge,
  rightSlot,
  hideDivider = false,
}: DashboardHeaderProps) {
  const showPeriod = period != null;
  const periodLabel = lang === "en" ? "Period" : "Período";

  const titleBlock = (
    <div className="mb-2">
      <div className="page-header-title">{title}</div>
      {(sub || showPeriod || extraBadge) && (
        <div className="page-header-sub">
          {sub}
          {showPeriod && (
            <span style={{ marginLeft: 12, fontSize: 11, color: "#888" }}>
              {periodLabel}: {period![0]}–{period![1]}
            </span>
          )}
          {extraBadge}
        </div>
      )}
    </div>
  );

  return (
    <>
      {rightSlot ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 12,
          }}
        >
          {titleBlock}
          {rightSlot}
        </div>
      ) : (
        titleBlock
      )}
      {!hideDivider && (
        <hr style={{ borderTop: "2px solid #e0e0e0", marginBottom: 12 }} />
      )}
    </>
  );
}
