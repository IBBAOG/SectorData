"use client";

// Viewport-aware entry point for /anp-precos-produtores.
//
// useIsMobile is SSR-safe — returns false during server render and the first
// client paint, then flips to the real value after mount. This means the
// desktop View renders first on mobile devices for a single frame, then the
// mobile View takes over. No hydration mismatches.

import { useIsMobile } from "../../../hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function AnpPrecosProdutoresPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
