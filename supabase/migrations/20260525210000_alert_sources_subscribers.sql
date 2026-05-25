-- ============================================================================
-- Alerts Product — Foundation tables (catalog + subscriptions + rate-limit)
--
-- This migration creates the catalog (`alert_sources`) and the subscription
-- model (`alert_subscribers`) used by the NEW user-facing /alerts module.
-- It is independent from `alert_recipients` (legacy broadcast list owned by
-- worker_alertas, kept for parallel-running cutover) — both coexist.
--
-- See docs/alerts/PRD.md for the full architecture.
-- See .claude/plans/quero-criar-um-novo-synchronous-reddy.md for decisions.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. alert_sources — declarative catalog of monitorable data sources
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.alert_sources (
  source_slug      TEXT        PRIMARY KEY,
  category         TEXT        NOT NULL
                                CHECK (category IN (
                                  'Fuel Distribution',
                                  'Oil & Gas',
                                  'Vessels',
                                  'Proprietary'
                                )),
  display_name     TEXT        NOT NULL,
  description      TEXT,
  frequency_hint   TEXT,
  detection_module TEXT        NOT NULL,
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.alert_sources IS
  'Catalog of data sources that can be subscribed to via /alerts.
   Seeded with 18+ sources by 20260525210040_alerts_seed_sources.sql.
   is_active=false means detector not yet shipped; UI hides those rows.';

ALTER TABLE public.alert_sources ENABLE ROW LEVEL SECURITY;

-- Anyone (anon + authenticated) can read the catalog
CREATE POLICY "alert_sources_public_read"
  ON public.alert_sources
  FOR SELECT
  TO anon, authenticated
  USING (TRUE);

-- Only admin can modify
CREATE POLICY "alert_sources_admin_write"
  ON public.alert_sources
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ----------------------------------------------------------------------------
-- 2. alert_subscribers — per (user|anon) per source
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.alert_subscribers (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  email                    TEXT        NOT NULL,
  source_slug              TEXT        NOT NULL
                                       REFERENCES public.alert_sources(source_slug)
                                       ON DELETE CASCADE,
  is_confirmed             BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active                BOOLEAN     NOT NULL DEFAULT TRUE,
  filters                  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  confirmation_token       UUID        UNIQUE,
  confirmation_sent_at     TIMESTAMPTZ,
  confirmation_expires_at  TIMESTAMPTZ,
  confirmed_at             TIMESTAMPTZ,
  unsubscribe_token        UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  source_ip                INET,
  user_agent               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT alert_subscribers_email_source_unique
    UNIQUE (email, source_slug),
  CONSTRAINT alert_subscribers_email_format
    CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE INDEX IF NOT EXISTS idx_alert_subscribers_user_id
  ON public.alert_subscribers (user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_subscribers_email
  ON public.alert_subscribers (email);

CREATE INDEX IF NOT EXISTS idx_alert_subscribers_source_active
  ON public.alert_subscribers (source_slug)
  WHERE is_active = TRUE AND is_confirmed = TRUE;

CREATE INDEX IF NOT EXISTS idx_alert_subscribers_confirmation_token
  ON public.alert_subscribers (confirmation_token)
  WHERE confirmation_token IS NOT NULL;

COMMENT ON TABLE public.alert_subscribers IS
  'Subscriptions per (email, source). user_id is NULL for anonymous signups
   (double opt-in via confirmation_token). UNIQUE(email, source_slug) prevents
   duplicate subscriptions for same email.';

ALTER TABLE public.alert_subscribers ENABLE ROW LEVEL SECURITY;

-- Authenticated users can manage their own subscriptions
CREATE POLICY "alert_subscribers_self_select"
  ON public.alert_subscribers
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "alert_subscribers_self_update"
  ON public.alert_subscribers
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "alert_subscribers_self_delete"
  ON public.alert_subscribers
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Admin has full access
CREATE POLICY "alert_subscribers_admin_all"
  ON public.alert_subscribers
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- NOTE: INSERTs by anon/authenticated come exclusively through the SECURITY
-- DEFINER RPC subscribe_to_alerts (defined in 20260525210020). Anonymous flow:
-- user_id=NULL but token-based confirmation. No INSERT policy for anon.

-- ----------------------------------------------------------------------------
-- 3. alert_signup_rate — anti-abuse rate limit (per IP, hour window)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.alert_signup_rate (
  source_ip    INET        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  attempts     INT         NOT NULL DEFAULT 1,
  PRIMARY KEY (source_ip, window_start)
);

COMMENT ON TABLE public.alert_signup_rate IS
  'Sliding-hour rate limit for signups. Window is truncated to hour.
   Enforced at RPC level (max 10/IP/hour). Periodic cleanup of rows >24h old.';

CREATE INDEX IF NOT EXISTS idx_alert_signup_rate_window
  ON public.alert_signup_rate (window_start);

ALTER TABLE public.alert_signup_rate ENABLE ROW LEVEL SECURITY;

-- Only service-role writes (via SECURITY DEFINER RPCs); no direct access
CREATE POLICY "alert_signup_rate_admin_read"
  ON public.alert_signup_rate
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- 4. Helper trigger: NULL confirmation_token when confirmed
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.alerts_clear_token_on_confirm()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_confirmed = TRUE AND OLD.is_confirmed = FALSE THEN
    NEW.confirmation_token := NULL;
    NEW.confirmation_expires_at := NULL;
    NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_alert_subscribers_clear_token
  BEFORE UPDATE ON public.alert_subscribers
  FOR EACH ROW
  EXECUTE FUNCTION public.alerts_clear_token_on_confirm();
