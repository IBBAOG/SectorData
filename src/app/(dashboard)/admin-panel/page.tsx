"use client";

// Viewport-aware entry point for /admin-panel (Wave 5 dual-view).
//
// useIsMobile is SSR-safe: returns `false` during server render and the first
// client paint, then flips to the real value after mount. This means desktop
// is the default first frame on mobile devices, then the mobile View takes
// over. Acceptable trade-off — avoids hydration mismatches.
//
// All RPC plumbing, role-guard logic, and state live in `useAdminPanelData`.
// Both Views consume that single hook.

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function AdminPanelPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
