"use client";

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

/**
 * Viewport-aware entry point for /diesel-gasoline-margins.
 *
 * useIsMobile is SSR-safe: returns false during server render and the first
 * client paint, then flips to the real value after mount. Desktop View renders
 * first on mobile for a single frame — no hydration mismatch.
 */
export default function DieselGasolineMarginsPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
