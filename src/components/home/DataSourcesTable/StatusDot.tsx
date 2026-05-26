"use client";

// StatusDot — coloured dot indicating fresh / stale / overdue status.
// Real-time sources receive the `.ds-pulse` CSS animation class.

import type { DataSource } from "../../../data/dataSources";
import type { SourceFreshness } from "./useDataSourcesFreshness";
import { deriveStatus, statusToTokenVar } from "./status";

export default function StatusDot({
  src,
  info,
}: {
  src: DataSource;
  info: SourceFreshness | undefined;
}): React.ReactElement {
  // Convert Date | null → string | null so the shared helper can consume it
  const lastUpdateStr = info?.lastUpdate ? info.lastUpdate.toISOString() : null;
  const status = deriveStatus(src, lastUpdateStr);
  const color = statusToTokenVar(status);
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
