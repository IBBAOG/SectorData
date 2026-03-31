-- ============================================================================
-- User Management RPCs
-- Allows Admins to list all registered users and assign/change roles
-- directly from the /settings UI — no manual SQL needed.
--
-- Run this AFTER create_profiles_and_visibility.sql
-- ============================================================================


-- ── RPC: list all users with their role ──────────────────────────────────────
-- Returns every row in auth.users joined with profiles.
-- Users without a profile row default to role='Client'.
-- Only callable by Admins (enforced inside the function).
CREATE OR REPLACE FUNCTION public.get_all_users_with_roles()
RETURNS TABLE (
  id         UUID,
  email      TEXT,
  full_name  TEXT,
  role       TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
BEGIN
  SELECT p.role INTO caller_role
  FROM public.profiles AS p
  WHERE p.id = auth.uid();

  IF caller_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Not authorized: Admin role required';
  END IF;

  RETURN QUERY
    SELECT
      u.id,
      u.email::TEXT,
      COALESCE(p.full_name, '')::TEXT AS full_name,
      COALESCE(p.role, 'Client')::TEXT AS role,
      u.created_at
    FROM auth.users AS u
    LEFT JOIN public.profiles AS p ON p.id = u.id
    ORDER BY u.created_at ASC;
END;
$$;


-- ── RPC: set a user's role ────────────────────────────────────────────────────
-- Creates a profile row if one doesn't exist yet, then sets the role.
-- Only callable by Admins.
CREATE OR REPLACE FUNCTION public.set_user_role(
  p_user_id UUID,
  p_role    TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
BEGIN
  -- Verify caller is Admin
  SELECT role INTO caller_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF caller_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Not authorized: Admin role required';
  END IF;

  -- Validate role value
  IF p_role NOT IN ('Admin', 'Client') THEN
    RAISE EXCEPTION 'Invalid role: must be Admin or Client';
  END IF;

  -- Upsert the profile row
  INSERT INTO public.profiles (id, role)
  VALUES (p_user_id, p_role)
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role;
END;
$$;


-- ── RPC: ensure a profile row exists for a user ───────────────────────────────
-- Called after a new user signs up (or manually by an Admin) to create the
-- profile row with the desired initial role and name.
-- Only callable by Admins (for creating other users' profiles).
CREATE OR REPLACE FUNCTION public.ensure_user_profile(
  p_user_id   UUID,
  p_role      TEXT DEFAULT 'Client',
  p_full_name TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role TEXT;
BEGIN
  SELECT role INTO caller_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF caller_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Not authorized: Admin role required';
  END IF;

  IF p_role NOT IN ('Admin', 'Client') THEN
    RAISE EXCEPTION 'Invalid role: must be Admin or Client';
  END IF;

  INSERT INTO public.profiles (id, role, full_name)
  VALUES (p_user_id, p_role, p_full_name)
  ON CONFLICT (id) DO NOTHING; -- don't overwrite if already exists
END;
$$;
