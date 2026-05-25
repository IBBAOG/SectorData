"""
Detector: vendas — NEW (no legacy alertas/ equivalent)
Source: ANP fuel sales (vendas table) — monthly.
State read from: vendas (date column, format YYYY-MM-DD).
event_key pattern: period:YYYY-MM
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class Vendas(BaseDetector):
    source_slug = "vendas"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()

        resp = (
            client.table("vendas")
            .select("date")
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        if not resp.data:
            logger.info("vendas: table is empty")
            return []

        latest_date: str = resp.data[0]["date"]
        period = latest_date[:7]  # YYYY-MM
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

        logger.info("vendas: new monthly data detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "period": period,
                    "source": "ANP Fuel Sales (Vendas)",
                    "table": "vendas",
                    "frontend_route": "/sales-volumes",
                    "message": f"ANP fuel sales data updated for {period}",
                },
            )
        ]
