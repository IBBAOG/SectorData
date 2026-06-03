"""
Jinja2 template rendering for Client Alerts emails.

Two email shapes:
  render_immediate(event, source, unsubscribe_token) -> (html, text)
      One detected event (cadence='immediate' bases).
  render_digest(groups, unsubscribe_token=None)      -> (html, text)
      The daily digest: events grouped by base for a single subscriber.

`groups` for the digest is a list of dicts:
  {"display_name": str, "frontend_route": str|None, "events": [event_dict, ...]}
where each event_dict has at least: event_key, payload (dict), detected_at (str).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from scripts.client_alerts._core.config import ALERTS_FRONTEND_URL

# templates/ lives one level up from _core/
_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "templates"

_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
    trim_blocks=True,
    lstrip_blocks=True,
)


def _unsubscribe_url(token: str | None) -> str | None:
    if not token:
        return None
    return f"{ALERTS_FRONTEND_URL}/alerts/unsubscribe?token={token}"


def _base_context(**extra: Any) -> dict[str, Any]:
    return {"frontend_url": ALERTS_FRONTEND_URL, **extra}


def render_immediate(
    *,
    event: dict,
    source: dict,
    unsubscribe_token: str | None = None,
) -> tuple[str, str]:
    """Render the single-event immediate alert. Returns (html, text)."""
    ctx = _base_context(event=event, source=source)
    url = _unsubscribe_url(unsubscribe_token)
    if url is not None:
        ctx["unsubscribe_url"] = url
    html = _env.get_template("alert_immediate.html").render(**ctx)
    text = _env.get_template("alert_immediate.txt").render(**ctx)
    return html, text


def render_digest(
    *,
    groups: list[dict],
    unsubscribe_token: str | None = None,
) -> tuple[str, str]:
    """Render the daily digest grouped by base. Returns (html, text)."""
    event_count = sum(len(g.get("events", [])) for g in groups)
    ctx = _base_context(groups=groups, event_count=event_count)
    url = _unsubscribe_url(unsubscribe_token)
    if url is not None:
        ctx["unsubscribe_url"] = url
    html = _env.get_template("alert_digest.html").render(**ctx)
    text = _env.get_template("alert_digest.txt").render(**ctx)
    return html, text
