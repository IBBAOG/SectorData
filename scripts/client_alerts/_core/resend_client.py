"""
DORMANT — Resend backend kept for a future verified-domain switch; the active
sender is gmail_client.py. Nothing imports this module at runtime anymore
(deliver.py / digest.py import from gmail_client). Do not delete: if a verified
domain is set up later, switch the imports back here and make RESEND_API_KEY
required again in config.validate().

Resend API client wrapper.

Calls the Resend REST API directly via `requests` (avoids SDK version coupling).
Implements only what the Client Alerts engine needs:
  - validate_api_key()  — GET /domains sanity check (call once at startup)
  - send_email()        — POST /emails with an Idempotency-Key header
  - list_suppressions() — GET /suppressions (pre-send suppression check, fail-open)

Resend API reference: https://resend.com/docs/api-reference

Failure-mode contract used by deliver.py / digest.py:
  send_email() returns a dict {success, provider_message_id, error, status_code}.
    - success=True                      -> mark outbox 'sent'
    - 4xx (400..499)                    -> PERMANENT failure -> mark outbox 'failed'
    - 5xx / timeout / network (code 0)  -> TRANSIENT failure -> keep 'queued', retry

Suppression endpoint permission note:
  GET /suppressions requires a "Full Access" (or "Read Suppressions") key scope.
  A "Sending"-only key returns HTTP 401. list_suppressions() is fail-open — on
  401/403/any error it logs and returns an empty set so sends still proceed.
  To enable real suppression checks, regenerate RESEND_API_KEY with Full Access
  at https://resend.com/api-keys and update the GitHub Actions secret.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import requests

from scripts.client_alerts._core.config import (
    ALERTS_SENDER_EMAIL,
    ALERTS_REPLY_TO_EMAIL,
)

logger = logging.getLogger(__name__)

# DORMANT backend: RESEND_API_KEY is no longer a config field (the active backend
# is Gmail SMTP). Read it straight from the env so this module stays importable
# if a future verified-domain switch revives it.
RESEND_API_KEY: str = os.environ.get("RESEND_API_KEY", "")

RESEND_BASE_URL = "https://api.resend.com"
_TIMEOUT = 15  # seconds
_key_validated: bool = False  # module-level sentinel; reset per process


def _headers(idempotency_key: str | None = None) -> dict[str, str]:
    h = {
        "Authorization": f"Bearer {RESEND_API_KEY}",
        "Content-Type": "application/json",
    }
    if idempotency_key:
        h["Idempotency-Key"] = idempotency_key
    return h


def validate_api_key() -> bool:
    """
    Cheap GET /domains call to verify the API key is accepted.

    Returns True on 2xx. Returns False (and logs ERROR, not WARNING) on a bad or
    missing key so the caller can `raise SystemExit(1)` and fail the GitHub
    Actions step visibly instead of silently sending zero emails. Skips the check
    if the key already validated in this process.
    """
    global _key_validated
    if _key_validated:
        return True
    if not RESEND_API_KEY:
        logger.error("RESEND_API_KEY is not set — all sends will fail. Aborting.")
        return False
    try:
        resp = requests.get(
            f"{RESEND_BASE_URL}/domains",
            headers=_headers(),
            timeout=_TIMEOUT,
        )
    except requests.RequestException as exc:
        logger.error("Resend API key validation: network error: %s", exc)
        return False

    if resp.status_code in (200, 201):
        _key_validated = True
        logger.info("Resend API key validation: OK (status %d)", resp.status_code)
        return True

    logger.error(
        "Resend API key validation FAILED: status=%d body=%s — "
        "check RESEND_API_KEY secret in GitHub Actions settings.",
        resp.status_code,
        resp.text[:300],
    )
    return False


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

    Returns:
        {success: bool, provider_message_id: str|None, error: str|None,
         status_code: int}   (status_code 0 = no HTTP response, i.e. transient)
    """
    if not RESEND_API_KEY:
        raise RuntimeError("RESEND_API_KEY is not set.")

    payload: dict[str, Any] = {
        "from": from_addr or ALERTS_SENDER_EMAIL,
        "to": to if isinstance(to, list) else [to],
        "subject": subject,
        "html": html,
        "text": text,
    }
    # Only attach reply_to when configured (empty string -> omit the header).
    effective_reply_to = reply_to or ALERTS_REPLY_TO_EMAIL
    if effective_reply_to:
        payload["reply_to"] = effective_reply_to

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

    logger.warning("Resend send failed: status=%d body=%s", resp.status_code, resp.text[:300])
    return {
        "success": False,
        "provider_message_id": None,
        "error": resp.text[:500],
        "status_code": resp.status_code,
    }


def list_suppressions() -> set[str]:
    """
    Fetch the Resend suppression list as a set of lowercased email addresses.

    Fail-open: returns an empty set on any error (the send attempt proceeds).
    Requires a "Full Access" / "Read Suppressions" key scope; a "Sending"-only
    key returns 401 (see module docstring).
    """
    try:
        resp = requests.get(
            f"{RESEND_BASE_URL}/suppressions",
            headers=_headers(),
            timeout=_TIMEOUT,
        )
        if resp.status_code in (401, 403):
            logger.error(
                "Resend suppressions fetch failed: %d. RESEND_API_KEY lacks "
                "'Read Suppressions' scope. Regenerate with Full Access at "
                "https://resend.com/api-keys and update the GHA secret. "
                "Proceeding without suppression check (fail-open).",
                resp.status_code,
            )
            return set()
        if resp.status_code != 200:
            logger.warning(
                "Resend suppressions fetch failed: status=%d — proceeding without check",
                resp.status_code,
            )
            return set()
        data = resp.json()
        records = data.get("data") or []
        return {r["email"].lower() for r in records if r.get("email")}
    except Exception as exc:
        logger.warning(
            "Resend suppressions fetch error: %s — proceeding without check", exc
        )
        return set()
