"use client";

// Viewport router for /anp-desembaracos. The desktop (≥769px) and mobile
// (≤768px) views share the same brain (`useAnpDesembaracosData`) but render
// with different chrome.
// See docs/app/dual-view-pattern.md and CLAUDE.md § "Dual-view (web + mobile) policy".

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function AnpDesembaracosPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
