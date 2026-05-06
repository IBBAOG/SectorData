-- ============================================================================
-- Hardening A — Quick wins: RLS auth() wrapping + duplicate index cleanup
--               + FK index + card_previews policy merge
-- ============================================================================
-- Resolves advisors:
--   auth_users_exposed (9 policies calling auth.uid()/auth.role() directly)
--   duplicate_index    (3 duplicate indexes on vendas)
--   unindexed_foreign_keys (stock_portfolios.user_id)
--   multiple_permissive_policies (card_previews SELECT overlap)
-- ============================================================================


-- ── A.1 profiles ─────────────────────────────────────────────────────────────
-- Merge two permissive SELECT policies into one unified policy.
-- Drop both existing SELECT policies, then create a single combined one.

DROP POLICY IF EXISTS "users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "admins can read all profiles" ON public.profiles;

-- Unified SELECT: own row OR caller is Admin
CREATE POLICY "profiles read"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) = id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (select auth.uid()) AND p.role = 'Admin'
    )
  );

-- UPDATE: wrap auth.uid() for performance
DROP POLICY IF EXISTS "users can update own profile" ON public.profiles;
CREATE POLICY "users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);


-- ── A.1 news_hunter_keywords ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "own keywords read" ON public.news_hunter_keywords;
CREATE POLICY "own keywords read"
  ON public.news_hunter_keywords FOR SELECT
  TO authenticated
  USING (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "own keywords insert" ON public.news_hunter_keywords;
CREATE POLICY "own keywords insert"
  ON public.news_hunter_keywords FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "own keywords delete" ON public.news_hunter_keywords;
CREATE POLICY "own keywords delete"
  ON public.news_hunter_keywords FOR DELETE
  TO authenticated
  USING (user_id = (select auth.uid()));


-- ── A.1 module_visibility ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "admins can update visibility" ON public.module_visibility;
CREATE POLICY "admins can update visibility"
  ON public.module_visibility FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (select auth.uid()) AND role = 'Admin'
    )
  );


-- ── A.1 stock_portfolios ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "users manage own stock portfolios" ON public.stock_portfolios;
CREATE POLICY "users manage own stock portfolios"
  ON public.stock_portfolios FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);


-- ── A.1 card_previews — fix auth.role() + merge overlapping SELECT policies ──

-- Drop the old SELECT policy that used auth.role() directly
DROP POLICY IF EXISTS "card_previews_select" ON public.card_previews;
-- Drop the ALL policy that overlapped on SELECT
DROP POLICY IF EXISTS "card_previews_admin_write" ON public.card_previews;

-- New SELECT-only policy: any authenticated user, wrapped auth
CREATE POLICY "card_previews_select"
  ON public.card_previews FOR SELECT
  TO authenticated
  USING ((select auth.role()) = 'authenticated');

-- Admin write separated into INSERT/UPDATE/DELETE to eliminate the SELECT overlap
CREATE POLICY "card_previews_admin_insert"
  ON public.card_previews FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (select auth.uid()) AND role = 'Admin'
    )
  );

CREATE POLICY "card_previews_admin_update"
  ON public.card_previews FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (select auth.uid()) AND role = 'Admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (select auth.uid()) AND role = 'Admin'
    )
  );

CREATE POLICY "card_previews_admin_delete"
  ON public.card_previews FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (select auth.uid()) AND role = 'Admin'
    )
  );


-- ── A.2 Drop duplicate indexes on vendas ─────────────────────────────────────
-- Keep: idx_vendas_agente_regulado, idx_vendas_regiao_dest, idx_vendas_uf_dest
-- Drop: shorter aliases that are exact duplicates

DROP INDEX IF EXISTS public.idx_vendas_agente;   -- duplicate of idx_vendas_agente_regulado
DROP INDEX IF EXISTS public.idx_vendas_regiao;   -- duplicate of idx_vendas_regiao_dest
DROP INDEX IF EXISTS public.idx_vendas_uf;       -- duplicate of idx_vendas_uf_dest


-- ── A.3 Add FK index on stock_portfolios.user_id ─────────────────────────────

CREATE INDEX IF NOT EXISTS idx_stock_portfolios_user_id
  ON public.stock_portfolios (user_id);
