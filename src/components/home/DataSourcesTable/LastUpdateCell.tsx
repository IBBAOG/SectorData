"use client";

// LastUpdateCell — renders "2h ago", "3 days ago", "just now", etc.
// Falls back to "—" when lastUpdate is null (yahoo_finance, unknown).

interface LastUpdateCellProps {
  lastUpdate: Date | null;
  loading: boolean;
  /** When true and lastUpdate is null, renders a green "live" label.
   *  When false and lastUpdate is null, renders "—" (no data yet). */
  isRealtime: boolean;
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 60) return "just now";
  if (diffMinutes < 60)
    return diffMinutes === 1 ? "1 min ago" : `${diffMinutes} min ago`;
  if (diffHours < 24)
    return diffHours === 1 ? "1h ago" : `${diffHours}h ago`;
  if (diffDays < 14)
    return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
  if (diffWeeks < 8)
    return diffWeeks === 1 ? "1 week ago" : `${diffWeeks} weeks ago`;
  if (diffMonths < 24)
    return diffMonths === 1 ? "1 month ago" : `${diffMonths} months ago`;
  return diffYears === 1 ? "1 year ago" : `${diffYears} years ago`;
}

export default function LastUpdateCell({
  lastUpdate,
  loading,
  isRealtime,
}: LastUpdateCellProps): React.ReactElement {
  if (loading) {
    return (
      <span
        style={{
          fontSize: 12,
          color: "rgba(0,0,0,0.3)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        …
      </span>
    );
  }

  if (!lastUpdate) {
    // Only show "live" for sources explicitly marked as real-time.
    // Empty tables or RPC failures should not be mislabeled.
    if (isRealtime) {
      return (
        <span
          style={{
            fontSize: 12,
            color: "rgba(0,0,0,0.35)",
            fontVariantNumeric: "tabular-nums",
          }}
          title="Real-time — no stored timestamp"
        >
          live
        </span>
      );
    }
    return (
      <span
        style={{
          fontSize: 12,
          color: "rgba(0,0,0,0.25)",
          fontVariantNumeric: "tabular-nums",
        }}
        title="No data yet"
      >
        —
      </span>
    );
  }

  const relative = formatRelative(lastUpdate);
  const absolute = lastUpdate.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  return (
    <span
      title={absolute}
      style={{
        fontSize: 12,
        color: "#444",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {relative}
    </span>
  );
}
