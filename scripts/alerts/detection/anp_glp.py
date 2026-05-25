"""
Detector: anp_glp
Source: ANP LPG (GLP) monthly sales data.
State read from: anp_glp (ano, mes columns).
event_key pattern: period:YYYY-MM
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class AnpGlp(BaseDetector):
    source_slug = "anp_glp"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()

        # Find the latest (ano, mes) combination
        resp = (
            client.table("anp_glp")
            .select("ano, mes")
            .order("ano", desc=True)
            .order("mes", desc=True)
            .limit(1)
            .execute()
        )
        if not resp.data:
            logger.info("anp_glp: table is empty")
            return []

        row = resp.data[0]
        period = f"{row['ano']}-{str(row['mes']).zfill(2)}"
        event_key = f"period:{period}"

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

        logger.info("anp_glp: new data detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "period": period,
                    "ano": row["ano"],
                    "mes": row["mes"],
                    "source": "ANP LPG Sales",
                    "table": "anp_glp",
                    "frontend_route": "/anp-glp",
                    "message": f"ANP LPG sales data updated for {period}",
                },
            )
        ]
