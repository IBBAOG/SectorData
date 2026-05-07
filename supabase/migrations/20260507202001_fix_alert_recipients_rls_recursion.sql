-- ============================================================================
-- fix_alert_recipients_rls_recursion
--
-- RECONSTRUÇÃO: esta migration foi aplicada diretamente no remote via MCP
-- (provavelmente em sessão de 2026-05-07 ~20:20 UTC) sem arquivo local.
-- Reconstruída a partir do diff do commit e1de4745 e do estado atual da tabela.
--
-- Problema original: a policy "alert_recipients_admin_all" usava subquery inline
-- `SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())` que causava
-- "infinite recursion detected in policy for relation 'profiles'" porque a tabela
-- profiles também tem RLS que re-avalia auth.uid() por row.
--
-- Solução: função SECURITY DEFINER is_admin() que bypassa RLS ao consultar
-- profiles, eliminando o loop.
-- ============================================================================

-- Função SECURITY DEFINER para verificar se o usuário autenticado é Admin
-- sem acionar a RLS de profiles (evita recursão infinita)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'Admin'
  );
$$;

-- Recriar policy usando is_admin() em vez de subquery inline
DROP POLICY IF EXISTS "alert_recipients_admin_all" ON public.alert_recipients;

CREATE POLICY "alert_recipients_admin_all"
  ON public.alert_recipients
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
