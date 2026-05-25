"""
Detector: mdic_comex
Source: MDIC Comex Stat — trade statistics (monthly).
State read from: mdic_comex table (ano, mes columns).
event_key pattern: period:YYYY-MM
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class MdicComex(BaseDetector):
    source_slug = "mdic_comex"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()

        resp = (
            client.table("mdic_comex")
            .select("ano, mes")
            .order("ano", desc=True)
            .order("mes", desc=True)
            .limit(1)
            .execute()
        )
        if not resp.data:
            logger.info("mdic_comex: table is empty")
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

        logger.info("mdic_comex: new data detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "period": period,
                    "ano": row["ano"],
                    "mes": row["mes"],
                    "source": "MDIC Comex Stat",
                    "table": "mdic_comex",
                    "frontend_route": "/imports-exports",
                    "message": f"MDIC trade statistics updated for {period}",
                },
            )
        ]
