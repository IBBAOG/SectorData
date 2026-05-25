"""
Detector: ais_candidates — NEW (no legacy alertas/ equivalent)
Source: AIS import candidates (high-score vessels approaching Brazilian ports).
State read from: import_candidates table.
event_key pattern: candidate:<imo>:<last_seen_hour>
  last_seen_hour = last_seen_at truncated to the hour (YYYY-MM-DDTHH)

Column mapping (verified against migration 20260424000000_import_candidates.sql):
  confidence_score  — composite 0-100 score
  navio             — vessel name
  last_seen_at      — last AIS update timestamp
  destination_port_name — human-readable destination
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

        # Get recent high-score candidates.
        # Column names verified against migration 20260424000000_import_candidates.sql:
        #   confidence_score (not score), navio (not vessel_name),
        #   last_seen_at (not updated_at), destination_port_name (correct)
        resp = (
            client.table("import_candidates")
            .select("imo, confidence_score, navio, last_seen_at, destination_port_name")
            .gte("confidence_score", MIN_SCORE)
            .order("last_seen_at", desc=True)
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
            last_seen_at = str(row.get("last_seen_at", ""))
            hour_str = last_seen_at[:13] if last_seen_at else ""
            if not imo or not hour_str:
                continue

            event_key = f"candidate:{imo}:{hour_str}"
            if event_key in existing_keys:
                continue

            vessel_name = row.get("navio") or imo
            score = row.get("confidence_score")
            logger.info("ais_candidates: new high-score candidate — %s", event_key)
            events.append(
                DetectedEvent(
                    event_key=event_key,
                    payload={
                        "imo": imo,
                        "confidence_score": score,
                        "vessel_name": vessel_name,
                        "last_seen_hour": hour_str,
                        "destination": row.get("destination_port_name"),
                        "source": "AIS Import Candidates",
                        "table": "import_candidates",
                        "frontend_route": "/navios-diesel",
                        "message": (
                            f"High-score AIS candidate: {vessel_name} "
                            f"(score {score}) detected at {hour_str}"
                        ),
                    },
                )
            )

        return events
