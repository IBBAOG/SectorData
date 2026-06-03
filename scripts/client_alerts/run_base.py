"""
Client Alerts CLI — invoked as the last step of each ETL workflow and by the
daily digest workflow.

Usage:
    # Immediate path: emit + (if the base is 'immediate') fanout + send.
    python -m scripts.client_alerts.run_base --source vendas
    python -m scripts.client_alerts.run_base --source anp_precos_produtores --source anp_glp

    # Digest path: sweep today's digest-cadence events into one email per subscriber.
    python -m scripts.client_alerts.run_base --digest [--batch-limit 200]

Behaviour:
    * run_one(slug) records a new-period event (idempotent). If the base's
      effective cadence is 'immediate', it fans out and sends right away. If the
      base is 'digest', it only records the event — the daily digest cron sends.
    * Missing required env (SUPABASE_URL / service key / GMAIL_APP_PASSWORD)
      prints a clear message and exits non-zero WITHOUT a stack trace.
    * A failure in one --source never aborts the others (best-effort per source).
"""
from __future__ import annotations

import argparse
import logging
import sys

from scripts.client_alerts._core import config
from scripts.client_alerts._core.emit import emit_event_if_new
from scripts.client_alerts._core.fanout import fanout_event
from scripts.client_alerts._core.deliver import send_pending_outbox
from scripts.client_alerts._core.digest import sweep_digests

logger = logging.getLogger("client_alerts")


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )


def _effective_source_cadence(slug: str) -> str | None:
    """Read alert_sources.cadence for `slug` ('immediate'/'digest'); None if unknown."""
    # Imported lazily so --help and arg parsing don't require Supabase creds.
    from scripts.client_alerts._core.supabase_client import get_client

    rows = (
        get_client()
        .table("alert_sources")
        .select("cadence")
        .eq("source_slug", slug)
        .limit(1)
        .execute()
        .data
    ) or []
    return rows[0]["cadence"] if rows else None


def run_one(slug: str) -> None:
    """Emit a new-period event for `slug` and, for immediate bases, send it."""
    event_id = emit_event_if_new(slug)
    if not event_id:
        logger.info("run_one[%s]: no new event — done", slug)
        return

    cadence = _effective_source_cadence(slug)
    if cadence == "digest":
        logger.info(
            "run_one[%s]: event %s recorded; base is 'digest' — daily cron will deliver",
            slug, event_id,
        )
        return

    # immediate (default): fan out + send now.
    queued = fanout_event(slug, event_id)
    logger.info("run_one[%s]: fanned out to %d subscriber(s); delivering…", slug, queued)
    counts = send_pending_outbox()
    logger.info("run_one[%s]: delivery counts %s", slug, counts)


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m scripts.client_alerts.run_base",
        description="Client Alerts engine: per-base emit/fanout/send + daily digest.",
    )
    p.add_argument(
        "--source",
        action="append",
        default=[],
        metavar="SLUG",
        help="Source slug to process (repeatable). Mutually exclusive with --digest.",
    )
    p.add_argument(
        "--digest",
        action="store_true",
        help="Run the daily digest sweep instead of per-source emit.",
    )
    p.add_argument(
        "--batch-limit",
        type=int,
        default=config.DELIVERY_BATCH_LIMIT,
        help="Max outbox rows / digest emails per run (default: %(default)s).",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    _setup_logging()
    args = _build_parser().parse_args(argv)

    if args.digest and args.source:
        logger.error("Pass either --digest OR one/more --source, not both.")
        return 2
    if not args.digest and not args.source:
        logger.error("Nothing to do: pass --digest or at least one --source.")
        return 2

    missing = config.validate()
    if missing:
        logger.error(
            "Missing required environment variable(s): %s. "
            "Set them in the workflow env (SUPABASE_URL, a service key, GMAIL_APP_PASSWORD) "
            "and re-run. Skipping.",
            ", ".join(missing),
        )
        return 1

    if args.digest:
        counts = sweep_digests(batch_limit=args.batch_limit)
        logger.info("digest sweep done: %s", counts)
        return 0

    # Per-source: best-effort; never let one source abort the others.
    had_error = False
    for slug in args.source:
        try:
            run_one(slug)
        except SystemExit:
            # send_pending_outbox raises SystemExit(1) on a bad Resend key —
            # that's fatal for delivery, surface it.
            raise
        except Exception as exc:
            had_error = True
            logger.error("run_one[%s] failed: %s", slug, exc, exc_info=True)
    return 1 if had_error else 0


if __name__ == "__main__":
    sys.exit(main())
