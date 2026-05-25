-- ============================================================================
-- Alerts Product — Admin RPCs (require public.is_admin())
--
-- Consumed by /admin-panel "Alerts" tab (worker_dash-admin) and by the
-- backend worker (worker_alerts-product) for testing/maintenance.
--
-- See docs/alerts/PRD.md § RPCs § Admin-only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- admin_list_subscribers — paginated listing with filters
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_subscribers(
  p_source_slug TEXT DEFAULT NULL,
  p_limit       INT  DEFAULT 100,
  p_offset      INT  DEFAULT 0
)
RETURNS TABLE (
  id           UUID,
  user_id      UUID,
  email        TEXT,
  source_slug  TEXT,
  is_confirmed BOOLEAN,
  is_active    BOOLEAN,
  source_ip    INET,
  created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    sub.id,
    sub.user_id,
    sub.email,
    sub.source_slug,
    sub.is_confirmed,
    sub.is_active,
    sub.source_ip,
    sub.created_at
  FROM public.alert_subscribers sub
  WHERE p_source_slug IS NULL OR sub.source_slug = p_source_slug
  ORDER BY sub.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 1000))
  OFFSET GREATEST(0, p_offset);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_subscribers(TEXT, INT, INT) TO authenticated;

-- ----------------------------------------------------------------------------
-- admin_force_unsubscribe — soft-delete a subscriber row
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_force_unsubscribe(p_subscriber_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  UPDATE public.alert_subscribers
  SET is_active = FALSE
  WHERE id = p_subscriber_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_force_unsubscribe(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- admin_requeue_outbox — reset a failed outbox row to retry
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_requeue_outbox(p_outbox_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  UPDATE public.alert_outbox
  SET status = 'queued',
      send_attempts = 0,
      last_attempt_at = NULL,
      error = NULL
  WHERE id = p_outbox_id
    AND status IN ('failed', 'skipped');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_requeue_outbox(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- admin_send_test_event — inject a synthetic event for testing fanout/delivery
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_send_test_event(p_source_slug TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id   UUID;
  v_event_key  TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.alert_sources WHERE source_slug = p_source_slug) THEN
    RAISE EXCEPTION 'unknown source: %', p_source_slug;
  END IF;

  v_event_key := 'test:' || extract(epoch from now())::bigint;

  INSERT INTO public.alert_events (source_slug, event_key, payload)
  VALUES (
    p_source_slug,
    v_event_key,
    jsonb_build_object(
      'test', TRUE,
      'message', 'This is a synthetic test event injected by admin.',
      'injected_by', auth.uid(),
      'injected_at', NOW()
    )
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_send_test_event(TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- admin_email_log_recent — audit query for /admin-panel
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_email_log_recent(p_limit INT DEFAULT 200)
RETURNS TABLE (
  id                  UUID,
  outbox_id           UUID,
  email               TEXT,
  subject             TEXT,
  status              TEXT,
  provider_message_id TEXT,
  recorded_at         TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    l.id,
    l.outbox_id,
    l.email,
    l.subject,
    l.status,
    l.provider_message_id,
    l.recorded_at
  FROM public.alert_email_log l
  ORDER BY l.recorded_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 1000));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_email_log_recent(INT) TO authenticated;

-- ----------------------------------------------------------------------------
-- admin_subscriber_stats — aggregate metrics for /admin-panel Alerts tab
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_subscriber_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_per_source         JSONB;
  v_totals             JSONB;
  v_send_rate_7d       INT;
  v_bounce_rate_7d_pct NUMERIC;
  v_total_sent_7d      INT;
  v_total_bounced_7d   INT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  -- Per-source counts
  SELECT jsonb_agg(jsonb_build_object(
    'source_slug', source_slug,
    'subscribers_total', total_count,
    'subscribers_active', active_count,
    'subscribers_confirmed', confirmed_count
  ))
  INTO v_per_source
  FROM (
    SELECT
      s.source_slug,
      count(*) AS total_count,
      count(*) FILTER (WHERE s.is_active) AS active_count,
      count(*) FILTER (WHERE s.is_confirmed AND s.is_active) AS confirmed_count
    FROM public.alert_subscribers s
    GROUP BY s.source_slug
  ) per_source;

  -- Overall totals
  SELECT jsonb_build_object(
    'subscribers_total', count(*),
    'subscribers_active', count(*) FILTER (WHERE is_active),
    'subscribers_confirmed', count(*) FILTER (WHERE is_confirmed AND is_active),
    'unique_emails', count(DISTINCT lower(email))
  )
  INTO v_totals
  FROM public.alert_subscribers;

  -- Send rate (last 7d)
  SELECT count(*) INTO v_total_sent_7d
  FROM public.alert_email_log
  WHERE status = 'sent' AND recorded_at > NOW() - INTERVAL '7 days';

  SELECT count(*) INTO v_total_bounced_7d
  FROM public.alert_email_log
  WHERE status IN ('bounced', 'complained') AND recorded_at > NOW() - INTERVAL '7 days';

  v_send_rate_7d := v_total_sent_7d;
  v_bounce_rate_7d_pct := CASE
    WHEN v_total_sent_7d = 0 THEN 0
    ELSE round(100.0 * v_total_bounced_7d / v_total_sent_7d, 2)
  END;

  RETURN jsonb_build_object(
    'totals', v_totals,
    'per_source', COALESCE(v_per_source, '[]'::jsonb),
    'sent_7d', v_send_rate_7d,
    'bounced_7d', v_total_bounced_7d,
    'bounce_rate_7d_pct', v_bounce_rate_7d_pct
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_subscriber_stats() TO authenticated;

-- ----------------------------------------------------------------------------
-- admin_toggle_source_active — activate/deactivate a source in the catalog
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_toggle_source_active(
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
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  UPDATE public.alert_sources
  SET is_active = p_is_active
  WHERE source_slug = p_source_slug;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_toggle_source_active(TEXT, BOOLEAN) TO authenticated;
