"use client";

import { useEffect, useState } from "react";

/**
 * useIsMobile — device detector for the dual-view (desktop + mobile) pattern.
 *
 * Returns `true` when the current device is a phone or tablet, detected via
 * `navigator.userAgent` (NOT viewport width). This is the **single source of
 * device-class truth for the entire app** — any dashboard that needs to branch
 * between its desktop and mobile View must consume this hook.
 *
 * Why UA-based instead of viewport-based: a desktop user narrowing their
 * browser window must NOT be flipped into the MobileShell. Mobile is meant for
 * phones and tablets only; viewport size is a noisy proxy for that.
 *
 * Implementation notes:
 *   - SSR-safe: returns `false` during server render and on the first client
 *     paint (before `useEffect` has run). Real phones get a brief desktop
 *     paint followed by a re-render — same flash behavior as before.
 *   - One-shot detection: UA does not change in runtime, so there is no
 *     listener and no resize/orientation reactivity (that was the bug).
 *   - iPadOS 13+ pitfall: iPads report UA as `Macintosh`. The desktop-class
 *     UA fallback uses `navigator.maxTouchPoints > 1` to recover them.
 *
 * Usage:
 *   const isMobile = useIsMobile();
 *   return isMobile ? <MobileView /> : <DesktopView />;
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ua = navigator.userAgent;
    const isPhoneOrTablet =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|Silk|Kindle/i.test(ua);
    // iPadOS 13+ reports UA as `Macintosh`; recover via touch-points heuristic.
    const isIPadOSDesktopClass =
      /Macintosh/.test(ua) &&
      typeof navigator.maxTouchPoints === "number" &&
      navigator.maxTouchPoints > 1;
    setIsMobile(isPhoneOrTablet || isIPadOSDesktopClass);
  }, []);

  return isMobile;
}
