"use client";

// Viewport router — picks desktop or mobile View based on useIsMobile().
// SSR-safe: returns false during server render + first paint, then flips
// after mount. Desktop renders first on mobile for a single frame (no
// hydration mismatch). See docs/app/dual-view-pattern.md § 2.

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function SalesVolumesPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
