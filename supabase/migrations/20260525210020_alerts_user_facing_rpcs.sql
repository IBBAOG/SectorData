-- ============================================================================
-- Alerts Product — User-facing RPCs (callable by anon + authenticated)
--
-- All RPCs are SECURITY DEFINER to bypass RLS while keeping access controlled
-- (auth.uid() captured internally; rate limit + token validation applied).
--
-- See docs/alerts/PRD.md § RPCs § User-facing.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- list_alert_sources — returns active catalog (anon + auth callable)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_alert_sources()
RETURNS TABLE (
  source_slug    TEXT,
  category       TEXT,
  display_name   TEXT,
  description    TEXT,
  frequency_hint TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    source_slug,
    category,
    display_name,
    description,
    frequency_hint
  FROM public.alert_sources
  WHERE is_active = TRUE
  ORDER BY category, display_name;
$$;

GRANT EXECUTE ON FUNCTION public.list_alert_sources() TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- subscribe_to_alerts — atomic upsert per (email, source_slug)
--
-- Behavior:
--   - If anon: insert all rows with is_confirmed=false + confirmation_token.
--     INSERT a synthetic confirmation event so delivery worker sends the
--     confirmation email (next cron tick).
--   - If authenticated AND p_email = auth.users.email: insta-confirm.
--   - If authenticated AND p_email <> auth.users.email: treat as anon flow.
--   - Rate limit: max 10 signups per IP per hour (window truncated to hour).
--
-- Returns JSONB: { subscribed: int, confirmation_sent: bool, rate_limited: bool }
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.subscribe_to_alerts(
  p_email        TEXT,
  p_source_slugs TEXT[],
  p_source_ip    INET DEFAULT NULL,
  p_user_agent   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id          UUID;
  v_user_email       TEXT;
  v_insta_confirm    BOOLEAN := FALSE;
  v_confirm_token    UUID;
  v_window           TIMESTAMPTZ;
  v_attempts         INT;
  v_inserted_count   INT := 0;
  v_confirmation_evt UUID;
  v_existing_subs    INT;
BEGIN
  -- Validate email format (RFC 5322 minimal)
  IF p_email IS NULL OR p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object(
      'subscribed', 0,
      'confirmation_sent', FALSE,
      'rate_limited', FALSE,
      'error', 'invalid_email'
    );
  END IF;

  -- Validate sources array
  IF p_source_slugs IS NULL OR cardinality(p_source_slugs) = 0 THEN
    RETURN jsonb_build_object(
      'subscribed', 0,
      'confirmation_sent', FALSE,
      'rate_limited', FALSE,
      'error', 'no_sources_selected'
    );
  END IF;

  -- Rate limit check (per IP, hour window)
  IF p_source_ip IS NOT NULL THEN
    v_window := date_trunc('hour', NOW());

    SELECT attempts INTO v_attempts
    FROM public.alert_signup_rate
    WHERE source_ip = p_source_ip AND window_start = v_window;

    IF v_attempts IS NOT NULL AND v_attempts >= 10 THEN
      RETURN jsonb_build_object(
        'subscribed', 0,
        'confirmation_sent', FALSE,
        'rate_limited', TRUE
      );
    END IF;

    INSERT INTO public.alert_signup_rate (source_ip, window_start, attempts)
    VALUES (p_source_ip, v_window, 1)
    ON CONFLICT (source_ip, window_start)
    DO UPDATE SET attempts = alert_signup_rate.attempts + 1;
  END IF;

  -- Determine user_id and insta-confirm eligibility
  v_user_id := auth.uid();
  IF v_user_id IS NOT NULL THEN
    SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
    IF lower(v_user_email) = lower(p_email) THEN
      v_insta_confirm := TRUE;
    END IF;
  END IF;

  -- Generate confirmation token (only used if NOT insta-confirm)
  v_confirm_token := gen_random_uuid();

  -- Upsert subscriptions for each requested source
  WITH valid_sources AS (
    SELECT s.source_slug
    FROM public.alert_sources s
    WHERE s.source_slug = ANY(p_source_slugs)
      AND s.is_active = TRUE
  ),
  inserted AS (
    INSERT INTO public.alert_subscribers (
      user_id, email, source_slug, is_confirmed,
      confirmation_token, confirmation_sent_at, confirmation_expires_at,
      source_ip, user_agent
    )
    SELECT
      v_user_id,
      lower(p_email),
      vs.source_slug,
      v_insta_confirm,
      CASE WHEN v_insta_confirm THEN NULL ELSE v_confirm_token END,
      CASE WHEN v_insta_confirm THEN NULL ELSE NOW() END,
      CASE WHEN v_insta_confirm THEN NULL ELSE NOW() + INTERVAL '48 hours' END,
      p_source_ip,
      p_user_agent
    FROM valid_sources vs
    ON CONFLICT (email, source_slug)
    DO UPDATE SET
      is_active = TRUE,
      -- Don't downgrade existing confirmation
      is_confirmed = alert_subscribers.is_confirmed OR EXCLUDED.is_confirmed,
      -- Refresh token only if unconfirmed (allow retry)
      confirmation_token = CASE
        WHEN alert_subscribers.is_confirmed THEN alert_subscribers.confirmation_token
        ELSE EXCLUDED.confirmation_token
      END,
      confirmation_sent_at = CASE
        WHEN alert_subscribers.is_confirmed THEN alert_subscribers.confirmation_sent_at
        ELSE NOW()
      END,
      confirmation_expires_at = CASE
        WHEN alert_subscribers.is_confirmed THEN alert_subscribers.confirmation_expires_at
        ELSE NOW() + INTERVAL '48 hours'
      END
    RETURNING id, is_confirmed
  )
  SELECT count(*) INTO v_inserted_count FROM inserted;

  -- If not insta-confirm, INSERT a synthetic confirmation event into alert_events
  -- so the delivery worker sends the confirmation email on next cron tick.
  IF NOT v_insta_confirm AND v_inserted_count > 0 THEN
    INSERT INTO public.alert_events (source_slug, event_key, payload)
    VALUES (
      'system_confirmation',
      'confirmation:' || v_confirm_token::text,
      jsonb_build_object(
        'email', lower(p_email),
        'token', v_confirm_token,
        'source_slugs', p_source_slugs,
        'expires_at', NOW() + INTERVAL '48 hours'
      )
    )
    ON CONFLICT (source_slug, event_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'subscribed', v_inserted_count,
    'confirmation_sent', NOT v_insta_confirm,
    'rate_limited', FALSE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.subscribe_to_alerts(TEXT, TEXT[], INET, TEXT)
  TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- confirm_subscription — double opt-in landing
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_subscription(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count INT;
BEGIN
  -- Update all rows matching this token (a user can subscribe to multiple
  -- sources in one signup; they share the same token)
  UPDATE public.alert_subscribers
  SET is_confirmed = TRUE
  WHERE confirmation_token = p_token
    AND (confirmation_expires_at IS NULL OR confirmation_expires_at > NOW())
    AND is_confirmed = FALSE;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    -- Check if it was already confirmed (idempotent re-click) vs. expired/invalid
    IF EXISTS (
      SELECT 1 FROM public.alert_subscribers
      WHERE unsubscribe_token = p_token -- accidentally clicking unsub on confirm? unlikely
         OR (confirmation_token = p_token AND is_confirmed = TRUE)
    ) THEN
      RETURN jsonb_build_object('success', TRUE, 'already_confirmed', TRUE);
    END IF;
    RETURN jsonb_build_object('success', FALSE, 'error', 'token_invalid_or_expired');
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'subscribed_count', v_updated_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_subscription(UUID) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- resend_confirmation — rate-limited (1×/10min per email)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resend_confirmation(
  p_email        TEXT,
  p_source_slugs TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token          UUID;
  v_last_sent      TIMESTAMPTZ;
  v_updated_count  INT;
BEGIN
  -- Rate limit: 1 resend per 10 min per email
  SELECT MAX(confirmation_sent_at) INTO v_last_sent
  FROM public.alert_subscribers
  WHERE lower(email) = lower(p_email);

  IF v_last_sent IS NOT NULL AND v_last_sent > NOW() - INTERVAL '10 minutes' THEN
    RETURN jsonb_build_object(
      'sent', FALSE,
      'retry_after_seconds',
      EXTRACT(EPOCH FROM (v_last_sent + INTERVAL '10 minutes' - NOW()))::INT
    );
  END IF;

  -- Generate fresh token
  v_token := gen_random_uuid();

  UPDATE public.alert_subscribers
  SET confirmation_token = v_token,
      confirmation_sent_at = NOW(),
      confirmation_expires_at = NOW() + INTERVAL '48 hours'
  WHERE lower(email) = lower(p_email)
    AND source_slug = ANY(p_source_slugs)
    AND is_confirmed = FALSE;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object('sent', FALSE, 'error', 'no_pending_subscriptions');
  END IF;

  -- Synthetic confirmation event
  INSERT INTO public.alert_events (source_slug, event_key, payload)
  VALUES (
    'system_confirmation',
    'confirmation:' || v_token::text,
    jsonb_build_object(
      'email', lower(p_email),
      'token', v_token,
      'source_slugs', p_source_slugs,
      'expires_at', NOW() + INTERVAL '48 hours',
      'resend', TRUE
    )
  )
  ON CONFLICT (source_slug, event_key) DO NOTHING;

  RETURN jsonb_build_object('sent', TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resend_confirmation(TEXT, TEXT[]) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- unsubscribe — single source via unsubscribe_token
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.unsubscribe(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count INT;
BEGIN
  UPDATE public.alert_subscribers
  SET is_active = FALSE
  WHERE unsubscribe_token = p_token AND is_active = TRUE;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    -- Idempotent: already unsubscribed = still success
    IF EXISTS (SELECT 1 FROM public.alert_subscribers WHERE unsubscribe_token = p_token) THEN
      RETURN jsonb_build_object('success', TRUE, 'already_unsubscribed', TRUE);
    END IF;
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_token');
  END IF;

  RETURN jsonb_build_object('success', TRUE);
END;
$$;

GRANT EXECUTE ON FUNCTION public.unsubscribe(UUID) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- unsubscribe_all — all sources for the email associated with given token
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.unsubscribe_all(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email         TEXT;
  v_updated_count INT;
BEGIN
  SELECT email INTO v_email
  FROM public.alert_subscribers
  WHERE unsubscribe_token = p_token
  LIMIT 1;

  IF v_email IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'invalid_token');
  END IF;

  UPDATE public.alert_subscribers
  SET is_active = FALSE
  WHERE lower(email) = lower(v_email) AND is_active = TRUE;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object('success', TRUE, 'count', v_updated_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.unsubscribe_all(UUID) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- list_my_subscriptions — authenticated only (RLS-scoped via auth.uid())
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_my_subscriptions()
RETURNS TABLE (
  source_slug    TEXT,
  display_name   TEXT,
  category       TEXT,
  is_confirmed   BOOLEAN,
  is_active      BOOLEAN,
  created_at     TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sub.source_slug,
    src.display_name,
    src.category,
    sub.is_confirmed,
    sub.is_active,
    sub.created_at
  FROM public.alert_subscribers sub
  JOIN public.alert_sources src ON src.source_slug = sub.source_slug
  WHERE sub.user_id = auth.uid()
  ORDER BY src.category, src.display_name;
$$;

GRANT EXECUTE ON FUNCTION public.list_my_subscriptions() TO authenticated;

-- ----------------------------------------------------------------------------
-- update_subscription_active — pause/resume a single subscription
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_subscription_active(
  p_source_slug TEXT,
  p_is_active   BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.alert_subscribers
  SET is_active = p_is_active
  WHERE user_id = auth.uid()
    AND source_slug = p_source_slug;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_subscription_active(TEXT, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- list_my_recent_alerts — feed of recent sends for logged user
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_my_recent_alerts(p_limit INT DEFAULT 20)
RETURNS TABLE (
  outbox_id     UUID,
  source_slug   TEXT,
  display_name  TEXT,
  event_key     TEXT,
  payload       JSONB,
  status        TEXT,
  sent_at       TIMESTAMPTZ,
  detected_at   TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id,
    e.source_slug,
    src.display_name,
    e.event_key,
    e.payload,
    o.status,
    o.sent_at,
    e.detected_at
  FROM public.alert_outbox o
  JOIN public.alert_subscribers sub ON sub.id = o.subscriber_id
  JOIN public.alert_events e ON e.id = o.event_id
  JOIN public.alert_sources src ON src.source_slug = e.source_slug
  WHERE sub.user_id = auth.uid()
    AND e.source_slug <> 'system_confirmation'   -- exclude confirmation emails from feed
  ORDER BY COALESCE(o.sent_at, o.created_at) DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

GRANT EXECUTE ON FUNCTION public.list_my_recent_alerts(INT) TO authenticated;
