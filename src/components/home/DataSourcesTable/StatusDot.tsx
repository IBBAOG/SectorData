"use client";

// StatusDot — coloured dot indicating fresh / stale / overdue status.
// Real-time sources receive the `.ds-pulse` CSS animation class.

import type { DataSource } from "../../../data/dataSources";
import type { SourceFreshness } from "./useDataSourcesFreshness";

type Status = "fresh" | "stale" | "overdue" | "unknown";

function deriveStatus(
  src: DataSource,
  info: SourceFreshness | undefined,
): Status {
  if (!info || !info.lastUpdate) return "unknown";
  const ageMs = Date.now() - info.lastUpdate.getTime();
  const ageHours = ageMs / 3_600_000;
  if (ageHours < src.staleAfterHours) return "fresh";
  if (ageHours < src.overdueAfterHours) return "stale";
  return "overdue";
}

const STATUS_COLOR: Record<Status, string> = {
  fresh: "var(--ds-status-fresh)",
  stale: "var(--ds-status-stale)",
  overdue: "var(--ds-status-overdue)",
  unknown: "rgba(0,0,0,0.25)",
};

export default function StatusDot({
  src,
  info,
}: {
  src: DataSource;
  info: SourceFreshness | undefined;
}): React.ReactElement {
  const status = deriveStatus(src, info);
  const color = STATUS_COLOR[status];
  const pulse = src.isRealtime && status !== "overdue";

  return (
    <span
      title={status.charAt(0).toUpperCase() + status.slice(1)}
      className={pulse ? "ds-pulse" : undefined}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        color: color, // for the currentColor-based pulse ring
        flexShrink: 0,
      }}
    />
  );
}

// Re-export so callers can use it without knowing the internals
export { deriveStatus };
export type { Status };
