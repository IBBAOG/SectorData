"use client";

// MobileNewsHunterPill — second floating shortcut, paired with MobileHomePill.
// Routes the visitor to /news-hunter from anywhere in the mobile app.
//
// Why this exists:
//   /news-hunter became mobile-eligible (commit 26fffd40 on main). Eduardo
//   asked for a persistent shortcut to the news feed — a sibling of the Home
//   pill rather than a buried tile in /home. It sits on the same floating row
//   so the two primary affordances (Home, News) are equally tappable.
//
// Visual recipe (Liquid Glass v2):
//   Identical to MobileHomePill — same diameter (64×56 capsule), same blur,
//   same border, same shadow stack. The only divergence is the icon
//   (NewspaperIcon) and the horizontal offset so the two pills sit side-by-
//   side instead of overlapping at the viewport center.
//
// Positioning math (paired layout):
//   Home pill is anchored at `left: 50%` then `translateX(-50%)` — i.e. its
//   geometric center sits on the viewport vertical centerline.
//   This pill is anchored at `left: 50%` then `translateX(calc(-50% + offset))`
//   where `offset` = (PILL_W / 2) + GAP + (PILL_W / 2) = PILL_W + GAP, so the
//   inner edges of the two pills are GAP px apart. With PILL_W=64 and GAP=14
//   that puts this pill's center 78px to the right of the Home pill's center.
//   Both pills share the same `bottom` so the row is visually balanced.
//
// Behaviour:
//   • Hidden on /news-hunter (would be redundant) — same pattern Home uses
//     for /home. Tolerates trailing slashes and nested children.
//   • Z-index 1000 (matches Home pill, sits below modals/sheets).
//   • SSR-safe: usePathname/useRouter are client-only; "use client" at top.
//   • Respects safe-area-inset-bottom on iOS.
//   • Visibility-by-role is NOT applied here — the module visibility guard
//     inside /news-hunter itself handles auth gating, and that is the right
//     layer. If an admin hides news-hunter from anon, the pill still appears
//     and tapping it routes via the redirect inside the page. Acceptable —
//     no extra client-side complexity here.

import { usePathname, useRouter } from "next/navigation";
import { NewspaperIcon } from "./icons";

const PILL_W = 64;
const PILL_H = 56;
// Visual gap between the two pills' inner edges, in pixels.
const GAP = 14;
// Distance to offset this pill's center from the viewport center.
// PILL_W + GAP places the inner edges GAP px apart.
const CENTER_OFFSET = PILL_W + GAP;

export interface MobileNewsHunterPillProps {
  /** Override the route target. Defaults to /news-hunter. */
  href?: string;
  /** Accessible label. Defaults to "News Hunter". */
  ariaLabel?: string;
  /** Force show even on /news-hunter. Mostly for previews. */
  forceVisible?: boolean;
}

export default function MobileNewsHunterPill(
  props: MobileNewsHunterPillProps = {},
): React.ReactElement | null {
  const {
    href = "/news-hunter",
    ariaLabel = "News Hunter",
    forceVisible = false,
  } = props;
  const pathname = usePathname();
  const router = useRouter();

  // Hide when already on /news-hunter — the pill would just be a no-op.
  const onNewsHunter =
    !!pathname &&
    (pathname === "/news-hunter" || pathname.startsWith("/news-hunter/"));
  if (onNewsHunter && !forceVisible) return null;

  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      aria-label={ariaLabel}
      className="mobile-news-hunter-pill"
      style={{
        // Positioning — fixed, offset to the right of the Home pill, sitting
        // above safe-area inset. See "Positioning math" in the header comment.
        position: "fixed",
        left: "50%",
        bottom: `calc(24px + ${"var(--mobile-safe-bottom)"})`,
        transform: `translateX(calc(-50% + ${CENTER_OFFSET}px))`,
        zIndex: 1000,

        // Box model — matches Home pill exactly.
        width: PILL_W,
        height: PILL_H,
        minWidth: PILL_W,
        minHeight: PILL_H,
        padding: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",

        // Shape — full capsule.
        borderRadius: 999,

        // Liquid Glass v2 surface (identical to Home pill).
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0) 50%), var(--mobile-glass-bg)",
        WebkitBackdropFilter: "var(--mobile-glass-blur)",
        backdropFilter: "var(--mobile-glass-blur)",
        border: "1px solid var(--mobile-glass-border)",
        boxShadow: "var(--mobile-glass-shadow)",

        // Foreground.
        color: "var(--mobile-text)",
        fontFamily: "Arial, Helvetica, sans-serif",
        cursor: "pointer",

        // Motion.
        transition:
          "transform 0.18s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.18s cubic-bezier(0.4, 0, 0.2, 1), background 0.18s ease",
      }}
    >
      <NewspaperIcon size={22} aria-hidden />
    </button>
  );
}
