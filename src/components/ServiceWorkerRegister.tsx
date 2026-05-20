"use client";

import { useEffect } from "react";

/**
 * ServiceWorkerRegister — registers `/sw.js` once after the app mounts.
 *
 * The service worker exists purely to enable the Add-to-Home-Screen prompt
 * on Android Chrome / Edge (see `public/sw.js` for scope/non-goals). It does
 * NOT cache business data.
 *
 * Registration is skipped in dev builds to avoid the cache shadowing Next.js
 * HMR chunks. In production it only runs in browsers that support the API.
 */
export default function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = (): void => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failure is non-fatal — the app still works without
        // PWA install. Log lightly without throwing.
        // eslint-disable-next-line no-console
        console.warn("[sw] registration failed");
      });
    };

    // Defer registration until after the load event so it never competes with
    // the initial route hydration.
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => {
        window.removeEventListener("load", register);
      };
    }
  }, []);

  return null;
}
