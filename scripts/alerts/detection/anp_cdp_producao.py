"""
Detector: anp_cdp_producao
Source: ANP CDP Monthly Production (wells/fields).
State read from: anp_cdp_producao (campo, local, ano, mes).
event_key pattern: field:<campo>:<local>

Emits one event per (campo, local) combination that is NEW in the DB
(not yet recorded in alert_events). This preserves the "baseline_consolidada"
invariant from the legacy alertas/ subsystem:
- We only emit an event for a (campo, local) pair if it has never appeared in alert_events.
- This means: first time a field is seen in the DB after this cloud system goes live
  → emit once. Subsequent updates to same field → no new event (field is already known).

For operational "data refresh" alerting, the caller can use admin_send_test_event or the
meta-canary to check staleness instead.
"""
from __future__ import annotations

import logging
from scripts.alerts.detection.base import BaseDetector, DetectedEvent
from scripts.alerts.supabase_client import get_client

logger = logging.getLogger(__name__)


class AnpCdpProducao(BaseDetector):
    source_slug = "anp_cdp_producao"

    def detect(self) -> list[DetectedEvent]:
        client = get_client()
        events: list[DetectedEvent] = []

        # Get all distinct (campo, local) combinations currently in the DB
        resp = (
            client.table("anp_cdp_producao")
            .select("campo, local, ano, mes")
            .order("ano", desc=True)
            .order("mes", desc=True)
            .execute()
        )
        if not resp.data:
            logger.info("anp_cdp_producao: table is empty")
            return []

        # Build set of unique (campo, local) pairs from current data
        field_combos: dict[tuple, dict] = {}
        for row in resp.data:
            key = (row["campo"], row["local"])
            if key not in field_combos:
                field_combos[key] = row

        # Check which event_keys already exist in alert_events
        existing_resp = (
            client.table("alert_events")
            .select("event_key")
            .eq("source_slug", self.source_slug)
            .execute()
        )
        existing_keys = {r["event_key"] for r in (existing_resp.data or [])}

        for (campo, local), row in field_combos.items():
            event_key = f"field:{campo}:{local}"
            if event_key in existing_keys:
                continue

            period = f"{row['ano']}-{str(row['mes']).zfill(2)}"
            logger.info("anp_cdp_producao: new field detected — %s", event_key)
            events.append(
                DetectedEvent(
                    event_key=event_key,
                    payload={
                        "campo": campo,
                        "local": local,
                        "latest_period": period,
                        "source": "ANP CDP Monthly Production",
                        "table": "anp_cdp_producao",
                        "frontend_route": "/anp-cdp",
                        "message": f"ANP CDP: new production data for field {campo} ({local})",
                    },
                )
            )

        return events
