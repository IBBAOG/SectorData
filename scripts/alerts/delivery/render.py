"""
Jinja2 template rendering for alert emails.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from scripts.alerts.config import ALERTS_FRONTEND_URL

_TEMPLATES_DIR = Path(__file__).parent / "templates"

_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
    trim_blocks=True,
    lstrip_blocks=True,
)


def _base_context(**extra: Any) -> dict[str, Any]:
    return {
        "frontend_url": ALERTS_FRONTEND_URL,
        **extra,
    }


def render_alert_instant(
    *,
    subscriber: dict,
    event: dict,
    source: dict,
) -> tuple[str, str]:
    """
    Render the instant-alert email (single event).
    Returns (html, text) tuple.
    """
    ctx = _base_context(
        subscriber=subscriber,
        event=event,
        source=source,
        unsubscribe_source_url=(
            f"{ALERTS_FRONTEND_URL}/alerts/unsubscribe"
            f"?token={subscriber.get('unsubscribe_token', '')}"
            f"&source={source.get('source_slug', '')}"
        ),
        unsubscribe_all_url=(
            f"{ALERTS_FRONTEND_URL}/alerts/unsubscribe-all"
            f"?token={subscriber.get('unsubscribe_token', '')}"
        ),
    )
    html = _env.get_template("alert_instant.html").render(**ctx)
    text = _env.get_template("alert_instant.txt").render(**ctx)
    return html, text


def render_alert_coalesced(
    *,
    subscriber: dict,
    events: list[dict],
    source: dict,
) -> tuple[str, str]:
    """
    Render a coalesced multi-event email.
    Returns (html, text) tuple.
    """
    ctx = _base_context(
        subscriber=subscriber,
        events=events,
        source=source,
        event_count=len(events),
        unsubscribe_source_url=(
            f"{ALERTS_FRONTEND_URL}/alerts/unsubscribe"
            f"?token={subscriber.get('unsubscribe_token', '')}"
            f"&source={source.get('source_slug', '')}"
        ),
        unsubscribe_all_url=(
            f"{ALERTS_FRONTEND_URL}/alerts/unsubscribe-all"
            f"?token={subscriber.get('unsubscribe_token', '')}"
        ),
    )
    html = _env.get_template("alert_coalesced.html").render(**ctx)
    text = _env.get_template("alert_coalesced.txt").render(**ctx)
    return html, text


def render_confirmation(
    *,
    subscriber: dict,
    source: dict,
) -> tuple[str, str]:
    """
    Render the double opt-in confirmation email.
    Returns (html, text) tuple.
    """
    ctx = _base_context(
        subscriber=subscriber,
        source=source,
        confirm_url=(
            f"{ALERTS_FRONTEND_URL}/alerts/confirm"
            f"?token={subscriber.get('confirmation_token', '')}"
        ),
    )
    html = _env.get_template("confirmation.html").render(**ctx)
    text = _env.get_template("confirmation.txt").render(**ctx)
    return html, text
