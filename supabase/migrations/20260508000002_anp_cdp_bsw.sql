-- ============================================================================
-- ANP CDP BSW — RPC for /anp-cdp-bsw scatter dashboard
-- Shows BSW (water cut = agua/(petroleo+agua)) vs months since first production,
-- per well, filtered by field (campo).
-- Source table: anp_cdp_producao (~1.8M rows, well-level monthly granularity)
-- ============================================================================

-- ── RPC: BSW scatter data ─────────────────────────────────────────────────────
-- Returns one row per (poco, month) with BSW ratio and time axis (mes_desde_t0).
-- t0 = first month where petroleo_bbl_dia > 0 for each well.
-- SECURITY INVOKER: authenticated users read through their own RLS context;
-- anp_cdp_producao already has "authenticated read" policy (hardening migration).
-- STABLE: pure read, no side effects, deterministic per transaction.
-- LIMIT 500000: safety cap — a single campo typically yields <50K rows.

CREATE OR REPLACE FUNCTION public.get_anp_cdp_bsw_scatter(p_campos text[])
RETURNS TABLE (
  poco          text,
  campo         text,
  mes_desde_t0  int,
  bsw           float8,
  ano           int,
  mes           int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      poco,
      campo,
      ano,
      mes,
      agua_bbl_dia,
      petroleo_bbl_dia,
      min(ano * 12 + mes) FILTER (WHERE petroleo_bbl_dia > 0)
        OVER (PARTITION BY poco) AS t0
    FROM public.anp_cdp_producao
    WHERE campo = ANY(p_campos)
  )
  SELECT
    poco,
    campo,
    (ano * 12 + mes - t0)::int                                      AS mes_desde_t0,
    (agua_bbl_dia / NULLIF(petroleo_bbl_dia + agua_bbl_dia, 0))::float8 AS bsw,
    ano,
    mes
  FROM base
  WHERE t0 IS NOT NULL
    AND (ano * 12 + mes) >= t0
    AND (petroleo_bbl_dia + agua_bbl_dia) > 0
  ORDER BY campo, poco, mes_desde_t0
  LIMIT 500000;
$$;

-- Revoke default public/anon access; only authenticated users may call this RPC.
REVOKE ALL ON FUNCTION public.get_anp_cdp_bsw_scatter(text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_scatter(text[]) TO authenticated;

-- ── module_visibility ─────────────────────────────────────────────────────────
-- Idempotent: ON CONFLICT DO NOTHING keeps existing value if already present.

INSERT INTO public.module_visibility (module_slug, is_visible_for_clients)
VALUES ('anp-cdp-bsw', true)
ON CONFLICT (module_slug) DO NOTHING;
