// ─── /navios-diesel — viewport router ────────────────────────────────────────
//
// Picks the correct View based on screen size:
//   ≥769px → desktop/View.tsx  (full sidebar, map, AIS layer)
//   ≤768px → mobile/View.tsx   (port scroller, vessel cards, bottom sheet detail)
//
// useIsMobile is SSR-safe: returns false during SSR + first paint, then flips
// to the real value after mount. The desktop View renders for a single frame
// on mobile — acceptable trade-off to avoid hydration mismatches.

"use client";

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function NaviosDieselPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
