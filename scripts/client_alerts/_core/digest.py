"""
Daily digest sweep.

A digest groups everything that happened "today" (America/Sao_Paulo) for every
subscriber whose EFFECTIVE cadence for a base is 'digest' — i.e. either the
source's default cadence is 'digest', or the subscription overrides it to
'digest'. The immediate path (run_one) handles instant bases as the ETL lands;
the digest path is the once-a-day cron for the rest.

Algorithm:
  1. Window = [start of today in America/Sao_Paulo, now], expressed in UTC.
  2. Pull today's alert_events (all sources) in that window.
  3. Resolve, per source, the active subscriptions whose effective cadence is
     'digest' (effective = COALESCE(cadence_override, source.cadence)).
  4. For each such (subscription, event) with NO existing outbox row, create a
     queued outbox row (ON CONFLICT DO NOTHING) — these are the "digest" rows.
  5. Resolve emails per source via alerts_active_recipients, group each
     subscriber's queued digest events by base, send ONE digest email per
     subscriber, mark every grouped outbox row, and log to alert_email_log.

Idempotency:
  - An event already represented by an outbox row for a subscription is never
    re-queued (UNIQUE(subscription_id,event_id) + ignore_duplicates).
  - Once every grouped outbox row is marked 'sent', a re-run finds no queued rows
    for that subscriber and sends nothing (the Gmail backend has no idempotency
    key; the anchor outbox id is passed but ignored).
  - Empty digest for a subscriber => no email.

Returns counts: {events_considered, outbox_created, subscribers, sent,
                 skipped, failed, transient}.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

from scripts.client_alerts._core.config import DIGEST_TIMEZONE
from scripts.client_alerts._core.supabase_client import get_client
from scripts.client_alerts._core.gmail_client import (
    send_email,
    list_suppressions,
    validate_api_key,
)
from scripts.client_alerts._core.render import render_digest

logger = logging.getLogger(__name__)


def _start_of_today_utc_iso() -> str:
    tz = ZoneInfo(DIGEST_TIMEZONE)
    now_local = datetime.now(tz)
    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    return start_local.astimezone(timezone.utc).isoformat()


def _digest_subscriptions(client) -> dict[str, list[dict]]:
    """
    Active subscriptions whose effective cadence is 'digest', grouped by source.

    Returns {source_slug: [ {id, source_slug}, ... ]}.
    """
    # Active subscriptions + their source default cadence.
    subs = (
        client.table("alert_subscriptions")
        .select("id, source_slug, cadence_override, is_active, alert_sources!inner(cadence)")
        .eq("is_active", True)
        .execute()
        .data
    ) or []

    by_source: dict[str, list[dict]] = {}
    for s in subs:
        src = s.get("alert_sources") or {}
        effective = s.get("cadence_override") or src.get("cadence")
        if effective != "digest":
            continue
        by_source.setdefault(s["source_slug"], []).append(
            {"id": s["id"], "source_slug": s["source_slug"]}
        )
    return by_source


def _todays_events_by_source(client, since_iso: str) -> dict[str, list[dict]]:
    events = (
        client.table("alert_events")
        .select("id, source_slug, event_key, payload, detected_at")
        .gte("detected_at", since_iso)
        .order("detected_at")
        .execute()
        .data
    ) or []
    by_source: dict[str, list[dict]] = {}
    for e in events:
        by_source.setdefault(e["source_slug"], []).append(e)
    return by_source


def _existing_outbox_keys(client, subscription_ids: list[str], event_ids: list[str]) -> set[tuple[str, str]]:
    """Return the set of (subscription_id, event_id) already present in outbox."""
    if not subscription_ids or not event_ids:
        return set()
    existing: set[tuple[str, str]] = set()
    rows = (
        client.table("alert_outbox")
        .select("subscription_id, event_id")
        .in_("subscription_id", subscription_ids)
        .in_("event_id", event_ids)
        .execute()
        .data
    ) or []
    for r in rows:
        existing.add((r["subscription_id"], r["event_id"]))
    return existing


def sweep_digests(batch_limit: int = 200) -> dict[str, int]:
    """Build and send the daily digest. See module docstring."""
    client = get_client()
    counts = {
        "events_considered": 0,
        "outbox_created": 0,
        "subscribers": 0,
        "sent": 0,
        "skipped": 0,
        "failed": 0,
        "transient": 0,
    }

    if not validate_api_key():
        raise SystemExit(1)

    since_iso = _start_of_today_utc_iso()
    logger.info("digest: window start (UTC) = %s", since_iso)

    digest_subs = _digest_subscriptions(client)
    if not digest_subs:
        logger.info("digest: no active digest subscriptions — nothing to do")
        return counts

    events_by_source = _todays_events_by_source(client, since_iso)
    if not events_by_source:
        logger.info("digest: no events today — nothing to do")
        return counts

    suppressed = list_suppressions()
    logger.info("digest: suppression list has %d address(es)", len(suppressed))

    # Source metadata (display_name + route) for the sources in play.
    relevant_slugs = sorted(set(digest_subs) & set(events_by_source))
    if not relevant_slugs:
        logger.info("digest: no overlap between digest subs and today's events")
        return counts

    src_meta_rows = (
        client.table("alert_sources")
        .select("source_slug, display_name, metadata")
        .in_("source_slug", relevant_slugs)
        .execute()
        .data
    ) or []
    src_meta = {s["source_slug"]: s for s in src_meta_rows}

    # ---- Step 1: create the digest outbox rows (idempotent) ----
    # Collect the candidate (subscription, event) pairs that lack an outbox row.
    all_sub_ids: list[str] = []
    all_event_ids: list[str] = []
    candidate_pairs: list[tuple[str, str, str]] = []  # (source_slug, subscription_id, event_id)
    for slug in relevant_slugs:
        subs = digest_subs.get(slug, [])
        evs = events_by_source.get(slug, [])
        for s in subs:
            for e in evs:
                candidate_pairs.append((slug, s["id"], e["id"]))
                all_sub_ids.append(s["id"])
                all_event_ids.append(e["id"])

    counts["events_considered"] = len({e for (_, _, e) in candidate_pairs})

    existing = _existing_outbox_keys(
        client, sorted(set(all_sub_ids)), sorted(set(all_event_ids))
    )

    new_rows = [
        {"subscription_id": sub_id, "event_id": ev_id, "status": "queued"}
        for (_, sub_id, ev_id) in candidate_pairs
        if (sub_id, ev_id) not in existing
    ]
    if new_rows:
        client.table("alert_outbox").upsert(
            new_rows,
            on_conflict="subscription_id,event_id",
            ignore_duplicates=True,
        ).execute()
        counts["outbox_created"] = len(new_rows)
        logger.info("digest: created %d new digest outbox row(s)", len(new_rows))

    # ---- Step 2: resolve emails per source ----
    # {source_slug: {subscription_id: (email, token)}}
    recip_by_source: dict[str, dict[str, tuple[str, str]]] = {}
    for slug in relevant_slugs:
        recips = (
            client.rpc("alerts_active_recipients", {"p_source_slug": slug})
            .execute()
            .data
        ) or []
        recip_by_source[slug] = {
            r["subscription_id"]: ((r.get("email") or "").lower(), r.get("unsubscribe_token"))
            for r in recips
        }

    # ---- Step 3: gather this run's queued digest outbox rows to send ----
    # Re-read the queued rows for the (subscription, event) universe so we pick
    # up rows created above AND any left queued from a previous failed run.
    sub_ids_u = sorted(set(all_sub_ids))
    event_ids_u = sorted(set(all_event_ids))
    queued = (
        client.table("alert_outbox")
        .select("id, subscription_id, event_id, send_attempts, status")
        .in_("subscription_id", sub_ids_u)
        .in_("event_id", event_ids_u)
        .eq("status", "queued")
        .limit(batch_limit * 50)  # generous; grouped into <= batch_limit emails
        .execute()
        .data
    ) or []

    if not queued:
        logger.info("digest: no queued digest rows to send")
        return counts

    # Index events by id for grouping.
    events_by_id: dict[str, dict] = {}
    for evs in events_by_source.values():
        for e in evs:
            events_by_id[e["id"]] = e

    # Group queued rows by subscriber EMAIL (a user may have several digest
    # subscriptions; one email per user). Track the anchor outbox id + token.
    # subscriber_key = email; value = {token, outbox_ids[], events_by_source{}}
    per_subscriber: dict[str, dict] = {}
    for row in queued:
        sub_id = row["subscription_id"]
        ev_id = row["event_id"]
        # find the source slug for this subscription within our universe
        # (a subscription belongs to exactly one source)
        ev = events_by_id.get(ev_id)
        if ev is None:
            continue
        slug = ev["source_slug"]
        email_token = recip_by_source.get(slug, {}).get(sub_id)
        if not email_token or not email_token[0]:
            # subscriber inactive/unresolved -> skip this row terminally
            _update_outbox(client, row["id"], "skipped",
                           error="subscriber inactive or email unresolved")
            counts["skipped"] += 1
            continue
        email_addr, token = email_token
        if email_addr in suppressed:
            _update_outbox(client, row["id"], "skipped")
            counts["skipped"] += 1
            continue

        bucket = per_subscriber.setdefault(email_addr, {
            "token": token, "outbox_ids": [], "by_source": {},
        })
        bucket["outbox_ids"].append(row["id"])
        bucket["by_source"].setdefault(slug, []).append(ev)

    counts["subscribers"] = len(per_subscriber)

    # ---- Step 4: send one digest email per subscriber ----
    for email_addr, bucket in per_subscriber.items():
        groups = []
        for slug, evs in bucket["by_source"].items():
            meta = src_meta.get(slug, {})
            groups.append({
                "display_name": meta.get("display_name", slug),
                "frontend_route": (meta.get("metadata") or {}).get("frontend_route"),
                "events": sorted(evs, key=lambda e: e.get("detected_at") or ""),
            })
        if not groups:
            continue

        anchor_outbox_id = sorted(bucket["outbox_ids"])[0]
        try:
            html, text = render_digest(groups=groups, unsubscribe_token=bucket["token"])
            total = sum(len(g["events"]) for g in groups)
            subject = f"[SectorData Alerts] Daily digest — {total} update{'s' if total != 1 else ''}"
        except Exception as exc:
            logger.error("digest: render failed for %s: %s", email_addr, exc, exc_info=True)
            for oid in bucket["outbox_ids"]:
                _update_outbox(client, oid, "failed", error=f"render error: {exc}")
            counts["failed"] += len(bucket["outbox_ids"])
            continue

        result = send_email(
            to=email_addr,
            subject=subject,
            html=html,
            text=text,
            idempotency_key=anchor_outbox_id,  # accepted but unused (Gmail has no key)
        )
        now_utc = datetime.now(timezone.utc).isoformat()
        status_code = result.get("status_code", 0)
        provider_message_id = result.get("provider_message_id")

        _insert_email_log(
            client,
            outbox_id=anchor_outbox_id,
            email=email_addr,
            subject=subject,
            status="sent" if result["success"] else (
                "failed" if (status_code and 400 <= status_code < 500) else "transient"
            ),
            provider_message_id=provider_message_id,
            provider_response=result,
        )

        if result["success"]:
            for oid in bucket["outbox_ids"]:
                _update_outbox(client, oid, "sent",
                               sent_at=now_utc, provider_message_id=provider_message_id,
                               last_attempt_at=now_utc)
            counts["sent"] += 1
            logger.info("digest: sent digest to %s (%d events)",
                        email_addr, sum(len(g["events"]) for g in groups))
        elif status_code and 400 <= status_code < 500:
            for oid in bucket["outbox_ids"]:
                _update_outbox(client, oid, "failed",
                               error=result.get("error", f"HTTP {status_code}"),
                               last_attempt_at=now_utc)
            counts["failed"] += 1
            logger.warning("digest: permanent failure for %s status=%d", email_addr, status_code)
        else:
            for oid in bucket["outbox_ids"]:
                _bump_attempt(client, oid, now_utc)
            counts["transient"] += 1
            logger.warning("digest: transient failure for %s — left queued", email_addr)

    logger.info("digest complete: %s", counts)
    return counts


def _update_outbox(
    client,
    outbox_id: str,
    status: str,
    *,
    sent_at: str | None = None,
    provider_message_id: str | None = None,
    error: str | None = None,
    last_attempt_at: str | None = None,
) -> None:
    update: dict = {"status": status}
    if sent_at is not None:
        update["sent_at"] = sent_at
    if provider_message_id is not None:
        update["provider_message_id"] = provider_message_id
    if error is not None:
        update["error"] = error
    if last_attempt_at is not None:
        update["last_attempt_at"] = last_attempt_at
    try:
        client.table("alert_outbox").update(update).eq("id", outbox_id).execute()
    except Exception as exc:
        logger.error("digest: failed to update outbox %s: %s", outbox_id, exc)


def _bump_attempt(client, outbox_id: str, when_iso: str) -> None:
    """Increment send_attempts on a transient failure, keep status='queued'."""
    try:
        cur = (
            client.table("alert_outbox")
            .select("send_attempts")
            .eq("id", outbox_id)
            .limit(1)
            .execute()
            .data
        ) or [{}]
        attempts = (cur[0].get("send_attempts") or 0) + 1
        client.table("alert_outbox").update(
            {"send_attempts": attempts, "last_attempt_at": when_iso}
        ).eq("id", outbox_id).execute()
    except Exception as exc:
        logger.error("digest: failed to bump attempt on outbox %s: %s", outbox_id, exc)


def _insert_email_log(
    client,
    *,
    outbox_id: str,
    email: str,
    subject: str,
    status: str,
    provider_message_id: str | None,
    provider_response: dict,
) -> None:
    try:
        client.table("alert_email_log").insert(
            {
                "outbox_id": outbox_id,
                "email": email,
                "subject": subject,
                "status": status,
                "provider_message_id": provider_message_id,
                "provider_response": provider_response,
            }
        ).execute()
    except Exception as exc:
        logger.error("digest: failed to insert email log for outbox %s: %s", outbox_id, exc)
