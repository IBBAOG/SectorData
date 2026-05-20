"use client";

// Mobile chrome: a sticky liquid-glass top bar and a sticky liquid-glass
// bottom tab bar. These are composed independently so a dashboard page can
// adopt one without the other (e.g. show the top bar only).
//
// Visual source of truth:
//   mockups/stocks-mobile.html (.topbar, .tabbar)
//   mockups/home-mobile.html  (same chrome — verified consistent)
//
// Tokens used (defined in src/app/globals.css "Mobile design system"):
//   --mobile-glass-bg / --mobile-glass-border / --mobile-glass-blur
//   --mobile-glass-shadow
//   --mobile-topbar-h (56px)  --mobile-tabbar-h (64px)
//   --mobile-safe-top / --mobile-safe-bottom
//   --mobile-accent (#ff5000) for active tab + avatar
//   --mobile-text / --mobile-text-muted

import type { ReactNode } from "react";

// ---------------------------------------------------------------- Top bar ---

export interface MobileTopBarProps {
  /** Optional title rendered as a wordmark on the left. Defaults to nothing. */
  title?: ReactNode;
  /** Custom left slot (replaces title when provided). */
  leftSlot?: ReactNode;
  /** Custom right slot (replaces the default theme toggle / avatar block). */
  rightSlot?: ReactNode;
  /** When true, renders the default theme-toggle icon button on the right. */
  showThemeToggle?: boolean;
  /** Callback fired when the theme-toggle button is tapped. */
  onToggleTheme?: () => void;
  /** When true, renders a circular avatar bubble on the right. */
  showAvatar?: boolean;
  /** Initials shown inside the avatar bubble (max 2 chars recommended). */
  avatarInitials?: string;
  /** Accessibility label for the avatar (e.g. user's full name). */
  avatarLabel?: string;
}

export function MobileTopBar(props: MobileTopBarProps): React.ReactElement {
  const {
    title,
    leftSlot,
    rightSlot,
    showThemeToggle = false,
    onToggleTheme,
    showAvatar = false,
    avatarInitials,
    avatarLabel,
  } = props;

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        height: "var(--mobile-topbar-h)",
        padding: "0 16px",
        paddingTop: "var(--mobile-safe-top)",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        background: "var(--mobile-glass-bg)",
        WebkitBackdropFilter: "var(--mobile-glass-blur)",
        backdropFilter: "var(--mobile-glass-blur)",
        borderBottom: "1px solid var(--mobile-glass-border)",
        boxShadow: "var(--mobile-glass-shadow)",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div style={{ minWidth: 0 }}>
        {leftSlot ?? (
          <div
            style={{
              fontWeight: 700,
              fontSize: 17,
              letterSpacing: "0.04em",
              color: "var(--mobile-text)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {rightSlot}
        {showThemeToggle && (
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Toggle theme"
            style={{
              width: 44,
              height: 44,
              border: 0,
              background: "transparent",
              color: "var(--mobile-text-muted)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              cursor: "pointer",
              transition: "background 0.15s ease, color 0.15s ease",
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          </button>
        )}
        {showAvatar && avatarInitials && (
          <div
            aria-label={avatarLabel}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "var(--mobile-accent)",
              color: "#fff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: "0.04em",
              boxShadow:
                "0 1px 0 rgba(255, 255, 255, 0.25) inset, 0 0 0 2px var(--mobile-surface)",
            }}
          >
            {avatarInitials.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
    </header>
  );
}

// --------------------------------------------------------- Bottom tab bar ---

export interface MobileBottomTab {
  key: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
}

export interface MobileBottomTabBarProps {
  tabs: MobileBottomTab[];
  onChange?: (key: string) => void;
  /** Phone-shell max-width — defaults to 428px to match the mockups. */
  maxWidth?: number;
}

export function MobileBottomTabBar(
  props: MobileBottomTabBarProps,
): React.ReactElement {
  const { tabs, onChange, maxWidth = 428 } = props;

  return (
    <nav
      aria-label="Primary"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        background: "var(--mobile-glass-bg)",
        WebkitBackdropFilter: "var(--mobile-glass-blur)",
        backdropFilter: "var(--mobile-glass-blur)",
        borderTop: "1px solid var(--mobile-glass-border)",
        boxShadow: "0 -2px 12px rgba(0, 0, 0, 0.05)",
        paddingBottom: "var(--mobile-safe-bottom)",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: `repeat(${tabs.length}, 1fr)`,
          height: "var(--mobile-tabbar-h)",
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange?.(tab.key)}
            aria-current={tab.active ? "page" : undefined}
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              background: "transparent",
              border: 0,
              color: tab.active
                ? "var(--mobile-accent)"
                : "var(--mobile-text-muted)",
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              minHeight: 44,
              padding: 0,
            }}
          >
            {tab.active && (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 0,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 28,
                  height: 2,
                  background: "var(--mobile-accent)",
                  borderRadius: "0 0 2px 2px",
                }}
              />
            )}
            <span
              aria-hidden="true"
              style={{
                width: 22,
                height: 22,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {tab.icon}
            </span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
