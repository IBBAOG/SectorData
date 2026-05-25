"use client";

// Viewport-aware entry point for /imports-exports.
//
// useIsMobile is SSR-safe: returns `false` on server/first paint,
// flips after mount. Desktop View renders first on mobile for a single
// frame, then the mobile View takes over — no hydration mismatch.

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function ImportsExportsPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
