/**
 * Admin RPC wrappers for the Alerts product (cloud, multi-recipient).
 *
 * All underlying RPCs are SECURITY DEFINER + `public.is_admin()` gated.
 * This file is intentionally separate from `src/lib/rpc.ts` to avoid a
 * merge conflict with `worker_dash-alerts`, which adds user-facing wrappers
 * there in parallel (Regra G).
 *
 * Usage: import from this file in admin-panel only.
 */

import { getSupabaseClient } from "./supabaseClient";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AlertSubscriber {
  id: string;
  email: string;
  source_slug: string;
  is_confirmed: boolean;
  is_active: boolean;
  created_at: string;
}

// Shape mirrors the JSONB returned by admin_subscriber_stats() in
// 20260525210030_alerts_admin_rpcs.sql:
//   { totals, per_source, sent_7d, bounced_7d, bounce_rate_7d_pct }
export interface AlertSubscriberStatsTotals {
  subscribers_total: number;
  subscribers_active: number;
  subscribers_confirmed: number;
  unique_emails: number;
}

export interface AlertSubscriberStatsPerSource {
  source_slug: string;
  subscribers_total: number;
  subscribers_active: number;
  subscribers_confirmed: number;
}

export interface AlertSubscriberStats {
  totals: AlertSubscriberStatsTotals;
  per_source: AlertSubscriberStatsPerSource[];
  sent_7d: number;
  bounced_7d: number;
  bounce_rate_7d_pct: number;
}

export interface AlertSource {
  source_slug: string;
  display_name: string;
  category: string;
  is_active: boolean;
}

// Bug 3 fix: widen status union to match all values written by delivery worker
// and Resend webhook handler (see alert_email_log comment in 20260525210010).
export type EmailLogStatus =
  | "sent"
  | "delivered"
  | "bounced"
  | "complained"
  | "opened"
  | "clicked"
  | "failed";

export interface AlertEmailLogEntry {
  id: string;
  email: string;
  subject: string | null;
  status: EmailLogStatus;
  provider_message_id: string | null;
  recorded_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function supabase() {
  const client = getSupabaseClient();
  if (!client) throw new Error("Supabase client not available");
  return client;
}

// ── RPC wrappers ──────────────────────────────────────────────────────────────

/**
 * List subscribers, optionally filtered by source_slug.
 * Calls `admin_list_subscribers(p_source_slug, p_limit)`.
 */
export async function rpcAdminListSubscribers(
  p_source_slug?: string,
  p_limit = 100,
): Promise<AlertSubscriber[]> {
  try {
    const sb = supabase();
    const { data, error } = await sb.rpc("admin_list_subscribers", {
      p_source_slug: p_source_slug ?? null,
      p_limit,
    });
    if (error) throw error;
    return (data as AlertSubscriber[]) ?? [];
  } catch (err) {
    console.error("[alertsAdminRpc] admin_list_subscribers error:", err);
    return [];
  }
}

/**
 * Force-unsubscribe a subscriber (sets is_active=false, deletes pending tokens).
 * Calls `admin_force_unsubscribe(p_subscriber_id)`.
 */
export async function rpcAdminForceUnsubscribe(
  p_subscriber_id: string,
): Promise<boolean> {
  try {
    const sb = supabase();
    const { data, error } = await sb.rpc("admin_force_unsubscribe", {
      p_subscriber_id,
    });
    if (error) throw error;
    return (data as boolean) ?? false;
  } catch (err) {
    console.error("[alertsAdminRpc] admin_force_unsubscribe error:", err);
    return false;
  }
}

/**
 * Requeue a failed outbox entry (resets status to 'queued', send_attempts to 0).
 * Calls `admin_requeue_outbox(p_outbox_id)`.
 */
export async function rpcAdminRequeueOutbox(
  p_outbox_id: string,
): Promise<boolean> {
  try {
    const sb = supabase();
    const { data, error } = await sb.rpc("admin_requeue_outbox", {
      p_outbox_id,
    });
    if (error) throw error;
    return (data as boolean) ?? false;
  } catch (err) {
    console.error("[alertsAdminRpc] admin_requeue_outbox error:", err);
    return false;
  }
}

/**
 * Send a test event for a given source slug (triggers the full alert pipeline
 * for that source with synthetic payload). Returns the event UUID.
 * Calls `admin_send_test_event(p_source_slug)`.
 */
export async function rpcAdminSendTestEvent(
  p_source_slug: string,
): Promise<string | null> {
  try {
    const sb = supabase();
    const { data, error } = await sb.rpc("admin_send_test_event", {
      p_source_slug,
    });
    if (error) throw error;
    return (data as string) ?? null;
  } catch (err) {
    console.error("[alertsAdminRpc] admin_send_test_event error:", err);
    return null;
  }
}

/**
 * Fetch recent email log entries (sent, bounced, complained, failed).
 * Calls `admin_email_log_recent(p_limit)`.
 */
export async function rpcAdminEmailLogRecent(
  p_limit = 200,
): Promise<AlertEmailLogEntry[]> {
  try {
    const sb = supabase();
    const { data, error } = await sb.rpc("admin_email_log_recent", {
      p_limit,
    });
    if (error) throw error;
    return (data as AlertEmailLogEntry[]) ?? [];
  } catch (err) {
    console.error("[alertsAdminRpc] admin_email_log_recent error:", err);
    return [];
  }
}

/**
 * Fetch subscriber stats: totals, bounce/complaint rates, per-source breakdown.
 * Calls `admin_subscriber_stats()`.
 */
export async function rpcAdminSubscriberStats(): Promise<AlertSubscriberStats | null> {
  try {
    const sb = supabase();
    const { data, error } = await sb.rpc("admin_subscriber_stats");
    if (error) throw error;
    return (data as AlertSubscriberStats) ?? null;
  } catch (err) {
    console.error("[alertsAdminRpc] admin_subscriber_stats error:", err);
    return null;
  }
}

/**
 * Toggle the is_active flag on an alert source.
 * Calls `admin_toggle_source_active(p_source_slug, p_is_active)`.
 */
export async function rpcAdminToggleSourceActive(
  p_source_slug: string,
  p_is_active: boolean,
): Promise<boolean> {
  try {
    const sb = supabase();
    const { data, error } = await sb.rpc("admin_toggle_source_active", {
      p_source_slug,
      p_is_active,
    });
    if (error) throw error;
    return (data as boolean) ?? false;
  } catch (err) {
    console.error("[alertsAdminRpc] admin_toggle_source_active error:", err);
    return false;
  }
}

/**
 * Fetch all alert sources directly via PostgREST (no RPC needed — table is
 * Admin-readable via RLS policy on `alert_sources`).
 */
export async function fetchAlertSources(): Promise<AlertSource[]> {
  try {
    const sb = supabase();
    const { data, error } = await sb
      .from("alert_sources")
      .select("source_slug, display_name, category, is_active")
      .order("category", { ascending: true })
      .order("display_name", { ascending: true });
    if (error) throw error;
    return (data as AlertSource[]) ?? [];
  } catch (err) {
    console.error("[alertsAdminRpc] fetchAlertSources error:", err);
    return [];
  }
}

/**
 * Fetch outbox rows with status='failed' for the Outbox Repair panel.
 *
 * Bug 2 fix: alert_outbox has NO subject or source_slug columns. They live in
 * alert_email_log (subject) and alert_events (source_slug). Use PostgREST
 * embed to pull both via FK relationships.
 */
// PostgREST returns related rows as arrays even for FK-to-single relationships.
// We access element [0] for the singular FK joins.
export interface AlertOutboxRowRaw {
  id: string;
  subscriber_id: string;
  status: string;
  send_attempts: number;
  last_attempt_at: string | null;
  created_at: string;
  event: Array<{
    source_slug: string;
    event_key: string;
    payload: Record<string, unknown>;
  }>;
  subscriber: Array<{
    email: string;
  }>;
}

// Flattened shape consumed by Views — singular (nullable) instead of array.
export interface AlertOutboxRow {
  id: string;
  subscriber_id: string;
  status: string;
  send_attempts: number;
  last_attempt_at: string | null;
  created_at: string;
  event: {
    source_slug: string;
    event_key: string;
    payload: Record<string, unknown>;
  } | null;
  subscriber: {
    email: string;
  } | null;
}

export async function fetchFailedOutboxRows(limit = 100): Promise<AlertOutboxRow[]> {
  try {
    const sb = supabase();
    const { data, error } = await sb
      .from("alert_outbox")
      .select(`
        id,
        subscriber_id,
        status,
        send_attempts,
        last_attempt_at,
        created_at,
        event:alert_events!event_id(source_slug, event_key, payload),
        subscriber:alert_subscribers!subscriber_id(email)
      `)
      .eq("status", "failed")
      .order("last_attempt_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    // Flatten the PostgREST array-embed into singular nullable objects
    return ((data ?? []) as AlertOutboxRowRaw[]).map((row) => ({
      id: row.id,
      subscriber_id: row.subscriber_id,
      status: row.status,
      send_attempts: row.send_attempts,
      last_attempt_at: row.last_attempt_at,
      created_at: row.created_at,
      event: row.event?.[0] ?? null,
      subscriber: row.subscriber?.[0] ?? null,
    }));
  } catch (err) {
    console.error("[alertsAdminRpc] fetchFailedOutboxRows error:", err);
    return [];
  }
}
