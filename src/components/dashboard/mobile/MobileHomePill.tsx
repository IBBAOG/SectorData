"use client";

// MobileHomePill — the single floating primary-nav action for the mobile reform
// (2026-05-27, Onda 1). One Liquid-Glass capsule, centered at the bottom of the
// viewport, always tappable, routes to /home.
//
// Why this exists:
//   The mobile reform replaces the 4-icon bottom tab bar (Overview / Compare /
//   Filters / Profile) with a single "always-tappable home" affordance — see
//   plan § 3.2 "Bottom bar shape — single Home pill". Drill-up still happens
//   via the contextual chevron in the header (worker_subgerente-app owns that),
//   but the pill is the universal escape hatch back to /home from anywhere.
//
// Visual recipe (Liquid Glass v2):
//   • Frosted blur 18px, saturate 180% (var(--mobile-glass-blur))
//   • Translucent shine border 1px (var(--mobile-glass-border))
//   • Multi-layer shadow including inner highlight (var(--mobile-glass-shadow))
//   • Subtle white-to-transparent gradient on top edge for glassy refraction
//   • Active press: orange glow halo using --mobile-accent-glow
//
// Touch target:
//   The visible pill is 64×56 (≈mid-fab), but the ::before pseudo-element
//   extends the hit area to ≥48px in every direction (effective 64×60 surface
//   with a 20px outer halo of invisible padding via padding/margin trick).
//
// Positioning:
//   The Home pill is the leftmost member of the bottom pill dock (Home, News
//   Hunter, Stock Guide as of 2026-06-02). Geometry is owned by `pillDock.ts`
//   (single source of truth). All pills anchor at `left: 50%` and translate by
//   `translateX(calc(-50% + var(--pill-offset)))`; the offset comes from
//   `pillOffset(pathname, "home")`. `null` means "hide on this route" (we are
//   on /home). See pillDock.ts § "Geometry" for the formula and the per-route
//   offset table (Home sits at −78 with 3 pills, −39 with 2).
//
// Behaviour:
//   • Hidden on /home (would be redundant). usePathname() drives the gate.
//   • Z-index 1000 → sits above content, below modals/sheets (which use
//     z-index 45/50 in BottomSheet). The pill is intentionally "below" any
//     modal scrim so users can't accidentally double-tap into a hidden /home.
//     Modals/sheets are interactive; the pill should yield to them.
//     (If a future bottom sheet uses z-index higher than 1000, it still wins.)
//   • SSR-safe: usePathname is a client-only hook; "use client" directive at top.
//   • Respects safe-area-inset-bottom on iOS (notch / home indicator).

import type { CSSProperties } from "react";
import { usePathname, useRouter } from "next/navigation";
import { HomeIcon } from "./icons";
import { PILL_W, PILL_H, pillOffset } from "./pillDock";

export interface MobileHomePillProps {
  /** Override the route target. Defaults to /home. */
  href?: string;
  /** Accessible label. Defaults to "Go to home". */
  ariaLabel?: string;
  /** Force show even on /home. Mostly for previews. */
  forceVisible?: boolean;
}

export default function MobileHomePill(
  props: MobileHomePillProps = {},
): React.ReactElement | null {
  const { href = "/home", ariaLabel = "Go to home", forceVisible = false } = props;
  const pathname = usePathname();
  const router = useRouter();

  // Geometry comes from pillDock — null means "hide on this route" (we are on
  // /home). The offset is exposed as the `--pill-offset` CSS custom property so
  // the `:active` rule in globals.css can re-use it without duplicating route
  // logic. See pillDock.ts § "Geometry".
  const offsetPx = pillOffset(pathname, "home", forceVisible);
  if (offsetPx === null) return null;

  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      aria-label={ariaLabel}
      className="mobile-home-pill"
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

          // Box model — 64×56 visible pill with extra invisible hit-padding.
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

          // Liquid Glass v2 surface.
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
      <HomeIcon size={24} aria-hidden />
    </button>
  );
}
