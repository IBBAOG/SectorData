"""
Detector: anp_ppi
Source: ANP Producer Price Index (PPI) — weekly updates.
State read from: anp_precos_produtores table (data_referencia column).
event_key pattern: period:YYYY-MM-DD (most recent data_referencia)
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class AnpPpi(BaseDetector):
    source_slug = "anp_ppi"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()

        # Get the most recent data_referencia in the table
        resp = (
            client.table("anp_precos_produtores")
            .select("data_referencia")
            .order("data_referencia", desc=True)
            .limit(1)
            .execute()
        )
        if not resp.data:
            logger.info("anp_ppi: table is empty, nothing to detect")
            return []

        latest_date = resp.data[0]["data_referencia"]
        event_key = f"period:{latest_date}"

        # Check if this event_key already exists in alert_events
        existing = (
            client.table("alert_events")
            .select("id")
            .eq("source_slug", self.source_slug)
            .eq("event_key", event_key)
            .limit(1)
            .execute()
        )
        if existing.data:
            logger.debug("anp_ppi: event_key %s already recorded, skipping", event_key)
            return []

        logger.info("anp_ppi: new data detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "period": latest_date,
                    "source": "ANP Producer Price Index",
                    "table": "anp_precos_produtores",
                    "frontend_route": "/anp-precos-produtores",
                    "message": f"ANP PPI data updated through {latest_date}",
                },
            )
        ]
