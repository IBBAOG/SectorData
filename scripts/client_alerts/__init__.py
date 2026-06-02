# scripts/client_alerts — Client Alerts engine (logged-in only, Resend delivery)
#
# Owner: worker_etl-pipelines (backend engine) — Phase 2 of the alerts rebuild.
#
# This package is the per-base alert engine: one thin wrapper per subscribable
# base (vendas.py, anp_glp.py, ...) plus a shared engine under _core/.
#
# The DB contract (alert_sources / alert_subscriptions / alert_events /
# alert_outbox / alert_email_log / alert_source_state + the service-role RPCs
# alerts_current_period / alerts_active_recipients) is owned by the Phase-1
# migration 20260608100000_alerts_rebuild_new_schema.sql — do NOT recreate it.
#
# All reads/writes use the Supabase service key (bypasses RLS). Emails are sent
# via the Resend REST API. Do NOT import from alertas/ (local-only legacy) or
# from the deleted scripts/alerts/ (Phase-0 removed product).
