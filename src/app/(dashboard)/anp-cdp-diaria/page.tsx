"use client";

import { useIsMobile } from "../../../hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

/**
 * Viewport-aware entry point for /anp-cdp-diaria.
 *
 * Both Views consume `useAnpCdpDiariaData` — single source of truth for RPCs,
 * filters, derivations, ranking, and export plumbing. Neither View ever calls
 * Supabase directly or derives metrics on its own.
 *
 * useIsMobile is SSR-safe: returns false during server render and first
 * client paint, then flips to the real value after mount. Desktop renders
 * first on mobile for a single frame — acceptable to avoid hydration
 * mismatches.
 */
export default function AnpCdpDiariaPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
