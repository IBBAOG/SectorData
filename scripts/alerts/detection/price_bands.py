"""
Detector: price_bands — NEW (no legacy alertas/ equivalent)
Source: Price Bands (manually uploaded data).
State read from: price_bands (date column, format YYYY-MM-DD).
event_key pattern: date:YYYY-MM-DD
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class PriceBands(BaseDetector):
    source_slug = "price_bands"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()

        resp = (
            client.table("price_bands")
            .select("date")
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        if not resp.data:
            logger.info("price_bands: table is empty")
            return []

        latest_date: str = resp.data[0]["date"]
        event_key = f"date:{latest_date[:10]}"

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

        logger.info("price_bands: new data detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "date": latest_date[:10],
                    "source": "Price Bands",
                    "table": "price_bands",
                    "frontend_route": "/price-bands",
                    "message": f"Price bands data updated through {latest_date[:10]}",
                },
            )
        ]
