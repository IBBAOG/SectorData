"""
Fanout: scripts/alerts/fanout.py

Materialises alert_outbox rows for each new (event, subscriber) pair.

Idempotency guarantees:
  - UNIQUE(subscriber_id, event_id) in alert_outbox prevents double-rows.
  - ON CONFLICT DO NOTHING makes re-runs safe.

Coalescing:
  - If a source has metadata->>'coalesce_above' set and the number of pending
    events for that source in the current batch exceeds the threshold, those N
    rows are replaced with a single outbox row whose payload includes all events.
  - Default threshold: 10 (per PRD).
"""
from __future__ import annotations

import json
import logging
from collections import defaultdict
from typing import Any

from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)

DEFAULT_COALESCE_ABOVE = 10


def fanout_pending_events() -> dict[str, int]:
    """
    Fan out newly detected events to all active + confirmed subscribers.

    Returns dict with keys:
        created         — outbox rows created (non-coalesced)
        coalesced_groups — number of coalesced bundles created
    """
    client = get_client()

    # ------------------------------------------------------------------
    # 1. Find all alert_events that do NOT have a corresponding outbox row
    #    for each active+confirmed subscriber of the same source.
    #    We do this in Python due to supabase-py not supporting complex CTEs.
    # ------------------------------------------------------------------

    # Load all active+confirmed subscribers
    subs_resp = (
        client.table("alert_subscribers")
        .select("id, source_slug, email")
        .eq("is_active", True)
        .eq("is_confirmed", True)
        .execute()
    )
    subscribers: list[dict] = subs_resp.data or []

    if not subscribers:
        logger.info("fanout: no active confirmed subscribers — nothing to do")
        return {"created": 0, "coalesced_groups": 0}

    # Build a map: source_slug -> [subscriber_id, ...]
    subs_by_source: dict[str, list[dict]] = defaultdict(list)
    for sub in subscribers:
        subs_by_source[sub["source_slug"]].append(sub)

    # Load all alert_events for sources that have subscribers
    active_slugs = list(subs_by_source.keys())
    events_resp = (
        client.table("alert_events")
        .select("id, source_slug, event_key, payload, detected_at")
        .in_("source_slug", active_slugs)
        .execute()
    )
    all_events: list[dict] = events_resp.data or []

    if not all_events:
        logger.info("fanout: no events found for active sources")
        return {"created": 0, "coalesced_groups": 0}

    # Load existing outbox rows to determine what's already queued/sent
    existing_resp = (
        client.table("alert_outbox")
        .select("subscriber_id, event_id")
        .execute()
    )
    existing_pairs: set[tuple] = {
        (r["subscriber_id"], r["event_id"]) for r in (existing_resp.data or [])
    }

    # ------------------------------------------------------------------
    # 2. Load coalesce thresholds from alert_sources metadata
    # ------------------------------------------------------------------
    sources_resp = (
        client.table("alert_sources")
        .select("source_slug, metadata")
        .execute()
    )
    coalesce_thresholds: dict[str, int] = {}
    for src in (sources_resp.data or []):
        meta = src.get("metadata") or {}
        threshold = meta.get("coalesce_above", DEFAULT_COALESCE_ABOVE)
        coalesce_thresholds[src["source_slug"]] = int(threshold)

    # ------------------------------------------------------------------
    # 3. Determine pending pairs: (subscriber, event) not yet in outbox
    # ------------------------------------------------------------------
    # Group pending events by (subscriber_id, source_slug)
    pending_by_sub_source: dict[tuple, list[dict]] = defaultdict(list)

    for event in all_events:
        slug = event["source_slug"]
        for sub in subs_by_source.get(slug, []):
            pair = (sub["id"], event["id"])
            if pair not in existing_pairs:
                pending_by_sub_source[(sub["id"], slug)].append(event)

    if not pending_by_sub_source:
        logger.info("fanout: all events already have outbox rows")
        return {"created": 0, "coalesced_groups": 0}

    # ------------------------------------------------------------------
    # 4. Build outbox INSERT rows (with coalescing)
    # ------------------------------------------------------------------
    rows_to_insert: list[dict[str, Any]] = []
    coalesced_groups = 0

    for (subscriber_id, source_slug), events_list in pending_by_sub_source.items():
        threshold = coalesce_thresholds.get(source_slug, DEFAULT_COALESCE_ABOVE)

        if len(events_list) > threshold:
            # Coalesce: create one synthetic outbox row
            # We use the first event_id as the anchor (arbitrary but stable)
            anchor_event = events_list[0]
            coalesced_payload = {
                "coalesced": True,
                "count": len(events_list),
                "source_slug": source_slug,
                "events": [
                    {
                        "id": e["id"],
                        "event_key": e["event_key"],
                        "payload": e["payload"],
                        "detected_at": e["detected_at"],
                    }
                    for e in events_list
                ],
            }
            rows_to_insert.append(
                {
                    "subscriber_id": subscriber_id,
                    "event_id": anchor_event["id"],
                    "status": "queued",
                    "coalesced_payload": json.dumps(coalesced_payload),
                }
            )
            coalesced_groups += 1
            logger.info(
                "fanout: coalescing %d events for subscriber %s source %s",
                len(events_list),
                subscriber_id,
                source_slug,
            )
        else:
            # Individual rows
            for event in events_list:
                rows_to_insert.append(
                    {
                        "subscriber_id": subscriber_id,
                        "event_id": event["id"],
                        "status": "queued",
                    }
                )

    if not rows_to_insert:
        return {"created": 0, "coalesced_groups": 0}

    # ------------------------------------------------------------------
    # 5. Batch insert (supabase-py has no native ON CONFLICT DO NOTHING,
    #    so we use upsert with the composite UNIQUE constraint).
    #    alert_outbox has UNIQUE(subscriber_id, event_id).
    # ------------------------------------------------------------------
    BATCH_SIZE = 200
    total_created = 0

    for i in range(0, len(rows_to_insert), BATCH_SIZE):
        batch = rows_to_insert[i : i + BATCH_SIZE]
        try:
            resp = (
                client.table("alert_outbox")
                .upsert(batch, on_conflict="subscriber_id,event_id", ignore_duplicates=True)
                .execute()
            )
            inserted = len(resp.data or [])
            total_created += inserted
            logger.info("fanout: inserted batch %d rows (total so far: %d)", inserted, total_created)
        except Exception as exc:
            logger.error("fanout: batch insert failed: %s", exc, exc_info=True)

    logger.info(
        "fanout complete: created=%d, coalesced_groups=%d",
        total_created,
        coalesced_groups,
    )
    return {"created": total_created, "coalesced_groups": coalesced_groups}
