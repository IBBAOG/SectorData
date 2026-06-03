"""
Fanout: turn one alert_events row into one alert_outbox row per active
subscriber of the source.

fanout_event(slug, event_id) reads active recipients via the service-only RPC
alerts_active_recipients and upserts an outbox row per (subscription, event)
with ON CONFLICT (subscription_id, event_id) DO NOTHING — so re-running never
duplicates a delivery. Returns the number of subscriptions fanned out to.
"""
from __future__ import annotations

import logging

from scripts.client_alerts._core.supabase_client import get_client

logger = logging.getLogger(__name__)


def fanout_event(slug: str, event_id: str) -> int:
    """Create queued outbox rows for every active subscriber of `slug`."""
    client = get_client()

    recips = (
        client.rpc("alerts_active_recipients", {"p_source_slug": slug})
        .execute()
        .data
    ) or []

    if not recips:
        logger.info("fanout[%s]: no active subscribers — nothing to queue", slug)
        return 0

    rows = [
        {
            "subscription_id": r["subscription_id"],
            "event_id": event_id,
            "status": "queued",
        }
        for r in recips
    ]

    client.table("alert_outbox").upsert(
        rows,
        on_conflict="subscription_id,event_id",
        ignore_duplicates=True,
    ).execute()

    logger.info(
        "fanout[%s]: queued outbox for %d subscriber(s) on event %s",
        slug, len(rows), event_id,
    )
    return len(rows)
