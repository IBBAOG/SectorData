"use client";

// Viewport router for /anp-ppi.
// useIsMobile is SSR-safe — returns false on server / first paint, then flips.

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function AnpPpiPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
