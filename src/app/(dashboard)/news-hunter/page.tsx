"use client";

// ─── /news-hunter — viewport router ──────────────────────────────────────────
//
// Detects viewport via useIsMobile (single breakpoint source: ≤768px) and
// routes to the appropriate View.
//
// useIsMobile is SSR-safe: returns `false` during server render and on the
// first client paint, then flips to the real value after mount. Desktop View
// renders first on mobile for a single frame — acceptable (avoids hydration
// mismatches entirely). This matches the pattern in template-module/page.tsx.
//
// Data lives in NewsHunterContext (mounted at dashboard layout level) and is
// surfaced to both Views through useNewsHunterData.
// ─────────────────────────────────────────────────────────────────────────────

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function NewsHunterPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
