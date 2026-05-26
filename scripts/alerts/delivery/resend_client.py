"""
Resend API client wrapper.

Uses the Resend REST API directly via requests (avoids SDK version coupling).
Implements:
  - validate_api_key()  — GET /api-keys (sanity check; call once at startup)
  - send_email()        — POST /emails with Idempotency-Key header
  - list_suppressions() — GET /suppressions (pre-send suppression check)

Resend API reference: https://resend.com/docs/api-reference

Suppression endpoint permission note (2026-05-26):
  GET /suppressions requires the "Full Access" key scope (or at minimum the
  "Read Suppressions" scope introduced mid-2024). A key created with only the
  "Sending" scope will receive HTTP 401. list_suppressions() is fail-open —
  a 401/403 logs ERROR and returns an empty set so sends still proceed. If
  suppressions are critical for compliance, regenerate the key with Full Access
  scope at https://resend.com/api-keys.

  CEO action if you see "Resend suppressions fetch failed: 401":
    1. Go to https://resend.com/api-keys
    2. Delete the current key
    3. Create a new key with scope "Full Access"
    4. Update the RESEND_API_KEY secret in GitHub Actions repository settings
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
    Perform a cheap GET /domains call to verify the API key is valid.

    Returns True if the key is accepted (2xx). Returns False and logs ERROR
    (not WARNING) on 401/403 so the GitHub Actions step fails visibly
    (caller should raise SystemExit(1) on False to surface the failure
    in the workflow log rather than silently proceeding with 0 sends).

    Call once at process startup (send_outbox.py calls this before the main loop).
    Skips the check if the key was already validated in this process.
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
    else:
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
    Returns empty set on error (fail-open: send attempt proceeds).

    Requires "Full Access" or "Read Suppressions" API key scope.
    A key with "Sending" scope only returns HTTP 401 — see module docstring
    for instructions to regenerate the key with broader scope.
    """
    try:
        resp = requests.get(
            f"{RESEND_BASE_URL}/suppressions",
            headers=_headers(),
            timeout=_TIMEOUT,
        )
        if resp.status_code == 401:
            logger.error(
                "Resend suppressions fetch failed: 401 Unauthorized. "
                "The RESEND_API_KEY lacks 'Read Suppressions' scope. "
                "Regenerate with Full Access scope at https://resend.com/api-keys "
                "and update the RESEND_API_KEY GHA secret. "
                "Proceeding without suppression check (fail-open)."
            )
            return set()
        if resp.status_code != 200:
            logger.warning(
                "Resend suppressions fetch failed: status=%d — proceeding without suppression check",
                resp.status_code,
            )
            return set()
        data = resp.json()
        # API returns {"data": [{"email": "..."}, ...]}
        records = data.get("data") or []
        return {r["email"] for r in records if r.get("email")}
    except Exception as exc:
        logger.warning("Resend suppressions fetch error: %s — proceeding without suppression check", exc)
        return set()
