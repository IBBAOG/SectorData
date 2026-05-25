"""
Detector: anp_lpc
Source: ANP LPC (fuel prices at retail pumps) — weekly updates.
State read from: anp_lpc (data_referencia).
event_key pattern: weeks:YYYY-MM-DD..YYYY-MM-DD
  (We use the week's end date from data_referencia to build the range key.)
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class AnpLpc(BaseDetector):
    source_slug = "anp_lpc"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()

        resp = (
            client.table("anp_lpc")
            .select("data_referencia")
            .order("data_referencia", desc=True)
            .limit(1)
            .execute()
        )
        if not resp.data:
            logger.info("anp_lpc: table is empty")
            return []

        end_str: str = resp.data[0]["data_referencia"]
        # Construct week range: [end - 6 days .. end]
        try:
            end_date = date.fromisoformat(end_str)
        except ValueError:
            # data_referencia may already be just a date string
            end_date = date.fromisoformat(end_str[:10])

        start_date = end_date - timedelta(days=6)
        event_key = f"weeks:{start_date.isoformat()}..{end_date.isoformat()}"

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

        logger.info("anp_lpc: new data detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "week_start": start_date.isoformat(),
                    "week_end": end_date.isoformat(),
                    "source": "ANP Fuel Retail Prices (LPC)",
                    "table": "anp_lpc",
                    "frontend_route": "/anp-lpc",
                    "message": f"ANP LPC prices updated for week ending {end_date.isoformat()}",
                },
            )
        ]
