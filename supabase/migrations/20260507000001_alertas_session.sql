-- ─────────────────────────────────────────────────────────────────────────────
-- 20260507000001_alertas_session.sql
--
-- Persistent APEX session storage for the alert monitoring subsystem.
-- Captured once per month by etl_anp_cdp.yml (Selenium+CAPTCHA), reused every
-- 2h by alertas_monitor.yml for lightweight CSV downloads via requests.
-- One row per detection base that needs an authenticated session.
-- Only the service role may read or write — frontend has no access.
--
-- Owner: worker_supabase
-- Consumers: dept ETL (write — etl_anp_cdp.yml), dept Alertas (read + update last_used_at)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.alertas_session (
    base          text        PRIMARY KEY,
    session       jsonb       NOT NULL,
    captured_at   timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz,
    last_used_at  timestamptz,
    metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.alertas_session ENABLE ROW LEVEL SECURITY;

-- No policies by design: only service-role bypasses RLS.
-- anon and authenticated roles have zero access to this table.

COMMENT ON TABLE public.alertas_session IS
    'Persistent authenticated session state for alert subsystem (one row per base needing auth, e.g. anp_cdp_producao_poco). '
    'Captured by ETL pipelines via Selenium/CAPTCHA, consumed by alerts monitor via lightweight requests replay. '
    'metadata jsonb holds debounce flags (last_capture_attempt) and APEX context (app_id, page_id, p_instance, captured_periodo). '
    'Owner: worker_supabase. Schema-only owner; producers/consumers in ETL + Alertas.';
