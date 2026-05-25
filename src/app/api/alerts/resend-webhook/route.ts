/**
 * POST /api/alerts/resend-webhook
 *
 * Handles Resend webhook events for the Alerts Product.
 *
 * Security:
 *   - Verifies the svix-signature header using RESEND_WEBHOOK_SECRET.
 *   - Uses Supabase service-role key (SUPABASE_SERVICE_KEY) — never anon key.
 *
 * Supported event types:
 *   email.sent | email.delivered | email.bounced | email.complained |
 *   email.opened | email.clicked
 *
 * On hard bounce or complaint:
 *   - Sets alert_subscribers.is_active = false for all rows with matching email.
 *
 * Reference: https://resend.com/docs/dashboard/webhooks/event-types
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_KEY not set");
  }
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

/**
 * Verify Resend webhook signature using svix-compatible HMAC-SHA256.
 *
 * Resend sends three headers:
 *   svix-id        — unique message ID
 *   svix-timestamp — Unix timestamp (seconds)
 *   svix-signature — "v1,<base64_signature>[,...]"
 *
 * Signed payload = "<svix-id>.<svix-timestamp>.<raw-body>"
 */
function verifyWebhookSignature(
  rawBody: string,
  headers: {
    "svix-id": string | null;
    "svix-timestamp": string | null;
    "svix-signature": string | null;
  },
  secret: string,
): boolean {
  const svixId = headers["svix-id"];
  const svixTimestamp = headers["svix-timestamp"];
  const svixSignature = headers["svix-signature"];

  if (!svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  // Timestamp tolerance: 5 minutes
  const ts = parseInt(svixTimestamp, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > 300) {
    return false;
  }

  const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;

  // Resend signs with the raw secret (not base64-encoded)
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(toSign);
  const expected = `v1,${hmac.digest("base64")}`;

  // svix-signature may contain multiple comma-separated signatures (rotation)
  const provided = svixSignature.split(" ");
  return provided.some((sig) => sig === expected);
}

// Map Resend event type to our audit log status string
const EVENT_TYPE_MAP: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.opened": "opened",
  "email.clicked": "clicked",
};

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // Webhook secret not configured — return 503 (service unavailable) rather than 500.
    // 503 signals a temporary configuration gap; Resend will retry automatically.
    // Cache-Control prevents CDN from caching this transient error state.
    return NextResponse.json(
      { error: "Webhook not configured (RESEND_WEBHOOK_SECRET missing)" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store, max-age=0" },
      },
    );
  }

  // Read raw body for signature verification
  const rawBody = await req.text();

  // Verify signature
  const valid = verifyWebhookSignature(
    rawBody,
    {
      "svix-id": req.headers.get("svix-id"),
      "svix-timestamp": req.headers.get("svix-timestamp"),
      "svix-signature": req.headers.get("svix-signature"),
    },
    webhookSecret,
  );

  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const eventType = body.type as string | undefined;
  const data = (body.data ?? {}) as Record<string, unknown>;

  if (!eventType) {
    return NextResponse.json({ error: "Missing event type" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const statusLabel = EVENT_TYPE_MAP[eventType] ?? eventType;

  // Extract identifiers from data.
  // Normalise to lowercase: subscribers are stored with lower(p_email) via RPC,
  // but Resend may echo the address in mixed case. Case-insensitive match required.
  const toEmail = (
    (data.to as string[] | undefined)?.[0] ?? (data.email as string | undefined) ?? ""
  ).toLowerCase();
  const messageId = (data.email_id as string | undefined) ?? null;

  // -------------------------------------------------------------------------
  // 1. INSERT into alert_email_log (append-only audit)
  // -------------------------------------------------------------------------
  await supabase.from("alert_email_log").insert({
    outbox_id: null, // Webhook events don't have outbox_id available
    email: toEmail,
    subject: (data.subject as string | undefined) ?? "",
    status: statusLabel,
    provider_message_id: messageId,
    provider_response: body,
  });

  // -------------------------------------------------------------------------
  // 2. Handle hard bounce or complaint → deactivate subscriber
  // -------------------------------------------------------------------------
  const isHardBounce =
    eventType === "email.bounced" &&
    (data.bounce as Record<string, unknown> | undefined)?.type === "hard";

  const isComplaint = eventType === "email.complained";

  if ((isHardBounce || isComplaint) && toEmail) {
    const { error } = await supabase
      .from("alert_subscribers")
      .update({ is_active: false })
      .eq("email", toEmail);

    if (error) {
      console.error(
        `[alerts-webhook] Failed to deactivate subscriber ${toEmail}:`,
        error.message,
      );
      // Still return 200 to prevent Resend from retrying — log is already written
    } else {
      console.log(
        `[alerts-webhook] Deactivated all subscriptions for ${toEmail} (reason: ${eventType})`,
      );
    }
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
