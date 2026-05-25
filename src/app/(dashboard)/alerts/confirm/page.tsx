"use client";

// ─── /alerts/confirm?token=<uuid> ────────────────────────────────────────────
//
// Double opt-in confirmation landing page.
// Reads `?token=` from the URL search params, calls rpcConfirmSubscription once
// on mount, then shows one of 4 states: loading | success | expired | error.
//
// This page is single-view (centered card, no dual-view divergence needed —
// it's a transactional landing page, not a dashboard).
//
// Anti-pattern note: token is read from URL query param only. It is never
// rendered in a DOM element (input value, hidden field, etc.).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { getSupabaseClient } from "@/lib/supabaseClient";
import { rpcConfirmSubscription, rpcResendConfirmation } from "@/lib/rpc";
import type { ConfirmFlowState } from "@/types/alerts";

// UUID format validator (basic)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AlertConfirmPage(): React.ReactElement {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [state, setState] = useState<ConfirmFlowState>({ kind: "loading" });
  const [resendEmail, setResendEmail] = useState("");
  const [resendSent, setResendSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendError, setResendError] = useState<string | null>(null);
  const cooldownRef = useState<ReturnType<typeof setInterval> | null>(null);

  const supabaseRaw = getSupabaseClient();

  useEffect(() => {
    if (!token || !UUID_RE.test(token)) {
      setState({ kind: "invalid" });
      return;
    }
    if (!supabaseRaw) {
      setState({ kind: "error", message: "Supabase client unavailable. Check environment configuration." });
      return;
    }
    const supabase = supabaseRaw;

    let cancelled = false;
    rpcConfirmSubscription(supabase, token).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setState({ kind: "success", count: result.subscribed_count });
      } else if (result.error === "token_expired") {
        setState({ kind: "expired" });
      } else {
        setState({ kind: "invalid" });
      }
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    if (!resendEmail.trim()) {
      setResendError("Please enter your email address");
      return;
    }
    if (!supabaseRaw) return;
    setResendError(null);
    const result = await rpcResendConfirmation(supabaseRaw, resendEmail.trim(), []);
    if (result.sent) {
      setResendSent(true);
    } else if (result.retry_after_seconds) {
      let remaining = result.retry_after_seconds;
      setResendCooldown(remaining);
      if (cooldownRef[0]) clearInterval(cooldownRef[0]);
      const id = setInterval(() => {
        remaining -= 1;
        setResendCooldown(remaining);
        if (remaining <= 0) clearInterval(id);
      }, 1000);
    } else {
      setResendError(result.error ?? "Failed to resend. Please try again.");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f9f9fb",
        padding: 24,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          border: "1px solid #e6e6ec",
          padding: "36px 32px",
          maxWidth: 480,
          width: "100%",
          textAlign: "center",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        }}
      >
        {/* ── Loading ── */}
        {state.kind === "loading" && (
          <>
            <div style={{ fontSize: 32, marginBottom: 16 }}>⏳</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>
              Confirming your subscription…
            </div>
            <div style={{ fontSize: 13, color: "#6b6b73" }}>
              Please wait while we activate your alerts.
            </div>
          </>
        )}

        {/* ── Success ── */}
        {state.kind === "success" && (
          <>
            <div style={{ fontSize: 40, marginBottom: 16 }}>✓</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>
              Subscriptions confirmed!
            </div>
            <div style={{ fontSize: 14, color: "#4b5563", marginBottom: 24, lineHeight: 1.5 }}>
              You&apos;re now subscribed to{" "}
              <strong>
                {state.count} source{state.count !== 1 ? "s" : ""}
              </strong>
              . You&apos;ll receive an email whenever new data is published.
            </div>
            <Link
              href="/alerts"
              style={{
                display: "inline-block",
                padding: "11px 24px",
                background: "#ff5000",
                color: "#fff",
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              Manage my alerts
            </Link>
          </>
        )}

        {/* ── Expired ── */}
        {state.kind === "expired" && (
          <>
            <div style={{ fontSize: 36, marginBottom: 16 }}>🕐</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>
              Confirmation link expired
            </div>
            <div style={{ fontSize: 13, color: "#6b6b73", marginBottom: 20, lineHeight: 1.5 }}>
              Confirmation links are valid for 48 hours. Enter your email to receive a new one.
            </div>

            {resendSent ? (
              <div
                style={{
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 8,
                  padding: 14,
                  fontSize: 13,
                  color: "#065f46",
                }}
              >
                A new confirmation email has been sent. Please check your inbox.
              </div>
            ) : (
              <div style={{ textAlign: "left" }}>
                <input
                  type="email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder="your@email.com"
                  aria-label="Email address"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: `1px solid ${resendError ? "#dc2626" : "#d1d1d9"}`,
                    borderRadius: 7,
                    fontSize: 14,
                    fontFamily: "Arial, sans-serif",
                    marginBottom: 8,
                    boxSizing: "border-box",
                  }}
                />
                {resendError && (
                  <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 8 }} role="alert">
                    {resendError}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendCooldown > 0}
                  style={{
                    width: "100%",
                    padding: "11px 0",
                    background: resendCooldown > 0 ? "#e6e6ec" : "#ff5000",
                    color: resendCooldown > 0 ? "#6b6b73" : "#fff",
                    border: "none",
                    borderRadius: 7,
                    fontWeight: 700,
                    fontSize: 14,
                    fontFamily: "Arial, sans-serif",
                    cursor: resendCooldown > 0 ? "not-allowed" : "pointer",
                  }}
                >
                  {resendCooldown > 0
                    ? `Resend in ${resendCooldown}s`
                    : "Send new confirmation"}
                </button>
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              <Link
                href="/alerts"
                style={{ fontSize: 13, color: "#ff5000", textDecoration: "none" }}
              >
                Back to Alerts →
              </Link>
            </div>
          </>
        )}

        {/* ── Invalid ── */}
        {state.kind === "invalid" && (
          <>
            <div style={{ fontSize: 36, marginBottom: 16 }}>✗</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>
              Invalid confirmation link
            </div>
            <div style={{ fontSize: 13, color: "#6b6b73", marginBottom: 20, lineHeight: 1.5 }}>
              This confirmation link is not valid or has already been used.
              If you&apos;re having trouble, you can subscribe again from the Alerts page.
            </div>
            <Link
              href="/alerts"
              style={{
                display: "inline-block",
                padding: "11px 24px",
                background: "#ff5000",
                color: "#fff",
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              Go to Alerts
            </Link>
          </>
        )}

        {/* ── Error ── */}
        {state.kind === "error" && (
          <>
            <div style={{ fontSize: 36, marginBottom: 16 }}>⚠</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>
              Something went wrong
            </div>
            <div style={{ fontSize: 13, color: "#6b6b73", marginBottom: 20 }}>
              {state.message}
            </div>
            <Link
              href="/alerts"
              style={{
                display: "inline-block",
                padding: "11px 24px",
                background: "#ff5000",
                color: "#fff",
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              Back to Alerts
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
