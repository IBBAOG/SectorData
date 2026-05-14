-- ─────────────────────────────────────────────────────────────────────────────
-- 20260514120000_mfa_admin_required.sql
--
-- F3.1: TOTP MFA enforcement for admin-sensitive RPCs.
--
-- Changes:
--   1. CREATE OR REPLACE FUNCTION public.require_admin_mfa() — helper that
--      raises if the caller is an Admin without a verified MFA factor in
--      auth.mfa_factors.
--   2. CREATE OR REPLACE FUNCTION public.has_verified_mfa(uuid) — helper that
--      returns boolean for any user (used by UI / audit queries).
--   3. CREATE OR REPLACE FUNCTION public.set_user_role — wraps the existing
--      F2.2 audited version with require_admin_mfa() at the top so that no
--      admin can mutate roles without 2FA.
--   4. CREATE OR REPLACE FUNCTION public.set_module_visibility — same wrap.
--   5. CREATE OR REPLACE FUNCTION public.set_module_home_visibility — same
--      wrap.
--
-- auth.mfa_factors access:
--   auth.mfa_factors is restricted to the service role + supabase_auth_admin
--   by default. We define both helpers as SECURITY DEFINER and the function
--   owner (postgres) has access through the schema. We do NOT GRANT direct
--   SELECT on auth.mfa_factors to authenticated; clients only see the result
--   through the SECURITY DEFINER wrappers.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. has_verified_mfa helper ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.has_verified_mfa(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM auth.mfa_factors f
  WHERE f.user_id = p_user_id
    AND f.status = 'verified';
  RETURN v_count > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_verified_mfa(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.has_verified_mfa(UUID) FROM anon;

-- ─── 2. require_admin_mfa guard ──────────────────────────────────────────────
-- Raises if the calling user has role Admin without any verified MFA factor.
-- Non-Admins and unauthenticated callers pass through (the caller RPC is
-- responsible for its own authz).

CREATE OR REPLACE FUNCTION public.require_admin_mfa()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id   UUID;
  v_caller_role TEXT;
  v_has_factor  BOOLEAN;
BEGIN
  v_caller_id := (SELECT auth.uid());
  IF v_caller_id IS NULL THEN
    RETURN;
  END IF;

  SELECT role INTO v_caller_role
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_caller_role IS DISTINCT FROM 'Admin' THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM auth.mfa_factors f
    WHERE f.user_id = v_caller_id
      AND f.status = 'verified'
  ) INTO v_has_factor;

  IF NOT v_has_factor THEN
    RAISE EXCEPTION 'Admin must enroll MFA before performing admin actions'
      USING ERRCODE = '28000', HINT = 'Visit /profile/mfa to enable two-factor authentication.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.require_admin_mfa() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.require_admin_mfa() FROM anon;

-- ─── 3. set_user_role — gated by require_admin_mfa() ─────────────────────────
-- Recreates the F2.2 audited version with the MFA guard added before any
-- mutation.

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
  caller_role     TEXT;
  v_previous_role TEXT;
BEGIN
  -- Authorization: caller must be Admin.
  SELECT role INTO caller_role
  FROM public.profiles
  WHERE id = (SELECT auth.uid());

  IF caller_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Not authorized: Admin role required';
  END IF;

  -- F3.1: Admin must have MFA enrolled and verified.
  PERFORM public.require_admin_mfa();

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

-- ─── 4. set_module_visibility — gated by require_admin_mfa() ─────────────────

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

  -- F3.1: Admin must have MFA enrolled and verified.
  PERFORM public.require_admin_mfa();

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

-- ─── 5. set_module_home_visibility — gated by require_admin_mfa() ────────────

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

  -- F3.1: Admin must have MFA enrolled and verified.
  PERFORM public.require_admin_mfa();

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
