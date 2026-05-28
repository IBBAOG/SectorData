-- =============================================================================
-- 20260601400000_restore_anon_grants_cdp_canonical_rpcs.sql
--
-- Hotfix: restore GRANT EXECUTE TO anon on the 4 CDP RPCs that lost it during
-- the canonical-expansion DROP+CREATE in 20260530000000.
--
-- ── Symptom (production, 2026-05-28) ────────────────────────────────────────
-- /anp-cdp-bsw mobile view stuck on "updating…" indefinitely; chart never
-- renders for anonymous visitors. Y/X axes show default 0/200/400% (empty
-- data). Filter pills (Búzios, Peregrino, Frade) load fine — the campos RPC
-- still has the anon grant.
--
-- Desktop view appears to work for callers who hit it while logged-in
-- (authenticated role kept the grant). Mobile users were predominantly
-- anonymous and surfaced the regression first.
--
-- ── Root cause (Pegadinha #18 reincarnated) ─────────────────────────────────
-- Migration 20260530000000_cdp_rpcs_canonical_expansion.sql added an optional
-- `p_expand_canonical boolean DEFAULT false` parameter to the 4 RPCs:
--   - get_anp_cdp_bsw_scatter
--   - get_anp_cdp_bsw_field_aggregate
--   - get_anp_cdp_depletion_scatter
--   - get_anp_cdp_depletion_field_aggregate
--
-- It correctly DROP+CREATEd the new (text[], boolean) signature and then
-- REVOKEd from anon + GRANTed only to authenticated. That mirrors a defensive
-- pattern from prior /well-by-well work, but these 4 RPCs are the public
-- backend for /anp-cdp-bsw and /anp-cdp-depletion, which BOTH have
-- `is_visible_for_public=true` in module_visibility. Anonymous browsing of
-- these dashboards is a product requirement (see CLAUDE.md / README "Auth &
-- Roles" — Anon tier reads modules flagged public).
--
-- The wrappers in src/lib/rpc.ts catch the resulting 42501 silently and
-- return []. The hook then sets fieldPoints/wellPoints to [], and the mobile
-- View's `chartLoading = selectedCampos.length > 0 && fieldPoints.length === 0`
-- derivation evaluates to TRUE forever → "updating…" forever.
--
-- ── Fix ─────────────────────────────────────────────────────────────────────
-- Re-grant EXECUTE on the new (text[], boolean) signatures to anon. Matches
-- the pre-20260530000000 contract (anon grant was present continuously from
-- 20260525210050_grant_execute_anon_rpcs.sql onwards).
--
-- Grant-only migration: no DDL on bodies, no policy changes. Safe to re-run.
--
-- ── Defensive note for future canonical/signature changes ───────────────────
-- When DROP+CREATE-ing any RPC that backs a `is_visible_for_public=true`
-- dashboard, the GRANT block MUST include `anon`, not just `authenticated`.
-- Pegadinha #18 in CLAUDE.md describes the silent-empty failure mode
-- thoroughly. The pre-deploy audit query:
--   SELECT n.nspname || '.' || p.proname AS func, p.prosecdef
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.proname LIKE 'get\_%' AND p.prosecdef=false;
-- catches SECURITY DEFINER drift; a parallel query against pg_proc_acl /
-- has_function_privilege('anon', ...) should be run to catch missing anon
-- grants on public-facing RPCs.
-- =============================================================================

BEGIN;

-- BSW family (/anp-cdp-bsw) — both signatures with the new boolean param.
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_scatter(text[], boolean)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[], boolean)
  TO anon, authenticated;

-- Depletion family (/anp-cdp-depletion) — same regression, same fix.
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_depletion_scatter(text[], boolean)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_depletion_field_aggregate(text[], boolean)
  TO anon, authenticated;

COMMIT;
