"use client";

// Viewport router — /anp-glp (LPG Market Share).
//
// Promoted to dual-view on 2026-06-05 when /anp-glp was rebuilt as a clone of
// /market-share over the anp_glp table. Both Views share one brain
// (useAnpGlpData). Previously this route was mobile-excluded (volume-only
// reference dashboard); the MobileExcludedRedirect was removed and the slug
// dropped from the mobile-excluded lists.

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function AnpGlpPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
