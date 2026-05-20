"use client";

// ─── /anp-cdp — dual-view router ─────────────────────────────────────────────
//
// Detects the viewport via useIsMobile() and routes to the matching View.
// All business logic (RPC orchestration, filter state, derivations) lives
// in `useAnpCdpData` — both Views consume it identically. This file is
// presentation routing only.
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes to
// one View require an equivalent change in the OTHER View in the SAME
// commit, or the commit must declare [desktop-only] / [mobile-only] with
// an explicit reason. See docs/app/anp-cdp.md § "Dual-view structure".

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function AnpCdpPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
