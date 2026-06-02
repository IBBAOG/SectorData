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

# ── Gmail (active email backend) ──────────────────────────────────────────────
# The full token.json content (JSON string) with token / refresh_token /
# client_id / client_secret / token_uri / scopes. gmail_client.py builds
# credentials in-memory from this and self-refreshes — no files on disk.
GMAIL_TOKEN_JSON: str = os.environ.get("GMAIL_TOKEN_JSON", "")

# ── Resend (DORMANT) ──────────────────────────────────────────────────────────
# Kept for a future verified-domain switch; no longer required (see gmail_client.py).
RESEND_API_KEY: str = os.environ.get("RESEND_API_KEY", "")

# Email sender. Must be the Gmail account that owns GMAIL_TOKEN_JSON
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
      - GMAIL_TOKEN_JSON   (the active Gmail backend; RESEND_API_KEY is dormant)

    The CLI prints these clearly and exits non-zero rather than crashing with a
    stack trace when a hook runs in an environment that lacks the Gmail secret.
    """
    missing: list[str] = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_SERVICE_KEY:
        missing.append("SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY)")
    if not GMAIL_TOKEN_JSON:
        missing.append("GMAIL_TOKEN_JSON")
    return missing
