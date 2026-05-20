"use client";

// Floating Action Button (FAB). Default action is "export" (download icon
// + brand orange glow), but the icon and label are customisable for any
// primary CTA that should float over the page content.
//
// Visual source of truth:
//   mockups/market-share-mobile.html (.fab, geometry-aligned for desktop preview)
//   mockups/navios-diesel-mobile.html (.fab, smaller offset variant)
//   mockups/news-hunter-mobile.html  (.fab, action = "Add keyword")
//
// Position:
//   The right offset uses the same trick as market-share-mobile.html — when
//   the phone shell is centered on a wider viewport (preview / desktop), the
//   FAB hugs the right edge of the 428px column, not the screen edge:
//     right: max(16px, calc((100vw - 428px) / 2 + 16px))

import type { ReactNode } from "react";

export type ExportFABIcon = "download" | "plus" | "upload" | ReactNode;

export interface ExportFABProps {
  /** Icon rendered inside the button. Defaults to a download arrow. */
  icon?: ExportFABIcon;
  /** Optional visible label (renders to the left of the icon — pill style). */
  label?: string;
  onClick?: () => void;
  /** Which edge to anchor against. Defaults to "right". */
  position?: "right" | "left";
  /** When true, the FAB is non-interactive. */
  disabled?: boolean;
  /** Override the bottom offset (e.g. above a tab bar). Defaults to
   *  `calc(72px + safe-area + 16px)` — sits above the standard tab bar. */
  bottom?: string;
  /** Override the size in px. Defaults to 56. */
  size?: number;
  /** Optional ARIA label override; defaults to "Export" for the download icon. */
  ariaLabel?: string;
}

const DownloadIcon = (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const PlusIcon = (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const UploadIcon = (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 9v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9" />
    <polyline points="7 14 12 9 17 14" />
    <line x1="12" y1="9" x2="12" y2="21" />
  </svg>
);

function resolveIcon(icon: ExportFABIcon | undefined): ReactNode {
  if (!icon || icon === "download") return DownloadIcon;
  if (icon === "plus") return PlusIcon;
  if (icon === "upload") return UploadIcon;
  return icon;
}

export default function ExportFAB(
  props: ExportFABProps,
): React.ReactElement {
  const {
    icon,
    label,
    onClick,
    position = "right",
    disabled = false,
    bottom = `calc(72px + ${"var(--mobile-safe-bottom)"} + 16px)`,
    size = 56,
    ariaLabel,
  } = props;

  // Horizontal offset hugs the 428px phone-shell edge when previewed wider.
  const sideOffset =
    "max(16px, calc((100vw - 428px) / 2 + 16px))";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label ?? "Export"}
      style={{
        position: "fixed",
        [position]: sideOffset,
        bottom,
        zIndex: 35,
        height: size,
        minWidth: size,
        paddingLeft: label ? 18 : 0,
        paddingRight: label ? 20 : 0,
        borderRadius: label ? size / 2 : "50%",
        border: 0,
        background: "var(--mobile-accent)",
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: label ? 10 : 0,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        boxShadow: "var(--mobile-shadow-fab)",
        transition: "transform 0.12s ease, background 0.15s ease",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 14,
        fontWeight: 700,
      } as React.CSSProperties}
      onPointerDown={(e) => {
        if (disabled) return;
        (e.currentTarget as HTMLElement).style.transform = "scale(0.95)";
        (e.currentTarget as HTMLElement).style.background =
          "var(--mobile-accent-hover)";
      }}
      onPointerUp={(e) => {
        (e.currentTarget as HTMLElement).style.transform = "scale(1)";
        (e.currentTarget as HTMLElement).style.background =
          "var(--mobile-accent)";
      }}
      onPointerLeave={(e) => {
        (e.currentTarget as HTMLElement).style.transform = "scale(1)";
        (e.currentTarget as HTMLElement).style.background =
          "var(--mobile-accent)";
      }}
    >
      {resolveIcon(icon)}
      {label && <span>{label}</span>}
    </button>
  );
}
