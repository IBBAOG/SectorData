"use client";

// MobileStockGuidePill — rightmost floating shortcut in the bottom pill dock.
// Routes the visitor to /stock-guide from anywhere in the mobile app.
//
// Why this exists:
//   /stock-guide is mobile-eligible (it ships a mobile/View.tsx). Eduardo asked
//   for it to be reachable on mobile as a floating button next to News Hunter,
//   mirroring how the news feed got its own pill. It joins the dock as the
//   third pill (Home, News Hunter, Stock Guide) — 2026-06-02.
//
// Visual recipe (Liquid Glass v2):
//   Identical to MobileHomePill / MobileNewsHunterPill — same 64×56 capsule,
//   same blur, border and shadow stack. The only divergence is the icon
//   (StockGuideIcon — a candlestick chart, the equities-research identity glyph
//   also used by the /home tile) and the horizontal offset.
//
// Positioning:
//   Geometry is owned by `pillDock.ts` (single source of truth). All pills
//   anchor at `left: 50%` and translate by
//   `translateX(calc(-50% + var(--pill-offset)))`. The offset comes from
//   `pillOffset(pathname, "stock-guide")`; `null` means "hide on this route"
//   (we are on /stock-guide). See pillDock.ts § "Geometry" for the formula and
//   the per-route offset table (Stock Guide sits at +78 with 3 pills, +39 with
//   2).
//
// Behaviour:
//   • Hidden on /stock-guide (would be redundant) — same pattern Home/News use.
//     Trailing slashes / nested children tolerated by pillDock.
//   • Z-index 1000 (matches the other pills, sits below modals/sheets).
//   • SSR-safe: usePathname/useRouter are client-only; "use client" at top.
//   • Respects safe-area-inset-bottom on iOS.
//   • Visibility-by-role is NOT applied here — parity with MobileNewsHunterPill.
//     The module visibility guard inside /stock-guide itself handles auth
//     gating, which is the right layer. If an admin hides stock-guide from anon,
//     the pill still appears and tapping it routes via the guard inside the
//     page. Acceptable — no extra client-side complexity here.

import type { CSSProperties } from "react";
import { usePathname, useRouter } from "next/navigation";
import { StockGuideIcon } from "./icons";
import { PILL_W, PILL_H, pillOffset } from "./pillDock";

export interface MobileStockGuidePillProps {
  /** Override the route target. Defaults to /stock-guide. */
  href?: string;
  /** Accessible label. Defaults to "Stock Guide". */
  ariaLabel?: string;
  /** Force show even on /stock-guide. Mostly for previews. */
  forceVisible?: boolean;
}

export default function MobileStockGuidePill(
  props: MobileStockGuidePillProps = {},
): React.ReactElement | null {
  const {
    href = "/stock-guide",
    ariaLabel = "Stock Guide",
    forceVisible = false,
  } = props;
  const pathname = usePathname();
  const router = useRouter();

  // Geometry comes from pillDock — null means "hide on this route" (we are on
  // /stock-guide). The offset is exposed as the `--pill-offset` CSS custom
  // property so the `:active` rule in globals.css can re-use it without
  // duplicating route logic. See pillDock.ts § "Geometry".
  const offsetPx = pillOffset(pathname, "stock-guide", forceVisible);
  if (offsetPx === null) return null;

  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      aria-label={ariaLabel}
      className="mobile-stock-guide-pill"
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

          // Box model — matches the other pills exactly.
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

          // Liquid Glass v2 surface (identical to the other pills).
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
      <StockGuideIcon size={22} aria-hidden />
    </button>
  );
}
