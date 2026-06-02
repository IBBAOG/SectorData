"""
Event emission: detect that a base advanced to a new period and record one
deduped alert_events row.

emit_event_if_new(slug) is the gate every ETL hook calls. It is idempotent and
race-safe:
  * The current period comes from the service-only RPC alerts_current_period.
  * It is compared against alert_source_state.last_period_key — a no-op if the
    period did not advance.
  * The event is inserted with ON CONFLICT (source_slug, event_key) DO NOTHING.
    If a parallel run already inserted it, this run inserts nothing and returns
    None (so it won't double-fan-out or double-send).
  * Only after a real insert do we advance alert_source_state.

Returns the new event id (str) when a brand-new period was recorded by THIS run,
otherwise None.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from scripts.client_alerts._core.supabase_client import get_client

logger = logging.getLogger(__name__)


def _load_source(client, slug: str) -> dict | None:
    resp = (
        client.table("alert_sources")
        .select("source_slug, display_name, period_table, metadata, cadence, is_active")
        .eq("source_slug", slug)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else None


def _load_state(client, slug: str) -> dict | None:
    resp = (
        client.table("alert_source_state")
        .select("source_slug, last_period_key, last_event_id")
        .eq("source_slug", slug)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else None


def emit_event_if_new(slug: str) -> str | None:
    """Detect a new period for `slug` and record a deduped event. See module doc."""
    client = get_client()

    source = _load_source(client, slug)
    if source is None:
        logger.warning("emit: unknown source_slug '%s' — skipping", slug)
        return None

    # Current period key (lexicographically sortable; NULL if the table is empty).
    current = client.rpc("alerts_current_period", {"p_source_slug": slug}).execute().data
    if current is None or current == "":
        logger.info("emit[%s]: no current period (empty table) — nothing to emit", slug)
        return None

    state = _load_state(client, slug)
    last_period = state.get("last_period_key") if state else None

    if last_period is not None and current <= last_period:
        logger.info(
            "emit[%s]: period unchanged (current=%s <= last=%s) — no-op",
            slug, current, last_period,
        )
        return None

    metadata = source.get("metadata") or {}
    frontend_route = metadata.get("frontend_route")
    display_name = source.get("display_name") or slug
    period_table = source.get("period_table") or slug

    event_key = f"period:{current}"
    payload = {
        "period": current,
        "source_slug": slug,
        "display_name": display_name,
        "frontend_route": frontend_route,
        "table": period_table,
        "message": f"{display_name} updated — new data for period {current}.",
    }

    # Insert deduped. ignore_duplicates=True => ON CONFLICT DO NOTHING.
    ins = (
        client.table("alert_events")
        .upsert(
            {"source_slug": slug, "event_key": event_key, "payload": payload},
            on_conflict="source_slug,event_key",
            ignore_duplicates=True,
        )
        .execute()
    )
    inserted = ins.data or []
    if not inserted:
        # Another run won the race (or this exact period already emitted earlier).
        logger.info(
            "emit[%s]: event already existed for %s (conflict) — no-op",
            slug, event_key,
        )
        return None

    event_id = inserted[0]["id"]
    now_iso = datetime.now(timezone.utc).isoformat()

    client.table("alert_source_state").upsert(
        {
            "source_slug": slug,
            "last_period_key": current,
            "last_event_id": event_id,
            "last_alerted_at": now_iso,
            "updated_at": now_iso,
        },
        on_conflict="source_slug",
    ).execute()

    logger.info(
        "emit[%s]: NEW event %s for period %s recorded", slug, event_id, current
    )
    return event_id
