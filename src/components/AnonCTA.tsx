"use client";

// Shared banner shown on dashboards that have an anonymous read-only view
// (e.g. /stocks, /news-hunter) inviting visitors to sign in for the full
// experience. Visual language follows the brand palette (#ff5000) with a
// subtle tinted card so it does not overpower the dashboard content.

import Link from "next/link";

const BRAND_ORANGE = "#ff5000";

export interface AnonCTAProps {
  /** Short rationale shown to the visitor (e.g. "Sign in to create your own portfolio"). */
  message: string;
  /** Button label. Defaults to "Sign in". */
  ctaText?: string;
  /** Link destination. Defaults to "/login". */
  ctaHref?: string;
}

export default function AnonCTA({
  message,
  ctaText = "Sign in",
  ctaHref = "/login",
}: AnonCTAProps): React.ReactElement {
  return (
    <div
      role="region"
      aria-label="Sign-in invitation"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 16px",
        margin: "12px 0",
        borderRadius: 8,
        background: "rgba(255, 80, 0, 0.08)",
        border: "1px solid rgba(255, 80, 0, 0.25)",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 14,
        color: "#1a1a1a",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: BRAND_ORANGE,
          color: "#fff",
          flexShrink: 0,
          fontWeight: 700,
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
      </span>
      <span style={{ flex: 1, lineHeight: 1.4 }}>{message}</span>
      <Link
        href={ctaHref}
        style={{
          display: "inline-block",
          padding: "6px 14px",
          borderRadius: 6,
          background: BRAND_ORANGE,
          color: "#fff",
          fontWeight: 600,
          textDecoration: "none",
          fontSize: 13,
          whiteSpace: "nowrap",
        }}
      >
        {ctaText}
      </Link>
    </div>
  );
}
