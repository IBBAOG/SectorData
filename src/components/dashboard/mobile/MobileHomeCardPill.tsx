"use client";

// MobileHomeCardPill — capsule launcher used by the /home v2 mobile layout
// (Onda 2 of the mobile reform, see plan § 4.1).
//
// Visual recipe:
//   • Full capsule (border-radius 999px)
//   • 1px translucent shine border (--mobile-glass-border)
//   • Liquid Glass background (--mobile-glass-bg) with subtle top gradient
//   • Title-only — Arial 15px / 600 weight / --mobile-text colour
//   • 14px vertical / 16px horizontal padding (touch target ≥ 48px tall)
//
// Behaviour:
//   • Wrapped in a Next.js <Link> so clicks route via the App Router.
//   • Active state delegated to the `.mobile-home-card-pill:active` rules in
//     globals.css (subtle scale + orange glow + accent border).
//   • Focus-visible delegated to globals.css (accent ring).
//
// Variants:
//   • "default" — full pill (used inside Oil & Gas / Fuel Distribution grid).
//   • "compact" — 40px tall, smaller font, used by the "Last visited" row
//     where horizontal density matters more than thumbprint reach.
//
// Why a dedicated component (not just inline JSX in mobile/View.tsx):
//   The /home layout reuses this shape ~13 times (5 Oil & Gas + 8 Fuel Dist)
//   plus the Last-visited row. Extracting keeps the View terse and ensures
//   any future redesign (e.g. accent-tinted dot per category) lands in one
//   place.

import Link from "next/link";

export type MobileHomeCardPillVariant = "default" | "compact";

export interface MobileHomeCardPillProps {
  /** Dashboard title — the only text shown on the pill. */
  title: string;
  /** Route to navigate to (e.g. /well-by-well). */
  href: string;
  /** Layout variant. Defaults to "default". */
  variant?: MobileHomeCardPillVariant;
  /** Optional accent dot colour (CSS color string). Defaults to none. */
  accentDot?: string;
  /** Optional click handler — fires before navigation (analytics, etc.). */
  onClick?: () => void;
}

export default function MobileHomeCardPill(
  props: MobileHomeCardPillProps,
): React.ReactElement {
  const { title, href, variant = "default", accentDot, onClick } = props;

  const isCompact = variant === "compact";

  return (
    <Link
      href={href}
      onClick={onClick}
      className="mobile-home-card-pill"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 10,
        width: "100%",
        minHeight: isCompact ? 40 : 48,
        padding: isCompact ? "8px 14px" : "12px 16px",
        borderRadius: 999,
        border: "1px solid var(--mobile-glass-border)",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 55%), var(--mobile-glass-bg)",
        WebkitBackdropFilter: "var(--mobile-glass-blur)",
        backdropFilter: "var(--mobile-glass-blur)",
        boxShadow: "var(--mobile-shadow-soft)",
        color: "var(--mobile-text)",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: isCompact ? 13 : 15,
        fontWeight: 600,
        letterSpacing: "0.01em",
        lineHeight: 1.2,
        textDecoration: "none",
        cursor: "pointer",
        // For "compact" pills in the horizontally-scrolling Last-visited row
        // we want intrinsic width based on content; for "default" pills inside
        // the 2-col grid we want full width.
        whiteSpace: isCompact ? "nowrap" : "normal",
      }}
    >
      {accentDot ? (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: accentDot,
            flex: "0 0 auto",
          }}
        />
      ) : null}
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          // 2-line clamp for the default grid (some titles are 18+ chars).
          display: "-webkit-box",
          WebkitLineClamp: isCompact ? 1 : 2,
          WebkitBoxOrient: "vertical" as const,
        }}
      >
        {title}
      </span>
    </Link>
  );
}
