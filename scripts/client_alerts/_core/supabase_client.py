"""
Supabase service-role client singleton.

Uses the service key (SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY) which
BYPASSES RLS — this client may read/write alert_events, alert_outbox,
alert_source_state, alert_email_log directly, and call the service-only RPCs
alerts_current_period / alerts_active_recipients. NEVER expose this key to the
browser.
"""
from __future__ import annotations

from supabase import create_client, Client

from scripts.client_alerts._core.config import SUPABASE_URL, SUPABASE_SERVICE_KEY

_client: Client | None = None


def get_client() -> Client:
    """Return the process-wide service-role Supabase client (lazy singleton)."""
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            raise RuntimeError(
                "SUPABASE_URL and a service key "
                "(SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY) "
                "must be set in the environment."
            )
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client
