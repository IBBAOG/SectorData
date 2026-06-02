"use client";

// /alerts/unsubscribe?token=<uuid> — one-click unsubscribe landing page.
//
// Linked from the footer of every alert email. Single centered card, mobile-safe
// (works on any device — a user clicks the email link from their phone). Calls
// the anon-callable RPC unsubscribe_by_token exactly once on mount. There is NO
// double opt-in / confirmation step — the click itself unsubscribes.
//
// The RPC is idempotent server-side: a re-click on an already-inactive
// subscription returns { success: true, already_unsubscribed: true }.
//
// Token is read from window.location.search (client-only) rather than
// useSearchParams() so the route never trips the Next.js 16 static-render
// Suspense requirement for a standalone transactional page.

import { useEffect, useRef, useState } from "react";

import { getSupabaseClient } from "@/lib/supabaseClient";
import { rpcUnsubscribeByToken } from "@/lib/rpc";
import type { UnsubscribeResult } from "@/types/alerts";
import styles from "../page.module.css";

type Phase =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "success"; already: boolean }
  | { kind: "invalid" }
  | { kind: "error" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read + validate the token from the URL synchronously (client-only).
 *  Returns the valid token, or null when absent/malformed. SSR-safe: returns
 *  null on the server (no window), resolving to the real value after mount. */
function readToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = (new URLSearchParams(window.location.search).get("token") ?? "").trim();
  return token && UUID_RE.test(token) ? token : null;
}

export default function UnsubscribePage(): React.ReactElement {
  // Compute the initial phase during render from the (validated) URL token so we
  // never call setState synchronously inside the effect. A missing/malformed
  // token short-circuits to "missing"; a valid token starts in "loading" and is
  // resolved by the async RPC below.
  const [token] = useState<string | null>(readToken);
  const [phase, setPhase] = useState<Phase>(() =>
    token ? { kind: "loading" } : { kind: "missing" },
  );
  const ranRef = useRef(false);

  useEffect(() => {
    if (!token) return; // nothing to do — already showing the "missing" card.
    // Guard against double-invocation (React StrictMode mounts effects twice in
    // dev). The RPC is idempotent anyway, but we avoid a redundant call.
    if (ranRef.current) return;
    ranRef.current = true;

    const supabase = getSupabaseClient();
    if (!supabase) {
      // Defer to a microtask so this is not a synchronous setState in the effect.
      Promise.resolve().then(() => setPhase({ kind: "error" }));
      return;
    }

    rpcUnsubscribeByToken(supabase, token)
      .then((res: UnsubscribeResult) => {
        if (res.success) {
          setPhase({ kind: "success", already: Boolean(res.already_unsubscribed) });
        } else if (res.error === "invalid_token" || res.error === "missing_token") {
          setPhase({ kind: "invalid" });
        } else {
          setPhase({ kind: "error" });
        }
      })
      .catch(() => {
        setPhase({ kind: "error" });
      });
  }, [token]);

  return (
    <div className={styles.page}>
      <div className={styles.unsubWrap}>
        <div className={styles.unsubCard}>{renderCard(phase)}</div>
      </div>
    </div>
  );
}

function renderCard(phase: Phase): React.ReactElement {
  switch (phase.kind) {
    case "loading":
      return (
        <>
          <div className={`${styles.unsubIcon} ${styles.unsubIconOk}`} aria-hidden="true">
            &hellip;
          </div>
          <h1 className={styles.unsubTitle}>Processing your request</h1>
          <p className={styles.unsubBody}>One moment while we update your subscription.</p>
        </>
      );

    case "success":
      return (
        <>
          <div className={`${styles.unsubIcon} ${styles.unsubIconOk}`} aria-hidden="true">
            &#10003;
          </div>
          <h1 className={styles.unsubTitle}>
            {phase.already ? "Already unsubscribed" : "You're unsubscribed"}
          </h1>
          <p className={styles.unsubBody}>
            {phase.already ? (
              <>You were already unsubscribed from this alert. No further emails will be sent.</>
            ) : (
              <>
                You won&apos;t receive any more emails for this data source. You can re-subscribe
                anytime from the Alerts page.
              </>
            )}
          </p>
          <a className={styles.unsubCta} href="/alerts">
            Manage my alerts
          </a>
        </>
      );

    case "missing":
      return (
        <>
          <div className={`${styles.unsubIcon} ${styles.unsubIconErr}`} aria-hidden="true">
            !
          </div>
          <h1 className={styles.unsubTitle}>Missing unsubscribe link</h1>
          <p className={styles.unsubBody}>
            This link is incomplete. Please use the unsubscribe link from the bottom of an alert
            email, or manage your subscriptions directly.
          </p>
          <a className={styles.unsubCta} href="/alerts">
            Manage my alerts
          </a>
        </>
      );

    case "invalid":
      return (
        <>
          <div className={`${styles.unsubIcon} ${styles.unsubIconErr}`} aria-hidden="true">
            !
          </div>
          <h1 className={styles.unsubTitle}>Link not recognized</h1>
          <p className={styles.unsubBody}>
            We couldn&apos;t match this unsubscribe link to a subscription. It may have already
            been removed. You can review your subscriptions on the Alerts page.
          </p>
          <a className={styles.unsubCta} href="/alerts">
            Manage my alerts
          </a>
        </>
      );

    case "error":
    default:
      return (
        <>
          <div className={`${styles.unsubIcon} ${styles.unsubIconErr}`} aria-hidden="true">
            !
          </div>
          <h1 className={styles.unsubTitle}>Something went wrong</h1>
          <p className={styles.unsubBody}>
            We couldn&apos;t process your request right now. Please try again in a moment, or
            manage your subscriptions on the Alerts page.
          </p>
          <a className={styles.unsubCta} href="/alerts">
            Manage my alerts
          </a>
        </>
      );
  }
}
