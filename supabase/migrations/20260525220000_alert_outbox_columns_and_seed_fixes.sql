-- Migration: fix alert_outbox schema gaps + seed errors uncovered in QA of 04a2ea9c
-- Owner: worker_alerts-product (in coordination with worker_supabase)

-- 1. Add missing columns on alert_outbox
ALTER TABLE public.alert_outbox
  ADD COLUMN IF NOT EXISTS coalesced_payload JSONB,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

COMMENT ON COLUMN public.alert_outbox.coalesced_payload IS
  'JSONB array of merged events when N>coalesce_above events of the same source land in the same fanout batch for the same subscriber. NULL for single-event rows.';
COMMENT ON COLUMN public.alert_outbox.provider_message_id IS
  'Resend message id captured at send time. Mirrored in alert_email_log; kept here for quick subscriber-side lookups.';

-- 2. Seed fixes

-- 2a. Add vendas (was missing from seed; detection/vendas.py registers it)
INSERT INTO public.alert_sources
  (source_slug, category, display_name, description, frequency_hint, detection_module, metadata, is_active)
VALUES
  ('vendas', 'Fuel Distribution', 'ANP Sales (Vendas)',
   'Monthly fuel sales by distributor (anp_vendas via Power BI scraper)',
   'Monthly (around 15th)',
   'scripts.alerts.detection.vendas:Vendas',
   '{"coalesce_above": 10, "frontend_route": "/sales-volumes"}'::jsonb,
   TRUE)
ON CONFLICT (source_slug) DO UPDATE SET
  detection_module = EXCLUDED.detection_module,
  metadata = EXCLUDED.metadata,
  is_active = EXCLUDED.is_active;

-- 2b. Drop ais_positions row (no detector; ais_candidates covers vessel watching for MVP)
DELETE FROM public.alert_sources WHERE source_slug = 'ais_positions';

-- 2c. Drop system_meta row (synthetic; canary will be rewritten to not write meta-events to alert_events)
DELETE FROM public.alert_sources WHERE source_slug = 'system_meta';

-- 2d. Keep system_confirmation (needed by subscribe_to_alerts RPC for synthetic confirmation events),
--     but ensure it's inactive (won't appear in user-facing list) — already inactive per seed.
--     No-op.

-- 2e. Fix detection_module strings: remove "Detector" suffix to match actual class names
UPDATE public.alert_sources
   SET detection_module = REPLACE(detection_module, 'Detector', '')
 WHERE detection_module LIKE '%Detector';
