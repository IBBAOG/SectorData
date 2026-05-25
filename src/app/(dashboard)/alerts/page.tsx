"use client";

// ─── /alerts — viewport router ───────────────────────────────────────────────
//
// Detects viewport via useIsMobile (single breakpoint: ≤768px) and routes to
// the appropriate View.  Both Views consume useAlertsData — no logic lives here.
// ─────────────────────────────────────────────────────────────────────────────

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function AlertsPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
