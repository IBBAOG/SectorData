"""
Meta-canary: detects stale sources (no new event in N hours).

For each active source in alert_sources, checks when the last event was detected.
If no event within `stale_hours`, logs a WARNING and the function returns a non-empty
`stale` list. The GHA workflow (alerts_meta_canary.yml) exits with code 1 when any
source is stale, which causes GitHub to send a failure email to the repo owner
automatically — no separate DB write needed.

Design decision (QA fix, 2026-05-25): removed the meta-event INSERT into alert_events
(which used FK source_slug='_meta_canary' that does not exist in alert_sources, causing
a silent FK violation swallowed by safe_except). Relying on GHA exit code is simpler
and more reliable for MVP.
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
            # No DB write here — the GHA workflow exits with code 1 when stale list is
            # non-empty, which triggers a GitHub failure email to the repo owner.
            # This avoids a FK violation on the removed '_meta_canary' source_slug.
        else:
            result["healthy"].append(slug)
            logger.debug("canary: source %s is healthy (last event: %s)", slug, latest)

    logger.info(
        "canary complete: %d stale, %d healthy",
        len(result["stale"]),
        len(result["healthy"]),
    )
    return result
