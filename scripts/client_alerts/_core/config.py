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

# ── Resend ────────────────────────────────────────────────────────────────────
RESEND_API_KEY: str = os.environ.get("RESEND_API_KEY", "")

# Email sender (Option A — onboarding@resend.dev needs no DNS setup).
ALERTS_SENDER_EMAIL: str = os.environ.get(
    "ALERTS_SENDER_EMAIL", "SectorData Alerts <onboarding@resend.dev>"
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
      - RESEND_API_KEY

    The CLI prints these clearly and exits non-zero rather than crashing with a
    stack trace when a hook runs in an environment that lacks the Resend secrets.
    """
    missing: list[str] = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_SERVICE_KEY:
        missing.append("SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY)")
    if not RESEND_API_KEY:
        missing.append("RESEND_API_KEY")
    return missing
