"use client";

// MobileNewsHunterPill — middle floating shortcut in the bottom pill dock.
// Routes the visitor to /news-hunter from anywhere in the mobile app.
//
// Why this exists:
//   /news-hunter became mobile-eligible (commit 26fffd40 on main). Eduardo
//   asked for a persistent shortcut to the news feed — a sibling of the Home
//   pill rather than a buried tile in /home. It sits on the same floating row
//   so the primary affordances are equally tappable. As of 2026-06-02 the row
//   holds three pills: Home, News Hunter, Stock Guide.
//
// Visual recipe (Liquid Glass v2):
//   Identical to MobileHomePill / MobileStockGuidePill — same 64×56 capsule,
//   same blur, border and shadow stack. The only divergence is the icon
//   (NewspaperIcon) and the horizontal offset relative to the viewport center.
//
// Positioning:
//   Geometry is owned by `pillDock.ts` (single source of truth). All pills
//   anchor at `left: 50%` and translate by
//   `translateX(calc(-50% + var(--pill-offset)))`. The offset comes from
//   `pillOffset(pathname, "news")`; `null` means "hide on this route" (we are
//   on /news-hunter). See pillDock.ts § "Geometry" for the formula and the
//   per-route offset table.
//
// Behaviour:
//   • Hidden on /news-hunter (would be redundant) — same pattern Home uses
//     for /home. Trailing slashes / nested children tolerated by pillDock.
//   • Z-index 1000 (matches the other pills, sits below modals/sheets).
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
import { PILL_W, PILL_H, pillOffset } from "./pillDock";

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

  // Geometry comes from pillDock — null means "hide on this route" (we are on
  // /news-hunter). The offset is exposed as the `--pill-offset` CSS custom
  // property so the `:active` rule in globals.css can re-use it without
  // duplicating route logic. See pillDock.ts § "Geometry".
  const offsetPx = pillOffset(pathname, "news", forceVisible);
  if (offsetPx === null) return null;

  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      aria-label={ariaLabel}
      className="mobile-news-hunter-pill"
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
