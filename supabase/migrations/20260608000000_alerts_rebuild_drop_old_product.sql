-- ============================================================================
-- Alerts Rebuild — Phase 1a: DROP the failed cloud alerts product (surgical)
--
-- Context
--   The first cloud alerts product (anon double-opt-in, confirmation tokens,
--   per-IP rate limiting) is being torn down and rebuilt logged-in-only. The
--   frontend, workflows and scripts/alerts were already removed in Phase 0.
--   This migration drops ONLY the database objects of that failed product.
--
-- Surgical scope — what this DOES NOT touch (different products, preserved):
--   * alert_recipients   — legacy local alert subsystem recipients
--   * alertas_estado     — legacy local alert subsystem state
--   * alertas_session    — legacy local alert subsystem captured sessions
--   * Any admin RPC unrelated to the alerts product (visibility, field stakes,
--     news keywords, home images, analytics, etc.) — untouched.
--
-- Objects removed here are recreated clean in the companion migration
-- 20260608100000_alerts_rebuild_new_schema.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) User-facing RPCs (exact signatures captured from
--    20260525210020_alerts_user_facing_rpcs.sql + pg_proc verification)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_alert_sources();
DROP FUNCTION IF EXISTS public.subscribe_to_alerts(text, text[], inet, text);
DROP FUNCTION IF EXISTS public.confirm_subscription(uuid);
DROP FUNCTION IF EXISTS public.resend_confirmation(text, text[]);
DROP FUNCTION IF EXISTS public.unsubscribe(uuid);
DROP FUNCTION IF EXISTS public.unsubscribe_all(uuid);
DROP FUNCTION IF EXISTS public.list_my_subscriptions();
DROP FUNCTION IF EXISTS public.update_subscription_active(text, boolean);
DROP FUNCTION IF EXISTS public.list_my_recent_alerts(integer);

-- ----------------------------------------------------------------------------
-- 2) Admin RPCs of the alerts product (signatures captured from
--    20260525210030_alerts_admin_rpcs.sql + pg_proc verification)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_list_subscribers(text, integer, integer);
DROP FUNCTION IF EXISTS public.admin_force_unsubscribe(uuid);
DROP FUNCTION IF EXISTS public.admin_requeue_outbox(uuid);
DROP FUNCTION IF EXISTS public.admin_send_test_event(text);
DROP FUNCTION IF EXISTS public.admin_email_log_recent(integer);
DROP FUNCTION IF EXISTS public.admin_subscriber_stats();
DROP FUNCTION IF EXISTS public.admin_toggle_source_active(text, boolean);

-- ----------------------------------------------------------------------------
-- 3) Confirmation trigger function (CASCADE drops the attached trigger
--    trg_alert_subscribers_clear_token on alert_subscribers)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.alerts_clear_token_on_confirm() CASCADE;

-- ----------------------------------------------------------------------------
-- 4) Tables of the failed product (CASCADE to clear FKs / dependent objects).
--    Order: children first, then parents.
--    NOTE: the new schema uses alert_subscriptions (NOT alert_subscribers),
--    so dropping alert_subscribers here does not clash with the rebuild.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.alert_email_log   CASCADE;
DROP TABLE IF EXISTS public.alert_outbox      CASCADE;
DROP TABLE IF EXISTS public.alert_events      CASCADE;
DROP TABLE IF EXISTS public.alert_signup_rate CASCADE;
DROP TABLE IF EXISTS public.alert_subscribers CASCADE;
DROP TABLE IF EXISTS public.alert_sources     CASCADE;
