"""
Detector: anp_desembaracos_daie
Source: ANP DAIE (imports/exports) + ANP Desembaraços (customs clearances) — monthly.
State read from: anp_daie and anp_desembaracos tables (ano, mes).
event_key pattern: period:YYYY-MM

Emits when either the DAIE or Desembaracos table has a new (ano, mes) period
not yet in alert_events. Uses the most recent across both tables.
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class AnpDesembaracosDaie(BaseDetector):
    source_slug = "anp_desembaracos_daie"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()
        latest_period: str | None = None

        # Check anp_daie
        resp_daie = (
            client.table("anp_daie")
            .select("ano, mes")
            .order("ano", desc=True)
            .order("mes", desc=True)
            .limit(1)
            .execute()
        )
        if resp_daie.data:
            row = resp_daie.data[0]
            latest_period = f"{row['ano']}-{str(row['mes']).zfill(2)}"

        # Check anp_desembaracos
        resp_des = (
            client.table("anp_desembaracos")
            .select("ano, mes")
            .order("ano", desc=True)
            .order("mes", desc=True)
            .limit(1)
            .execute()
        )
        if resp_des.data:
            row = resp_des.data[0]
            period_des = f"{row['ano']}-{str(row['mes']).zfill(2)}"
            if latest_period is None or period_des > latest_period:
                latest_period = period_des

        if latest_period is None:
            logger.info("anp_desembaracos_daie: both tables empty")
            return []

        event_key = f"period:{latest_period}"

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

        logger.info("anp_desembaracos_daie: new data detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "period": latest_period,
                    "source": "ANP Imports/Exports + Customs Clearances",
                    "tables": ["anp_daie", "anp_desembaracos"],
                    "frontend_route": "/imports-exports",
                    "message": f"ANP trade and customs data updated for {latest_period}",
                },
            )
        ]
