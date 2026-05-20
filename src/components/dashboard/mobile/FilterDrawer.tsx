"use client";

// Specialised BottomSheet for filter UIs (the most common consumer of the
// sheet primitive). Renders title + close × at the top, dashboard-provided
// filter sections in the body, and a sticky Reset / Apply footer.
//
// Visual source of truth:
//   mockups/market-share-mobile.html  (.sheet-header / .sheet-footer)
//   mockups/anp-cdp-mobile.html        (filter sheet variant — same geometry)
//
// Consumers compose filter sections inside `children` (e.g. MultiSelectFilter,
// PeriodSlider, check-pill rows). This component owns the chrome only.

import type { ReactNode } from "react";

import BottomSheet from "./BottomSheet";

export interface FilterDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Title shown centered at the top. Defaults to "Filters". */
  title?: string;
  /** Reset handler — fires when the left-side Reset button is tapped. */
  onReset?: () => void;
  /** Apply handler — fires when the orange primary button is tapped.
   *  Note: this component does NOT auto-close; consumer decides. */
  onApply?: () => void;
  /** Label for the apply primary button. Defaults to "Apply filters". */
  applyLabel?: string;
  /** Label for the reset text button. Defaults to "Reset". */
  resetLabel?: string;
  /** Filter sections (typically MultiSelectFilter / PeriodSlider / chip rows). */
  children: ReactNode;
  /** Optional summary shown next to Apply (e.g. "3 selected · 12K rows"). */
  footerHint?: ReactNode;
}

export default function FilterDrawer(
  props: FilterDrawerProps,
): React.ReactElement {
  const {
    open,
    onClose,
    title = "Filters",
    onReset,
    onApply,
    applyLabel = "Apply filters",
    resetLabel = "Reset",
    children,
    footerHint,
  } = props;

  // Custom header (with close × on the right) replaces BottomSheet's default
  // centered title — we pass title={null} and prepend our own header to body.
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      height="auto"
      ariaLabel={title}
    >
      {/* Header row: Reset · Title · Close (mirrors the mockups exactly) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "60px 1fr 60px",
          alignItems: "center",
          gap: 8,
          paddingBottom: 12,
          marginBottom: 16,
          borderBottom: "1px solid var(--mobile-divider)",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <button
          type="button"
          onClick={onReset}
          disabled={!onReset}
          style={{
            background: "transparent",
            border: 0,
            color: "var(--mobile-text-muted)",
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 600,
            cursor: onReset ? "pointer" : "default",
            padding: "8px 0",
            textAlign: "left",
            minHeight: 36,
            opacity: onReset ? 1 : 0.5,
          }}
        >
          {resetLabel}
        </button>
        <h2
          style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 700,
            color: "var(--mobile-text)",
            textAlign: "center",
          }}
        >
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filters"
          style={{
            width: 36,
            height: 36,
            marginLeft: "auto",
            border: 0,
            background: "var(--mobile-divider)",
            color: "var(--mobile-text-muted)",
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
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
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {/* Caller-provided filter sections */}
      <div style={{ paddingBottom: 12 }}>{children}</div>

      {/* Sticky footer rendered manually inside the sheet body so we can keep
          the simpler BottomSheet API. Consumers that need different actions
          can use BottomSheet directly with a custom `footer` prop. */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: 16,
          marginLeft: -16,
          marginRight: -16,
          marginBottom: -16,
          padding: `12px 16px calc(12px + ${"var(--mobile-safe-bottom)"})`,
          borderTop: "1px solid var(--mobile-divider)",
          background: "var(--mobile-sheet-bg)",
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: 10,
          alignItems: "center",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <button
          type="button"
          onClick={onReset}
          disabled={!onReset}
          style={{
            minHeight: 44,
            padding: "0 18px",
            border: 0,
            background: "transparent",
            color: "var(--mobile-text-muted)",
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 600,
            cursor: onReset ? "pointer" : "default",
            borderRadius: 10,
            opacity: onReset ? 1 : 0.5,
          }}
        >
          {resetLabel}
        </button>
        <button
          type="button"
          onClick={onApply}
          style={{
            minHeight: 44,
            padding: "0 18px",
            border: 0,
            borderRadius: 12,
            background: "var(--mobile-accent)",
            color: "#fff",
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: "0.02em",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(255, 80, 0, 0.30)",
            transition: "transform 0.12s ease, box-shadow 0.12s ease",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <span>{applyLabel}</span>
          {footerHint && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                opacity: 0.85,
                background: "rgba(255, 255, 255, 0.18)",
                padding: "2px 8px",
                borderRadius: 999,
              }}
            >
              {footerHint}
            </span>
          )}
        </button>
      </div>
    </BottomSheet>
  );
}
