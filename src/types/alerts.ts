// ─── Alerts module types ──────────────────────────────────────────────────────
//
// Shared types for the /alerts dashboard (user-facing email subscription UI).
// Backend contracts defined in docs/alerts/PRD.md.
//
// NOTE: never expose confirmation_token or unsubscribe_token in the DOM.
//       They only travel via email links (URL query params) to the /alerts/confirm
//       and /alerts/unsubscribe landing pages.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Source catalog (from list_alert_sources) ────────────────────────────────

export type AlertSourceCategory =
  | "Fuel Distribution"
  | "Oil & Gas"
  | "Vessels"
  | "Proprietary";

export interface AlertSource {
  source_slug: string;
  category: AlertSourceCategory;
  display_name: string;
  description: string | null;
  frequency_hint: string | null;
  // detection_module is stripped by the RPC view (alert_sources_public_v)
}

// ─── Subscription (from list_my_subscriptions) ──────────────────────────────

export interface MySubscription {
  source_slug: string;
  is_active: boolean;
  is_confirmed: boolean;
  created_at: string;
}

// ─── Recent alert feed item (from list_my_recent_alerts) ────────────────────

export interface RecentAlertItem {
  source_slug: string;
  display_name?: string; // joined from alert_sources by the RPC
  payload: Record<string, unknown>;
  status: "queued" | "sending" | "sent" | "failed" | "skipped";
  sent_at: string | null;
}

// ─── RPC return shapes ───────────────────────────────────────────────────────

export interface SubscribeResult {
  // Backend contract: { subscribed: int, confirmation_sent: bool, rate_limited: bool, error?: string }
  // confirmation_sent=false  → insta-activated (authenticated user, email matches auth.users.email)
  // confirmation_sent=true   → double opt-in required (anon or email override)
  // rate_limited=true        → server blocked the request (max 10 signups/IP/hour)
  subscribed: number;
  confirmation_sent: boolean;
  rate_limited: boolean;
  error?: string;
}

export interface ConfirmResult {
  success: boolean;
  subscribed_count: number;
  // Backend returns 'token_invalid_or_expired' as a single error code for both
  // invalid and expired tokens. Frontend treats it as expired (allows resend).
  error?: "token_invalid_or_expired" | string;
}

export interface ResendConfirmResult {
  sent: boolean;
  retry_after_seconds?: number;
  error?: string;
}

export interface UnsubscribeResult {
  success: boolean;
  error?: string;
}

export interface UnsubscribeAllResult {
  success: boolean;
  count: number;
  error?: string;
}

// ─── UI state helpers ────────────────────────────────────────────────────────

export type SubscribeFlowState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "needs_confirmation" }       // anon flow — requires_confirmation: true
  | { kind: "activated"; count: number } // logged-in + email matches auth — insta-confirm
  | { kind: "error"; message: string };

export type ConfirmFlowState =
  | { kind: "loading" }
  | { kind: "success"; count: number }
  | { kind: "expired"; token: string }  // token kept for potential UX use (e.g. deeplink back)
  | { kind: "invalid" }
  | { kind: "error"; message: string };

export type UnsubscribeFlowState =
  | { kind: "loading" }
  | { kind: "success"; all: boolean; count?: number; displayName?: string }
  | { kind: "error"; message: string };
