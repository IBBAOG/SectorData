"use client";

// /admin-panel — desktop-only. Mobile users are redirected to /home.
// Role guard (Admin) and MFA enforcement live inside DesktopView via
// useAdminPanelData / useRoleGuard("Admin").
//
// MobileExcludedRedirect is a side-effect-only client component — on mobile it
// redirects to /home?excluded=admin-panel and fires an app-toast event; on
// desktop it renders null.

import MobileExcludedRedirect from "@/components/dashboard/mobile/MobileExcludedRedirect";
import DesktopView from "./desktop/View";

export default function AdminPanelPage(): React.ReactElement {
  return (
    <>
      <MobileExcludedRedirect slug="admin-panel" />
      <DesktopView />
    </>
  );
}
