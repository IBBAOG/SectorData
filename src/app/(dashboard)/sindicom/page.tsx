"use client";

// Viewport router for /sindicom.
// useIsMobile is SSR-safe: returns false on server / first paint, then flips
// after mount. Desktop renders first on mobile for a single frame (no
// hydration mismatch). See docs/app/dual-view-pattern.md § 2.

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function SindicomPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
