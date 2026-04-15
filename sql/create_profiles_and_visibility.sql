-- ============================================================================
-- profiles table
-- Stores one row per authenticated user.
-- id references auth.users — deleted automatically when the user is deleted.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'Client'
                          CHECK (role IN ('Admin', 'Client')),
  full_name   TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for role-based lookups (future: admin panel querying all Admin users)
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles (role);

-- Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Each user may read their own profile row
CREATE POLICY "users can read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Each user may update their own profile (for future edit-mode / avatar upload)
CREATE POLICY "users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admins can read all profile rows (future: admin management panel)
CREATE POLICY "admins can read all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid() AND p.role = 'Admin'
    )
  );

-- ── RPC: get own profile ─────────────────────────────────────────────────────
-- Returns the caller's profile row, or no rows if none exists yet.
-- The frontend treats a NULL result as role='Client' (safe default).
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS public.profiles
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- ── RPC: upsert own profile ──────────────────────────────────────────────────
-- Called by a future "Edit Profile" UI. Role is intentionally NOT updatable
-- via this function — role changes require direct DB access or a separate
-- admin-only function.
CREATE OR REPLACE FUNCTION public.upsert_my_profile(
  p_full_name  TEXT DEFAULT NULL,
  p_avatar_url TEXT DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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


-- ============================================================================
-- module_visibility table
-- Controls which modules are visible to Client users.
-- One row per module slug. Admins toggle these via the /settings page.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.module_visibility (
  module_slug             TEXT        PRIMARY KEY,
  is_visible_for_clients  BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default rows — one per module defined in home/page.tsx CARDS array.
-- ON CONFLICT DO NOTHING ensures re-running this migration is safe.
INSERT INTO public.module_visibility (module_slug, is_visible_for_clients)
VALUES
  ('sales',                   TRUE),
  ('market-share',            TRUE),
  ('navios-diesel',           TRUE),
  ('diesel-gasoline-margins', TRUE),
  ('price-bands',             TRUE),
  ('stocks',                  TRUE)
ON CONFLICT (module_slug) DO NOTHING;

-- Row Level Security
ALTER TABLE public.module_visibility ENABLE ROW LEVEL SECURITY;

-- All authenticated users may read visibility rows.
-- The home page and module guard hooks need this to filter content for Clients.
CREATE POLICY "authenticated users can read visibility"
  ON public.module_visibility FOR SELECT
  TO authenticated
  USING (true);

-- Only Admins may update visibility rows.
CREATE POLICY "admins can update visibility"
  ON public.module_visibility FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'Admin'
    )
  );

-- ── RPC: get all module visibility rows ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_module_visibility()
RETURNS SETOF public.module_visibility
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.module_visibility ORDER BY module_slug;
$$;

-- ── RPC: toggle one module's visibility (Admin only) ─────────────────────────
-- Server-side role check provides defense-in-depth even if the frontend guard
-- is bypassed. Raises an exception for non-Admin callers.
CREATE OR REPLACE FUNCTION public.set_module_visibility(
  p_slug       TEXT,
  p_is_visible BOOLEAN
)
RETURNS public.module_visibility
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
