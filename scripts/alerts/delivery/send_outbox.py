"""
Delivery worker: reads alert_outbox WHERE status='queued' and sends via Resend.

Idempotency guarantees:
  - status='sent' is terminal — re-runs never reprocess sent rows.
  - status='failed' is terminal — re-runs skip. Admin can requeue via RPC.
  - Resend Idempotency-Key = outbox.id (UUID) — Resend deduplicates retries.
  - Pre-check against Resend suppression list — suppressed addresses get status='skipped'.

Failure modes:
  - Transient (5xx, timeout, 0): send_attempts++, status stays 'queued'. Retry next run.
  - Permanent (4xx): status='failed', error captured.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from scripts.alerts.supabase_client import get_client
from scripts.alerts.delivery.resend_client import send_email, list_suppressions
from scripts.alerts.delivery.render import (
    render_alert_instant,
    render_alert_coalesced,
    render_confirmation,
)

logger = logging.getLogger(__name__)


def send_pending_outbox(batch_limit: int = 100) -> dict[str, int]:
    """
    Process up to batch_limit queued outbox rows and send emails.

    Returns counts: {sent, skipped, failed, transient}
    """
    client = get_client()
    counts = {"sent": 0, "skipped": 0, "failed": 0, "transient": 0}

    # Load suppression list once per batch (fail-open on error)
    suppressed = list_suppressions()
    logger.info("send_outbox: suppression list has %d addresses", len(suppressed))

    # Fetch queued rows
    rows_resp = (
        client.table("alert_outbox")
        .select("id, subscriber_id, event_id, send_attempts, coalesced_payload")
        .eq("status", "queued")
        .order("id")
        .limit(batch_limit)
        .execute()
    )
    rows = rows_resp.data or []
    logger.info("send_outbox: %d queued rows to process", len(rows))

    if not rows:
        return counts

    # Pre-load all needed subscribers, events, sources in batch
    subscriber_ids = list({r["subscriber_id"] for r in rows})
    event_ids = list({r["event_id"] for r in rows})

    subs_resp = (
        client.table("alert_subscribers")
        .select("id, email, source_slug, unsubscribe_token, confirmation_token, is_confirmed")
        .in_("id", subscriber_ids)
        .execute()
    )
    subs_by_id: dict[str, dict] = {s["id"]: s for s in (subs_resp.data or [])}

    events_resp = (
        client.table("alert_events")
        .select("id, source_slug, event_key, payload, detected_at")
        .in_("id", event_ids)
        .execute()
    )
    events_by_id: dict[str, dict] = {e["id"]: e for e in (events_resp.data or [])}

    # Collect unique source slugs and load sources
    source_slugs = list(
        {subs_by_id[r["subscriber_id"]]["source_slug"]
         for r in rows if r["subscriber_id"] in subs_by_id}
    )
    sources_resp = (
        client.table("alert_sources")
        .select("source_slug, display_name, description, metadata")
        .in_("source_slug", source_slugs)
        .execute()
    )
    sources_by_slug: dict[str, dict] = {
        s["source_slug"]: s for s in (sources_resp.data or [])
    }

    for row in rows:
        outbox_id: str = row["id"]
        subscriber_id: str = row["subscriber_id"]
        event_id: str = row["event_id"]
        send_attempts: int = row.get("send_attempts", 0)
        coalesced_payload_raw = row.get("coalesced_payload")

        subscriber = subs_by_id.get(subscriber_id)
        event = events_by_id.get(event_id)

        if not subscriber or not event:
            logger.warning(
                "send_outbox: outbox %s missing subscriber or event — skipping", outbox_id
            )
            _update_outbox(client, outbox_id, "failed", error="subscriber or event not found")
            counts["failed"] += 1
            continue

        email_addr: str = subscriber["email"]
        source_slug: str = subscriber["source_slug"]
        source = sources_by_slug.get(source_slug, {"source_slug": source_slug, "display_name": source_slug})

        # Pre-check suppression list
        if email_addr in suppressed:
            logger.info("send_outbox: %s is suppressed — skipping outbox %s", email_addr, outbox_id)
            _update_outbox(client, outbox_id, "skipped")
            counts["skipped"] += 1
            continue

        # Determine template type
        is_confirmation = event["event_key"].startswith("confirmation:")
        is_coalesced = bool(coalesced_payload_raw)

        try:
            if is_confirmation:
                html, text = render_confirmation(subscriber=subscriber, source=source)
                subject = f"[SectorData Alerts] Confirm your subscription — {source.get('display_name', source_slug)}"
            elif is_coalesced:
                coalesced_data = json.loads(coalesced_payload_raw) if isinstance(coalesced_payload_raw, str) else coalesced_payload_raw
                coalesced_events = coalesced_data.get("events", [event])
                html, text = render_alert_coalesced(
                    subscriber=subscriber,
                    events=coalesced_events,
                    source=source,
                )
                subject = (
                    f"[SectorData Alerts] {len(coalesced_events)} updates — "
                    f"{source.get('display_name', source_slug)}"
                )
            else:
                html, text = render_alert_instant(
                    subscriber=subscriber,
                    event=event,
                    source=source,
                )
                payload = event.get("payload", {})
                period_info = (
                    payload.get("period") or payload.get("date") or
                    payload.get("week") or payload.get("year") or ""
                )
                subject = (
                    f"[SectorData Alerts] {source.get('display_name', source_slug)}"
                    + (f" — {period_info}" if period_info else "")
                )
        except Exception as exc:
            logger.error(
                "send_outbox: template render failed for outbox %s: %s", outbox_id, exc, exc_info=True
            )
            _update_outbox(client, outbox_id, "failed", error=f"render error: {exc}")
            counts["failed"] += 1
            continue

        # Send via Resend
        result = send_email(
            to=email_addr,
            subject=subject,
            html=html,
            text=text,
            idempotency_key=outbox_id,  # UUID — Resend deduplicates
        )

        now_utc = datetime.now(timezone.utc).isoformat()
        provider_message_id = result.get("provider_message_id")
        status_code = result.get("status_code", 0)

        # Log to alert_email_log (append-only audit)
        _insert_email_log(
            client,
            outbox_id=outbox_id,
            email=email_addr,
            subject=subject,
            status="sent" if result["success"] else (
                "failed" if (status_code and 400 <= status_code < 500) else "transient"
            ),
            provider_message_id=provider_message_id,
            provider_response=result,
        )

        if result["success"]:
            _update_outbox(
                client, outbox_id, "sent",
                sent_at=now_utc,
                provider_message_id=provider_message_id,
            )
            counts["sent"] += 1
            logger.info("send_outbox: sent outbox %s to %s", outbox_id, email_addr)

        elif status_code and 400 <= status_code < 500:
            # Permanent failure
            _update_outbox(
                client, outbox_id, "failed",
                error=result.get("error", f"HTTP {status_code}"),
                send_attempts=send_attempts + 1,
                last_attempt_at=now_utc,
            )
            counts["failed"] += 1
            logger.warning(
                "send_outbox: permanent failure outbox %s status=%d", outbox_id, status_code
            )

        else:
            # Transient — keep queued, increment attempts
            _update_outbox(
                client, outbox_id, "queued",
                send_attempts=send_attempts + 1,
                last_attempt_at=now_utc,
            )
            counts["transient"] += 1
            logger.warning(
                "send_outbox: transient failure outbox %s (attempt %d)",
                outbox_id,
                send_attempts + 1,
            )

    logger.info("send_outbox complete: %s", counts)
    return counts


def _update_outbox(
    client,
    outbox_id: str,
    status: str,
    *,
    sent_at: str | None = None,
    provider_message_id: str | None = None,
    error: str | None = None,
    send_attempts: int | None = None,
    last_attempt_at: str | None = None,
) -> None:
    update: dict = {"status": status}
    if sent_at is not None:
        update["sent_at"] = sent_at
    if provider_message_id is not None:
        update["provider_message_id"] = provider_message_id
    if error is not None:
        update["error"] = error
    if send_attempts is not None:
        update["send_attempts"] = send_attempts
    if last_attempt_at is not None:
        update["last_attempt_at"] = last_attempt_at
    try:
        client.table("alert_outbox").update(update).eq("id", outbox_id).execute()
    except Exception as exc:
        logger.error("send_outbox: failed to update outbox %s: %s", outbox_id, exc)


def _insert_email_log(
    client,
    *,
    outbox_id: str,
    email: str,
    subject: str,
    status: str,
    provider_message_id: str | None,
    provider_response: dict,
) -> None:
    try:
        client.table("alert_email_log").insert(
            {
                "outbox_id": outbox_id,
                "email": email,
                "subject": subject,
                "status": status,
                "provider_message_id": provider_message_id,
                "provider_response": provider_response,
            }
        ).execute()
    except Exception as exc:
        logger.error("send_outbox: failed to insert email log for outbox %s: %s", outbox_id, exc)
