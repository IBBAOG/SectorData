// ─── DUAL-VIEW MODULE TEMPLATE ─────────────────────────────────────────────
//
// HOW TO USE THIS TEMPLATE
// ────────────────────────
// 1. Copy this folder:  cp -r template-module my-module-name
// 2. Rename the hook file (useTemplateModuleData.ts → useMyModuleData.ts)
//    and update its exported types/function name.
// 3. Implement the real RPC call inside the hook (replace the stub).
// 4. Build out desktop/View.tsx (desktop UX) and mobile/View.tsx (mobile UX)
//    against the hook. Both Views consume the SAME hook — that's the contract.
// 5. Add your route to NavBar:
//      src/components/NavBar.tsx → NAV_ENTRIES
//      { href: "/my-module-name", label: "My Module" }
// 6. Add RPC wrappers in src/lib/rpc.ts under a new "MODULE:" section.
// 7. Auth is automatically enforced by src/app/(dashboard)/layout.tsx.
//    You do NOT need to add any session checks here.
//
// Binding sync rule (CLAUDE.md § Dual-view policy):
//   Any meaningful change to one View (new filter, chart, KPI, copy) must
//   land in the OTHER View in the same commit, or the commit message must
//   declare `[desktop-only]` / `[mobile-only]` with an explicit reason.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

/**
 * Viewport-aware entry point.
 *
 * useIsMobile is SSR-safe: it returns `false` during server render and the
 * first client paint, then flips to the real value after mount. This means
 * the desktop View renders first on mobile devices for a single frame, then
 * the mobile View takes over. Acceptable trade-off — we avoid hydration
 * mismatches entirely.
 */
export default function TemplateModulePage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
