"""
Detector: anp_cdp_diaria — NEW (no legacy alertas/ equivalent)
Source: ANP CDP Daily production data (field + installation + well level).
State read from: anp_cdp_diaria (data column).
event_key pattern: day:YYYY-MM-DD
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class AnpCdpDiaria(BaseDetector):
    source_slug = "anp_cdp_diaria"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()

        resp = (
            client.table("anp_cdp_diaria")
            .select("data")
            .order("data", desc=True)
            .limit(1)
            .execute()
        )
        if not resp.data:
            logger.info("anp_cdp_diaria: table is empty")
            return []

        latest_date: str = resp.data[0]["data"]
        event_key = f"day:{latest_date[:10]}"

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

        logger.info("anp_cdp_diaria: new daily data detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "date": latest_date[:10],
                    "source": "ANP CDP Daily Production",
                    "table": "anp_cdp_diaria",
                    "frontend_route": "/anp-cdp-diaria",
                    "message": f"ANP CDP daily production updated through {latest_date[:10]}",
                },
            )
        ]
