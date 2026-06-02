"use client";

// ─── /alerts — viewport router ──────────────────────────────────────────────
//
// Rebuilt logged-in-only email subscription dashboard (Phase 4). Dual-view per
// CLAUDE.md § Dual-view policy — the shared brain lives in useAlertsData.ts and
// both Views consume it.
//
// Access tier: clients-only. `module_visibility('alerts')` is
// clients=true / public=false, so Anon visitors are redirected to /home by
// useModuleVisibilityGuard("alerts") (called inside each View). The subscriber's
// email is implicit (their auth email) — no anonymous signup here.
//
// useIsMobile is SSR-safe (returns false on the server / first paint, flips
// after mount via UA + maxTouchPoints — never on resize), so desktop renders
// for a single frame on a phone, then the mobile View takes over.

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function AlertsPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
