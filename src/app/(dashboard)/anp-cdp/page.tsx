"use client";

// ─── /anp-cdp — page router ───────────────────────────────────────────────────
//
// Mobile is excluded from this dashboard (granular well-by-well explorer is
// too technical for mobile; /well-by-well covers the executive view instead).
// MobileExcludedRedirect is a side-effect-only client component that fires on
// mobile and redirects to /home?excluded=anp-cdp; on desktop it renders null.
// DesktopView is always rendered (the redirect races it away on mobile before
// the user sees anything).

import MobileExcludedRedirect from "@/components/dashboard/mobile/MobileExcludedRedirect";
import DesktopView from "./desktop/View";

export default function AnpCdpPage(): React.ReactElement {
  return (
    <>
      <MobileExcludedRedirect slug="anp-cdp" />
      <DesktopView />
    </>
  );
}
