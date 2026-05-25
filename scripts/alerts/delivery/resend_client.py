"""
Resend API client wrapper.

Uses the Resend REST API directly via requests (avoids SDK version coupling).
Implements:
  - send_email()     — POST /emails with Idempotency-Key header
  - list_suppressions() — GET /suppressions (for pre-send suppression check)

Resend API reference: https://resend.com/docs/api-reference
"""
from __future__ import annotations

import logging
from typing import Any

import requests

from scripts.alerts.config import (
    RESEND_API_KEY,
    ALERTS_SENDER_EMAIL,
    ALERTS_REPLY_TO_EMAIL,
)

logger = logging.getLogger(__name__)

RESEND_BASE_URL = "https://api.resend.com"
_TIMEOUT = 15  # seconds


def _headers(idempotency_key: str | None = None) -> dict[str, str]:
    h = {
        "Authorization": f"Bearer {RESEND_API_KEY}",
        "Content-Type": "application/json",
    }
    if idempotency_key:
        h["Idempotency-Key"] = idempotency_key
    return h


def send_email(
    *,
    to: str | list[str],
    subject: str,
    html: str,
    text: str,
    idempotency_key: str | None = None,
    reply_to: str | None = None,
    from_addr: str | None = None,
) -> dict[str, Any]:
    """
    Send an email via Resend.

    Returns dict with keys:
        success (bool), provider_message_id (str|None), error (str|None),
        status_code (int)
    """
    if not RESEND_API_KEY:
        raise RuntimeError("RESEND_API_KEY is not set.")

    payload: dict[str, Any] = {
        "from": from_addr or ALERTS_SENDER_EMAIL,
        "to": to if isinstance(to, list) else [to],
        "subject": subject,
        "html": html,
        "text": text,
        "reply_to": reply_to or ALERTS_REPLY_TO_EMAIL,
    }

    try:
        resp = requests.post(
            f"{RESEND_BASE_URL}/emails",
            json=payload,
            headers=_headers(idempotency_key),
            timeout=_TIMEOUT,
        )
    except requests.Timeout:
        logger.warning("Resend send timeout for to=%s", to)
        return {"success": False, "provider_message_id": None, "error": "timeout", "status_code": 0}
    except requests.RequestException as exc:
        logger.warning("Resend send network error: %s", exc)
        return {"success": False, "provider_message_id": None, "error": str(exc), "status_code": 0}

    if resp.status_code in (200, 201):
        data = resp.json()
        return {
            "success": True,
            "provider_message_id": data.get("id"),
            "error": None,
            "status_code": resp.status_code,
        }
    else:
        logger.warning(
            "Resend send failed: status=%d body=%s", resp.status_code, resp.text[:300]
        )
        return {
            "success": False,
            "provider_message_id": None,
            "error": resp.text[:500],
            "status_code": resp.status_code,
        }


def list_suppressions() -> set[str]:
    """
    Fetch the Resend suppression list and return a set of suppressed email addresses.
    Returns empty set on error (fail-open: let the send attempt proceed).
    """
    try:
        resp = requests.get(
            f"{RESEND_BASE_URL}/suppressions",
            headers=_headers(),
            timeout=_TIMEOUT,
        )
        if resp.status_code != 200:
            logger.warning("Resend suppressions fetch failed: %d", resp.status_code)
            return set()
        data = resp.json()
        # API returns {"data": [{"email": "..."}, ...]}
        records = data.get("data") or []
        return {r["email"] for r in records if r.get("email")}
    except Exception as exc:
        logger.warning("Resend suppressions fetch error: %s", exc)
        return set()
