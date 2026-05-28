"use client";

// ─── /alerts — page entry point ──────────────────────────────────────────────
//
// /alerts is desktop-only by CTO decision (mobile reform wave 2, § 3.1).
// MobileExcludedRedirect handles the mobile redirect to /home as a no-op on
// desktop; DesktopView renders unconditionally for all visitors.
//
// Transactional sub-pages are NOT affected:
//   /alerts/confirm       — double opt-in confirmation (mobile-safe, no redirect)
//   /alerts/unsubscribe   — one-click unsubscribe (mobile-safe, no redirect)
// ─────────────────────────────────────────────────────────────────────────────

import MobileExcludedRedirect from "@/components/dashboard/mobile/MobileExcludedRedirect";
import DesktopView from "./desktop/View";

export default function AlertsPage(): React.ReactElement {
  return (
    <>
      <MobileExcludedRedirect slug="alerts" displayName="Alerts" />
      <DesktopView />
    </>
  );
}
