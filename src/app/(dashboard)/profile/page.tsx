"use client";

// Viewport router for /profile.
// useIsMobile is SSR-safe — returns false during SSR + first paint, then flips
// after mount. See docs/app/dual-view-pattern.md for the canonical template.

import { useIsMobile } from "@/hooks/useIsMobile";
import DesktopView from "./desktop/View";
import MobileView from "./mobile/View";

export default function ProfilePage(): React.ReactElement {
  const isMobile = useIsMobile();
  return isMobile ? <MobileView /> : <DesktopView />;
}
