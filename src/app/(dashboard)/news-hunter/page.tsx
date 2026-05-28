"use client";

// ─── /news-hunter — page ─────────────────────────────────────────────────────
//
// Mobile is excluded from this dashboard (continuous feed is not suited for
// small screens). MobileExcludedRedirect detects mobile viewports and
// redirects to /home?excluded=news-hunter, firing an app-toast event.
// On desktop it is a no-op (renders null).
//
// Desktop View is rendered unconditionally; it handles its own data via
// useNewsHunterData.
// ─────────────────────────────────────────────────────────────────────────────

import MobileExcludedRedirect from "@/components/dashboard/mobile/MobileExcludedRedirect";
import DesktopView from "./desktop/View";

export default function NewsHunterPage(): React.ReactElement {
  return (
    <>
      <MobileExcludedRedirect slug="news-hunter" />
      <DesktopView />
    </>
  );
}
