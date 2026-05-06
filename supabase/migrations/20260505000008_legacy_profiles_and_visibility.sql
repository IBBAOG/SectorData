-- ============================================================================
-- Legacy: profiles + module_visibility — tables, indexes, RLS, RPCs
--
-- Mirrors sql/create_profiles_and_visibility.sql, which was applied directly
-- via the Supabase Dashboard before versioned migrations were adopted.
--
-- All DDL is idempotent (IF NOT EXISTS / CREATE OR REPLACE / policy guards).
--
-- Drift vs prod (policies on profiles and module_visibility):
--   - 20260505000001_hardening_a_rls_indexes.sql dropped and replaced the
--     original policies from the sql/ file:
--       Dropped: "users can read own profile", "admins can read all profiles"
--       Created: "profiles read" (merged, with (select auth.uid()) wrapping)
--       Dropped: "users can update own profile"
--       Created: "users can update own profile" (same name, wrapped auth.uid())
--       Dropped: "admins can update visibility"
--       Created: "admins can update visibility" (same name, wrapped auth.uid())
--   - This migration uses DO $$ guards so it skips CREATE POLICY if the
--     hardening-era policy already exists under a different name, and only
--     creates the original policy if neither name variant is present.
--     For policies that share the same name, IF NOT EXISTS prevents errors.
--   - module_visibility seed rows: ON CONFLICT DO NOTHING — safe to re-run.
--   - Note: prod may have additional module_visibility rows inserted by later
--     migrations (news-hunter, admin-panel slugs). This seed covers the
--     original 6 modules only.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- profiles
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'Client'
                          CHECK (role IN ('Admin', 'Client')),
  full_name   TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles (role);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: "users can read own profile" (original name from sql/).
-- Hardening A dropped this and created "profiles read" (merged policy).
-- Guard: create original only if neither variant exists.
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname IN ('users can read own profile', 'profiles read')
  ) THEN
    CREATE POLICY "users can read own profile"
      ON public.profiles FOR SELECT
      TO authenticated
      USING (auth.uid() = id);
  END IF;
END
$policy$;

-- SELECT (admin): "admins can read all profiles" (original).
-- Hardening A merged this into "profiles read". Skip if any SELECT policy exists.
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname IN ('admins can read all profiles', 'profiles read')
      AND cmd = 'SELECT'
  ) THEN
    CREATE POLICY "admins can read all profiles"
      ON public.profiles FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles AS p
          WHERE p.id = auth.uid() AND p.role = 'Admin'
        )
      );
  END IF;
END
$policy$;

-- UPDATE: same name kept by hardening A (body changed to wrap auth.uid()).
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'users can update own profile'
  ) THEN
    CREATE POLICY "users can update own profile"
      ON public.profiles FOR UPDATE
      TO authenticated
      USING (auth.uid() = id)
      WITH CHECK (auth.uid() = id);
  END IF;
END
$policy$;

-- ── RPCs ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.upsert_my_profile(
  p_full_name  TEXT DEFAULT NULL,
  p_avatar_url TEXT DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result public.profiles;
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (auth.uid(), p_full_name, p_avatar_url)
  ON CONFLICT (id) DO UPDATE
    SET full_name  = EXCLUDED.full_name,
        avatar_url = EXCLUDED.avatar_url;

  SELECT * INTO result FROM public.profiles WHERE id = auth.uid();
  RETURN result;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- module_visibility
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.module_visibility (
  module_slug             TEXT        PRIMARY KEY,
  is_visible_for_clients  BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed original 6 modules. ON CONFLICT DO NOTHING is safe for re-runs.
-- Note: prod may have additional slugs (e.g. 'news-hunter', 'admin-panel')
-- inserted by later migrations or by the app. Not listed here — not a gap.
INSERT INTO public.module_visibility (module_slug, is_visible_for_clients)
VALUES
  ('sales',                   TRUE),
  ('market-share',            TRUE),
  ('navios-diesel',           TRUE),
  ('diesel-gasoline-margins', TRUE),
  ('price-bands',             TRUE),
  ('stocks',                  TRUE)
ON CONFLICT (module_slug) DO NOTHING;

ALTER TABLE public.module_visibility ENABLE ROW LEVEL SECURITY;

-- SELECT: all authenticated users
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'module_visibility'
      AND policyname = 'authenticated users can read visibility'
  ) THEN
    CREATE POLICY "authenticated users can read visibility"
      ON public.module_visibility FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END
$policy$;

-- UPDATE: Admin only. Hardening A recreated this with same name + wrapped uid.
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'module_visibility'
      AND policyname = 'admins can update visibility'
  ) THEN
    CREATE POLICY "admins can update visibility"
      ON public.module_visibility FOR UPDATE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE id = auth.uid() AND role = 'Admin'
        )
      );
  END IF;
END
$policy$;

-- ── RPCs ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_module_visibility()
RETURNS SETOF public.module_visibility
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.module_visibility ORDER BY module_slug;
$$;

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
  result      public.module_visibility;
BEGIN
  SELECT role INTO caller_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF caller_role IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Not authorized: Admin role required';
  END IF;

  UPDATE public.module_visibility
    SET is_visible_for_clients = p_is_visible,
        updated_at             = NOW()
    WHERE module_slug = p_slug;

  SELECT * INTO result
  FROM public.module_visibility
  WHERE module_slug = p_slug;

  RETURN result;
END;
$$;
