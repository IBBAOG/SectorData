"use client";

import { useEffect, useState } from "react";

/**
 * useIsMobile — viewport detector for the dual-view (desktop + mobile) pattern.
 *
 * Returns `true` when the viewport matches `(max-width: 768px)`. The 768px
 * threshold is the **single source of breakpoint truth for the entire app**.
 * Any dashboard that needs to branch between its desktop and mobile View must
 * consume this hook — do not roll your own media query elsewhere.
 *
 * Implementation notes:
 *   - SSR-safe: returns `false` during server render and on the first client
 *     paint (before `useEffect` has run). The real value is set after mount,
 *     which avoids hydration mismatches.
 *   - Reactive: subscribes to `matchMedia.addEventListener("change", ...)` so a
 *     window resize (or device rotation) flips the value live without a reload.
 *   - Cleans up the listener on unmount.
 *
 * Usage:
 *   const isMobile = useIsMobile();
 *   return isMobile ? <MobileView /> : <DesktopView />;
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    // Guard for non-browser environments (defensive — `useEffect` itself does
    // not run during SSR, but this keeps TypeScript narrow and protects test
    // environments that may stub window without matchMedia).
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mql: MediaQueryList = window.matchMedia("(max-width: 768px)");

    // Set the initial value from the live media query on first effect run.
    setIsMobile(mql.matches);

    const handleChange = (event: MediaQueryListEvent): void => {
      setIsMobile(event.matches);
    };

    mql.addEventListener("change", handleChange);
    return () => {
      mql.removeEventListener("change", handleChange);
    };
  }, []);

  return isMobile;
}
