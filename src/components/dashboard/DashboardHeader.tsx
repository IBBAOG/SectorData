"use client";

// Standard page header for dashboard modules.
//
// Renders the same .page-header-title / .page-header-sub structure used
// across Phase 3 dashboards, plus an optional "Período: yMin–yMax" badge
// and the divider <hr> beneath. Visual output matches the previous inline
// markup byte-for-byte.

import type { ReactNode } from "react";

export interface DashboardHeaderProps {
  title: string;
  sub?: ReactNode;
  /** Optional [yMin, yMax] tuple. When truthy, renders a small grey badge. */
  period?: [number | string, number | string] | null;
}

export default function DashboardHeader({ title, sub, period }: DashboardHeaderProps) {
  const showPeriod = period != null;
  return (
    <>
      <div className="mb-2">
        <div className="page-header-title">{title}</div>
        {(sub || showPeriod) && (
          <div className="page-header-sub">
            {sub}
            {showPeriod && (
              <span style={{ marginLeft: 12, fontSize: 11, color: "#888" }}>
                Período: {period![0]}–{period![1]}
              </span>
            )}
          </div>
        )}
      </div>
      <hr style={{ borderTop: "2px solid #e0e0e0", marginBottom: 12 }} />
    </>
  );
}
