"""
Gmail SMTP sender — the ACTIVE email backend for the Client Alerts product.

Why SMTP + an App Password (not the OAuth Gmail API): the OAuth refresh token
kept expiring (the Google Cloud app is in Testing mode, so refresh tokens are
short-lived and were getting revoked → `invalid_grant`). An App Password over
plain SMTP (smtp.gmail.com:587, STARTTLS) NEVER expires and needs no token
plumbing — just two env vars: the login address and the app password.

Credentials come from the environment (NOT disk):
  GMAIL_ADDRESS       — the Gmail account used as the SMTP login user. Must match
                        the From address (Gmail rewrites a mismatched From).
                        Defaults to ibbaogproject@gmail.com.
  GMAIL_APP_PASSWORD  — a 16-character Google App Password (generated at
                        https://myaccount.google.com/apppasswords). Never expires.

Drop-in contract (same symbols deliver.py / digest.py already import — this file
replaces the OAuth implementation with no interface change):
  - validate_api_key() -> bool         open+login+quit an SMTP session once; True
                                       if the login succeeds, else False (logged
                                       ERROR with a regenerate hint).
  - list_suppressions() -> set[str]    SMTP has no suppression API → empty set.
  - send_email(...) -> dict            {success, provider_message_id, error,
                                       status_code} with the SAME failure-mode
                                       semantics deliver.py relies on:
                                         success=True            -> 'sent'
                                         4xx (400..499)          -> permanent 'failed'
                                         5xx / network (code 0)  -> transient, retry
                                       Auth / recipient / sender refusals map to
                                       550 (a 4xx-range "permanent" for deliver.py).

Sender identity: `From` MUST be the Gmail account that owns the app password
(GMAIL_ADDRESS, default ibbaogproject@gmail.com); Gmail ignores/overrides a
mismatched From. Daily send quota for a free Gmail account is ~500 messages/day.
"""
from __future__ import annotations

import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import make_msgid
from typing import Any

from scripts.client_alerts._core.config import (
    ALERTS_SENDER_EMAIL,
    ALERTS_REPLY_TO_EMAIL,
    GMAIL_ADDRESS,
    GMAIL_APP_PASSWORD,
)

logger = logging.getLogger(__name__)

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_TIMEOUT = 30  # seconds — never hang a CI step on a stuck connection

# Remember the validated-login result so we only open a probe connection once
# per process. None = not yet checked.
_login_ok: bool | None = None

_REGEN_HINT = (
    "set/refresh the GMAIL_APP_PASSWORD secret; generate at "
    "https://myaccount.google.com/apppasswords (and confirm GMAIL_ADDRESS matches "
    "the account that owns the app password)"
)


def _new_connection() -> smtplib.SMTP:
    """Open a fresh STARTTLS-secured, logged-in SMTP connection (caller closes it)."""
    smtp = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=SMTP_TIMEOUT)
    smtp.starttls(context=ssl.create_default_context())
    smtp.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
    return smtp


def validate_api_key() -> bool:
    """
    Verify the SMTP credentials by opening a connection, STARTTLS, login, quit.

    Returns True if the login succeeds; False (logged ERROR, not WARNING) on
    SMTPAuthenticationError or any failure, so the caller can `raise SystemExit(1)`
    and fail the GitHub Actions step visibly instead of silently sending zero
    emails. The result is cached — checked once per process. The name is kept
    (`validate_api_key`) for a drop-in swap with the previous backends.
    """
    global _login_ok
    if _login_ok is not None:
        return _login_ok

    if not GMAIL_APP_PASSWORD:
        _login_ok = False
        logger.error("gmail: GMAIL_APP_PASSWORD is not set — %s", _REGEN_HINT)
        return False

    try:
        smtp = _new_connection()
        try:
            smtp.quit()
        except Exception:  # noqa: BLE001 — quit failure after a good login is harmless
            pass
        _login_ok = True
        logger.info("gmail: SMTP login OK (%s @ %s)", GMAIL_ADDRESS, SMTP_HOST)
        return True
    except smtplib.SMTPAuthenticationError as exc:
        _login_ok = False
        logger.error("gmail: SMTP authentication FAILED: %s — %s", exc, _REGEN_HINT)
        return False
    except Exception as exc:  # noqa: BLE001 — last-resort: never crash the step here
        _login_ok = False
        logger.error(
            "gmail: SMTP credential validation FAILED: %s — %s",
            exc, _REGEN_HINT, exc_info=True,
        )
        return False


def list_suppressions() -> set[str]:
    """
    SMTP has no suppression-list API. Return an empty set (fail-open), so the
    existing pre-send suppression check in deliver.py/digest.py is a no-op.
    """
    logger.info("gmail: no suppression list (SMTP) — proceeding without check")
    return set()


def send_email(
    *,
    to: str | list[str],
    subject: str,
    html: str,
    text: str,
    idempotency_key: str | None = None,  # accepted but unused — SMTP has no key
    reply_to: str | None = None,
    from_addr: str | None = None,
) -> dict[str, Any]:
    """
    Send a multipart (plain + HTML) email via Gmail SMTP.

    A fresh SMTP connection is opened per send (simpler and more robust than a
    pooled connection; only the validated-login flag is reused). `idempotency_key`
    is accepted for interface parity but ignored — SMTP offers no idempotency key.
    (The outbox 'sent'/'failed'/'skipped' terminal states in deliver.py already
    prevent re-sends across runs.)

    Returns:
        {success: bool, provider_message_id: str|None, error: str|None,
         status_code: int}
          - success                          -> status_code 200
          - auth / recipient / sender refusal -> status_code 550 (permanent 'failed')
          - other SMTP / network / timeout    -> status_code 0   (transient, retry)
    """
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr or ALERTS_SENDER_EMAIL
    msg["To"] = to if isinstance(to, str) else ", ".join(to)
    effective_reply_to = reply_to or ALERTS_REPLY_TO_EMAIL
    if effective_reply_to:
        msg["Reply-To"] = effective_reply_to
    # Stamp a Message-ID before sending so we always have something to log even
    # though SMTP returns no provider id.
    message_id = make_msgid()
    msg["Message-ID"] = message_id
    # Order matters for multipart/alternative: plain first, HTML last (preferred).
    msg.attach(MIMEText(text or "", "plain", "utf-8"))
    msg.attach(MIMEText(html or "", "html", "utf-8"))

    try:
        smtp = _new_connection()
        try:
            smtp.send_message(msg)
        finally:
            try:
                smtp.quit()
            except Exception:  # noqa: BLE001 — quit failure after a good send is harmless
                pass
    except (
        smtplib.SMTPAuthenticationError,
        smtplib.SMTPRecipientsRefused,
        smtplib.SMTPSenderRefused,
    ) as exc:
        # Permanent: bad credentials or a rejected recipient/sender won't fix
        # itself on retry. Map to a 4xx-range code so deliver.py marks 'failed'.
        logger.warning("gmail: permanent send failure for to=%s: %s", to, exc)
        return {
            "success": False,
            "provider_message_id": None,
            "error": str(exc),
            "status_code": 550,
        }
    except (smtplib.SMTPException, OSError) as exc:
        # Transient: transport/timeout/temporary server error → retry next run.
        logger.warning("gmail: transient send error for to=%s: %s", to, exc)
        return {
            "success": False,
            "provider_message_id": None,
            "error": str(exc),
            "status_code": 0,
        }

    return {
        "success": True,
        "provider_message_id": msg["Message-ID"] or None,
        "error": None,
        "status_code": 200,
    }
