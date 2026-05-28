"use client";

// MobileHomeRappiCard — Rappi-inspired pastel launcher tile used by the
// /home mobile gallery (mobile-only redesign, 2026-05-28).
//
// Three layout variants share a single component (driven by `variant`):
//
//   ┌──────────────────────────────────────┐  HERO (1 col of a 2-col grid,
//   │      🛢️                              │    ~ 168px tall on 360px)
//   │   .────.                              │  Big illustration top, label
//   │  ⟢ icon ⟣        ← decorative SVG     │  bottom-left in saturated
//   │   `────'         (oversized, low      │  brand colour. Pastel bg.
//   │                   opacity wash)       │
//   │   Brazil Production                   │
//   │   Production                          │
//   └──────────────────────────────────────┘
//
//   ┌──────────────────────────┐  SECONDARY (1 col of a 2x2 grid)
//   │  🪙                       │  Medium-sized pastel card. Smaller
//   │                           │  illustration top-right, label bottom.
//   │  Daily Production         │
//   └──────────────────────────┘
//
//   ┌──────────┐  QUICK (horizontal scroll row, fixed 96px wide)
//   │   ┌──┐    │  Neutral white card. Centred squared icon badge in a
//   │   │🛢️│    │  per-slug accent tint. 1-line label below.
//   │   └──┘    │
//   │  Label    │
//   └──────────┘
//
// Visual language:
//   • Border-radius generous (20px hero/secondary, 16px quick) per Rappi
//     mood-board.
//   • Subtle multi-layer shadow (Liquid Glass v2 compatible) — no heavy
//     elevation, lets the pastel breathe.
//   • Press feedback handled by `.mobile-home-rappi-tile:active` in
//     globals.css (scale 0.97 + tightened inner shadow).
//
// Adding a new dashboard:
//   1. Drop tokens into globals.css under the Rappi palette block:
//        --mobile-home-tile-<slug>-bg
//        --mobile-home-tile-<slug>-fg
//      (for quick variant: `-badge-bg` / `-badge-fg` instead).
//   2. Pick a slug-mapped illustration emoji or fall back to the SVG glyph
//      from `getModuleIcon` (already shared with desktop).

import Link from "next/link";
import type { ReactNode } from "react";

export type RappiCardVariant = "hero" | "secondary" | "quick";

export interface MobileHomeRappiCardProps {
  /** Destination route, e.g. /well-by-well. */
  href: string;
  /** Short label shown bottom-left (hero/secondary) or below icon (quick). */
  label: string;
  /** Optional second line for hero cards (e.g. a tag-line). */
  sublabel?: string;
  /**
   * Decorative illustration node. Hero/secondary: rendered large in the upper
   * area. Quick: rendered small inside the squared icon badge. Caller chooses
   * its own size by passing the right size prop to the icon factory.
   */
  illustration: ReactNode;
  /** Optional emoji adornment — drawn above/beside the illustration. */
  emoji?: string;
  /** Pastel background colour (CSS color string). */
  bgColor: string;
  /** Saturated foreground colour for the label + illustration tint. */
  fgColor: string;
  /** Layout flavour. */
  variant: RappiCardVariant;
  /** Optional click handler for analytics — fires before navigation. */
  onClick?: () => void;
}

// ── Dimensions per variant ────────────────────────────────────────────────
//
// All numbers picked from a 360px Android baseline (smallest mainstream
// viewport). Both the hero and secondary keep an aspect ratio close to
// 1 (square-ish) so the illustration anchors visually; quick cards are
// taller-than-wide capsules.

interface VariantSpec {
  minHeight: number;
  padding: string;
  radius: number;
  labelSize: number;
  labelWeight: number;
  sublabelSize: number;
  illustrationBoxHeight: number | undefined;
}

const VARIANT_SPEC: Record<RappiCardVariant, VariantSpec> = {
  hero: {
    minHeight: 168,
    padding: "16px 16px 14px",
    radius: 22,
    labelSize: 17,
    labelWeight: 800,
    sublabelSize: 12,
    illustrationBoxHeight: 96,
  },
  secondary: {
    minHeight: 116,
    padding: "12px 12px 10px",
    radius: 18,
    labelSize: 14,
    labelWeight: 700,
    sublabelSize: 11,
    illustrationBoxHeight: 60,
  },
  quick: {
    minHeight: 96,
    padding: "10px 8px 10px",
    radius: 16,
    labelSize: 11,
    labelWeight: 600,
    sublabelSize: 10,
    illustrationBoxHeight: undefined,
  },
};

export default function MobileHomeRappiCard(
  props: MobileHomeRappiCardProps,
): React.ReactElement {
  const {
    href,
    label,
    sublabel,
    illustration,
    emoji,
    bgColor,
    fgColor,
    variant,
    onClick,
  } = props;

  const spec = VARIANT_SPEC[variant];
  const isHero = variant === "hero";
  const isSecondary = variant === "secondary";
  const isQuick = variant === "quick";

  // Quick variant uses a white shell with a tinted inner badge instead of a
  // full pastel bg — fits the small "support" surface from the mood board.
  const cardBg = isQuick ? "var(--mobile-home-quick-bg)" : bgColor;
  const cardBorder = isQuick
    ? "1px solid var(--mobile-home-quick-border)"
    : "1px solid rgba(255, 255, 255, 0.55)";
  const cardShadow = isQuick
    ? "var(--mobile-home-quick-shadow)"
    : "0 4px 14px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.55)";

  return (
    <Link
      href={href}
      onClick={onClick}
      className="mobile-home-rappi-tile"
      data-rappi-variant={variant}
      aria-label={sublabel ? `${label} — ${sublabel}` : label}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: isQuick ? "center" : "space-between",
        alignItems: isQuick ? "center" : "stretch",
        width: "100%",
        minHeight: spec.minHeight,
        padding: spec.padding,
        borderRadius: spec.radius,
        background: cardBg,
        border: cardBorder,
        boxShadow: cardShadow,
        color: fgColor,
        fontFamily: "Arial, Helvetica, sans-serif",
        textDecoration: "none",
        cursor: "pointer",
        overflow: "hidden",
        // Quick cards anchor a fixed width inside the horizontal scroll row.
        flex: isQuick ? "0 0 96px" : undefined,
      }}
    >
      {/* ── Illustration zone ─────────────────────────────────────────── */}
      {isQuick ? (
        // Quick variant: centred squared icon badge above the label.
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 44,
            height: 44,
            borderRadius: 12,
            background: bgColor,
            color: fgColor,
            marginBottom: 8,
            boxShadow:
              "inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 1px 2px rgba(15, 23, 42, 0.06)",
          }}
        >
          {illustration}
        </span>
      ) : (
        // Hero/secondary: oversized illustration in the upper area, anchored
        // to the top-right so the bottom-left is free for the label block.
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: isHero ? 12 : 8,
            right: isHero ? 12 : 8,
            height: spec.illustrationBoxHeight,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // Wash the illustration with the saturated fg colour — lets a
            // single mono SVG read as part of the pastel composition.
            color: fgColor,
            opacity: 0.92,
          }}
        >
          {/* Stack the optional emoji behind the SVG for a 3D "icon hero"
              effect inspired by Rappi's mascots. The emoji bleeds slightly
              past the SVG and is dimmed to ~40% so it reads as a backdrop. */}
          {emoji && (
            <span
              style={{
                position: "absolute",
                fontSize: isHero ? 84 : 52,
                lineHeight: 1,
                opacity: 0.38,
                filter: "saturate(1.2)",
                transform: isHero
                  ? "translate(-6px, 4px) rotate(-6deg)"
                  : "translate(-2px, 2px) rotate(-4deg)",
                pointerEvents: "none",
              }}
            >
              {emoji}
            </span>
          )}
          <span
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: fgColor,
            }}
          >
            {illustration}
          </span>
        </div>
      )}

      {/* ── Label block ───────────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: isQuick ? "center" : "flex-start",
          textAlign: isQuick ? "center" : "left",
          gap: 2,
          maxWidth: "100%",
          // Hero/secondary: nudge the label to the very bottom so the big
          // illustration owns the top half.
          marginTop: isQuick ? 0 : "auto",
        }}
      >
        <span
          style={{
            color: isQuick ? "var(--mobile-text)" : fgColor,
            fontSize: spec.labelSize,
            fontWeight: spec.labelWeight,
            lineHeight: 1.15,
            letterSpacing: "-0.01em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: isQuick ? 2 : isSecondary ? 2 : 2,
            WebkitBoxOrient: "vertical" as const,
            wordBreak: "normal",
            overflowWrap: "break-word",
            // Quick cards need a width cap so the 2-line clamp activates.
            width: "100%",
          }}
        >
          {label}
        </span>
        {sublabel && !isQuick && (
          <span
            style={{
              color: fgColor,
              opacity: 0.7,
              fontSize: spec.sublabelSize,
              fontWeight: 600,
              lineHeight: 1.2,
              letterSpacing: "0.02em",
              textTransform: "uppercase",
            }}
          >
            {sublabel}
          </span>
        )}
      </div>
    </Link>
  );
}
