"""
Detector: anp_precos_distribuicao
Source: ANP distribution-level fuel prices — weekly + monthly updates.
State read from: anp_precos_distribuicao (data_referencia).
event_key pattern: period:<YYYY-MM-DD>:weekly  (weekly observation)
                   period:<YYYY-MM>:monthly    (monthly snapshot, if distinct cadence)
We treat the latest data_referencia as a weekly signal.
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class AnpPrecosDistribuicao(BaseDetector):
    source_slug = "anp_precos_distribuicao"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()

        resp = (
            client.table("anp_precos_distribuicao")
            .select("data_referencia")
            .order("data_referencia", desc=True)
            .limit(1)
            .execute()
        )
        if not resp.data:
            logger.info("anp_precos_distribuicao: table is empty")
            return []

        latest_date: str = resp.data[0]["data_referencia"]
        # Determine cadence: if day-of-month is 1 or 5 it's likely monthly, otherwise weekly
        try:
            from datetime import date
            d = date.fromisoformat(latest_date[:10])
            cadence = "monthly" if d.day <= 5 else "weekly"
            period_str = d.strftime("%Y-%m") if cadence == "monthly" else d.isoformat()
        except ValueError:
            cadence = "weekly"
            period_str = latest_date[:10]

        event_key = f"period:{period_str}:{cadence}"

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

        logger.info("anp_precos_distribuicao: new data detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "period": period_str,
                    "cadence": cadence,
                    "data_referencia": latest_date,
                    "source": "ANP Distribution Prices",
                    "table": "anp_precos_distribuicao",
                    "frontend_route": "/anp-precos-distribuicao",
                    "message": f"ANP distribution prices updated ({cadence}) — {period_str}",
                },
            )
        ]
