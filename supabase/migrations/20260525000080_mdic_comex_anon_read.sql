-- mdic_comex was originally restricted to authenticated only. The Imports & Exports
-- dashboard (anon-visible per module_visibility) consumes it via the new
-- get_imports_exports_fob_price_serie RPC (SECURITY INVOKER). Mirror the F1 pattern
-- (anp_daie / anp_desembaracos opened to anon in migration 20260525000020) so
-- anonymous visitors see Panel C without escalating the RPC privilege.
--
-- Wrapped in DO/IF NOT EXISTS for idempotency (matches the F1 structure).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mdic_comex' AND policyname = 'anon read mdic_comex'
  ) THEN
    EXECUTE 'CREATE POLICY "anon read mdic_comex" ON public.mdic_comex
             FOR SELECT TO anon USING (true)';
  END IF;
END;
$$;

GRANT SELECT ON public.mdic_comex TO anon;
