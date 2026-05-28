"use client";

/**
 * /stocks — Market Watch (Bloomberg-style dark trading terminal).
 *
 * Mobile is excluded by business decision — MobileExcludedRedirect detects
 * mobile viewports and redirects to /home?excluded=stocks with a toast.
 * Desktop renders the full Bloomberg dark trading terminal unconditionally.
 *
 * All data logic lives in useStocksData.ts.
 * Desktop UI (drag-drop grid, live quotes, Bloomberg theme) lives in desktop/View.tsx.
 */

import MobileExcludedRedirect from "@/components/dashboard/mobile/MobileExcludedRedirect";
import DesktopView from "./desktop/View";

export default function StocksPage(): React.ReactElement {
  return (
    <>
      <MobileExcludedRedirect slug="stocks" />
      <DesktopView />
    </>
  );
}
