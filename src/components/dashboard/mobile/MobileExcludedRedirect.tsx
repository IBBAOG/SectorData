"use client";

// MobileExcludedRedirect — a side-effect-only client component mounted at the
// top of every dashboard that has been declared OFF-LIMITS on mobile by the
// reform plan § 3.1 / § 5.5:
//
//   /stocks, /admin-panel, /admin-analytics, /news-hunter, /alerts,
//   /profile, /anp-cdp, /anp-prices, /anp-glp
//
// When the viewport is mobile, the visitor is routed to /home with a query
// string flag (?excluded=<slug>) so the home page can show a one-time toast
// like "Stocks is available only on desktop". The toast itself is dispatched
// here via a CustomEvent('app-toast', ...) so any global toast listener (TBD —
// see TODO below) can pick it up; the routing happens unconditionally.
//
// Why a component (and not the proxy / a middleware redirect):
//   The viewport check is a client-only concern (matchMedia (max-width:768px))
//   and the proxy runs server-side without that signal. We avoid duplicating
//   UA-sniffing on the server (notoriously unreliable for tablets / desktop in
//   responsive mode) and keep the rule colocated with the page that owns it.
//
// Server render:
//   Renders null on the server. On client mount, useIsMobile() resolves the
//   real viewport via matchMedia and triggers router.replace() if mobile.
//   Desktop visitors get null — the page below renders normally.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useIsMobile } from "../../../hooks/useIsMobile";

export interface MobileExcludedRedirectProps {
  /** Route slug being protected — used in the redirect query string + toast. */
  slug: string;
  /** Display name for the toast. Defaults to the slug. */
  displayName?: string;
  /** Override the destination. Defaults to /home. */
  redirectTo?: string;
}

export default function MobileExcludedRedirect(
  props: MobileExcludedRedirectProps,
): null {
  const { slug, displayName, redirectTo = "/home" } = props;
  const isMobile = useIsMobile();
  const router = useRouter();

  useEffect(() => {
    if (!isMobile) return;

    // Fire a global "app-toast" event so any future toast container can render
    // a transient message. TODO(worker_subgerente-app): mount a global
    // ToastHost in (dashboard)/layout.tsx (or root layout) that listens for
    // window.addEventListener("app-toast", ...) and renders a 3s-auto-dismiss
    // pill at the top of the mobile screen.
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      const message = `${displayName ?? slug} is available only on desktop.`;
      try {
        window.dispatchEvent(
          new CustomEvent("app-toast", {
            detail: { message, tone: "info", source: "mobile-excluded" },
          }),
        );
      } catch {
        // CustomEvent constructor is unavailable in some test envs — soft-fail.
      }
    }

    // Use replace (not push) so the back button does not return the user to
    // the very page we just rejected.
    const target = `${redirectTo}?excluded=${encodeURIComponent(slug)}`;
    router.replace(target);
  }, [isMobile, slug, displayName, redirectTo, router]);

  return null;
}
