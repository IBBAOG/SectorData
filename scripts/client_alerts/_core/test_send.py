"""
Production-safe test sends for the Client Alerts engine.

run_test_send(slug, to=None) SIMULATES a base update so the email fires NOW,
without ever touching real data or the watermark:

  * It reads the base's REAL current period via alerts_current_period (so the
    test email shows a realistic "Period: …").
  * It inserts a SYNTHETIC alert_events row keyed `test:<slug>:<unix-epoch>`
    (UNIQUE on (source_slug, event_key); a fresh epoch each call → never
    collides), with payload {test, simulated, period, source_slug,
    display_name, frontend_route, message}.
  * It fans out to the source's ACTIVE subscribers and delivers IMMEDIATELY via
    SMTP — ALWAYS immediate, even for a base whose cadence is 'digest' (the test
    bypasses the digest deferral so the operator gets the email right away).
  * If `to` is given, it ALSO renders the same alert and sends one extra copy
    straight to that address (no subscription required).

CRITICAL production-safety guarantees:
  * NEVER writes to the base's own data table.
  * NEVER touches alert_source_state (the real-period watermark) — so a test can
    never make the engine "skip" a genuine future update.
  * The only artifacts are a `test:`-prefixed alert_events row and its
    outbox / email_log rows — all trivially purgeable by the test:* key prefix.

Returns a summary dict:
  {event_id, period, recipients (subscriber emails fanned out),
   queued (#outbox rows), counts (deliver counts dict),
   extra_to (email|None), extra_sent (bool|None)}.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

from scripts.client_alerts._core.supabase_client import get_client
from scripts.client_alerts._core.fanout import fanout_event
from scripts.client_alerts._core.deliver import send_pending_outbox
from scripts.client_alerts._core.render import render_immediate
from scripts.client_alerts._core.gmail_client import send_email, validate_api_key

logger = logging.getLogger(__name__)


def _load_source(client, slug: str) -> dict | None:
    rows = (
        client.table("alert_sources")
        .select("source_slug, display_name, metadata, cadence, is_active")
        .eq("source_slug", slug)
        .limit(1)
        .execute()
        .data
    ) or []
    return rows[0] if rows else None


def _current_period(client, slug: str) -> str | None:
    period = client.rpc("alerts_current_period", {"p_source_slug": slug}).execute().data
    if period in (None, ""):
        return None
    return period


def run_test_send(slug: str, to: str | None = None) -> dict:
    """Simulate an update for `slug` and deliver it now. See module docstring."""
    client = get_client()

    source = _load_source(client, slug)
    if source is None:
        raise ValueError(f"unknown source_slug '{slug}' (not in alert_sources)")

    display_name = source.get("display_name") or slug
    metadata = source.get("metadata") or {}
    frontend_route = metadata.get("frontend_route")

    # REAL current period (purely informational for the test email).
    period = _current_period(client, slug)
    logger.info(
        "test[%s]: real current period = %s (base will NOT be advanced)",
        slug, period if period is not None else "—",
    )

    # Unique, test-prefixed event key. A fresh epoch each call avoids ON CONFLICT
    # so repeated tests each produce a distinct event/email.
    event_key = f"test:{slug}:{int(time.time())}"
    payload = {
        "test": True,
        "simulated": True,
        "period": period,
        "source_slug": slug,
        "display_name": display_name,
        "frontend_route": frontend_route,
        "message": f"TEST — {display_name} updated (simulated).",
    }

    # Direct service-role insert (NOT the period-gated emit path) so the test
    # event lands regardless of the watermark, and the watermark is untouched.
    ins = (
        client.table("alert_events")
        .insert(
            {"source_slug": slug, "event_key": event_key, "payload": payload}
        )
        .execute()
    )
    inserted = ins.data or []
    if not inserted:
        raise RuntimeError(f"test[{slug}]: failed to insert synthetic event")
    event_id = inserted[0]["id"]
    detected_at = inserted[0].get("detected_at") or datetime.now(timezone.utc).isoformat()
    logger.info("test[%s]: inserted synthetic event %s (%s)", slug, event_id, event_key)

    # Fan out to the source's active subscribers and deliver immediately —
    # ALWAYS immediate for a test, even when the base cadence is 'digest'.
    recips = (
        client.rpc("alerts_active_recipients", {"p_source_slug": slug})
        .execute()
        .data
    ) or []
    recipient_emails = sorted({(r.get("email") or "").lower() for r in recips if r.get("email")})

    queued = fanout_event(slug, event_id)
    if queued:
        logger.info("test[%s]: fanned out to %d subscriber(s); delivering…", slug, queued)
        counts = send_pending_outbox()
    else:
        logger.info("test[%s]: no active subscribers to fan out to", slug)
        counts = {"sent": 0, "skipped": 0, "failed": 0, "transient": 0}
    logger.info("test[%s]: subscriber delivery counts %s", slug, counts)

    # Optional extra copy to an explicit address (no subscription needed).
    extra_sent: bool | None = None
    if to:
        # Re-use the same rendered immediate email; no unsubscribe link (this is
        # not a managed subscription — it's a one-off operator copy).
        event_for_render = {
            "source_slug": slug,
            "event_key": event_key,
            "payload": payload,
            "detected_at": detected_at,
        }
        source_for_render = {
            "source_slug": slug,
            "display_name": display_name,
            "metadata": metadata,
        }
        # Guard the SMTP login once (validate_api_key caches) so a bad password
        # surfaces the same way the fanout path would.
        if not validate_api_key():
            raise SystemExit(1)
        html, text = render_immediate(
            event=event_for_render, source=source_for_render, unsubscribe_token=None
        )
        period_sfx = f" — {period}" if period else ""
        subject = f"[SectorData Alerts] {display_name}{period_sfx} (TEST)"
        result = send_email(to=to, subject=subject, html=html, text=text)
        extra_sent = bool(result.get("success"))
        if extra_sent:
            logger.info("test[%s]: extra copy sent to %s", slug, to)
        else:
            logger.warning(
                "test[%s]: extra copy to %s FAILED: %s (status %s)",
                slug, to, result.get("error"), result.get("status_code"),
            )

    summary = {
        "event_id": event_id,
        "period": period,
        "recipients": recipient_emails,
        "queued": queued,
        "counts": counts,
        "extra_to": to,
        "extra_sent": extra_sent,
    }
    logger.info(
        "test[%s] SUMMARY: event=%s period=%s subscribers=%d delivered=%s%s",
        slug, event_id, period, len(recipient_emails), counts,
        f" extra_to={to}({'sent' if extra_sent else 'FAILED'})" if to else "",
    )
    return summary


def reset_watermark(slug: str) -> bool:
    """
    DELETE the alert_source_state row for `slug` (service-role) so the next real
    run re-detects the current period from scratch. Returns True if a row was
    removed. Secondary test mode — re-exercises genuine period detection.
    """
    client = get_client()
    existing = (
        client.table("alert_source_state")
        .select("source_slug")
        .eq("source_slug", slug)
        .limit(1)
        .execute()
        .data
    ) or []
    client.table("alert_source_state").delete().eq("source_slug", slug).execute()
    removed = bool(existing)
    if removed:
        logger.info("reset-watermark[%s]: deleted alert_source_state row", slug)
    else:
        logger.info("reset-watermark[%s]: no watermark row existed (already clean)", slug)
    return removed


def list_active_source_slugs() -> list[str]:
    """All active source slugs (alert_sources WHERE is_active=true), sorted."""
    client = get_client()
    rows = (
        client.table("alert_sources")
        .select("source_slug")
        .eq("is_active", True)
        .order("source_slug")
        .execute()
        .data
    ) or []
    return [r["source_slug"] for r in rows]
