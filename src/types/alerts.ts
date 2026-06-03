// ─────────────────────────────────────────────────────────────────────────────
// types/alerts.ts — TypeScript shapes for the rebuilt /alerts dashboard (Phase 4)
//
// Logged-in-only email subscription product. A Client toggles which data
// "bases" they want email alerts for; the subscriber's email is implicit (their
// auth email). No anonymous signup, no email field, no double opt-in, no
// confirmation tokens.
//
// Every shape here mirrors a SECURITY DEFINER RPC deployed in
// supabase/migrations/20260608100000_alerts_rebuild_new_schema.sql.
// ─────────────────────────────────────────────────────────────────────────────

/** Delivery cadence of a base, decided source-side by the backend engine.
 *  Shown in the UI as a READ-ONLY badge — there is no per-subscription
 *  immediate-vs-digest toggle in v1. */
export type AlertCadence = "immediate" | "digest";

/** Top-level grouping of subscribable bases. Free text from the DB; the four
 *  values below are the seeded categories. Kept as a widened string so a new
 *  category added DB-side never breaks the build. */
export type AlertCategory =
  | "Fuel Distribution"
  | "Oil & Gas"
  | "Vessels"
  | "Proprietary"
  | (string & {});

/** Delivery status of a single sent alert (from `alert_outbox.status`). */
export type AlertStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "bounced"
  | "failed"
  | (string & {});

// ─── list_subscribable_bases() row ───────────────────────────────────────────
//
// The catalog joined with the current user's flags. One row per subscribable
// base. `is_subscribed` reflects whether a subscription row exists at all;
// `sub_is_active` whether it is currently active (paused subscriptions keep the
// row but flip active off). For the v1 UI we treat "subscribed" as
// `is_subscribed && sub_is_active`.
export interface SubscribableBase {
  source_slug: string;
  category: AlertCategory;
  display_name: string;
  description: string | null;
  /** Human hint of update frequency, e.g. "Daily", "Weekly (Mon)", "Monthly". */
  frequency_hint: string | null;
  cadence: AlertCadence;
  is_subscribed: boolean;
  sub_is_active: boolean;
  /** Per-subscription cadence override (unused in v1 UI; always null/ignored). */
  cadence_override: string | null;
}

// ─── list_my_subscriptions() row ─────────────────────────────────────────────
//
// The current user's subscriptions (active and paused). `effective_cadence`
// resolves any override against the source-level cadence.
export interface MySubscription {
  source_slug: string;
  display_name: string;
  category: AlertCategory;
  is_active: boolean;
  effective_cadence: AlertCadence;
  created_at: string;
}

// ─── list_my_recent_alerts(limit) row ────────────────────────────────────────
//
// A read-only feed of recently sent alerts for the logged user. `payload`
// carries the deep-link `frontend_route` plus contextual fields written by the
// backend engine (`period`, `message`, ...).
export interface RecentAlert {
  outbox_id: string;
  source_slug: string;
  display_name: string;
  event_key: string;
  payload: RecentAlertPayload;
  status: AlertStatus;
  sent_at: string | null;
  detected_at: string | null;
}

/** Shape of `alert_events.payload` as surfaced by list_my_recent_alerts.
 *  All fields optional — older/synthetic events may omit some. */
export interface RecentAlertPayload {
  /** Lexicographically-sortable period key, e.g. "2026-04", "2026-W18",
   *  "2026-05-31", a year, or a timestamp — depends on the source period_kind. */
  period?: string | null;
  /** Deep link into the dashboard the base feeds, e.g. "/market-share". */
  frontend_route?: string | null;
  /** Pre-rendered human message from the engine. */
  message?: string | null;
  source_slug?: string | null;
  display_name?: string | null;
  table?: string | null;
  /** Present on admin-injected synthetic test events. */
  test?: boolean | null;
  [key: string]: unknown;
}

// ─── unsubscribe_by_token(token) result ──────────────────────────────────────
//
// The single anon-callable write, used by the email footer landing page.
// Idempotent: a re-click on an already-inactive subscription still returns
// success with `already_unsubscribed: true`.
export interface UnsubscribeResult {
  success: boolean;
  source_slug?: string | null;
  already_unsubscribed?: boolean | null;
  error?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin-only shapes for the /admin-panel "Alerts" tab.
//
// These mirror the SECURITY DEFINER, is_admin()-guarded RPCs `admin_alerts_*`
// deployed for the rebuilt client-alerts product. They are consumed ONLY by
// the admin panel — never by the Client-facing /alerts dashboard.
// ─────────────────────────────────────────────────────────────────────────────

/** Aggregate counters returned by `admin_alerts_stats()`. */
export interface AdminAlertsStats {
  totals: {
    subscriptions_total: number;
    subscriptions_active: number;
    unique_users: number;
  };
  per_source: AdminAlertsPerSource[];
  sent_7d: number;
  bounced_7d: number;
}

/** One row of the `per_source` array inside `admin_alerts_stats()`. */
export interface AdminAlertsPerSource {
  source_slug: string;
  subscriptions_total: number;
  subscriptions_active: number;
}

/** One row of `admin_alerts_list_subscribers(p_source_slug, p_limit)`. */
export interface AdminAlertsSubscriber {
  subscription_id: string;
  user_id: string;
  email: string;
  source_slug: string;
  is_active: boolean;
  cadence_override: string | null;
  created_at: string;
}

/** One row of `admin_alerts_email_log_recent(p_limit)`. */
export interface AdminAlertsEmailLogRow {
  id: string;
  outbox_id: string | null;
  email: string;
  subject: string;
  status: AlertStatus;
  provider_message_id: string | null;
  recorded_at: string;
}
