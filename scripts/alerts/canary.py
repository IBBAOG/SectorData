"""
Meta-canary: detects stale sources (no new event in N hours).

For each active source in alert_sources, checks when the last event was detected.
If no event within `stale_hours`, logs a warning and optionally inserts a
meta-alert event (source_slug='_meta_canary', event_key='stale:<slug>:<date>').

This does NOT send email directly — it inserts into alert_events and lets
fanout + delivery handle notification if there are subscribers to _meta_canary.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta

from scripts.alerts.supabase_client import get_client
from scripts.alerts.config import CANARY_STALE_HOURS

logger = logging.getLogger(__name__)


def run_canary(stale_hours: int | None = None) -> dict[str, list[str]]:
    """
    Check all active sources for staleness.

    Args:
        stale_hours: Override config.CANARY_STALE_HOURS.

    Returns dict:
        stale   — list of source_slugs with no event in stale_hours
        healthy — list of source_slugs with recent events
    """
    threshold_hours = stale_hours if stale_hours is not None else CANARY_STALE_HOURS
    client = get_client()
    result: dict[str, list[str]] = {"stale": [], "healthy": []}

    # Load active sources
    sources_resp = (
        client.table("alert_sources")
        .select("source_slug, display_name")
        .eq("is_active", True)
        .execute()
    )
    sources = sources_resp.data or []
    if not sources:
        logger.info("canary: no active sources")
        return result

    cutoff = datetime.now(timezone.utc) - timedelta(hours=threshold_hours)
    cutoff_iso = cutoff.isoformat()

    # Load most recent event per source
    events_resp = (
        client.table("alert_events")
        .select("source_slug, detected_at")
        .order("detected_at", desc=True)
        .execute()
    )
    latest_by_source: dict[str, str] = {}
    for evt in (events_resp.data or []):
        slug = evt["source_slug"]
        if slug not in latest_by_source:
            latest_by_source[slug] = evt["detected_at"]

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    for src in sources:
        slug = src["source_slug"]
        latest = latest_by_source.get(slug)

        if latest is None or latest < cutoff_iso:
            result["stale"].append(slug)
            logger.warning(
                "canary: source %s is STALE (last event: %s, threshold: %dh)",
                slug,
                latest or "never",
                threshold_hours,
            )
            # Insert a meta-alert event so admins can be notified
            event_key = f"stale:{slug}:{today_str}"
            try:
                client.table("alert_events").insert(
                    {
                        "source_slug": "_meta_canary",
                        "event_key": event_key,
                        "payload": {
                            "stale_source": slug,
                            "display_name": src.get("display_name", slug),
                            "last_event_at": latest,
                            "stale_hours": threshold_hours,
                            "message": (
                                f"Source '{slug}' has been stale for >{threshold_hours}h "
                                f"(last event: {latest or 'never'})"
                            ),
                        },
                    }
                ).execute()
            except Exception as exc:
                # Likely UNIQUE constraint — already flagged today, suppress
                logger.debug("canary: meta-event insert skipped for %s: %s", slug, exc)
        else:
            result["healthy"].append(slug)
            logger.debug("canary: source %s is healthy (last event: %s)", slug, latest)

    logger.info(
        "canary complete: %d stale, %d healthy",
        len(result["stale"]),
        len(result["healthy"]),
    )
    return result
