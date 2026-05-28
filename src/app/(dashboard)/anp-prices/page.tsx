"use client";

// /anp-prices entry point.
//
// EXCLUDED FROM MOBILE — see mobile reform plan § 3.1 / § 5.5.
// Reference-data dashboard with sporadic consumption; desktop-only by CTO call.
// On mobile viewports `<MobileExcludedRedirect>` ships the visitor back to
// /home with a one-shot toast. On desktop the redirect is a no-op (returns
// null) and the desktop View renders normally.
//
// Both Views (the desktop one is the only one left) consume
// `useAnpPricesData` — the single source of truth for RPC orchestration,
// filter state, trace visibility matrix and export plumbing. Neither View
// ever calls Supabase or derives metrics on its own.

import { MobileExcludedRedirect } from "@/components/dashboard/mobile";
import DesktopView from "./desktop/View";

export default function AnpPricesPage(): React.ReactElement {
  return (
    <>
      <MobileExcludedRedirect slug="anp-prices" displayName="ANP Prices" />
      <DesktopView />
    </>
  );
}
