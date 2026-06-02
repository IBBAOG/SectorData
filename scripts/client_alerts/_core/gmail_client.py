"""
Gmail API sender — the ACTIVE email backend for the Client Alerts product.

Why Gmail (not Resend): the project has no verified custom domain, and the
Resend sandbox only delivers to its own account. The legacy ANP alert system
(`alertas/notificador.py`) already sends reliably through the Gmail API with a
self-refreshing OAuth token, so we reuse that exact mechanism here.

Credentials come from the environment (NOT disk):
  GMAIL_TOKEN_JSON       — the full `token.json` content (a JSON string with
                           token / refresh_token / client_id / client_secret /
                           token_uri / scopes). Because client_id + client_secret
                           + refresh_token are all present, the token can refresh
                           itself in CI without any browser flow.
  GMAIL_CREDENTIALS_JSON  — the OAuth client secrets (kept in the workflow env for
                           parity with the legacy job; not strictly required here
                           because the token already embeds client_id/secret).

Reading creds from the env (instead of writing files to disk) means the ETL hook
steps need no extra "write token.json" step — just the env var.

Drop-in contract (same symbols deliver.py / digest.py already import from the
old resend_client):
  - validate_api_key() -> bool         build the service once; True if creds are
                                       valid or refreshable, else False (logged).
  - list_suppressions() -> set[str]    Gmail has no suppression API → empty set.
  - send_email(...) -> dict            {success, provider_message_id, error,
                                       status_code} with the SAME failure-mode
                                       semantics deliver.py relies on:
                                         success=True            -> 'sent'
                                         4xx (400..499)          -> permanent 'failed'
                                         5xx / network (code 0)  -> transient, retry

Sender identity: `From` MUST be the Gmail account that owns the token
(ibbaogproject@gmail.com); Gmail ignores/overrides a mismatched From. Daily
send quota for a free Gmail account is ~500 messages/day.
"""
from __future__ import annotations

import base64
import json
import logging
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any

from google.auth.exceptions import GoogleAuthError, RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from scripts.client_alerts._core.config import (
    ALERTS_SENDER_EMAIL,
    ALERTS_REPLY_TO_EMAIL,
)

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/gmail.send"]

# Build the Gmail service ONCE per process (token refresh + discovery is costly).
_service: Any | None = None
_service_failed: bool = False  # remember a hard auth failure; don't retry per email

_REGEN_HINT = (
    "Gmail OAuth token is missing/expired/revoked and cannot be refreshed in a "
    "headless environment. Regenerate the token locally (e.g. "
    "`python alertas/auth_gmail.py`) and update the GMAIL_TOKEN_JSON secret at "
    "https://github.com/IBBAOG/SectorData/settings/secrets/actions"
)


def _build_credentials() -> Credentials:
    """Build OAuth credentials from GMAIL_TOKEN_JSON (env), refreshing if stale."""
    raw = os.environ.get("GMAIL_TOKEN_JSON", "").strip()
    if not raw:
        raise RuntimeError(
            "GMAIL_TOKEN_JSON is not set — Gmail sends will fail. " + _REGEN_HINT
        )
    try:
        info = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"GMAIL_TOKEN_JSON is not valid JSON ({exc}). " + _REGEN_HINT
        ) from exc

    creds = Credentials.from_authorized_user_info(info, SCOPES)

    if not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                logger.info("gmail: access token refreshed from refresh_token")
            except RefreshError as exc:
                raise RuntimeError(
                    f"Gmail refresh token revoked/invalid ({exc}). " + _REGEN_HINT
                ) from exc
        else:
            raise RuntimeError(
                "Gmail credentials invalid and not refreshable "
                "(no refresh_token in GMAIL_TOKEN_JSON). " + _REGEN_HINT
            )
    return creds


def _get_service() -> Any:
    """Return the cached Gmail API service, building (and refreshing creds) once."""
    global _service
    if _service is None:
        creds = _build_credentials()
        _service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    return _service


def validate_api_key() -> bool:
    """
    Verify the Gmail credentials build/refresh successfully.

    Returns True if the service is ready; False (logged ERROR, not WARNING) on any
    auth failure so the caller can `raise SystemExit(1)` and fail the GitHub
    Actions step visibly instead of silently sending zero emails. The name is kept
    (`validate_api_key`) for a drop-in swap with the old Resend client.
    """
    global _service_failed
    if _service_failed:
        return False
    try:
        _get_service()
        logger.info("gmail: credentials OK (service ready)")
        return True
    except (RuntimeError, GoogleAuthError, HttpError) as exc:
        _service_failed = True
        logger.error("gmail: credential validation FAILED: %s", exc)
        return False
    except Exception as exc:  # noqa: BLE001 — last-resort: never crash the step here
        _service_failed = True
        logger.error("gmail: unexpected credential error: %s", exc, exc_info=True)
        return False


def list_suppressions() -> set[str]:
    """
    Gmail has no suppression-list API. Return an empty set (fail-open), so the
    existing pre-send suppression check in deliver.py/digest.py is a no-op.
    """
    logger.info("gmail: no suppression list (Gmail) — proceeding without check")
    return set()


def send_email(
    *,
    to: str | list[str],
    subject: str,
    html: str,
    text: str,
    idempotency_key: str | None = None,  # accepted but unused — Gmail has no key
    reply_to: str | None = None,
    from_addr: str | None = None,
) -> dict[str, Any]:
    """
    Send a multipart (plain + HTML) email via the Gmail API.

    `idempotency_key` is accepted for interface parity but ignored — Gmail offers
    no idempotency key. (The outbox 'sent'/'failed'/'skipped' terminal states in
    deliver.py already prevent re-sends across runs.)

    Returns:
        {success: bool, provider_message_id: str|None, error: str|None,
         status_code: int}   (status_code 0 = no HTTP response, i.e. transient)
    """
    try:
        service = _get_service()
    except Exception as exc:  # noqa: BLE001 — surface as a transient-ish failure
        logger.error("gmail: cannot build service for send: %s", exc)
        return {
            "success": False,
            "provider_message_id": None,
            "error": str(exc),
            "status_code": 0,
        }

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr or ALERTS_SENDER_EMAIL
    msg["To"] = to if isinstance(to, str) else ", ".join(to)
    effective_reply_to = reply_to or ALERTS_REPLY_TO_EMAIL
    if effective_reply_to:
        msg["Reply-To"] = effective_reply_to
    # Order matters for multipart/alternative: plain first, HTML last (preferred).
    msg.attach(MIMEText(text or "", "plain", "utf-8"))
    msg.attach(MIMEText(html or "", "html", "utf-8"))

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    try:
        resp = (
            service.users()
            .messages()
            .send(userId="me", body={"raw": raw})
            .execute()
        )
    except HttpError as exc:
        status = getattr(getattr(exc, "resp", None), "status", 0) or 0
        logger.warning("gmail: send failed (HTTP %s) for to=%s: %s", status, to, exc)
        return {
            "success": False,
            "provider_message_id": None,
            "error": str(exc),
            "status_code": int(status),
        }
    except Exception as exc:  # noqa: BLE001 — network/transport → transient (code 0)
        logger.warning("gmail: send network/transport error for to=%s: %s", to, exc)
        return {
            "success": False,
            "provider_message_id": None,
            "error": str(exc),
            "status_code": 0,
        }

    return {
        "success": True,
        "provider_message_id": resp.get("id"),
        "error": None,
        "status_code": 200,
    }
