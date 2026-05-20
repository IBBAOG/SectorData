"use client";

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

/**
 * Viewport-aware entry point for /mdic-comex.
 *
 * useIsMobile is SSR-safe: returns false during server render and first client
 * paint, then flips to the real value after mount. Desktop renders first on
 * mobile for a single frame — acceptable to avoid hydration mismatches.
 *
 * Both views consume useMdicComexData (single brain hook). Neither view calls
 * Supabase directly or derives metrics independently.
 */
export default function MdicComexPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
