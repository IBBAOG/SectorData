"""
Client Alerts CLI — invoked as the last step of each ETL workflow, by the daily
digest workflow, by the every-20-min safety-net poll, and on demand for tests.

Usage:
    # Immediate path: emit + (if the base is 'immediate') fanout + send.
    python -m scripts.client_alerts.run_base --source vendas
    python -m scripts.client_alerts.run_base --source anp_precos_produtores --source anp_glp

    # Digest path: sweep today's digest-cadence events into one email per subscriber.
    python -m scripts.client_alerts.run_base --digest [--batch-limit 200]

    # Safety-net poll: emit/send for EVERY active source (idempotent). Backs the
    # hook-less Data Input bases (price_bands, d_g_margins) and backstops all hooks.
    python -m scripts.client_alerts.run_base --all-active

    # Test harness: SIMULATE an update so the email fires NOW (production-safe —
    # never writes the data table, never touches the watermark).
    python -m scripts.client_alerts.run_base --test --source price_bands
    python -m scripts.client_alerts.run_base --test --source price_bands --to me@itaubba.com

    # Re-exercise real period detection by clearing one base's watermark.
    python -m scripts.client_alerts.run_base --reset-watermark price_bands

Behaviour:
    * run_one(slug) records a new-period event (idempotent). If the base's
      effective cadence is 'immediate', it fans out and sends right away. If the
      base is 'digest', it only records the event — the daily digest cron sends.
    * --all-active runs run_one for every alert_sources row WHERE is_active=true
      (best-effort per source).
    * --test inserts a SYNTHETIC `test:`-keyed event and delivers immediately
      (always immediate, even for digest bases); never touches data tables or the
      watermark. --to additionally mails an extra copy to that exact address.
    * --reset-watermark deletes the alert_source_state row for one source.
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
from scripts.client_alerts._core.test_send import (
    run_test_send,
    reset_watermark,
    list_active_source_slugs,
)

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
        help="Source slug to process (repeatable). With --test, exactly one slug. "
             "Mutually exclusive with --digest / --all-active / --reset-watermark.",
    )
    p.add_argument(
        "--digest",
        action="store_true",
        help="Run the daily digest sweep instead of per-source emit.",
    )
    p.add_argument(
        "--all-active",
        action="store_true",
        help="Run the immediate path for EVERY active source (the safety-net poll).",
    )
    p.add_argument(
        "--test",
        action="store_true",
        help="Simulate an update for --source so its email fires NOW "
             "(production-safe: never writes the data table or the watermark).",
    )
    p.add_argument(
        "--to",
        metavar="EMAIL",
        default=None,
        help="With --test: also send one extra copy of the rendered email to this "
             "exact address (no subscription required).",
    )
    p.add_argument(
        "--reset-watermark",
        metavar="SLUG",
        default=None,
        help="Delete the alert_source_state row for SLUG so the next real run "
             "re-detects the period from scratch. No email is sent.",
    )
    p.add_argument(
        "--batch-limit",
        type=int,
        default=config.DELIVERY_BATCH_LIMIT,
        help="Max outbox rows / digest emails per run (default: %(default)s).",
    )
    return p


def _validate_modes(args) -> str | None:
    """
    Return an error message for a nonsense flag combination, else None.

    Exactly one "mode" must be chosen:
      digest | all_active | reset_watermark | test | per-source(default).
    """
    # Count the explicit top-level modes (per-source is the implicit default).
    explicit = [
        ("--digest", args.digest),
        ("--all-active", args.all_active),
        ("--reset-watermark", args.reset_watermark is not None),
        ("--test", args.test),
    ]
    chosen = [name for name, on in explicit if on]

    if len(chosen) > 1:
        return f"Pass only one of: {', '.join(chosen)} — they are mutually exclusive."

    # --to only makes sense with --test.
    if args.to is not None and not args.test:
        return "--to is only valid together with --test."

    if args.test:
        if len(args.source) != 1:
            return "--test requires exactly one --source SLUG."
        return None

    if args.all_active:
        if args.source:
            return "--all-active processes every active source; do not also pass --source."
        return None

    if args.reset_watermark is not None:
        if args.source:
            return "--reset-watermark takes its own SLUG; do not also pass --source."
        return None

    if args.digest:
        if args.source:
            return "Pass either --digest OR one/more --source, not both."
        return None

    # Default per-source mode.
    if not args.source:
        return ("Nothing to do: pass --source SLUG, --all-active, --digest, "
                "--test --source SLUG, or --reset-watermark SLUG.")
    return None


def _require_env(*, gmail: bool = True) -> int | None:
    """
    Check required env. `gmail=True` requires the full send stack
    (SUPABASE + GMAIL_APP_PASSWORD); `gmail=False` requires only Supabase (used
    by --reset-watermark, which sends nothing). Returns 1 on failure, else None.
    """
    missing = config.validate()
    if not gmail:
        # Drop the Gmail requirement for non-sending modes.
        missing = [m for m in missing if "GMAIL" not in m]
    if missing:
        logger.error(
            "Missing required environment variable(s): %s. "
            "Set them in the workflow env (SUPABASE_URL, a service key%s) and re-run.",
            ", ".join(missing),
            ", GMAIL_APP_PASSWORD" if gmail else "",
        )
        return 1
    return None


def main(argv: list[str] | None = None) -> int:
    _setup_logging()
    args = _build_parser().parse_args(argv)

    err = _validate_modes(args)
    if err:
        logger.error(err)
        return 2

    # ── --reset-watermark: Supabase only (no email) ──
    if args.reset_watermark is not None:
        rc = _require_env(gmail=False)
        if rc is not None:
            return rc
        removed = reset_watermark(args.reset_watermark)
        logger.info(
            "reset-watermark[%s]: %s",
            args.reset_watermark,
            "watermark cleared" if removed else "no watermark to clear",
        )
        return 0

    # Everything below sends email → full env required.
    rc = _require_env(gmail=True)
    if rc is not None:
        return rc

    # ── --test: simulate an update and deliver now ──
    if args.test:
        slug = args.source[0]
        try:
            summary = run_test_send(slug, to=args.to)
        except SystemExit:
            raise  # bad SMTP login during the extra-copy send — surface it
        except Exception as exc:
            logger.error("test[%s] failed: %s", slug, exc, exc_info=True)
            return 1
        logger.info("test[%s] done: %s", slug, summary)
        return 0

    # ── --digest: daily sweep ──
    if args.digest:
        counts = sweep_digests(batch_limit=args.batch_limit)
        logger.info("digest sweep done: %s", counts)
        return 0

    # ── --all-active: the safety-net poll over every active source ──
    if args.all_active:
        slugs = list_active_source_slugs()
        logger.info("all-active: %d active source(s) to poll", len(slugs))
    else:
        slugs = args.source

    # Per-source: best-effort; never let one source abort the others.
    had_error = False
    for slug in slugs:
        try:
            run_one(slug)
        except SystemExit:
            # send_pending_outbox raises SystemExit(1) on a bad email key —
            # that's fatal for delivery, surface it.
            raise
        except Exception as exc:
            had_error = True
            logger.error("run_one[%s] failed: %s", slug, exc, exc_info=True)
    return 1 if had_error else 0


if __name__ == "__main__":
    sys.exit(main())
