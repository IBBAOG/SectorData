"""
Detector: ais_candidates — NEW (no legacy alertas/ equivalent)
Source: AIS import candidates (high-score vessels approaching Brazilian ports).
State read from: import_candidates table (imo, updated_at or discovered_at).
event_key pattern: candidate:<imo>:<last_update_hour>
  last_update_hour = ISO datetime truncated to the hour
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)

# Only alert on candidates with score >= this threshold
MIN_SCORE = 70


class AisCandidates(BaseDetector):
    source_slug = "ais_candidates"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()
        events: list[DetectedEvent] = []

        # Get recent high-score candidates
        resp = (
            client.table("import_candidates")
            .select("imo, score, vessel_name, updated_at, port_call_destination")
            .gte("score", MIN_SCORE)
            .order("updated_at", desc=True)
            .limit(50)
            .execute()
        )
        if not resp.data:
            logger.info("ais_candidates: no high-score candidates found")
            return []

        # Check existing events
        existing_resp = (
            client.table("alert_events")
            .select("event_key")
            .eq("source_slug", self.source_slug)
            .execute()
        )
        existing_keys = {r["event_key"] for r in (existing_resp.data or [])}

        for row in resp.data:
            imo = str(row.get("imo", ""))
            updated_at = str(row.get("updated_at", ""))
            hour_str = updated_at[:13] if updated_at else ""
            if not imo or not hour_str:
                continue

            event_key = f"candidate:{imo}:{hour_str}"
            if event_key in existing_keys:
                continue

            logger.info("ais_candidates: new high-score candidate — %s", event_key)
            events.append(
                DetectedEvent(
                    event_key=event_key,
                    payload={
                        "imo": imo,
                        "score": row.get("score"),
                        "vessel_name": row.get("vessel_name"),
                        "last_update_hour": hour_str,
                        "destination": row.get("port_call_destination"),
                        "source": "AIS Import Candidates",
                        "table": "import_candidates",
                        "frontend_route": "/navios-diesel",
                        "message": (
                            f"High-score AIS candidate: {row.get('vessel_name', imo)} "
                            f"(score {row.get('score')}) detected at {hour_str}"
                        ),
                    },
                )
            )

        return events
