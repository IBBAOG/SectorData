"""
CLI entry point for the Alerts Product backend.

Usage:
    python -m scripts.alerts.cli detect [--all | --source=<slug>] [--dry-run]
    python -m scripts.alerts.cli fanout
    python -m scripts.alerts.cli deliver [--batch-limit=N]
    python -m scripts.alerts.cli canary [--stale-hours=N]
    python -m scripts.alerts.cli send-test --to=<email>
"""
from __future__ import annotations

import argparse
import json
import logging
import sys

# Configure logging early
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger("alerts.cli")


def cmd_detect(args: argparse.Namespace) -> int:
    """Run detection for one or all sources."""
    from scripts.alerts.detection import DETECTOR_REGISTRY, BaseDetector
    from scripts.alerts.supabase_client import get_client

    dry_run: bool = args.dry_run
    source_filter: str | None = getattr(args, "source", None)

    # Select detectors to run
    if source_filter:
        if source_filter not in DETECTOR_REGISTRY:
            logger.error("Unknown source slug: %s", source_filter)
            logger.error("Available: %s", sorted(DETECTOR_REGISTRY.keys()))
            return 1
        detectors = {source_filter: DETECTOR_REGISTRY[source_filter]}
    else:
        detectors = DETECTOR_REGISTRY

    total_detected = 0
    total_inserted = 0
    client = None if dry_run else get_client()

    for slug, cls in sorted(detectors.items()):
        detector: BaseDetector = cls()
        events = detector.safe_detect()
        logger.info("detect [%s]: %d event(s) returned", slug, len(events))
        total_detected += len(events)

        if events and not dry_run:
            # Insert into alert_events (ON CONFLICT DO NOTHING via upsert)
            rows = [
                {
                    "source_slug": slug,
                    "event_key": e.event_key,
                    "payload": e.payload,
                }
                for e in events
            ]
            for row in rows:
                try:
                    resp = (
                        client.table("alert_events")
                        .upsert(row, on_conflict="source_slug,event_key", ignore_duplicates=True)
                        .execute()
                    )
                    if resp.data:
                        total_inserted += len(resp.data)
                        logger.info(
                            "detect [%s]: inserted event_key=%s", slug, row["event_key"]
                        )
                    else:
                        logger.debug(
                            "detect [%s]: event_key=%s already exists (skipped)", slug, row["event_key"]
                        )
                except Exception as exc:
                    logger.error(
                        "detect [%s]: insert failed for event_key=%s: %s",
                        slug, row["event_key"], exc, exc_info=True,
                    )
        elif events and dry_run:
            for e in events:
                print(
                    json.dumps(
                        {"source_slug": slug, "event_key": e.event_key, "payload": e.payload},
                        default=str,
                        indent=2,
                    )
                )

    if dry_run:
        logger.info("detect --dry-run: %d event(s) would be inserted (not committed)", total_detected)
    else:
        logger.info(
            "detect complete: %d event(s) detected, %d inserted", total_detected, total_inserted
        )
    return 0


def cmd_fanout(args: argparse.Namespace) -> int:
    """Fan out pending events to subscriber outboxes."""
    from scripts.alerts.fanout import fanout_pending_events

    result = fanout_pending_events()
    logger.info("fanout: created=%d, coalesced_groups=%d", result["created"], result["coalesced_groups"])
    return 0


def cmd_deliver(args: argparse.Namespace) -> int:
    """Send queued outbox rows via Resend."""
    from scripts.alerts.config import validate
    from scripts.alerts.delivery.send_outbox import send_pending_outbox

    missing = validate()
    if missing:
        logger.error("Missing required env vars: %s", missing)
        return 1

    batch_limit: int = getattr(args, "batch_limit", 100)
    result = send_pending_outbox(batch_limit=batch_limit)
    logger.info(
        "deliver: sent=%d skipped=%d failed=%d transient=%d",
        result["sent"], result["skipped"], result["failed"], result["transient"],
    )
    return 0


def cmd_canary(args: argparse.Namespace) -> int:
    """Check for stale sources (no events in N hours)."""
    from scripts.alerts.canary import run_canary

    stale_hours: int | None = getattr(args, "stale_hours", None)
    result = run_canary(stale_hours=stale_hours)

    if result["stale"]:
        logger.warning("STALE sources (%d): %s", len(result["stale"]), result["stale"])
        return 1  # Non-zero exit so GHA flags the run
    else:
        logger.info("All %d sources are healthy", len(result["healthy"]))
        return 0


def cmd_send_test(args: argparse.Namespace) -> int:
    """
    Send a single test email via Resend to validate sender works for arbitrary recipients.
    First sanity check required before MVP launch (PRD § Sender strategy).
    """
    from scripts.alerts.config import validate, ALERTS_SENDER_EMAIL, ALERTS_REPLY_TO_EMAIL
    from scripts.alerts.delivery.resend_client import send_email

    missing = validate()
    if "RESEND_API_KEY" in missing:
        logger.error("RESEND_API_KEY is not set — cannot send test email")
        return 1

    to_addr: str = args.to
    logger.info("send-test: sending to %s from %s", to_addr, ALERTS_SENDER_EMAIL)

    result = send_email(
        to=to_addr,
        subject="[SectorData Alerts] Sandbox connectivity test",
        html=(
            "<p style='font-family:Arial,sans-serif;'>"
            "<strong>SectorData Alerts — Sandbox Test</strong></p>"
            "<p>If you received this email, the Resend sender (<code>onboarding@resend.dev</code>) "
            "is able to deliver to arbitrary recipients. Alerts product is ready to send.</p>"
            "<p style='color:#888; font-size:12px;'>This is an automated test — no action needed.</p>"
        ),
        text=(
            "SectorData Alerts — Sandbox Test\n\n"
            "If you received this email, the Resend sender (onboarding@resend.dev) "
            "is able to deliver to arbitrary recipients. Alerts product is ready to send.\n\n"
            "This is an automated test — no action needed."
        ),
    )

    if result["success"]:
        logger.info(
            "send-test: SUCCESS — provider_message_id=%s", result["provider_message_id"]
        )
        print(f"\nSANITY TEST: PASS\nProvider message ID: {result['provider_message_id']}")
        return 0
    else:
        logger.error(
            "send-test: FAILED — status=%d error=%s",
            result["status_code"],
            result["error"],
        )
        print(f"\nSANITY TEST: FAIL\nStatus: {result['status_code']}\nError: {result['error']}")
        print(
            "\nAction required: If error is 'domain not verified', pivot to custom domain per "
            "PRD § 'Migration path'. Escalate to CTO before continuing."
        )
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m scripts.alerts.cli",
        description="Alerts Product CLI — detection, fanout, delivery, canary",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # detect
    p_detect = subparsers.add_parser("detect", help="Run source detectors")
    p_detect.add_argument("--all", action="store_true", default=True, help="Run all detectors")
    p_detect.add_argument("--source", type=str, default=None, help="Run a single detector by slug")
    p_detect.add_argument("--dry-run", action="store_true", help="Print events without inserting")

    # fanout
    subparsers.add_parser("fanout", help="Fan out pending events to subscriber outboxes")

    # deliver
    p_deliver = subparsers.add_parser("deliver", help="Send queued outbox rows via Resend")
    p_deliver.add_argument(
        "--batch-limit", type=int, default=100, metavar="N", help="Max rows to process (default 100)"
    )

    # canary
    p_canary = subparsers.add_parser("canary", help="Check for stale sources")
    p_canary.add_argument(
        "--stale-hours", type=int, default=None, metavar="N", help="Stale threshold in hours"
    )

    # send-test
    p_test = subparsers.add_parser("send-test", help="Send a test email via Resend")
    p_test.add_argument("--to", required=True, metavar="EMAIL", help="Recipient email address")

    args = parser.parse_args()

    dispatch = {
        "detect": cmd_detect,
        "fanout": cmd_fanout,
        "deliver": cmd_deliver,
        "canary": cmd_canary,
        "send-test": cmd_send_test,
    }

    handler = dispatch.get(args.command)
    if not handler:
        parser.print_help()
        return 1

    return handler(args)


if __name__ == "__main__":
    sys.exit(main())
