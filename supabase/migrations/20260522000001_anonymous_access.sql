-- =============================================================================
-- 20260522000001_anonymous_access.sql
--
-- Phase A — Backend foundation for "login optional" with 3-tier visibility
-- (Anon < Client < Admin).
--
-- Summary:
--   1. module_visibility: + is_visible_for_public column (default FALSE —
--      closed; admin opt-in per-module), CHECK + trigger enforcing invariant
--      "public ⇒ clients".
--   2. get_module_visibility(): recreated with 4 columns; GRANT TO anon too.
--   3. set_module_public_visibility(): new admin-only, MFA-gated RPC mirroring
--      set_module_visibility / set_module_home_visibility.
--   4. app_events: + visitor_id column, user_id nullable, actor CHECK,
--      partial index on (visitor_id, created_at DESC).
--   5. track_event: adapted to accept p_visitor_id; GRANT TO anon.
--   6. Analytics RPCs (get_analytics_kpis, by_dashboard, by_user, user_timeline,
--      heatmap): COUNT DISTINCT trades user_id for COALESCE(user_id::text,
--      visitor_id); KPIs get two new fields for unique visitors / authed.
--   7. get_analytics_anon_summary(): new RPC for /admin-analytics anon section.
--   8. stock_portfolios: + is_public column, user_id nullable, RLS policy for
--      anon + authed read-public; seed 1 public default portfolio.
--   9. news_hunter_default_keywords: new table; seed mirrors the hardcoded
--      list in seed_my_news_hunter_keywords(); GRANT SELECT TO anon. New RPC
--      get_default_news_keywords(). seed_my_news_hunter_keywords() refactored
--      to read from this table (single source of truth).
--  10. news_articles: RLS policy adds anon read; GRANT SELECT TO anon.
--
-- All operations idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY
-- IF EXISTS / ON CONFLICT DO NOTHING / DO $$ guards. Safe to re-run.
--
-- Note on rollback: see plan §"Risk & Rollback" — companion standby migration
-- 20260522000002_revert_anonymous.sql (NOT in this migration) would DROP the
-- new columns and restore NOT NULLs if needed.
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. module_visibility: + is_visible_for_public
-- ══════════════════════════════════════════════════════════════════════════════
--
-- DEFAULT FALSE — closed by default; admin opens per-module via the
-- /admin-panel Permissions tab once a dashboard is verified anon-safe. The
-- closed default also keeps the CHECK invariant (public ⇒ clients) trivially
-- satisfied on existing rows where is_visible_for_clients may be FALSE.
-- The follow-up migration 20260522000002 seeds the two adapted dashboards
-- (/stocks and /news-hunter) to TRUE.

ALTER TABLE public.module_visibility
  ADD COLUMN IF NOT EXISTS is_visible_for_public BOOLEAN NOT NULL DEFAULT FALSE;

-- Invariant: public ⇒ clients. A module visible to anonymous visitors must
-- also be visible to logged-in Clients (otherwise the anon would lose access
-- on sign-in, which is nonsense).
-- Drop-and-recreate is safe because the constraint name is namespaced.
DO $constraint$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'module_visibility_public_implies_clients_chk'
      AND conrelid = 'public.module_visibility'::regclass
  ) THEN
    ALTER TABLE public.module_visibility
      DROP CONSTRAINT module_visibility_public_implies_clients_chk;
  END IF;

  ALTER TABLE public.module_visibility
    ADD CONSTRAINT module_visibility_public_implies_clients_chk
    CHECK (NOT (is_visible_for_public AND NOT is_visible_for_clients));
END
$constraint$;

-- Self-healing trigger: if a caller writes public=TRUE while clients=FALSE,
-- coerce clients=TRUE rather than raising. The CHECK above remains as a
-- defense-in-depth guarantee against pathological INSERTs that bypass the
-- trigger (e.g. service-role direct DML).
CREATE OR REPLACE FUNCTION public.module_visibility_enforce_public_implies_clients()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_visible_for_public IS TRUE AND NEW.is_visible_for_clients IS NOT TRUE THEN
    NEW.is_visible_for_clients := TRUE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_module_visibility_public_implies_clients
  ON public.module_visibility;

CREATE TRIGGER trg_module_visibility_public_implies_clients
  BEFORE INSERT OR UPDATE
  ON public.module_visibility
  FOR EACH ROW
  EXECUTE FUNCTION public.module_visibility_enforce_public_implies_clients();


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. get_module_visibility(): rebuild with 4 columns + anon GRANT
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_module_visibility();

CREATE OR REPLACE FUNCTION public.get_module_visibility()
RETURNS TABLE (
  module_slug             TEXT,
  is_visible_for_clients  BOOLEAN,
  is_visible_on_home      BOOLEAN,
  is_visible_for_public   BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    module_slug,
    is_visible_for_clients,
    is_visible_on_home,
    is_visible_for_public
  FROM public.module_visibility
  ORDER BY module_slug;
$$;

GRANT EXECUTE ON FUNCTION public.get_module_visibility() TO anon, authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. set_module_public_visibility(): admin-only, MFA-gated, audited
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_module_public_visibility(
  p_slug       TEXT,
  p_is_visible BOOLEAN
)
RETURNS public.module_visibility
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role     TEXT;
  v_previous BOOLEAN;
  v_row      public.module_visibility;
BEGIN
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = (SELECT auth.uid());

  IF v_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Not authorized: Admin role required';
  END IF;

  -- F3.1: Admin must have MFA enrolled and verified.
  PERFORM public.require_admin_mfa();

  -- Capture previous value before upsert.
  SELECT is_visible_for_public INTO v_previous
  FROM public.module_visibility
  WHERE module_slug = p_slug;

  -- Upsert. The BEFORE trigger will coerce is_visible_for_clients=TRUE if
  -- p_is_visible=TRUE and clients=FALSE, so the invariant is self-healing.
  INSERT INTO public.module_visibility (module_slug, is_visible_for_public)
  VALUES (p_slug, p_is_visible)
  ON CONFLICT (module_slug)
  DO UPDATE SET
    is_visible_for_public = EXCLUDED.is_visible_for_public,
    updated_at            = NOW()
  RETURNING * INTO v_row;

  -- Audit trail.
  INSERT INTO public.app_events (user_id, event_type, route, payload)
  VALUES (
    (SELECT auth.uid()),
    'admin.set_module_public_visibility',
    NULL,
    jsonb_build_object(
      'module_slug', p_slug,
      'is_visible',  p_is_visible,
      'old_value',   v_previous
    )
  );

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_module_public_visibility(TEXT, BOOLEAN) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_module_public_visibility(TEXT, BOOLEAN) FROM anon;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. app_events: visitor_id + nullable user_id + actor CHECK
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.app_events
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.app_events
  ADD COLUMN IF NOT EXISTS visitor_id TEXT;

-- At least one of (user_id, visitor_id) must be present. Guarantees we can
-- always attribute an event to *some* actor.
DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'app_events_actor_chk'
      AND conrelid = 'public.app_events'::regclass
  ) THEN
    ALTER TABLE public.app_events
      ADD CONSTRAINT app_events_actor_chk
      CHECK (user_id IS NOT NULL OR visitor_id IS NOT NULL);
  END IF;
END
$constraint$;

-- Partial index for anon analytics queries.
CREATE INDEX IF NOT EXISTS idx_app_events_visitor_created
  ON public.app_events (visitor_id, created_at DESC)
  WHERE visitor_id IS NOT NULL;


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. track_event: accept p_visitor_id; GRANT TO anon
-- ══════════════════════════════════════════════════════════════════════════════
--
-- New 4-arg signature. The old 3-arg overload is dropped first because
-- PostgREST resolves by argument names — keeping the 3-arg form would shadow
-- the new one for anon callers.

DROP FUNCTION IF EXISTS public.track_event(text, text, jsonb);

CREATE OR REPLACE FUNCTION public.track_event(
  p_event_type text,
  p_route      text   DEFAULT NULL,
  p_payload    jsonb  DEFAULT '{}'::jsonb,
  p_visitor_id text   DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid uuid;
BEGIN
  -- Validate event_type (mirror of the CHECK constraint).
  IF p_event_type NOT IN ('login', 'page_view', 'export') THEN
    RAISE EXCEPTION 'track_event: invalid event_type "%"', p_event_type;
  END IF;

  v_uid := auth.uid();

  IF v_uid IS NOT NULL THEN
    INSERT INTO public.app_events (user_id, visitor_id, event_type, route, payload)
    VALUES (v_uid, NULL, p_event_type, p_route, COALESCE(p_payload, '{}'::jsonb));
  ELSIF p_visitor_id IS NOT NULL AND length(trim(p_visitor_id)) > 0 THEN
    INSERT INTO public.app_events (user_id, visitor_id, event_type, route, payload)
    VALUES (NULL, p_visitor_id, p_event_type, p_route, COALESCE(p_payload, '{}'::jsonb));
  END IF;
  -- Else: silent no-op (no session, no visitor_id) — keeps SSR / bot calls safe.
END;
$$;

GRANT EXECUTE ON FUNCTION public.track_event(text, text, jsonb, text) TO anon, authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 6. Analytics RPCs: count distinct actor (user_id OR visitor_id)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Pattern used everywhere below:
--   COUNT(DISTINCT COALESCE(e.user_id::text, e.visitor_id))
--
-- Joins to profiles use LEFT JOIN so anon rows (user_id IS NULL) survive.
-- Filters like `p.role <> 'Admin'` become `(p.role <> 'Admin' OR p.role IS NULL)`
-- so anon rows are counted (they have no profile, so p.role IS NULL after LEFT JOIN).

-- ── 6a. get_analytics_kpis: add unique_visitors_period and unique_authenticated_period.
CREATE OR REPLACE FUNCTION public.get_analytics_kpis(
  period_days int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_role text;
  v_result      jsonb;
BEGIN
  SELECT role INTO v_caller_role
  FROM public.profiles
  WHERE id = (SELECT auth.uid());

  IF v_caller_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'get_analytics_kpis: caller is not an Admin';
  END IF;

  SELECT jsonb_build_object(
    'dau',                  (
      SELECT COUNT(DISTINCT COALESCE(e.user_id::text, e.visitor_id))
      FROM public.app_events e
      LEFT JOIN public.profiles p ON p.id = e.user_id
      WHERE (p.role IS NULL OR p.role <> 'Admin')
        AND e.created_at >= now() - interval '1 day'
    ),
    'wau',                  (
      SELECT COUNT(DISTINCT COALESCE(e.user_id::text, e.visitor_id))
      FROM public.app_events e
      LEFT JOIN public.profiles p ON p.id = e.user_id
      WHERE (p.role IS NULL OR p.role <> 'Admin')
        AND e.created_at >= now() - interval '7 days'
    ),
    'mau',                  (
      SELECT COUNT(DISTINCT COALESCE(e.user_id::text, e.visitor_id))
      FROM public.app_events e
      LEFT JOIN public.profiles p ON p.id = e.user_id
      WHERE (p.role IS NULL OR p.role <> 'Admin')
        AND e.created_at >= now() - interval '30 days'
    ),
    'total_users',          (
      SELECT COUNT(*) FROM public.profiles WHERE role <> 'Admin'
    ),
    'active_users_period',  (
      SELECT COUNT(DISTINCT COALESCE(e.user_id::text, e.visitor_id))
      FROM public.app_events e
      LEFT JOIN public.profiles p ON p.id = e.user_id
      WHERE (p.role IS NULL OR p.role <> 'Admin')
        AND e.created_at >= now() - (period_days || ' days')::interval
    ),
    'unique_visitors_period', (
      SELECT COUNT(DISTINCT e.visitor_id)
      FROM public.app_events e
      WHERE e.user_id IS NULL
        AND e.visitor_id IS NOT NULL
        AND e.created_at >= now() - (period_days || ' days')::interval
    ),
    'unique_authenticated_period', (
      SELECT COUNT(DISTINCT e.user_id)
      FROM public.app_events e
      JOIN public.profiles p ON p.id = e.user_id
      WHERE p.role <> 'Admin'
        AND e.created_at >= now() - (period_days || ' days')::interval
    ),
    'exports_period',       (
      SELECT COUNT(*)
      FROM public.app_events e
      LEFT JOIN public.profiles p ON p.id = e.user_id
      WHERE (p.role IS NULL OR p.role <> 'Admin')
        AND e.event_type = 'export'
        AND e.created_at >= now() - (period_days || ' days')::interval
    ),
    'page_views_period',    (
      SELECT COUNT(*)
      FROM public.app_events e
      LEFT JOIN public.profiles p ON p.id = e.user_id
      WHERE (p.role IS NULL OR p.role <> 'Admin')
        AND e.event_type = 'page_view'
        AND e.created_at >= now() - (period_days || ' days')::interval
    ),
    'logins_period',        (
      SELECT COUNT(*)
      FROM public.app_events e
      JOIN public.profiles p ON p.id = e.user_id
      WHERE p.role <> 'Admin'
        AND e.event_type = 'login'
        AND e.created_at >= now() - (period_days || ' days')::interval
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_analytics_kpis(int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_analytics_kpis(int) FROM anon;

-- ── 6b. get_analytics_by_dashboard
CREATE OR REPLACE FUNCTION public.get_analytics_by_dashboard(
  period_days int DEFAULT 30
)
RETURNS TABLE(
  route        text,
  page_views   bigint,
  unique_users bigint,
  exports      bigint,
  bytes_total  bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_role text;
BEGIN
  SELECT pr.role INTO v_caller_role
  FROM public.profiles pr
  WHERE pr.id = (SELECT auth.uid());

  IF v_caller_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'get_analytics_by_dashboard: caller is not an Admin';
  END IF;

  RETURN QUERY
  SELECT
    e.route,
    COUNT(*) FILTER (WHERE e.event_type = 'page_view')                                                                AS page_views,
    COUNT(DISTINCT COALESCE(e.user_id::text, e.visitor_id))
      FILTER (WHERE e.event_type = 'page_view')                                                                       AS unique_users,
    COUNT(*) FILTER (WHERE e.event_type = 'export')                                                                   AS exports,
    COALESCE(
      SUM((e.payload->>'bytes')::bigint) FILTER (WHERE e.event_type = 'export'),
      0
    )                                                                                                                  AS bytes_total
  FROM public.app_events e
  LEFT JOIN public.profiles p ON p.id = e.user_id
  WHERE (p.role IS NULL OR p.role <> 'Admin')
    AND e.created_at >= now() - (period_days || ' days')::interval
    AND e.route IS NOT NULL
  GROUP BY e.route
  ORDER BY page_views DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_analytics_by_dashboard(int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_analytics_by_dashboard(int) FROM anon;

-- ── 6c. get_analytics_by_user — unchanged semantics (per-user list excludes
-- visitors by design; visitors don't have profile rows). We only need to keep
-- the join on user_id IS NOT NULL implicit so anon rows are skipped.
CREATE OR REPLACE FUNCTION public.get_analytics_by_user(
  period_days int  DEFAULT 30,
  p_search    text DEFAULT ''
)
RETURNS TABLE(
  user_id    uuid,
  full_name  text,
  role       text,
  last_login timestamptz,
  page_views bigint,
  exports    bigint,
  top_routes jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_role text;
BEGIN
  SELECT pr.role INTO v_caller_role
  FROM public.profiles pr
  WHERE pr.id = (SELECT auth.uid());

  IF v_caller_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'get_analytics_by_user: caller is not an Admin';
  END IF;

  RETURN QUERY
  SELECT
    p.id                                                                   AS user_id,
    p.full_name,
    p.role,
    MAX(e.created_at) FILTER (WHERE e.event_type = 'login')               AS last_login,
    COUNT(*) FILTER (WHERE e.event_type = 'page_view')                    AS page_views,
    COUNT(*) FILTER (WHERE e.event_type = 'export')                       AS exports,
    (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object('route', sub.route, 'views', sub.views)
          ORDER BY sub.views DESC
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT e2.route, COUNT(*) AS views
        FROM public.app_events e2
        WHERE e2.user_id = p.id
          AND e2.event_type = 'page_view'
          AND e2.route IS NOT NULL
          AND e2.created_at >= now() - (period_days || ' days')::interval
        GROUP BY e2.route
        ORDER BY views DESC
        LIMIT 3
      ) sub
    )                                                                      AS top_routes
  FROM public.profiles p
  LEFT JOIN public.app_events e
    ON e.user_id = p.id
   AND e.created_at >= now() - (period_days || ' days')::interval
  WHERE p.role <> 'Admin'
    AND (
      p_search = ''
      OR p.full_name ILIKE '%' || p_search || '%'
    )
  GROUP BY p.id, p.full_name, p.role
  ORDER BY page_views DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_analytics_by_user(int, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_analytics_by_user(int, text) FROM anon;

-- ── 6d. get_analytics_user_timeline — unchanged (per-user drill-down).
-- Anon visitors don't have a uuid, so they can't be the target of this RPC.
CREATE OR REPLACE FUNCTION public.get_analytics_user_timeline(
  target_user_id uuid,
  period_days    int DEFAULT 30
)
RETURNS TABLE(
  event_type text,
  route      text,
  payload    jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_role text;
BEGIN
  SELECT pr.role INTO v_caller_role
  FROM public.profiles pr
  WHERE pr.id = (SELECT auth.uid());

  IF v_caller_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'get_analytics_user_timeline: caller is not an Admin';
  END IF;

  RETURN QUERY
  SELECT
    e.event_type,
    e.route,
    e.payload,
    e.created_at
  FROM public.app_events e
  WHERE e.user_id = target_user_id
    AND e.created_at >= now() - (period_days || ' days')::interval
  ORDER BY e.created_at DESC
  LIMIT 500;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_analytics_user_timeline(uuid, int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_analytics_user_timeline(uuid, int) FROM anon;

-- ── 6e. get_analytics_heatmap — include anon rows in the dow/hour count.
CREATE OR REPLACE FUNCTION public.get_analytics_heatmap(
  period_days int DEFAULT 30
)
RETURNS TABLE(
  dow         int,
  hour        int,
  event_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_role text;
BEGIN
  SELECT pr.role INTO v_caller_role
  FROM public.profiles pr
  WHERE pr.id = (SELECT auth.uid());

  IF v_caller_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'get_analytics_heatmap: caller is not an Admin';
  END IF;

  RETURN QUERY
  SELECT
    EXTRACT(DOW  FROM e.created_at AT TIME ZONE 'America/Sao_Paulo')::int AS dow,
    EXTRACT(HOUR FROM e.created_at AT TIME ZONE 'America/Sao_Paulo')::int AS hour,
    COUNT(*)                                                                AS event_count
  FROM public.app_events e
  LEFT JOIN public.profiles p ON p.id = e.user_id
  WHERE (p.role IS NULL OR p.role <> 'Admin')
    AND e.event_type = 'page_view'
    AND e.created_at >= now() - (period_days || ' days')::interval
  GROUP BY 1, 2
  ORDER BY 1, 2;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_analytics_heatmap(int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_analytics_heatmap(int) FROM anon;


-- ══════════════════════════════════════════════════════════════════════════════
-- 7. get_analytics_anon_summary: dedicated RPC for /admin-analytics anon section
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_analytics_anon_summary(
  p_period_days int DEFAULT 30
)
RETURNS TABLE (
  unique_visitors  bigint,
  total_page_views bigint,
  top_routes       jsonb  -- [{route, page_views}, …]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_role text;
BEGIN
  SELECT pr.role INTO v_caller_role
  FROM public.profiles pr
  WHERE pr.id = (SELECT auth.uid());

  IF v_caller_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'get_analytics_anon_summary: caller is not an Admin';
  END IF;

  RETURN QUERY
  WITH anon_events AS (
    SELECT e.visitor_id, e.event_type, e.route
    FROM public.app_events e
    WHERE e.user_id IS NULL
      AND e.visitor_id IS NOT NULL
      AND e.created_at >= now() - (p_period_days || ' days')::interval
  ),
  by_route AS (
    SELECT a.route, COUNT(*) AS page_views
    FROM anon_events a
    WHERE a.event_type = 'page_view'
      AND a.route IS NOT NULL
    GROUP BY a.route
    ORDER BY page_views DESC
    LIMIT 20
  )
  SELECT
    (SELECT COUNT(DISTINCT a.visitor_id) FROM anon_events a)                               AS unique_visitors,
    (SELECT COUNT(*) FROM anon_events a WHERE a.event_type = 'page_view')                  AS total_page_views,
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object('route', b.route, 'page_views', b.page_views)
                         ORDER BY b.page_views DESC)
        FROM by_route b
      ),
      '[]'::jsonb
    )                                                                                       AS top_routes;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_analytics_anon_summary(int) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_analytics_anon_summary(int) FROM anon;


-- ══════════════════════════════════════════════════════════════════════════════
-- 8. stock_portfolios: is_public column + anon read policy + seed public row
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.stock_portfolios
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

-- Allow NULL user_id so a system-owned public portfolio can exist without a
-- backing auth.users row.
ALTER TABLE public.stock_portfolios
  ALTER COLUMN user_id DROP NOT NULL;

-- The original migration created a single `FOR ALL` policy named
-- "users manage own stock portfolios" with USING auth.uid() = user_id. We do
-- NOT drop or modify it (owners must keep CRUD over their own rows). Instead
-- we add a permissive SELECT-only policy for anon and authenticated readers
-- that opens public portfolios to everyone.
--
-- RLS semantics: multiple permissive policies are OR'd. The owner's SELECT is
-- already covered by the FOR ALL policy; this new policy adds rows where
-- is_public = TRUE regardless of the caller (including anon).

DROP POLICY IF EXISTS "anon and authed read public portfolios" ON public.stock_portfolios;
CREATE POLICY "anon and authed read public portfolios"
  ON public.stock_portfolios
  FOR SELECT
  TO anon, authenticated
  USING (is_public = TRUE);

-- Grant SELECT to anon (PostgREST table-level grant). Owner CRUD policies
-- already grant the right operations to authenticated through the existing
-- FOR ALL policy and table grants.
GRANT SELECT ON public.stock_portfolios TO anon;

-- Seed a single public "Brazilian Oil & Gas" portfolio. Deterministic UUID
-- so re-runs are idempotent. tickers + groups must both be set; groups
-- mirrors the migration 20260401000001 shape.
INSERT INTO public.stock_portfolios (id, user_id, name, tickers, groups, is_public, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  NULL,
  'Brazilian Oil & Gas (default)',
  ARRAY['PETR4.SA','VBBR3.SA','BRAV3.SA','UGPA3.SA','RECV3.SA','PRIO3.SA']::text[],
  jsonb_build_array(
    jsonb_build_object(
      'name', 'Oil & Gas',
      'tickers', jsonb_build_array('PETR4.SA','VBBR3.SA','BRAV3.SA','UGPA3.SA','RECV3.SA','PRIO3.SA')
    )
  ),
  TRUE,
  TRUE
)
ON CONFLICT (id) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- 9. news_hunter_default_keywords: new table + RPC + refactor seed RPC
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.news_hunter_default_keywords (
  keyword    TEXT        PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.news_hunter_default_keywords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon and authed read defaults" ON public.news_hunter_default_keywords;
CREATE POLICY "anon and authed read defaults"
  ON public.news_hunter_default_keywords
  FOR SELECT
  TO anon, authenticated
  USING (TRUE);

GRANT SELECT ON public.news_hunter_default_keywords TO anon, authenticated;

-- Seed: mirrors the hardcoded list in the original
-- seed_my_news_hunter_keywords() body (migration 20260424000009).
INSERT INTO public.news_hunter_default_keywords (keyword) VALUES
  ('petróleo'), ('petroleo'), ('Petrobras'),
  ('Vibra'), ('Brava'), ('Ultrapar'),
  ('Ipiranga'), ('PetroReconcavo'), ('PetroRecôncavo'),
  ('oil'), ('gasolina'), ('gás'), ('gas'),
  ('diesel'), ('combustível'), ('combustivel'),
  ('combustíveis'), ('combustiveis'),
  ('OceanPact'), ('Cosan'), ('Raízen'), ('Raizen'),
  ('Braskem'), ('Compass'), ('PRIO'), ('ANP'), ('refit')
ON CONFLICT (keyword) DO NOTHING;

-- RPC: returns the default keyword set as a TEXT[] (callable from anon).
CREATE OR REPLACE FUNCTION public.get_default_news_keywords()
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(keyword ORDER BY keyword), ARRAY[]::TEXT[])
  FROM public.news_hunter_default_keywords;
$$;

GRANT EXECUTE ON FUNCTION public.get_default_news_keywords() TO anon, authenticated;

-- Refactor seed_my_news_hunter_keywords to read from the new table.
-- Single source of truth: edits to the default set now flow through INSERT
-- on news_hunter_default_keywords, not edits to this function body.
CREATE OR REPLACE FUNCTION public.seed_my_news_hunter_keywords()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.news_hunter_keywords (user_id, keyword)
  SELECT uid, d.keyword
  FROM public.news_hunter_default_keywords d
  ON CONFLICT (user_id, keyword) DO NOTHING;
END;
$$;

-- Existing GRANT (from 20260424000009) carries over; restate for safety.
GRANT EXECUTE ON FUNCTION public.seed_my_news_hunter_keywords() TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 10. news_articles: add anon SELECT policy
-- ══════════════════════════════════════════════════════════════════════════════
--
-- The original policy (migration 20260424000008) granted SELECT only to
-- `authenticated`. Add a parallel anon-only policy so unauthenticated visitors
-- can render the public News Hunter feed.

DROP POLICY IF EXISTS "anon read news_articles" ON public.news_articles;
CREATE POLICY "anon read news_articles"
  ON public.news_articles
  FOR SELECT
  TO anon
  USING (TRUE);

GRANT SELECT ON public.news_articles TO anon;


-- =============================================================================
-- End of migration 20260522000001_anonymous_access.sql
-- =============================================================================
