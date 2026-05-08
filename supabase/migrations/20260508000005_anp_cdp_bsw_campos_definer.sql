-- ============================================================================
-- Fix: get_anp_cdp_bsw_campos returns [] in production
--
-- Cause: function was SECURITY INVOKER reading mv_anp_cdp_pocos, which has
--   REVOKE SELECT FROM anon, authenticated (Hardening C, migration
--   20260505000003). authenticated callers therefore see zero rows.
-- Fix: switch to SECURITY DEFINER, matching the pattern used by
--   get_anp_cdp_pocos_json (the canonical reader of mv_anp_cdp_pocos).
-- Safety: function takes no parameters, performs no DML, exposes only
--   distinct campo strings already public via the broader /anp-cdp dashboard.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_anp_cdp_bsw_campos()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    array_agg(DISTINCT campo ORDER BY campo),
    ARRAY[]::text[]
  )
  FROM public.mv_anp_cdp_pocos
  WHERE local IN ('PreSal','PosSal')
    AND campo IS NOT NULL;
$$;

-- Re-assert grants (CREATE OR REPLACE preserves them, but be explicit):
REVOKE ALL ON FUNCTION public.get_anp_cdp_bsw_campos() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_campos() TO authenticated;
