"""
Detector: navios_diesel — NEW (no legacy alertas/ equivalent)
Source: Diesel vessel lineup (navios_diesel table).
State read from: navios_diesel (collected_at, porto).
event_key pattern: lineup:<porto>:<YYYY-MM-DD>  (daily granularity)

One event per (porto, day) — at most 5 events/day (one per port).
The UNIQUE constraint on (source_slug, event_key) in alert_events deduplicates
re-runs within the same day automatically.

v1.1 follow-up: refine to emit only when lineup content actually changes
(hash of vessel IMO set per port). Daily granularity is acceptable for MVP.
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class NaviosDiesel(BaseDetector):
    source_slug = "navios_diesel"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()
        events: list[DetectedEvent] = []

        # Get the most recent collected_at per porto
        resp = (
            client.table("navios_diesel")
            .select("porto, collected_at")
            .order("collected_at", desc=True)
            .limit(200)
            .execute()
        )
        if not resp.data:
            logger.info("navios_diesel: table is empty")
            return []

        # Deduplicate: latest collected_at per porto
        latest_by_porto: dict[str, str] = {}
        for row in resp.data:
            porto = row["porto"]
            ts = row["collected_at"]
            if porto not in latest_by_porto:
                latest_by_porto[porto] = ts

        # Check which event_keys already exist
        existing_resp = (
            client.table("alert_events")
            .select("event_key")
            .eq("source_slug", self.source_slug)
            .execute()
        )
        existing_keys = {r["event_key"] for r in (existing_resp.data or [])}

        for porto, collected_at in latest_by_porto.items():
            # Truncate to day (YYYY-MM-DD) — capped at 5 alerts/day (one per port).
            # UNIQUE(source_slug, event_key) in alert_events deduplicates re-runs.
            # v1.1: refine to emit only on content change (vessel IMO set hash).
            day_str = collected_at[:10] if collected_at else ""
            if not day_str:
                continue
            event_key = f"lineup:{porto}:{day_str}"
            if event_key in existing_keys:
                continue

            logger.info("navios_diesel: new lineup detected — %s", event_key)
            events.append(
                DetectedEvent(
                    event_key=event_key,
                    payload={
                        "porto": porto,
                        "lineup_date": day_str,
                        "collected_at": collected_at,
                        "source": "Diesel Vessel Lineup",
                        "table": "navios_diesel",
                        "frontend_route": "/navios-diesel",
                        "message": f"New vessel lineup snapshot for {porto} on {day_str}",
                    },
                )
            )

        return events
