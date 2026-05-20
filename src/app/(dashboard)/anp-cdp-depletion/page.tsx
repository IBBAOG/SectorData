"use client";

import { useIsMobile } from "../../../hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

/**
 * Viewport-aware entry point for /anp-cdp-depletion.
 *
 * useIsMobile is SSR-safe: returns `false` during server render and the first
 * client paint, then flips to the real value after mount. This means desktop
 * View renders first on mobile devices for a single frame, then mobile View
 * takes over. Acceptable trade-off — avoids hydration mismatches entirely.
 *
 * Both Views consume the shared hook `useAnpCdpDepletionData` which owns all
 * filter state, debounced RPCs (per-well scatter + field aggregate + campos
 * list), rolling-depletion derivations, table model, period helper, and
 * formatters. See CLAUDE.md § Dual-view policy for the binding sync rule.
 */
export default function AnpCdpDepletionPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
