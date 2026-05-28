"use client";

// MobileHomeIconTile — bento launcher used by the /home mobile gallery
// (Onda 5 of the mobile reform — visual refresh, 2026-05-28).
//
// History:
//   • Onda 5 introduced the horizontal tile (icon-left 44×44 + label right).
//   • Onda 7.1 attempted a vertical redesign (icon-on-top + centered label,
//     3-line clamp) to fit long titles. Eduardo rejected it: tiles too tall,
//     icon-on-top looked odd, centered label was awkward.
//   • Onda 7.2 (current) reverts to the horizontal layout and instead solves
//     the truncation problem by shortening the LONG titles on mobile only
//     via `mobileLabel` overrides in `mobileHomeTiles.tsx`. Desktop labels
//     stay untouched.
//
// Visual recipe (default variant — horizontal):
//
//   ┌─────────────────────────────────────────┐
//   │ ┌──────┐                                │
//   │ │ ICON │   Brazil Production            │   ← ~88px tall, full column width
//   │ │ 40×40│   (Arial 15px / 600 / dark)    │
//   │ └──────┘                                │
//   └─────────────────────────────────────────┘
//      ^                ^
//      40×40 squircle    14px gap
//      radius 12px       Arial 15/600 — left-aligned, clamps to 2 lines
//      tinted bg         No subtitle (minimalism per plan § 3.x)
//      ~24px icon
//      colour = tintFg
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
//   • "default" — full tile (~88px tall). Used inside the Oil & Gas / Fuel
//     Distribution 2-col grid in /home mobile.
//   • "compact" — 56px tall, 36×36 icon badge, slightly smaller title. Used
//     by the horizontally-scrolling "Last visited" row where horizontal
//     density matters more than fingerprint reach.

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

  // Icon-badge dimensions — 36×36 in both variants. Default used 40×40 in
  // earlier iterations but the extra 4px squeezed long titles into 3-line
  // overflow at 360px viewports (e.g. "Brazil Production", "Monthly
  // Production"). Dropping to 36 gives the label ~10px of breathing room
  // without visually shrinking the icon noticeably.
  const badgeSize = 36;
  const badgeRadius = isCompact ? 10 : 11;

  // Tile dimensions — ~84px tall default, 56px compact (still meets the 48×48
  // touch-target floor with margin).
  const tileMinHeight = isCompact ? 56 : 84;
  const tilePadding = isCompact ? "10px 12px" : "12px 12px";
  const tileGap = isCompact ? 10 : 10;
  const titleSize = isCompact ? 13 : 15;

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
        // Compact tiles in the horizontally-scrolling Last-visited row keep an
        // intrinsic min-width so the row paints distinct, non-shrunk targets.
        minWidth: isCompact ? 168 : undefined,
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
          // Subtle inner highlight gives the badge depth without competing
          // with the tile's Liquid Glass body.
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.08)",
        }}
      >
        {icon}
      </span>

      {/* ── Label column (left-aligned, 2-line clamp) ────────────────────── */}
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          minWidth: 0,
          flex: "1 1 auto",
          gap: 2,
        }}
      >
        <span
          style={{
            color: "var(--mobile-text)",
            fontSize: titleSize,
            fontWeight: 600,
            lineHeight: 1.2,
            letterSpacing: "-0.005em",
            // 2-line clamp keeps shortened titles ("D&G Margins",
            // "Brazil Production") fitting comfortably inside the tile.
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: isCompact ? 1 : 2,
            WebkitBoxOrient: "vertical" as const,
            whiteSpace: isCompact ? "nowrap" : "normal",
            wordBreak: "normal",
            overflowWrap: "break-word",
            width: "100%",
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
