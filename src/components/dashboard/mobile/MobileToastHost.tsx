"use client";

// MobileToastHost — global toast container for the mobile layout (Onda 2 of
// the mobile reform, 2026-05-27). Subscribes to the `app-toast` CustomEvent
// dispatched by callers such as `MobileExcludedRedirect` and renders a single
// translucent Liquid-Glass pill near the bottom of the viewport.
//
// Why a global listener (and not per-page toast call sites):
//   The `MobileExcludedRedirect` fires its toast event right before navigating
//   away from the excluded route — so a per-page Toaster would unmount with
//   the page before the message ever paints. A single host mounted by the
//   `MobileLayout` survives the route change and renders the message on the
//   destination (/home).
//
// Stacking:
//   Max 1 visible toast at a time. A new event replaces the previous toast
//   (resets the auto-dismiss timer). Simplest UX with the most predictable
//   behaviour for our current use cases (excluded redirects, error nudges).
//
// Layout:
//   Fixed bottom-center, ~80px above the Home pill so the two stack cleanly
//   without overlap. The pill is at `calc(24px + safe-bottom)` and is 56px
//   tall — placing the toast at `calc(24px + 56 + 24 + safe-bottom)` ≈ 104
//   gives breathing room.
//
// Tones:
//   • info     — neutral white-on-glass (default)
//   • warning  — amber accent border + text
//   • error    — red accent border + text
//
// Liquid Glass styling consumes the same tokens as MobileHomePill:
//   --mobile-glass-bg, --mobile-glass-border, --mobile-glass-blur,
//   --mobile-glass-shadow.

import { useEffect, useState } from "react";

export interface AppToastDetail {
  message: string;
  tone?: "info" | "warning" | "error";
  source?: string;
}

export interface MobileToastHostProps {
  /** Auto-dismiss timeout in milliseconds. Defaults to 3000ms. */
  durationMs?: number;
}

interface ToastState {
  message: string;
  tone: NonNullable<AppToastDetail["tone"]>;
  id: number;
}

const TONE_COLORS: Record<
  NonNullable<AppToastDetail["tone"]>,
  { border: string; color: string; bg: string }
> = {
  info: {
    border: "var(--mobile-glass-border)",
    color: "var(--mobile-text)",
    bg: "var(--mobile-glass-bg)",
  },
  warning: {
    // Amber accent — visible against the white-glass surface.
    border: "rgba(217, 119, 6, 0.55)",
    color: "#92400e",
    bg: "rgba(254, 243, 199, 0.85)",
  },
  error: {
    // Red accent — semantic --mobile-down with stronger alpha.
    border: "rgba(220, 38, 38, 0.55)",
    color: "#991b1b",
    bg: "rgba(254, 226, 226, 0.85)",
  },
};

export default function MobileToastHost(
  props: MobileToastHostProps = {},
): React.ReactElement | null {
  const { durationMs = 3000 } = props;
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function onAppToast(ev: Event): void {
      const custom = ev as CustomEvent<AppToastDetail | undefined>;
      const detail = custom.detail;
      if (!detail || typeof detail.message !== "string" || !detail.message.trim()) {
        return;
      }
      setToast({
        message: detail.message,
        tone: detail.tone ?? "info",
        // Unique id so React replaces (not merges) the toast each time.
        id: Date.now() + Math.random(),
      });
    }

    window.addEventListener("app-toast", onAppToast as EventListener);
    return () => {
      window.removeEventListener("app-toast", onAppToast as EventListener);
    };
  }, []);

  // Auto-dismiss timer — resets when `toast.id` changes (new toast replaces
  // previous before the timer expires).
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => {
      setToast((current) => (current && current.id === toast.id ? null : current));
    }, durationMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast, durationMs]);

  if (!toast) return null;

  const colors = TONE_COLORS[toast.tone];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: "fixed",
        left: "50%",
        bottom: `calc(104px + ${"var(--mobile-safe-bottom)"})`,
        transform: "translateX(-50%)",
        zIndex: 1100,
        maxWidth: "calc(100vw - 32px)",
        padding: "10px 18px",
        borderRadius: 999,
        background: colors.bg,
        color: colors.color,
        border: `1px solid ${colors.border}`,
        WebkitBackdropFilter: "var(--mobile-glass-blur)",
        backdropFilter: "var(--mobile-glass-blur)",
        boxShadow: "var(--mobile-glass-shadow)",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 14,
        fontWeight: 600,
        lineHeight: 1.3,
        letterSpacing: "0.01em",
        textAlign: "center",
        // Subtle fade-in on mount.
        animation: "mobile-toast-fade-in 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {toast.message}
    </div>
  );
}
