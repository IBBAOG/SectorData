"use client";

// MobileHomeIconTile — bento launcher used by the /home mobile gallery
// (Onda 5 of the mobile reform — visual refresh, 2026-05-28).
//
// Replaces the previous capsule launcher (MobileHomeCardPill) with a
// horizontal tile that pairs a tinted squircle icon badge with the dashboard
// title — the layout adopted by every premium analytics app launcher in 2026
// (Apple Stocks, Robinhood, Bloomberg). The icon establishes identity at a
// glance; the title confirms the destination.
//
// Visual recipe (default variant — vertical layout since Onda 7.1, 2026-05-28):
//
//   ┌─────────────────────────┐
//   │       ┌──────┐          │
//   │       │ ICON │          │   ← 116px tall, full column width
//   │       │ 40×40│          │
//   │       └──────┘          │
//   │  Brazil Production      │   ← Arial 13.5/600, dark
//   │       Summary           │     up to 3 lines, centered
//   └─────────────────────────┘
//      ^                ^
//      40×40 squircle    Label below, full-width center-aligned
//      radius 12px       Arial 13.5/600 — clamps to 3 lines
//      tinted bg         No subtitle (minimalism per plan § 3.x)
//      22px icon
//      colour = tintFg
//
// Rationale for vertical (vs the original horizontal): at viewport 360–426px
// in a 2-col grid, horizontal tiles only afforded ~100px for the label,
// truncating "Brazil Production Summary", "Diesel & Gasoline Margins" and
// "Subsidy Tracker" with ellipsis. Going vertical hands the entire tile
// width (~150–190px) to the label, which now wraps cleanly in 2–3 lines for
// every dashboard in the gallery. The icon stays as the primary identity
// anchor on top.
//
// Layering (the tile itself):
//   • border-radius 16px (squircle)
//   • Liquid Glass background (--mobile-glass-bg) with subtle top sheen
//   • 1px shine-edge border (--mobile-glass-border)
//   • Multi-layer shadow w/ inset top highlight (--mobile-glass-shadow)
//   • Press state: scale 0.97 + brand-orange glow (delegated to globals.css
//     selector .mobile-home-icon-tile:active)
//   • Focus-visible: 2px brand-orange ring (delegated to globals.css)
//
// Excluded variant:
//   When `excluded=true` (the dashboard is mobile-excluded — tapping the tile
//   triggers a redirect-to-home + toast via MobileExcludedRedirect mounted on
//   the destination page), we render the tile at opacity 0.82 with a tiny
//   "Desktop only" caption under the title. The tile remains tappable; the
//   excluded-redirect side-effect on the destination handles the UX bounce.
//
// Variants:
//   • "default" — full tile (88px tall). Used inside the Oil & Gas / Fuel
//     Distribution 2-col grid in /home mobile.
//   • "compact" — 56px tall, 36×36 icon badge, slightly smaller title. Used
//     by the horizontally-scrolling "Last visited" row where horizontal
//     density matters more than fingerprint reach.
//
// Why a dedicated component:
//   This shape is reused 13× in the /home grid + 4× in the Last-visited row.
//   Centralising it (and the colour palette + icon mapping it depends on)
//   guarantees a future palette refresh lands in exactly one place.

import Link from "next/link";
import type { ReactNode } from "react";

export type MobileHomeIconTileVariant = "default" | "compact";

export interface MobileHomeIconTileProps {
  /** Route to navigate to (e.g. /well-by-well). */
  href: string;
  /** Dashboard title — shown to the right of the icon. */
  title: string;
  /** Pre-sized SVG glyph (component expects ~24px at default, ~20px compact). */
  icon: ReactNode;
  /** Tile icon-container background colour (CSS color string, e.g. "#0c4a6e"). */
  tintBg: string;
  /** Icon foreground colour. Defaults to white. */
  tintFg?: string;
  /** Layout variant. Defaults to "default". */
  variant?: MobileHomeIconTileVariant;
  /** When true, dim the tile and show a "Desktop only" caption. */
  excluded?: boolean;
  /** Optional click handler — fires before navigation (analytics, etc.). */
  onClick?: () => void;
}

export default function MobileHomeIconTile(
  props: MobileHomeIconTileProps,
): React.ReactElement {
  const {
    href,
    title,
    icon,
    tintBg,
    tintFg = "#ffffff",
    variant = "default",
    excluded = false,
    onClick,
  } = props;

  const isCompact = variant === "compact";

  // Compact variant keeps the horizontal layout (used by the Last-visited row
  // where horizontal density matters). Default variant is now vertical
  // (icon-on-top, label below) so long titles get the full tile width.
  if (isCompact) {
    const badgeSize = 36;
    const badgeRadius = 10;
    const tileMinHeight = 56;
    const tilePadding = "10px 12px";
    const tileGap = 10;
    const titleSize = 13;

    return (
      <Link
        href={href}
        onClick={onClick}
        className="mobile-home-icon-tile"
        data-excluded={excluded ? "true" : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: tileGap,
          width: "100%",
          minHeight: tileMinHeight,
          padding: tilePadding,
          borderRadius: 16,
          border: "1px solid var(--mobile-glass-border)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 55%), var(--mobile-glass-bg)",
          WebkitBackdropFilter: "var(--mobile-glass-blur)",
          backdropFilter: "var(--mobile-glass-blur)",
          boxShadow: "var(--mobile-glass-shadow)",
          color: "var(--mobile-text)",
          fontFamily: "Arial, Helvetica, sans-serif",
          textDecoration: "none",
          cursor: "pointer",
          opacity: excluded ? 0.82 : 1,
          minWidth: 168,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            flex: "0 0 auto",
            width: badgeSize,
            height: badgeSize,
            borderRadius: badgeRadius,
            background: tintBg,
            color: tintFg,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.08)",
          }}
        >
          {icon}
        </span>
        <span
          style={{
            color: "var(--mobile-text)",
            fontSize: titleSize,
            fontWeight: 600,
            lineHeight: 1.2,
            letterSpacing: "-0.005em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: "1 1 auto",
            minWidth: 0,
          }}
        >
          {title}
        </span>
      </Link>
    );
  }

  // ── Default (vertical) variant ───────────────────────────────────────────
  // Icon-badge dimensions — 40×40 squircle on top.
  const badgeSize = 40;
  const badgeRadius = 12;
  // Tile dimensions — 116px tall (icon 40 + gap 10 + 3-line label headroom).
  const tileMinHeight = 116;
  const titleSize = 13.5;

  return (
    <Link
      href={href}
      onClick={onClick}
      className="mobile-home-icon-tile"
      data-excluded={excluded ? "true" : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 10,
        width: "100%",
        minHeight: tileMinHeight,
        padding: "14px 10px 12px",
        borderRadius: 16,
        border: "1px solid var(--mobile-glass-border)",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 55%), var(--mobile-glass-bg)",
        WebkitBackdropFilter: "var(--mobile-glass-blur)",
        backdropFilter: "var(--mobile-glass-blur)",
        boxShadow: "var(--mobile-glass-shadow)",
        color: "var(--mobile-text)",
        fontFamily: "Arial, Helvetica, sans-serif",
        textDecoration: "none",
        cursor: "pointer",
        opacity: excluded ? 0.82 : 1,
        textAlign: "center",
      }}
    >
      {/* ── Icon badge (tinted squircle) ─────────────────────────────────── */}
      <span
        aria-hidden="true"
        style={{
          flex: "0 0 auto",
          width: badgeSize,
          height: badgeSize,
          borderRadius: badgeRadius,
          background: tintBg,
          color: tintFg,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.08)",
        }}
      >
        {icon}
      </span>

      {/* ── Label (centered below the icon, up to 3 lines) ────────────────── */}
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          minWidth: 0,
          width: "100%",
          gap: 2,
        }}
      >
        <span
          style={{
            color: "var(--mobile-text)",
            fontSize: titleSize,
            fontWeight: 600,
            lineHeight: 1.25,
            letterSpacing: "-0.005em",
            // 3-line clamp accommodates "Brazil Production Summary",
            // "Diesel & Gasoline Margins", "Subsidy Tracker" etc. at the
            // narrowest viewport (360px → ~150px tile width).
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical" as const,
            whiteSpace: "normal",
            wordBreak: "normal",
            overflowWrap: "break-word",
            hyphens: "auto",
            width: "100%",
            textAlign: "center",
          }}
        >
          {title}
        </span>
        {excluded && (
          <span
            style={{
              color: "var(--mobile-text-faint)",
              fontSize: 11,
              fontWeight: 500,
              lineHeight: 1.2,
              letterSpacing: "0.02em",
            }}
          >
            Desktop only
          </span>
        )}
      </span>
    </Link>
  );
}
