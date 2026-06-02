"""
Configuration for scripts/client_alerts — reads from environment variables.

The Client Alerts engine runs inside GitHub Actions (one hook step per ETL +
the daily digest workflow). All values come from the workflow `env:` block,
which is fed by repository secrets/vars. Nothing is hard-coded except the safe
defaults below.

Service-key resolution (important):
  ETL workflows in this repo are inconsistent — some pass the service key as
  `SUPABASE_SERVICE_KEY`, others as `SUPABASE_SERVICE_ROLE_KEY`. We accept
  EITHER so a hook step works no matter which the host workflow already wires.
  `SUPABASE_SERVICE_KEY` takes precedence when both are set.
"""
from __future__ import annotations

import os

# ── Supabase ──────────────────────────────────────────────────────────────────
SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")

# Accept both secret names (see module docstring).
SUPABASE_SERVICE_KEY: str = (
    os.environ.get("SUPABASE_SERVICE_KEY")
    or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or ""
)

# ── Gmail (active email backend — SMTP + App Password) ────────────────────────
# gmail_client.py logs into smtp.gmail.com:587 (STARTTLS) with GMAIL_ADDRESS +
# GMAIL_APP_PASSWORD. An App Password never expires (unlike the old OAuth refresh
# token, which kept getting revoked in the Testing-mode app).
#
# GMAIL_ADDRESS is the SMTP login user AND the account the From must match
# (Gmail rewrites a mismatched From). GMAIL_APP_PASSWORD is a 16-char Google App
# Password generated at https://myaccount.google.com/apppasswords.
GMAIL_ADDRESS: str = os.environ.get("GMAIL_ADDRESS", "ibbaogproject@gmail.com")
GMAIL_APP_PASSWORD: str = os.environ.get("GMAIL_APP_PASSWORD", "")

# Email sender. Must be the Gmail account that owns GMAIL_APP_PASSWORD
# (ibbaogproject@gmail.com) — Gmail overrides a mismatched From.
ALERTS_SENDER_EMAIL: str = os.environ.get(
    "ALERTS_SENDER_EMAIL", "SectorData Alerts <ibbaogproject@gmail.com>"
)

# Optional Reply-To. Empty string means "no reply_to" (Resend omits the header).
ALERTS_REPLY_TO_EMAIL: str = os.environ.get("ALERTS_REPLY_TO_EMAIL", "")

# Frontend URL used in email links (unsubscribe + "view data"). Defaults to the
# project's production deployment.
ALERTS_FRONTEND_URL: str = os.environ.get(
    "ALERTS_FRONTEND_URL", "https://sectordata-dashboard.vercel.app"
).rstrip("/")

# Default delivery batch size (overridable on the digest CLI via --batch-limit).
DELIVERY_BATCH_LIMIT: int = int(os.environ.get("DELIVERY_BATCH_LIMIT", "100"))

# Timezone used to bound the "today" window for digests.
DIGEST_TIMEZONE: str = os.environ.get("DIGEST_TIMEZONE", "America/Sao_Paulo")


def validate() -> list[str]:
    """
    Return the list of missing REQUIRED env var names (empty list = OK).

    Required for any send-capable run:
      - SUPABASE_URL
      - SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY)
      - GMAIL_APP_PASSWORD   (the active Gmail SMTP backend; GMAIL_ADDRESS has a
                             safe default)

    The CLI prints these clearly and exits non-zero rather than crashing with a
    stack trace when a hook runs in an environment that lacks the Gmail secret.
    """
    missing: list[str] = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_SERVICE_KEY:
        missing.append("SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY)")
    if not GMAIL_APP_PASSWORD:
        missing.append("GMAIL_APP_PASSWORD")
    return missing
