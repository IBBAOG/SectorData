"""
Detector: navios_diesel — NEW (no legacy alertas/ equivalent)
Source: Diesel vessel lineup (navios_diesel table).
State read from: navios_diesel (collected_at, porto).
event_key pattern: lineup:<porto>:<collected_at_hour>
  collected_at_hour = ISO datetime truncated to the hour: YYYY-MM-DDTHH

Emits one event per (porto, hour) combination not yet seen in alert_events.
This captures each new lineup snapshot per port.
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
            # Truncate to hour
            hour_str = collected_at[:13] if collected_at else ""
            if not hour_str:
                continue
            event_key = f"lineup:{porto}:{hour_str}"
            if event_key in existing_keys:
                continue

            logger.info("navios_diesel: new lineup detected — %s", event_key)
            events.append(
                DetectedEvent(
                    event_key=event_key,
                    payload={
                        "porto": porto,
                        "collected_at_hour": hour_str,
                        "source": "Diesel Vessel Lineup",
                        "table": "navios_diesel",
                        "frontend_route": "/navios-diesel",
                        "message": f"New vessel lineup snapshot for {porto} at {hour_str}",
                    },
                )
            )

        return events
