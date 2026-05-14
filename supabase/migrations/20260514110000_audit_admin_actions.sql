-- ─────────────────────────────────────────────────────────────────────────────
-- 20260514110000_audit_admin_actions.sql
--
-- F2.2: Audit trail for admin RPCs.
--
-- Changes:
--   1. Relax app_events.event_type CHECK constraint to also allow 'admin.*'
--      event types (stored as exact literal strings beginning with 'admin.').
--   2. CREATE OR REPLACE FUNCTION set_user_role — captures old role before
--      UPDATE, then inserts audit row into app_events.
--   3. CREATE OR REPLACE FUNCTION set_module_visibility — captures old value
--      before UPDATE, then inserts audit row.
--   4. CREATE OR REPLACE FUNCTION set_module_home_visibility — captures old
--      value before upsert, then inserts audit row.
--   5. CREATE OR REPLACE VIEW admin_audit_log — restricted to Admin via the
--      existing app_events RLS policy.
--
-- Column mapping note:
--   app_events has (user_id, event_type, route, payload, created_at).
--   Audit events use payload for structured data and route = NULL.
--   The planner CHECK is relaxed to: event_type IN known literals OR
--   event_type LIKE 'admin.%'.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Relax CHECK constraint on app_events.event_type ──────────────────────

ALTER TABLE public.app_events
  DROP CONSTRAINT IF EXISTS app_events_event_type_check;

ALTER TABLE public.app_events
  ADD CONSTRAINT app_events_event_type_check
  CHECK (
    event_type IN ('login', 'page_view', 'export')
    OR event_type LIKE 'admin.%'
  );

-- ─── 2. set_user_role — with audit ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_user_role(
  p_user_id UUID,
  p_role    TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_role    TEXT;
  v_previous_role TEXT;
BEGIN
  -- Authorization: caller must be Admin.
  SELECT role INTO caller_role
  FROM public.profiles
  WHERE id = (SELECT auth.uid());

  IF caller_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Not authorized: Admin role required';
  END IF;

  IF p_role NOT IN ('Admin', 'Client') THEN
    RAISE EXCEPTION 'Invalid role: must be Admin or Client';
  END IF;

  -- Capture previous role before mutation (NULL if profile does not exist yet).
  SELECT role INTO v_previous_role
  FROM public.profiles
  WHERE id = p_user_id;

  -- Upsert profile with new role.
  INSERT INTO public.profiles (id, role)
  VALUES (p_user_id, p_role)
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role;

  -- Audit trail.
  INSERT INTO public.app_events (user_id, event_type, route, payload)
  VALUES (
    (SELECT auth.uid()),
    'admin.set_user_role',
    NULL,
    jsonb_build_object(
      'target_user_id', p_user_id,
      'new_role',        p_role,
      'old_role',        v_previous_role
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_user_role(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_user_role(UUID, TEXT) FROM anon;

-- ─── 3. set_module_visibility — with audit ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_module_visibility(
  p_slug       TEXT,
  p_is_visible BOOLEAN
)
RETURNS public.module_visibility
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  caller_role TEXT;
  v_previous  BOOLEAN;
  result      public.module_visibility;
BEGIN
  SELECT role INTO caller_role
  FROM public.profiles
  WHERE id = (SELECT auth.uid());

  IF caller_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Not authorized: Admin role required';
  END IF;

  -- Capture previous value before mutation.
  SELECT is_visible_for_clients INTO v_previous
  FROM public.module_visibility
  WHERE module_slug = p_slug;

  UPDATE public.module_visibility
    SET is_visible_for_clients = p_is_visible,
        updated_at             = NOW()
    WHERE module_slug = p_slug;

  SELECT * INTO result
  FROM public.module_visibility
  WHERE module_slug = p_slug;

  -- Audit trail.
  INSERT INTO public.app_events (user_id, event_type, route, payload)
  VALUES (
    (SELECT auth.uid()),
    'admin.set_module_visibility',
    NULL,
    jsonb_build_object(
      'module_slug', p_slug,
      'is_visible',  p_is_visible,
      'old_value',   v_previous
    )
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_module_visibility(TEXT, BOOLEAN) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_module_visibility(TEXT, BOOLEAN) FROM anon;

-- ─── 4. set_module_home_visibility — with audit ──────────────────────────────

CREATE OR REPLACE FUNCTION public.set_module_home_visibility(
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
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Capture previous value before upsert.
  SELECT is_visible_on_home INTO v_previous
  FROM public.module_visibility
  WHERE module_slug = p_slug;

  INSERT INTO public.module_visibility (module_slug, is_visible_on_home)
  VALUES (p_slug, p_is_visible)
  ON CONFLICT (module_slug)
  DO UPDATE SET is_visible_on_home = EXCLUDED.is_visible_on_home
  RETURNING * INTO v_row;

  -- Audit trail.
  INSERT INTO public.app_events (user_id, event_type, route, payload)
  VALUES (
    (SELECT auth.uid()),
    'admin.set_module_home_visibility',
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

GRANT EXECUTE ON FUNCTION public.set_module_home_visibility(TEXT, BOOLEAN) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_module_home_visibility(TEXT, BOOLEAN) FROM anon;

-- ─── 5. admin_audit_log view ─────────────────────────────────────────────────
-- Inherits RLS from app_events (Admin-only SELECT policy already defined).
-- security_invoker = true means the view resolves using the caller's identity,
-- so the RLS check on app_events fires for the caller — no privilege escalation.

CREATE OR REPLACE VIEW public.admin_audit_log
  WITH (security_invoker = true)
AS
  SELECT
    id,
    user_id,
    event_type,
    payload   AS event_data,
    created_at
  FROM public.app_events
  WHERE event_type LIKE 'admin.%';

GRANT SELECT ON public.admin_audit_log TO authenticated;
