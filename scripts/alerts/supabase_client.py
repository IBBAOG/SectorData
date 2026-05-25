"""
Supabase service-role client singleton.
Uses SUPABASE_SERVICE_KEY — NEVER exposed to the browser.
"""
from __future__ import annotations

from supabase import create_client, Client
from scripts.alerts.config import SUPABASE_URL, SUPABASE_SERVICE_KEY

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in the environment."
            )
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client
