-- Lock down EXECUTE on public.recompute_dg_margins(text, text) to service_role only.
--
-- Context: the /diesel-gasoline-margins automation cut the live d_g_margins series
-- over to the computed composition. recompute_dg_margins is SECURITY DEFINER and
-- WRITES to public.d_g_margins, so it must never be callable by anon/authenticated
-- (PostgREST auto-grants EXECUTE to PUBLIC on every new public function). Only the
-- service-role ETL path may run it.
--
-- Idempotent: REVOKE/GRANT are safe to re-run.

REVOKE EXECUTE ON FUNCTION public.recompute_dg_margins(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recompute_dg_margins(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recompute_dg_margins(text, text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.recompute_dg_margins(text, text) TO service_role;
