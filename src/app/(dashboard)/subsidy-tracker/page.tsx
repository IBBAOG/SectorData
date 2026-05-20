"use client";

// Viewport-aware entry point for /subsidy-tracker.
//
// useIsMobile is SSR-safe: returns false on the server and first client paint,
// then flips to the real breakpoint value after mount. Desktop View renders
// for one frame on mobile — acceptable trade-off to avoid hydration mismatches.

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function SubsidyTrackerPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
