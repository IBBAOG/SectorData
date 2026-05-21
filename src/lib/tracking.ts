// ─────────────────────────────────────────────────────────────────────────────
// tracking.ts — fire-and-forget analytics event helper
//
// Calls the SECURITY DEFINER RPC `track_event` on Supabase. The RPC inspects
// `auth.uid()` server-side:
//   - If logged in,  inserts (user_id = auth.uid(), visitor_id = NULL)
//   - If anonymous,  inserts (user_id = NULL, visitor_id = p_visitor_id) when
//                    a visitor_id is provided; otherwise it's a silent no-op.
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
//
// Visitor id sourcing: the value comes from UserProfileContext (read once on
// mount via /api/visitor-id). Callers pass it explicitly as the 4th argument
// because the cookie itself is HttpOnly and unreadable from client JS.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabaseClient } from "./supabaseClient";

export type AnalyticsEventType = "login" | "page_view" | "export";

export type AnalyticsPayload = Record<string, unknown>;

/**
 * Fire-and-forget tracking call. Never throws. Never awaits.
 * The RPC `track_event` is SECURITY DEFINER and reads auth.uid() server-side.
 *
 * @param eventType  One of 'login' | 'page_view' | 'export'.
 * @param route      Pathname for page_view/export (null for login).
 * @param payload    Arbitrary JSON metadata (bytes count, filter snapshot, ...).
 * @param visitorId  Anonymous visitor id from UserProfileContext.visitorId.
 *                   Pass `null`/`undefined` for logged-in callers (the RPC
 *                   resolves user_id from auth.uid() instead).
 */
export function trackEvent(
  eventType: AnalyticsEventType,
  route: string | null = null,
  payload: AnalyticsPayload = {},
  visitorId: string | null = null,
): void {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  void supabase
    .rpc("track_event", {
      p_event_type: eventType,
      p_route: route,
      p_payload: payload,
      p_visitor_id: visitorId,
    })
    .then(({ error }) => {
      if (error) {
        // Soft-fail: never break UX over telemetry.
        console.warn(`[tracking] track_event(${eventType}) failed:`, error.message);
      }
    });
}
