"use client";

import { useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";

/**
 * Chrome / Edge / Samsung Internet expose this event when the page meets the
 * PWA install criteria (manifest + SW + secure context + user engagement).
 * Safari does not fire it — iOS users install via the Share sheet manually.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

const DISMISS_STORAGE_KEY = "sectordata_pwa_install_dismissed";

/**
 * PWAInstallPrompt — small dismissable banner shown to mobile users when the
 * browser fires `beforeinstallprompt`. Hidden after the user dismisses it
 * (localStorage flag) or installs the app.
 *
 * Renders nothing on desktop, on SSR, or when no install event has been
 * captured. Designed to be mounted once inside the dashboard layout.
 */
export default function PWAInstallPrompt(): React.ReactElement | null {
  const isMobile = useIsMobile();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [dismissed, setDismissed] = useState<boolean>(true);

  // Read dismissal flag once on mount. Default to `dismissed = true` so the
  // banner stays hidden until we confirm the user has not dismissed it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const flag = window.localStorage.getItem(DISMISS_STORAGE_KEY);
      setDismissed(flag === "1");
    } catch {
      // localStorage may be unavailable (private mode, quota); fail closed.
      setDismissed(true);
    }
  }, []);

  // Capture the beforeinstallprompt event so we can trigger it later.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleBeforeInstall = (event: Event): void => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = (): void => {
      setDeferredPrompt(null);
      try {
        window.localStorage.setItem(DISMISS_STORAGE_KEY, "1");
      } catch {
        // Ignore storage failures.
      }
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstall = async (): Promise<void> => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        // The browser will fire `appinstalled` shortly — clean up locally too.
        setDeferredPrompt(null);
      }
    } catch {
      // If the call throws (e.g. the prompt was consumed elsewhere), just
      // hide the banner.
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = (): void => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, "1");
    } catch {
      // Ignore.
    }
  };

  // Only render on mobile, when a prompt is available, and not previously
  // dismissed. SSR + first paint always renders null thanks to useIsMobile.
  if (!isMobile) return null;
  if (!deferredPrompt) return null;
  if (dismissed) return null;

  return (
    <div
      role="dialog"
      aria-label="Install SectorData"
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        right: 16,
        zIndex: 1080,
        padding: "12px 14px",
        borderRadius: 12,
        background: "#ffffff",
        border: "1px solid #e6e6ec",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.12)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: "#1a1a1a" }}>
          Install SectorData on your phone
        </div>
        <div style={{ fontSize: 12, color: "#6b6b73", marginTop: 2 }}>
          Add it to your home screen for one-tap access.
        </div>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        style={{
          padding: "6px 10px",
          fontSize: 13,
          color: "#6b6b73",
          background: "transparent",
          border: "1px solid #e6e6ec",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        Dismiss
      </button>
      <button
        type="button"
        onClick={handleInstall}
        style={{
          padding: "6px 12px",
          fontSize: 13,
          fontWeight: 600,
          color: "#ffffff",
          background: "#ff5000",
          border: "1px solid #ff5000",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        Install
      </button>
    </div>
  );
}
