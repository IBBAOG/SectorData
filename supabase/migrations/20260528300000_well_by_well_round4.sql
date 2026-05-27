-- ─── Round 4 — /well-by-well rename + canonical field grouping + live admin overview ────────
-- (1) Rename module_slug 'production' → 'well-by-well' in module_visibility.
-- (2) Create field_canonical_names override table + deterministic canonical_field_name() helper
--     (strips AnC_/EX_ prefixes and _ECO/_EX suffixes; manual overrides win).
-- (3) Update production RPCs that read by `campo` to group/expand by canonical name.
-- (4) Replace get_field_stakes_overview source from mv_anp_cdp_pocos (manual refresh) to
--     anp_cdp_producao filtered to last 2 months (live, no refresh needed). Adds canonical col.
-- (5) Add anp_cdp_producao(campo) index for the new DISTINCT campo + filter scan.

-- ───── (1) Module rename ─────────────────────────────────────────────────────
UPDATE public.module_visibility
   SET module_slug = 'well-by-well'
 WHERE module_slug = 'production';

-- ───── (2) Canonical field name table + helper ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.field_canonical_names (
  variant    text PRIMARY KEY,
  canonical  text NOT NULL,
  source     text NOT NULL DEFAULT 'manual' CHECK (source IN ('rule','manual')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.field_canonical_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "field_canonical_names_read_all"
  ON public.field_canonical_names FOR SELECT TO anon, authenticated USING (true);

-- No INSERT/UPDATE/DELETE policies — writes via admin RPCs only (future Round 5 if needed).

CREATE INDEX IF NOT EXISTS field_canonical_names_canonical_idx
  ON public.field_canonical_names (canonical);

CREATE OR REPLACE FUNCTION public.canonical_field_name(p_variant text)
  RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    -- Order: 1) manual override; 2) strip known prefixes/suffixes; 3) fallback to as-is.
    SELECT COALESCE(
      (SELECT canonical FROM field_canonical_names WHERE variant = p_variant),
      trim(both ' ' FROM
        regexp_replace(
          regexp_replace(
            regexp_replace(p_variant, '^AnC_', '', 'i'),
            '^EX_', '', 'i'
          ),
          '(_ECO|_EX)$', '', 'i'
        )
      ),
      p_variant
    );
  $$;

GRANT EXECUTE ON FUNCTION public.canonical_field_name(text) TO anon, authenticated;

-- ───── (3) Update production RPCs that key on `campo` ───────────────────────
-- (3a) get_production_top_fields — group by canonical, aggregate stake-weighted production
CREATE OR REPLACE FUNCTION public.get_production_top_fields(
  p_empresa text,
  p_date    date,
  p_top_n   int DEFAULT 10
) RETURNS TABLE (
  campo            text,
  oil_bbl_dia      numeric,
  water_bbl_dia    numeric,
  hours_rate       numeric,
  stake_pct        numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH valid_stakes AS (
    SELECT campo, empresa, stake_pct
      FROM field_stakes
     WHERE campo IN (
       SELECT campo FROM field_stakes
        GROUP BY campo
       HAVING SUM(stake_pct) = 100
     )
       AND empresa = p_empresa
  ),
  month_data AS (
    SELECT
      canonical_field_name(p.campo) AS canonical,
      SUM(p.petroleo_bbl_dia * vs.stake_pct / 100)::numeric AS oil_company,
      SUM(p.agua_bbl_dia * vs.stake_pct / 100)::numeric AS water_company,
      (AVG(p.tempo_prod_hs_mes) /
       (EXTRACT(DAY FROM (date_trunc('month', p_date) + INTERVAL '1 month - 1 day')) * 24))::numeric AS hours_rate,
      -- For multi-variant canonical groups, report the WEIGHTED-AVG stake (weighted by raw production).
      -- For single-variant cases it equals the single stake. For zero production rows fallback to AVG.
      COALESCE(
        SUM(p.petroleo_bbl_dia * vs.stake_pct) / NULLIF(SUM(p.petroleo_bbl_dia), 0),
        AVG(vs.stake_pct)
      )::numeric AS stake_pct
    FROM anp_cdp_producao p
    JOIN valid_stakes vs ON vs.campo = p.campo
    WHERE p.ano = EXTRACT(YEAR FROM p_date)::int
      AND p.mes = EXTRACT(MONTH FROM p_date)::int
    GROUP BY canonical_field_name(p.campo)
  )
  SELECT canonical AS campo, oil_company AS oil_bbl_dia, water_company AS water_bbl_dia, hours_rate, stake_pct
    FROM month_data
   ORDER BY oil_company DESC NULLS LAST
   LIMIT p_top_n;
$$;

-- (3b) get_production_field_timeseries — p_campo now interpreted as CANONICAL name,
--      WHERE expands to all variants with canonical match.
CREATE OR REPLACE FUNCTION public.get_production_field_timeseries(
  p_campo      text,
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
 WHERE canonical_field_name(p.campo) = p_campo  -- ← canonical match: sums all variants
   AND make_date(p.ano, p.mes, 1) BETWEEN p_date_start AND p_date_end
 GROUP BY p.ano, p.mes
 ORDER BY p.ano, p.mes;
$$;

-- ───── (4) get_field_stakes_overview — live read from anp_cdp_producao + canonical col ──
-- DROP+CREATE required: new `canonical` column changes RETURNS TABLE shape (Postgres
-- error 42P13 "cannot change return type of existing function"). Pegadinha #18:
-- explicitly re-GRANT after DROP (DROP wipes grants and SECURITY DEFINER attribute).
DROP FUNCTION IF EXISTS public.get_field_stakes_overview();

CREATE OR REPLACE FUNCTION public.get_field_stakes_overview()
RETURNS TABLE (
  campo                text,
  canonical            text,
  n_empresas           int,
  soma_pct             numeric,
  is_complete          boolean,
  has_data_in_producao boolean,
  last_updated         timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH last_two_months AS (
    SELECT ano, mes FROM (
      SELECT DISTINCT ano, mes
        FROM anp_cdp_producao
       ORDER BY ano DESC, mes DESC
       LIMIT 2
    ) t
  ),
  active_campos AS (
    SELECT DISTINCT p.campo
      FROM anp_cdp_producao p
      JOIN last_two_months m USING (ano, mes)
     WHERE p.campo IS NOT NULL
  ),
  all_campos AS (
    SELECT campo FROM active_campos
    UNION
    SELECT campo FROM field_stakes
  ),
  stakes_agg AS (
    SELECT campo,
           COUNT(*)::int    AS n_empresas,
           SUM(stake_pct)   AS soma_pct,
           MAX(updated_at)  AS last_updated
      FROM field_stakes
     GROUP BY campo
  )
  SELECT
    ac.campo,
    canonical_field_name(ac.campo) AS canonical,
    COALESCE(sa.n_empresas, 0)::int AS n_empresas,
    COALESCE(sa.soma_pct, 0) AS soma_pct,
    COALESCE(sa.soma_pct = 100, false) AS is_complete,
    EXISTS (SELECT 1 FROM active_campos a WHERE a.campo = ac.campo) AS has_data_in_producao,
    sa.last_updated
  FROM all_campos ac
  LEFT JOIN stakes_agg sa USING (campo)
  ORDER BY canonical_field_name(ac.campo), ac.campo;
$$;

GRANT EXECUTE ON FUNCTION public.get_field_stakes_overview() TO anon, authenticated;

-- ───── (5) Index on anp_cdp_producao(campo) for the new DISTINCT scan ──
CREATE INDEX IF NOT EXISTS anp_cdp_producao_campo_idx
  ON public.anp_cdp_producao (campo);
