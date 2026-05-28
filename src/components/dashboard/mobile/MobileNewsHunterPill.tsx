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
//   (NewspaperIcon) and the horizontal offset relative to the viewport center.
//
// Positioning math (two modes — see "Why two modes" below):
//   Both pills are anchored at `left: 50%` and translated by
//   `translateX(calc(-50% + var(--pill-offset)))`. The `--pill-offset` CSS
//   custom property is set inline by each pill based on the active route:
//
//   ┌──────────────────┬─────────────────┬──────────────────────────────────┐
//   │ Route            │ Visible pills   │ News Hunter pill offset          │
//   ├──────────────────┼─────────────────┼──────────────────────────────────┤
//   │ /home            │ News Hunter     │  0px      (solo, centered)       │
//   │ /news-hunter     │ Home only       │  hidden   (n/a)                  │
//   │ everywhere else  │ Home + News     │  +39px    (paired, balanced)     │
//   └──────────────────┴─────────────────┴──────────────────────────────────┘
//
//   "Paired" offset = (PILL_W + GAP) / 2 = (64 + 14) / 2 = 39px, so that the
//   pair as a group is centered around the viewport vertical centerline with
//   GAP px between their inner edges. Home pill mirrors this with −39px.
//
// Why two modes:
//   On /home the Home pill auto-hides (would be a no-op). Before this change
//   the News Hunter pill stayed at its paired offset (+78px), which made the
//   only visible pill look off-center on /home. Switching to a route-aware
//   offset keeps the solo pill on the viewport centerline (the natural
//   resting position of any single floating action), while the paired layout
//   stays balanced as a group on every other route.
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

import type { CSSProperties } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NewspaperIcon } from "./icons";

const PILL_W = 64;
const PILL_H = 56;
// Visual gap between the two pills' inner edges in paired layout, in pixels.
const GAP = 14;
// Paired-mode offset from the viewport center.
// (PILL_W + GAP) / 2 keeps the inner edges GAP px apart AND centers the pair
// as a group around the viewport's vertical centerline.
const PAIRED_OFFSET = (PILL_W + GAP) / 2;

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

  // Mode resolution — solo on /home (Home pill is hidden there), paired on
  // every other route. The offset is exposed as a CSS custom property so the
  // `:active` rule in globals.css can re-use it without duplicating route
  // logic. See "Positioning math" in the header comment.
  const onHome =
    !!pathname && (pathname === "/home" || pathname.startsWith("/home/"));
  const offsetPx = onHome ? 0 : PAIRED_OFFSET;
  const positionMode = onHome ? "solo" : "paired";

  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      aria-label={ariaLabel}
      className="mobile-news-hunter-pill"
      data-position={positionMode}
      style={
        {
          // Positioning — fixed, route-aware offset, sitting above safe-area
          // inset. `--pill-offset` is the single source of truth; the :active
          // rule in globals.css reads the same variable to preserve the
          // horizontal placement during the press-scale animation.
          position: "fixed",
          left: "50%",
          bottom: `calc(24px + ${"var(--mobile-safe-bottom)"})`,
          "--pill-offset": `${offsetPx}px`,
          transform: "translateX(calc(-50% + var(--pill-offset)))",
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
        } as CSSProperties
      }
    >
      <NewspaperIcon size={22} aria-hidden />
    </button>
  );
}
