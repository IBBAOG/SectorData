"""
Configuration for scripts/alerts — reads from environment variables.
All values are strings; caller is responsible for type conversion.
"""
import os

# Supabase
SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY: str = os.environ.get("SUPABASE_SERVICE_KEY", "")

# Resend
RESEND_API_KEY: str = os.environ.get("RESEND_API_KEY", "")
RESEND_WEBHOOK_SECRET: str = os.environ.get("RESEND_WEBHOOK_SECRET", "")

# Email sender strategy (Option A — onboarding@resend.dev, no DNS setup required)
ALERTS_SENDER_EMAIL: str = os.environ.get(
    "ALERTS_SENDER_EMAIL", "SectorData Alerts <onboarding@resend.dev>"
)
ALERTS_REPLY_TO_EMAIL: str = os.environ.get(
    "ALERTS_REPLY_TO_EMAIL", "ibbaogproject@gmail.com"
)

# Frontend URL used in email links (unsubscribe, confirm, view data)
ALERTS_FRONTEND_URL: str = os.environ.get(
    "ALERTS_FRONTEND_URL", "https://sectordata-dashboard.vercel.app"
)

# Delivery
DELIVERY_BATCH_LIMIT: int = int(os.environ.get("DELIVERY_BATCH_LIMIT", "100"))

# Meta-canary stale threshold (hours)
CANARY_STALE_HOURS: int = int(os.environ.get("CANARY_STALE_HOURS", "48"))


def validate() -> list[str]:
    """Return list of missing required env var names (empty = OK)."""
    missing = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_SERVICE_KEY:
        missing.append("SUPABASE_SERVICE_KEY")
    if not RESEND_API_KEY:
        missing.append("RESEND_API_KEY")
    return missing
