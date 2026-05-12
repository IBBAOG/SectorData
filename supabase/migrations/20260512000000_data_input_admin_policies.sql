-- ============================================================================
-- Admin write policies for price_bands and d_g_margins
--
-- Purpose: enable INSERT/UPDATE/DELETE from the /admin-panel → Data Input UI.
--   The UI posts directly via PostgREST (anon key is NOT used here; the page is
--   behind session auth and uses the authenticated role).  RLS is the only
--   enforcement layer — without these policies every write returns HTTP 403.
--
-- These policies are layered on top of the existing SELECT policy
-- "acesso autenticado" (USING (true) FOR SELECT TO authenticated).
-- Because Postgres combines PERMISSIVE policies with OR, adding a FOR ALL
-- policy does NOT replace the SELECT policy — both remain active and a
-- Client user can still read rows.
--
-- WARNING: do NOT drop the "acesso autenticado" SELECT policies on these
-- tables.  Removing them would break read access for Client users on
-- /price-bands and /diesel-gasoline-margins dashboards (RLS would fall
-- through to the FOR ALL policy which requires is_admin(), denying Clients).
--
-- Depends on: public.is_admin() introduced in 20260507000006_create_alert_recipients.sql
-- ============================================================================

-- ── price_bands ───────────────────────────────────────────────────────────────

-- Drop first for idempotency (no CREATE OR REPLACE for policies).
DROP POLICY IF EXISTS "price_bands_admin_write" ON public.price_bands;

CREATE POLICY "price_bands_admin_write" ON public.price_bands
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── d_g_margins ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "d_g_margins_admin_write" ON public.d_g_margins;

CREATE POLICY "d_g_margins_admin_write" ON public.d_g_margins
  AS PERMISSIVE FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
