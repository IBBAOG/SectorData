"use client";

// Horizontal-scroll breadcrumb. Designed for drill-down navigation (e.g.
// ANP CDP: Country › Basin › Field › Well), but also useful for any
// hierarchical context surface.
//
// Visual source of truth: mockups/anp-cdp-mobile.html (.breadcrumb)
//
// Behaviour:
//   • Pills are taps that can re-root the user higher up the tree.
//   • The active segment uses brand orange.
//   • A trailing × reset button appears when `onReset` is provided.
//   • Sticky by default (top: --mobile-topbar-h). Pass sticky={false} to
//     opt out (e.g. when rendered inside a non-sticky region).

import type { ReactNode } from "react";

export interface BreadcrumbSegment {
  label: string;
  /** Tap handler to navigate back to this level (no-op for the last item). */
  onClick?: () => void;
  /** Marks the segment as the current/active one. */
  active?: boolean;
  /** Optional leading icon (e.g. flag emoji or small svg). */
  leading?: ReactNode;
}

export interface StickyBreadcrumbProps {
  segments: BreadcrumbSegment[];
  onReset?: () => void;
  sticky?: boolean;
  /** Top offset for the sticky position. Defaults to --mobile-topbar-h. */
  top?: string;
  /** Optional override for the separator character. Defaults to "›". */
  separator?: string;
}

export default function StickyBreadcrumb(
  props: StickyBreadcrumbProps,
): React.ReactElement {
  const {
    segments,
    onReset,
    sticky = true,
    top = "var(--mobile-topbar-h)",
    separator = "›", // ›
  } = props;

  return (
    <nav
      aria-label="Drill-down breadcrumb"
      style={{
        position: sticky ? "sticky" : "relative",
        top: sticky ? top : undefined,
        zIndex: sticky ? 25 : undefined,
        height: 40,
        padding: "0 12px 0 16px",
        background: "var(--mobile-glass-bg)",
        WebkitBackdropFilter: "var(--mobile-glass-blur)",
        backdropFilter: "var(--mobile-glass-blur)",
        borderBottom: "1px solid var(--mobile-glass-border)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        overflowX: "auto",
        overflowY: "hidden",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
        whiteSpace: "nowrap",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {segments.map((seg, idx) => {
        const isLast = idx === segments.length - 1;
        return (
          <span
            key={`${seg.label}-${idx}`}
            style={{ display: "inline-flex", alignItems: "center" }}
          >
            <button
              type="button"
              onClick={seg.onClick}
              disabled={!seg.onClick}
              style={{
                flex: "0 0 auto",
                padding: "4px 8px",
                border: 0,
                background: "transparent",
                color: seg.active
                  ? "var(--mobile-accent)"
                  : "var(--mobile-text-muted)",
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: 600,
                cursor: seg.onClick ? "pointer" : "default",
                borderRadius: 6,
                minHeight: 28,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {seg.leading}
              {seg.label}
            </button>
            {!isLast && (
              <span
                aria-hidden="true"
                style={{
                  flex: "0 0 auto",
                  color: "var(--mobile-text-faint)",
                  fontSize: 13,
                  padding: "0 2px",
                  pointerEvents: "none",
                }}
              >
                {separator}
              </span>
            )}
          </span>
        );
      })}

      {onReset && (
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset drill-down"
          style={{
            flex: "0 0 auto",
            marginLeft: "auto",
            width: 28,
            height: 28,
            border: 0,
            background: "var(--mobile-row-press)",
            color: "var(--mobile-text-muted)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            cursor: "pointer",
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </nav>
  );
}
