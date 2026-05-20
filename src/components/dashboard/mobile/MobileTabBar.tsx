"use client";

// Top segmented control used INSIDE a page (e.g. Active / Recent / Expected
// for navios-diesel, or Petroleum / Gas / Water for anp-cdp). NOT to be
// confused with `MobileBottomTabBar` which is the bottom nav.
//
// Visual source of truth:
//   mockups/navios-diesel-mobile.html (.seg / .seg-btn)
//   mockups/anp-cdp-mobile.html        (.product-tab segmented control)
//
// Two visual modes:
//   • "container" (default) — pill-cluster inside a rounded container, the
//     active tab gets brand orange background. Matches navios-diesel.
//   • "underline"           — minimal underline indicator under the active
//     tab, no container. Matches the underline style used in stocks range
//     pills when shrunk.
//
// Both modes animate the active highlight via a sliding indicator for smooth
// transitions. Implemented in pure CSS by toggling the active style on the
// selected child (no offset math required because we use flex 1).

import type { ReactNode } from "react";

export interface MobileTabBarTab {
  key: string;
  label: ReactNode;
  /** Optional badge (e.g. count) shown next to the label. */
  badge?: ReactNode;
}

export interface MobileTabBarProps {
  tabs: MobileTabBarTab[];
  activeKey: string;
  onChange: (key: string) => void;
  variant?: "container" | "underline";
  /** ARIA label for the tablist. */
  ariaLabel?: string;
}

export default function MobileTabBar(
  props: MobileTabBarProps,
): React.ReactElement {
  const {
    tabs,
    activeKey,
    onChange,
    variant = "container",
    ariaLabel = "Tab navigation",
  } = props;

  if (variant === "underline") {
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        style={{
          display: "flex",
          gap: 4,
          padding: "0 16px",
          borderBottom: "1px solid var(--mobile-divider)",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.key)}
              style={{
                position: "relative",
                flex: 1,
                minHeight: 40,
                padding: "0 12px",
                background: "transparent",
                border: 0,
                color: active
                  ? "var(--mobile-accent)"
                  : "var(--mobile-text-muted)",
                fontFamily: "inherit",
                fontSize: 13,
                fontWeight: active ? 700 : 600,
                cursor: "pointer",
                transition: "color 0.15s ease",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              {tab.label}
              {tab.badge}
              {active && (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: "20%",
                    right: "20%",
                    bottom: -1,
                    height: 2,
                    background: "var(--mobile-accent)",
                    borderRadius: "2px 2px 0 0",
                    transition: "left 0.2s ease, right 0.2s ease",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // container variant
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: "flex",
        gap: 6,
        margin: "0 16px",
        padding: 4,
        background: "var(--mobile-surface)",
        border: "1px solid var(--mobile-border)",
        borderRadius: "var(--mobile-radius-md)",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            style={{
              flex: "1 1 0",
              minHeight: 36,
              border: 0,
              background: active ? "var(--mobile-accent)" : "transparent",
              color: active ? "#fff" : "var(--mobile-text-muted)",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: 600,
              borderRadius: "var(--mobile-radius-sm)",
              cursor: "pointer",
              transition: "background 0.18s ease, color 0.18s ease",
              boxShadow: active
                ? "0 2px 8px rgba(255, 80, 0, 0.25)"
                : "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "0 10px",
            }}
          >
            {tab.label}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}
