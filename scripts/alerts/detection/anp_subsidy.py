"""
Detector: anp_subsidy — NEW (no legacy alertas/ equivalent)
Source: ANP Diesel Subsidy Reference Price.
State read from: anp_subsidy_diesel_reference (data_referencia column).
event_key pattern: day:YYYY-MM-DD
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class AnpSubsidy(BaseDetector):
    source_slug = "anp_subsidy"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()

        resp = (
            client.table("anp_subsidy_diesel_reference")
            .select("data_referencia")
            .order("data_referencia", desc=True)
            .limit(1)
            .execute()
        )
        if not resp.data:
            logger.info("anp_subsidy: table is empty")
            return []

        latest_date: str = resp.data[0]["data_referencia"]
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

        logger.info("anp_subsidy: new data detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "date": latest_date[:10],
                    "source": "ANP Diesel Subsidy Reference",
                    "table": "anp_subsidy_diesel_reference",
                    "frontend_route": "/subsidy-tracker",
                    "message": f"ANP diesel subsidy reference updated for {latest_date[:10]}",
                },
            )
        ]
