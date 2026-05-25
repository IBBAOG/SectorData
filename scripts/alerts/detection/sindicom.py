"""
Detector: sindicom
Source: SINDICOM fuel distribution data (monthly).
State read from: vendas table filtered to SINDICOM records,
or from the latest ANP vendas (anp_glp is the closest public proxy).
We detect new monthly data via the vendas table's most recent (ano, mes).
event_key pattern: period:YYYY-MM
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class Sindicom(BaseDetector):
    source_slug = "sindicom"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()

        # SINDICOM data lives in the vendas table (SINDICOM is a distributor member set)
        resp = (
            client.table("vendas")
            .select("date")
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        if not resp.data:
            logger.info("sindicom: vendas table is empty")
            return []

        latest_date: str = resp.data[0]["date"]
        # date is stored as YYYY-MM-DD; extract YYYY-MM as the period
        period = latest_date[:7]
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

        logger.info("sindicom: new data detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "period": period,
                    "source": "SINDICOM",
                    "table": "vendas",
                    "frontend_route": "/sales-volumes",
                    "message": f"SINDICOM fuel distribution data updated for {period}",
                },
            )
        ]
