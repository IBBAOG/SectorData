# scripts/client_alerts/_core — shared engine for the Client Alerts product.
#
# Modules:
#   config.py           env-driven configuration + validate()
#   supabase_client.py  service-role Supabase client singleton
#   emit.py             emit_event_if_new(slug) -> event_id | None
#   fanout.py           fanout_event(slug, event_id) -> int
#   deliver.py          send_pending_outbox(batch_limit) -> counts
#   digest.py           sweep_digests() -> counts
#   resend_client.py    Resend REST wrapper (idempotency, suppression, key check)
#   render.py           Jinja2 immediate/digest rendering
