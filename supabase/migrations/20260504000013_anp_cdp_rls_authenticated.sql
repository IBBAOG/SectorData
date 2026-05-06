-- Tighten anp_cdp_producao RLS policy: restrict SELECT to authenticated users
-- (consistent with all other Phase 3 tables that already use this pattern)

DROP POLICY IF EXISTS "public read" ON public.anp_cdp_producao;
CREATE POLICY "acesso autenticado" ON public.anp_cdp_producao
    FOR SELECT TO authenticated USING (true);
