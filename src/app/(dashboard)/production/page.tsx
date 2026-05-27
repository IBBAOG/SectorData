"use client";

// /production — executive monthly oil & gas production summary.
//
// Viewport-aware router per the canonical dual-view template
// (docs/app/dual-view-pattern.md). Both Views consume `useProductionData`;
// neither calls Supabase directly.
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes to one
// View must land in the OTHER View in the same commit, OR the commit message
// must declare `[desktop-only]` / `[mobile-only]` with an explicit reason.

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function ProductionPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
