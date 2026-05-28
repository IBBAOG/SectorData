"use client";

// ─── /news-hunter — viewport router ─────────────────────────────────────────
//
// Dual-view dashboard (CLAUDE.md § Dual-view policy). The shared brain lives
// in useNewsHunterData.ts; both Views consume it.
//
// useIsMobile is SSR-safe (returns `false` on the server / first paint, flips
// after mount based on UA + maxTouchPoints — never on resize). So desktop
// renders first on mobile for a single frame, then mobile takes over.
//
// History: before 2026-05-28 this page mounted <MobileExcludedRedirect /> and
// only rendered desktop. The mobile View landed in this commit alongside the
// dual-view refactor that turned page.tsx into a pure router. See
// docs/app/news-hunter.md § "Dual-view structure".

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function NewsHunterPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
