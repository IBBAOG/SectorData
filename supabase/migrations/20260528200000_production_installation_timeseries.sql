-- ─── Production RPCs — Round 3 (2026-05-28) ──────────────────────────────────
-- New `get_production_installation_timeseries`: mirror of Round 2's
-- `get_production_field_timeseries` but filtered by `instalacao_destino`
-- (FPSO / installation) instead of `campo`.
--
-- Consumed by /production Installations drill-down (FPSO panel click).
--
-- Stake-weighting note: an installation typically serves one or more campos.
-- The JOIN through field_stakes × empresa naturally restricts to wells where
-- the user's empresa actually holds a stake, and the stake_pct weighting
-- returns the company-attributable share of the FPSO's output. E.g.
--   p_instalacao='FPSO Cidade de Maricá' (TUPI, Petrobras 65%)
--   p_empresa='Petrobras'
-- → returns ~0.65 × FPSO total oil (campo TUPI).
--
-- SECURITY DEFINER + SET search_path = public, pg_temp because anp_cdp_producao
-- and field_stakes both have RLS scoped to authenticated only — anon callers
-- would otherwise get empty results (Pegadinha #18 in CLAUDE.md).

CREATE OR REPLACE FUNCTION public.get_production_installation_timeseries(
  p_instalacao text,
  p_empresa    text,
  p_date_start date,
  p_date_end   date
) RETURNS TABLE (
  ano           int,
  mes           int,
  oil_bbl_dia   numeric,
  gas_mm3_dia   numeric,
  water_bbl_dia numeric,
  hours_rate    numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH valid_stakes AS (
    -- Only include campos with complete stakes (SUM=100), filtered to empresa
    SELECT campo, empresa, stake_pct
      FROM field_stakes
     WHERE empresa = p_empresa
       AND campo IN (
         SELECT campo FROM field_stakes
          GROUP BY campo HAVING SUM(stake_pct) = 100
       )
  )
  SELECT
    p.ano,
    p.mes,
    SUM(p.petroleo_bbl_dia  * vs.stake_pct / 100)::numeric AS oil_bbl_dia,
    SUM(p.gas_total_mm3_dia * vs.stake_pct / 100)::numeric AS gas_mm3_dia,
    SUM(p.agua_bbl_dia      * vs.stake_pct / 100)::numeric AS water_bbl_dia,
    (AVG(p.tempo_prod_hs_mes) /
      (EXTRACT(DAY FROM (date_trunc('month', make_date(p.ano, p.mes, 1)) + INTERVAL '1 month - 1 day')) * 24)
    )::numeric AS hours_rate
  FROM anp_cdp_producao p
  JOIN valid_stakes vs ON vs.campo = p.campo
 WHERE p.instalacao_destino = p_instalacao
   AND make_date(p.ano, p.mes, 1) BETWEEN p_date_start AND p_date_end
 GROUP BY p.ano, p.mes
 ORDER BY p.ano, p.mes;
$$;

GRANT EXECUTE ON FUNCTION public.get_production_installation_timeseries(text, text, date, date) TO anon, authenticated;
