"use client";

import { useIsMobile } from "../../../hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

/**
 * Viewport-aware entry point for /anp-prices.
 *
 * Both Views consume `useAnpPricesData` — the single source of truth for
 * RPC orchestration, filter state, trace visibility matrix and export
 * plumbing. Neither View ever calls Supabase or derives metrics on its own.
 *
 * useIsMobile is SSR-safe: returns false during server render and the first
 * client paint, then flips to the real value after mount.
 */
export default function AnpPricesPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
