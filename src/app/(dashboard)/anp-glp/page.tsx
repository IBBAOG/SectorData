"use client";

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

/**
 * Viewport router for /anp-glp.
 * useIsMobile is SSR-safe: returns false on server/first paint, then flips.
 */
export default function AnpGlpPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
