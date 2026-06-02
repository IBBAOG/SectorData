"""
Delivery worker: read alert_outbox WHERE status='queued' and send via Gmail API.

Email resolution (logged-in product): the outbox row references a subscription,
NOT an email. Emails are resolved fresh from auth.users via the service-only RPC
alerts_active_recipients(slug), per distinct source in the batch, into a
{subscription_id: (email, unsubscribe_token)} map. A queued row whose
subscription is no longer active/resolvable is marked 'skipped'.

Idempotency / failure contract:
  - status='sent'    is terminal — re-runs never reprocess.
  - status='failed'  is terminal (permanent 4xx).
  - status='skipped' is terminal (suppressed / unresolved subscriber).
  - The terminal 'sent' state is what prevents duplicate sends across runs (the
    Gmail backend has no idempotency key; idempotency_key is passed but ignored).
  - Transient (5xx/timeout/0): send_attempts++, stays 'queued', retried next run.

Returns counts: {sent, skipped, failed, transient}.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from scripts.client_alerts._core.supabase_client import get_client
from scripts.client_alerts._core.gmail_client import (
    send_email,
    list_suppressions,
    validate_api_key,
)
from scripts.client_alerts._core.render import render_immediate

logger = logging.getLogger(__name__)

# PostgREST embed: outbox -> event (via event_id FK) -> source (via source_slug FK).
_OUTBOX_SELECT = (
    "id, subscription_id, event_id, send_attempts, "
    "alert_events!inner("
    "  source_slug, event_key, payload, detected_at, "
    "  alert_sources!inner( display_name, metadata )"
    ")"
)


def _subject_for(source: dict, payload: dict) -> str:
    display = source.get("display_name", source.get("source_slug", "Alert"))
    period = payload.get("period") or ""
    base = f"[SectorData Alerts] {display}"
    return f"{base} — {period}" if period else base


def send_pending_outbox(batch_limit: int = 100) -> dict[str, int]:
    """Process up to batch_limit queued outbox rows. See module docstring."""
    client = get_client()
    counts = {"sent": 0, "skipped": 0, "failed": 0, "transient": 0}

    # Abort visibly if the key is bad (logs ERROR + non-zero exit at the step).
    if not validate_api_key():
        raise SystemExit(1)

    suppressed = list_suppressions()
    logger.info("deliver: suppression list has %d address(es)", len(suppressed))

    rows_resp = (
        client.table("alert_outbox")
        .select(_OUTBOX_SELECT)
        .eq("status", "queued")
        .order("id")
        .limit(batch_limit)
        .execute()
    )
    rows = rows_resp.data or []
    logger.info("deliver: %d queued row(s) to process", len(rows))
    if not rows:
        return counts

    # Resolve emails per distinct source in the batch.
    source_slugs = sorted({
        (r.get("alert_events") or {}).get("source_slug")
        for r in rows
        if (r.get("alert_events") or {}).get("source_slug")
    })
    recip_map: dict[str, tuple[str, str]] = {}  # subscription_id -> (email, token)
    for slug in source_slugs:
        recips = (
            client.rpc("alerts_active_recipients", {"p_source_slug": slug})
            .execute()
            .data
        ) or []
        for r in recips:
            recip_map[r["subscription_id"]] = (
                (r.get("email") or "").lower(),
                r.get("unsubscribe_token"),
            )

    for row in rows:
        outbox_id = row["id"]
        subscription_id = row["subscription_id"]
        send_attempts = row.get("send_attempts", 0) or 0
        event = row.get("alert_events") or {}
        source = event.get("alert_sources") or {}
        payload = event.get("payload") or {}
        # display_name lives on the source; keep source_slug for subject fallback.
        source = {**source, "source_slug": event.get("source_slug")}

        email_token = recip_map.get(subscription_id)
        if not email_token or not email_token[0]:
            logger.info(
                "deliver: subscription %s no longer active/resolvable — skipping outbox %s",
                subscription_id, outbox_id,
            )
            _update_outbox(client, outbox_id, "skipped",
                           error="subscriber inactive or email unresolved")
            counts["skipped"] += 1
            continue

        email_addr, unsub_token = email_token

        if email_addr in suppressed:
            logger.info("deliver: %s suppressed — skipping outbox %s", email_addr, outbox_id)
            _update_outbox(client, outbox_id, "skipped")
            counts["skipped"] += 1
            continue

        try:
            html, text = render_immediate(
                event=event, source=source, unsubscribe_token=unsub_token,
            )
            subject = _subject_for(source, payload)
        except Exception as exc:
            logger.error(
                "deliver: render failed for outbox %s: %s", outbox_id, exc, exc_info=True
            )
            _update_outbox(client, outbox_id, "failed", error=f"render error: {exc}")
            counts["failed"] += 1
            continue

        result = send_email(
            to=email_addr,
            subject=subject,
            html=html,
            text=text,
            idempotency_key=outbox_id,  # accepted but unused (Gmail has no key)
        )

        now_utc = datetime.now(timezone.utc).isoformat()
        provider_message_id = result.get("provider_message_id")
        status_code = result.get("status_code", 0)

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
            _update_outbox(client, outbox_id, "sent",
                           sent_at=now_utc, provider_message_id=provider_message_id,
                           send_attempts=send_attempts + 1, last_attempt_at=now_utc)
            counts["sent"] += 1
            logger.info("deliver: sent outbox %s to %s", outbox_id, email_addr)
        elif status_code and 400 <= status_code < 500:
            _update_outbox(client, outbox_id, "failed",
                           error=result.get("error", f"HTTP {status_code}"),
                           send_attempts=send_attempts + 1, last_attempt_at=now_utc)
            counts["failed"] += 1
            logger.warning("deliver: permanent failure outbox %s status=%d", outbox_id, status_code)
        else:
            _update_outbox(client, outbox_id, "queued",
                           send_attempts=send_attempts + 1, last_attempt_at=now_utc)
            counts["transient"] += 1
            logger.warning(
                "deliver: transient failure outbox %s (attempt %d)",
                outbox_id, send_attempts + 1,
            )

    logger.info("deliver complete: %s", counts)
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
        logger.error("deliver: failed to update outbox %s: %s", outbox_id, exc)


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
        logger.error("deliver: failed to insert email log for outbox %s: %s", outbox_id, exc)
