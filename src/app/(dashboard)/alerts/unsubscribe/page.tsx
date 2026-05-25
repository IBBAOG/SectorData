"use client";

// ─── /alerts/unsubscribe?token=<uuid>[&all=1] ─────────────────────────────────
//
// One-click unsubscribe landing page. Reads `?token=` (and optional `&all=1`)
// from URL search params. Calls rpcUnsubscribe or rpcUnsubscribeAll once on mount.
//
// Single-view (centered card — no dual-view divergence needed for transactional pages).
//
// Anti-pattern note: token travels via URL only. Never rendered in DOM.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { getSupabaseClient } from "@/lib/supabaseClient";
import { rpcUnsubscribe, rpcUnsubscribeAll } from "@/lib/rpc";
import type { UnsubscribeFlowState } from "@/types/alerts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AlertUnsubscribePage(): React.ReactElement {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const all = searchParams.get("all") === "1";

  const [state, setState] = useState<UnsubscribeFlowState>({ kind: "loading" });

  const supabaseRaw = getSupabaseClient();

  useEffect(() => {
    if (!token || !UUID_RE.test(token)) {
      setState({ kind: "error", message: "The unsubscribe link is missing or invalid." });
      return;
    }
    if (!supabaseRaw) {
      setState({ kind: "error", message: "Supabase client unavailable." });
      return;
    }
    const supabase = supabaseRaw;

    let cancelled = false;

    if (all) {
      rpcUnsubscribeAll(supabase, token).then((result) => {
        if (cancelled) return;
        if (result.success) {
          setState({ kind: "success", all: true, count: result.count });
        } else {
          setState({
            kind: "error",
            message: result.error ?? "Could not process your unsubscribe request.",
          });
        }
      });
    } else {
      rpcUnsubscribe(supabase, token).then((result) => {
        if (cancelled) return;
        if (result.success) {
          setState({ kind: "success", all: false });
        } else {
          setState({
            kind: "error",
            message: result.error ?? "Could not process your unsubscribe request.",
          });
        }
      });
    }

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, all]);

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
              Processing your request…
            </div>
            <div style={{ fontSize: 13, color: "#6b6b73" }}>
              Please wait a moment.
            </div>
          </>
        )}

        {/* ── Success (single source) ── */}
        {state.kind === "success" && !state.all && (
          <>
            <div style={{ fontSize: 36, marginBottom: 16 }}>✓</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>
              You&apos;ve been unsubscribed
            </div>
            <div style={{ fontSize: 14, color: "#4b5563", lineHeight: 1.5, marginBottom: 24 }}>
              You won&apos;t receive further alerts for this source.
              You can re-subscribe at any time from the Alerts page.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <Link
                href="/alerts"
                style={{
                  display: "inline-block",
                  padding: "11px 20px",
                  background: "#ff5000",
                  color: "#fff",
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 13,
                  textDecoration: "none",
                }}
              >
                Manage alerts
              </Link>
            </div>
          </>
        )}

        {/* ── Success (all sources) ── */}
        {state.kind === "success" && state.all && (
          <>
            <div style={{ fontSize: 36, marginBottom: 16 }}>✓</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a1a", marginBottom: 8 }}>
              Unsubscribed from all SectorData Alerts
            </div>
            <div style={{ fontSize: 14, color: "#4b5563", lineHeight: 1.5, marginBottom: 24 }}>
              {state.count != null && state.count > 0
                ? `${state.count} subscription${state.count !== 1 ? "s" : ""} deactivated. `
                : ""}
              You&apos;ll no longer receive alert emails from us.
              You can re-subscribe at any time.
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
              Re-subscribe
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
            <div style={{ fontSize: 13, color: "#6b6b73", lineHeight: 1.5, marginBottom: 20 }}>
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
