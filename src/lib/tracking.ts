// ─────────────────────────────────────────────────────────────────────────────
// tracking.ts — fire-and-forget analytics event helper
//
// Calls the SECURITY DEFINER RPC `track_event` on Supabase. The RPC reads
// `auth.uid()` itself, so the caller does NOT pass user_id.
//
// All calls are intentionally fire-and-forget: errors are logged via
// console.warn and never bubble up to the UI. We do not await the promise
// from React effects; tracking must never block rendering or navigation.
//
// Event types:
//   - 'login'      — fired once per browser session, gated by sessionStorage
//   - 'page_view'  — fired on every pathname change in the (dashboard) layout
//   - 'export'     — fired by ExportPanel/ExportModal after a download finishes
//
// Routes excluded from page_view (handled at the call site, not here):
//   /login, /profile, /admin-panel, /admin-analytics
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseClient } from "./supabaseClient";

export type AnalyticsEventType = "login" | "page_view" | "export";

export type AnalyticsPayload = Record<string, unknown>;

/**
 * Fire-and-forget tracking call. Never throws. Never awaits.
 * The RPC `track_event` is SECURITY DEFINER and reads auth.uid() server-side.
 */
export function trackEvent(
  eventType: AnalyticsEventType,
  route: string | null = null,
  payload: AnalyticsPayload = {},
): void {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  void supabase
    .rpc("track_event", {
      p_event_type: eventType,
      p_route: route,
      p_payload: payload,
    })
    .then(({ error }) => {
      if (error) {
        // Soft-fail: never break UX over telemetry.
        console.warn(`[tracking] track_event(${eventType}) failed:`, error.message);
      }
    });
}
