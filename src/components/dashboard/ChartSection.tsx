"use client";

// Standard chart container used in Phase 3 dashboards.
//
// Replaces the repeated pattern:
//   <div className="chart-container" style={{ position: "relative" }}>
//     <div className="section-title">
//       {title}
//       {loading && <span style={...}>atualizando…</span>}
//     </div>
//     <hr className="section-hr" />
//     <PlotlyChart ... style={{ ..., opacity: loading ? 0.5 : 1 }} />
//   </div>
//
// Children render area gets `position: relative` and the dim-on-loading
// overlay via `opacity: 0.5`. Inner PlotlyChart should NOT manage its own
// loading opacity any more — it inherits from this wrapper.

import type { ReactNode } from "react";

export interface ChartSectionProps {
  title: ReactNode;
  loading?: boolean;
  height?: number;
  children: ReactNode;
  /** Extra className for the outer .chart-container wrapper. */
  className?: string;
  /** Optional additional style overrides for the wrapper. */
  containerStyle?: React.CSSProperties;
  /** Hide the "atualizando…" suffix even when loading is true. Default false. */
  hideLoadingHint?: boolean;
}

export default function ChartSection({
  title,
  loading = false,
  height = 300,
  children,
  className,
  containerStyle,
  hideLoadingHint = false,
}: ChartSectionProps) {
  const wrapperClass = ["chart-container", className].filter(Boolean).join(" ");
  return (
    <div className={wrapperClass} style={{ position: "relative", ...containerStyle }}>
      <div className="section-title">
        {title}
        {loading && !hideLoadingHint && (
          <span style={{ marginLeft: 10, fontSize: 11, color: "#aaa", fontWeight: 400 }}>
            atualizando…
          </span>
        )}
      </div>
      <hr className="section-hr" />
      <div
        style={{
          position: "relative",
          opacity: loading ? 0.5 : 1,
          minHeight: height,
        }}
      >
        {children}
      </div>
    </div>
  );
}
