"""
Detector: d_g_margins — NEW (no legacy alertas/ equivalent)
Source: Diesel & Gasoline Margins (manually uploaded weekly Excel).
State read from: d_g_margins (week column, format YYYY-MM-DD).
event_key pattern: week:YYYY-MM-DD
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class DGMargins(BaseDetector):
    source_slug = "d_g_margins"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()

        resp = (
            client.table("d_g_margins")
            .select("week")
            .order("week", desc=True)
            .limit(1)
            .execute()
        )
        if not resp.data:
            logger.info("d_g_margins: table is empty")
            return []

        latest_week: str = resp.data[0]["week"]
        event_key = f"week:{latest_week[:10]}"

        existing = (
            client.table("alert_events")
            .select("id")
            .eq("source_slug", self.source_slug)
            .eq("event_key", event_key)
            .limit(1)
            .execute()
        )
        if existing.data:
            return []

        logger.info("d_g_margins: new weekly data detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "week": latest_week[:10],
                    "source": "Diesel & Gasoline Margins",
                    "table": "d_g_margins",
                    "frontend_route": "/diesel-gasoline-margins",
                    "message": f"D&G margin data updated for week of {latest_week[:10]}",
                },
            )
        ]
