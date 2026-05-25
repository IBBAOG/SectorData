"""
Detector: anp_precos_produtores
Source: ANP Producer Prices — weekly updates.
State read from: anp_precos_produtores (data_referencia).
event_key pattern: period:YYYY-MM-DD
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class AnpPrecosProdutores(BaseDetector):
    source_slug = "anp_precos_produtores"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()

        resp = (
            client.table("anp_precos_produtores")
            .select("data_referencia")
            .order("data_referencia", desc=True)
            .limit(1)
            .execute()
        )
        if not resp.data:
            logger.info("anp_precos_produtores: table is empty")
            return []

        latest_date = resp.data[0]["data_referencia"]
        event_key = f"period:{latest_date}"

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

        logger.info("anp_precos_produtores: new data detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "period": latest_date,
                    "source": "ANP Producer Prices",
                    "table": "anp_precos_produtores",
                    "frontend_route": "/anp-precos-produtores",
                    "message": f"ANP producer prices updated through {latest_date}",
                },
            )
        ]
