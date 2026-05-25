-- ============================================================================
-- Alerts Product — Event log, outbox, and email log
--
-- These 3 tables form the immutable backbone of the detection → fanout →
-- delivery pipeline. Triple-idempotency via UNIQUE constraints:
--   1. (source_slug, event_key) in alert_events  → "1 alert per fact"
--   2. (subscriber_id, event_id) in alert_outbox → "1 fanout per pair"
--   3. status='sent' terminal in alert_outbox    → "1 send per row"
--
-- See docs/alerts/PRD.md § Database schema.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. alert_events — immutable log of every detected update
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.alert_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slug  TEXT        NOT NULL
                            REFERENCES public.alert_sources(source_slug)
                            ON DELETE CASCADE,
  event_key    TEXT        NOT NULL,
  payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT alert_events_source_key_unique
    UNIQUE (source_slug, event_key)
);

COMMENT ON TABLE public.alert_events IS
  'Append-only log of update events detected by scripts/alerts/detection/*.py.
   IDEMPOTENCY: UNIQUE(source_slug, event_key) prevents re-firing same fact.
   Detectors INSERT ... ON CONFLICT DO NOTHING for safe re-runs.';

CREATE INDEX IF NOT EXISTS idx_alert_events_source_detected_at
  ON public.alert_events (source_slug, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_events_detected_at
  ON public.alert_events (detected_at DESC);

ALTER TABLE public.alert_events ENABLE ROW LEVEL SECURITY;

-- Service role writes (via worker_alerts-product backend); no anon/auth direct INSERT.
-- Admin can SELECT for debugging.
CREATE POLICY "alert_events_admin_select"
  ON public.alert_events
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- 2. alert_outbox — fanout queue per (subscriber, event)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.alert_outbox (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id   UUID        NOT NULL
                              REFERENCES public.alert_subscribers(id) ON DELETE CASCADE,
  event_id        UUID        NOT NULL
                              REFERENCES public.alert_events(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued','sending','sent','failed','skipped')),
  send_attempts   SMALLINT    NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT alert_outbox_pair_unique
    UNIQUE (subscriber_id, event_id)
);

COMMENT ON TABLE public.alert_outbox IS
  'Fanout target: 1 row per (subscriber, event). Created by scripts/alerts/fanout.py
   from JOIN of alert_subscribers (active+confirmed) and new alert_events.
   IDEMPOTENCY: UNIQUE(subscriber_id, event_id). status=''sent'' is terminal.';

CREATE INDEX IF NOT EXISTS idx_alert_outbox_status_queued
  ON public.alert_outbox (created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_alert_outbox_subscriber
  ON public.alert_outbox (subscriber_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_outbox_event
  ON public.alert_outbox (event_id);

ALTER TABLE public.alert_outbox ENABLE ROW LEVEL SECURITY;

-- Service role writes only. Admin reads for debugging.
CREATE POLICY "alert_outbox_admin_select"
  ON public.alert_outbox
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Authenticated users can read THEIR OWN outbox rows (for /alerts feed)
CREATE POLICY "alert_outbox_self_select"
  ON public.alert_outbox
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.alert_subscribers s
      WHERE s.id = alert_outbox.subscriber_id
        AND s.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 3. alert_email_log — append-only audit (sends, bounces, opens, clicks)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.alert_email_log (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id           UUID        REFERENCES public.alert_outbox(id) ON DELETE SET NULL,
  email               TEXT        NOT NULL,
  subject             TEXT        NOT NULL,
  status              TEXT        NOT NULL,
  provider_message_id TEXT,
  provider_response   JSONB,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.alert_email_log IS
  'Append-only audit of every send and every Resend webhook event.
   status: sent | delivered | bounced | complained | opened | clicked.
   Written by delivery worker (sent) AND webhook handler (others).';

CREATE INDEX IF NOT EXISTS idx_alert_email_log_recorded_at
  ON public.alert_email_log (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_email_log_email_status
  ON public.alert_email_log (email, status);

CREATE INDEX IF NOT EXISTS idx_alert_email_log_outbox
  ON public.alert_email_log (outbox_id) WHERE outbox_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_email_log_provider_msg
  ON public.alert_email_log (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.alert_email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alert_email_log_admin_select"
  ON public.alert_email_log
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Authenticated users can see logs for their own subscribers (for feed status)
CREATE POLICY "alert_email_log_self_select"
  ON public.alert_email_log
  FOR SELECT
  TO authenticated
  USING (
    outbox_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.alert_outbox o
      JOIN public.alert_subscribers s ON s.id = o.subscriber_id
      WHERE o.id = alert_email_log.outbox_id
        AND s.user_id = auth.uid()
    )
  );
