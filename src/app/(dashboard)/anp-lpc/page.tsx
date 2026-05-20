"use client";

// Viewport router — /anp-lpc
//
// Picks between desktop (≥769px) and mobile (≤768px) Views using the
// single-source-of-truth breakpoint hook. Both Views share one brain:
// useAnpLpcData (see useAnpLpcData.ts).
//
// SSR note: useIsMobile returns `false` on the server and first client paint,
// so DesktopView renders first on all devices. The mobile View takes over
// after mount. This is the accepted trade-off (no hydration mismatches).

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function AnpLpcPage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
