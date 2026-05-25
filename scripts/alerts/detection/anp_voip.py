"""
Detector: anp_voip — NEW (no legacy alertas/ equivalent)
Source: ANP VOIP (Volumes Originais In Place) — annual publication.
State read from: anp_voip (ano_publicacao column).
event_key pattern: year:YYYY
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class AnpVoip(BaseDetector):
    source_slug = "anp_voip"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()

        resp = (
            client.table("anp_voip")
            .select("ano_publicacao")
            .order("ano_publicacao", desc=True)
            .limit(1)
            .execute()
        )
        if not resp.data:
            logger.info("anp_voip: table is empty")
            return []

        latest_year = str(resp.data[0]["ano_publicacao"])
        event_key = f"year:{latest_year}"

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

        logger.info("anp_voip: new annual data detected — %s", event_key)
        return [
            DetectedEvent(
                event_key=event_key,
                payload={
                    "year": latest_year,
                    "source": "ANP VOIP (Volumes In Place)",
                    "table": "anp_voip",
                    "frontend_route": "/anp-cdp-bsw",
                    "message": f"ANP VOIP annual data published for {latest_year}",
                },
            )
        ]
