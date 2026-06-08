-- =============================================================================
-- Migration: subsidy_fixed_diesel_1_47
-- Date: 2026-06-08 (timestamp slot 20260613000000)
-- =============================================================================
--
-- Regulatory/economic correction effective 2026-06-01: the EFFECTIVE diesel
-- subsidy (reimbursement) that both agents ('importador' and 'produtor')
-- receive is FIXED at 1.47 BRL/L, not 1.12.
--
-- Why 1.47 and not the headline 1.12: MP 1.363 establishes a headline subsidy
-- of 1.12 BRL/L, but in the same move Petrobras cut 0.35 BRL/L off the refinery
-- price (3.65 -> 3.30, already reflected in price_bands.petrobras_price) and the
-- government reactivated PIS/COFINS (~0.35 BRL/L) that Petrobras now pays. The
-- effective subsidy that keeps Petrobras whole is 1.12 + 0.35 = 1.47. Realization:
-- 3.30 + 1.47 = 4.77 = pre-reform level (3.65 + 1.12). The dashboard must reflect
-- the effective economics (1.47) for BOTH agents.
--
-- Dates before 2026-06-01 keep the existing per-region averaged formula
-- (history is untouched). On/after 2026-06-01, the reimbursement is the
-- flat effective value of 1.47 BRL/L.
--
-- Implementation: CREATE OR REPLACE compute_subsidy_reimbursement(DATE, TEXT)
-- with a CASE branch. The ELSE branch reuses the EXACT prior formula
-- (cap CTE -> regional CTE -> AVG) wrapped as a scalar subquery.
--
-- SECURITY DEFINER + search_path preserved (Pegadinha #18). DROP+CREATE-style
-- replacement re-applies GRANT explicitly. Finally repopulates price_bands
-- diesel _w_subsidy columns from 2026-06-01 onward.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.compute_subsidy_reimbursement(
  p_date        DATE,
  p_tipo_agente TEXT
) RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_date >= DATE '2026-06-01' THEN 1.47::NUMERIC
    ELSE (
      WITH cap AS (
        SELECT cap_brl_l
        FROM public.anp_subsidy_caps
        WHERE tipo_agente   = p_tipo_agente
          AND vigente_desde <= p_date
        ORDER BY vigente_desde DESC
        LIMIT 1
      ),
      regional AS (
        SELECT LEAST(
                 GREATEST(r.preco_referencia - c.preco_comercializacao, 0),
                 (SELECT cap_brl_l FROM cap)
               ) AS reimb
        FROM public.anp_subsidy_diesel_reference r
        JOIN public.anp_subsidy_commercialization c
          ON c.regiao       = r.regiao
         AND c.tipo_agente  = r.tipo_agente
         AND p_date BETWEEN c.data_inicio AND c.data_fim
        WHERE r.data_referencia = p_date
          AND r.tipo_agente     = p_tipo_agente
      )
      SELECT AVG(reimb)::NUMERIC FROM regional
    )
  END;
$$;

COMMENT ON FUNCTION public.compute_subsidy_reimbursement(DATE, TEXT) IS
  'Per-day, per-agent diesel subsidy reimbursement. On/after 2026-06-01 it is FIXED at 1.47 BRL/L for both agents (effective subsidy = 1.12 headline subvenção under MP 1.363 + 0.35 compensation for the Petrobras refinery-price cut / reactivated PIS-COFINS; keeps Petrobras whole: 3.30 + 1.47 = 4.77 = pre-reform 3.65 + 1.12). Before 2026-06-01 it is the AVG over 5 regions of MIN(MAX(ref - comm, 0), cap), returning NULL if no data. SECURITY DEFINER + search_path so anon callers see real data (Pegadinha #18). Caller convention: tipo_agente is one of (''importador'',''produtor'').';

GRANT EXECUTE ON FUNCTION public.compute_subsidy_reimbursement(DATE, TEXT) TO anon, authenticated;

-- Repopulate price_bands diesel _w_subsidy columns for the fixed-value period.
SELECT public._pb_refresh_w_subsidy_from_date(DATE '2026-06-01');

COMMIT;
