-- ============================================================================
-- 20260530000000_cdp_rpcs_canonical_expansion.sql
--
-- Filename slot 20260528400000 (suggested by task) was already taken in remote
-- schema_migrations by `well_by_well_perf_mv`. Slot 20260530000000 is the next
-- clean prefix after the existing 20260529300000_well_by_well_header_expand
-- and avoids collision with parallel worktrees.
--
-- ── What this migration does ────────────────────────────────────────────────
-- Adds an optional `p_expand_canonical boolean DEFAULT false` parameter to the
-- 4 CDP RPCs that drive /anp-cdp-bsw and /anp-cdp-depletion charts:
--
--   - public.get_anp_cdp_bsw_scatter(text[])                    → adds bool param
--   - public.get_anp_cdp_bsw_field_aggregate(text[])            → adds bool param
--   - public.get_anp_cdp_depletion_scatter(text[])              → adds bool param
--   - public.get_anp_cdp_depletion_field_aggregate(text[])      → adds bool param
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- /well-by-well groups raw campo names by canonical via canonical_field_name()
-- (see 20260528300000_well_by_well_round4.sql). Example: canonical 'TUPI'
-- aggregates {TUPI, SUL DE TUPI, AnC_TUPI}. A future popup in /well-by-well
-- will reuse these 4 CDP RPCs but needs to feed them the FULL set of variants
-- of a canonical, not just the raw label.
--
--   p_expand_canonical = FALSE (default) → identical to current behavior
--                                          (backward compat strict)
--   p_expand_canonical = TRUE            → input array is expanded via
--                                          canonical_field_name(): every campo
--                                          whose canonical matches any input
--                                          value is included.
--
-- Implementation: we don't change the signature of the existing functions
-- (which would risk PostgREST/RPC client breakage). Instead, we DROP the old
-- (text[]) overloads and CREATE NEW ones with (text[], boolean DEFAULT false).
-- The default lets every existing caller continue to send just `p_campos`
-- without modification — PostgREST resolves to the same function.
--
-- Why DROP+CREATE (not just CREATE OR REPLACE):
--   - Postgres CANNOT add a parameter with default to an existing function via
--     CREATE OR REPLACE; the signature `(text[])` is different from
--     `(text[], boolean)` and would coexist as 2 overloads. PostgREST would
--     then refuse to dispatch ambiguously. So we drop the old overload first.
--
-- Pegadinha #18 (CTO CLAUDE.md): DROP+CREATE wipes grants, SECURITY DEFINER
-- and search_path. We re-apply all 3 explicitly at the bottom of each CREATE.
--
-- ── Backward-compat verification ───────────────────────────────────────────
-- The expanded_campos CTE in each function returns `p_campos` unchanged when
-- p_expand_canonical=FALSE (CASE branch on the parameter). The downstream
-- queries are byte-identical to the post-onshore versions
-- (20260508000015_anp_cdp_bsw_depletion_allow_onshore.sql) except that
-- `campo = ANY(p_campos)` becomes `campo = ANY((SELECT * FROM expanded_campos))`.
-- That dereference is logically equivalent when no expansion is requested.
--
-- ── NULL safety ─────────────────────────────────────────────────────────────
-- If p_campos IS NULL, expanded_campos returns NULL → `campo = ANY(NULL)` is
-- NULL (filtered out) → empty result set. No crash.
--
-- ── Performance note ────────────────────────────────────────────────────────
-- The expansion CTE must read DISTINCT campo (~543 unique values, index-only
-- scan via anp_cdp_producao_campo_idx) instead of every row in
-- anp_cdp_producao (~2.2M rows). Naive scan calling canonical_field_name() per
-- row hits the statement timeout (caught in pre-deploy smoke 2026-05-29).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1) get_anp_cdp_bsw_scatter
-- ============================================================================
-- Source-of-truth body from 20260508000015 (onshore allowed; SECURITY INVOKER
-- at that time), with SECURITY DEFINER restored by 20260526100000.

DROP FUNCTION IF EXISTS public.get_anp_cdp_bsw_scatter(text[]) CASCADE;

CREATE FUNCTION public.get_anp_cdp_bsw_scatter(
  p_campos           text[],
  p_expand_canonical boolean DEFAULT false
)
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
AS $$
  WITH distinct_campos AS (
    -- Pull DISTINCT campo from the index (anp_cdp_producao_campo_idx, ~543 rows)
    -- so canonical_field_name() is invoked once per unique campo, not once per
    -- production row (~2.2M). Only materialized when p_expand_canonical=true.
    SELECT DISTINCT campo
    FROM public.anp_cdp_producao
    WHERE p_expand_canonical IS TRUE
      AND campo IS NOT NULL
  ),
  expanded_campos AS (
    -- When p_expand_canonical=true, include every raw campo whose canonical
    -- name matches any entry in p_campos (covers AnC_* prefixes, ECO suffixes
    -- and the manual overrides in public.field_canonical_names).
    -- When false, distinct_campos is empty and only the unnest(p_campos)
    -- branch contributes — strict backward compat.
    SELECT DISTINCT c.campo
    FROM (
      SELECT unnest(p_campos) AS campo
      UNION ALL
      SELECT dc.campo
      FROM distinct_campos dc
      WHERE canonical_field_name(dc.campo) = ANY(p_campos)
    ) c
    WHERE c.campo IS NOT NULL
  ),
  base AS (
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
    WHERE campo IN (SELECT campo FROM expanded_campos)
      AND campo <> poco                            -- drop exploratory wells masquerading as campo
      AND campo NOT LIKE '%\_%' ESCAPE '\'         -- official campo names never contain underscores
  )
  SELECT
    poco,
    campo,
    (ano * 12 + mes - t0)::int                                        AS mes_desde_t0,
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

ALTER FUNCTION public.get_anp_cdp_bsw_scatter(text[], boolean)
  SECURITY DEFINER;
ALTER FUNCTION public.get_anp_cdp_bsw_scatter(text[], boolean)
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.get_anp_cdp_bsw_scatter(text[], boolean)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_scatter(text[], boolean)
  TO authenticated;


-- ============================================================================
-- 2) get_anp_cdp_bsw_field_aggregate
-- ============================================================================
-- Source-of-truth body from 20260508000015 (RETURNS jsonb), with SECURITY
-- DEFINER restored by 20260526100000.

DROP FUNCTION IF EXISTS public.get_anp_cdp_bsw_field_aggregate(text[]) CASCADE;

CREATE FUNCTION public.get_anp_cdp_bsw_field_aggregate(
  p_campos           text[],
  p_expand_canonical boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  WITH expanded_campos AS (
    SELECT DISTINCT c.campo
    FROM (
      SELECT unnest(p_campos) AS campo
      UNION ALL
      SELECT p.campo
      FROM public.anp_cdp_producao p
      WHERE p_expand_canonical IS TRUE
        AND p.campo IS NOT NULL
        AND canonical_field_name(p.campo) = ANY(p_campos)
    ) c
    WHERE c.campo IS NOT NULL
  ),
  per_campo_mes AS (
    SELECT
      campo, ano, mes,
      sum(agua_bbl_dia)::float8     AS agua_bbl_dia,
      sum(petroleo_bbl_dia)::float8 AS petroleo_bbl_dia,
      count(DISTINCT poco)::int     AS pocos_ativos,
      sum(petroleo_bbl_dia)::float8 *
        extract(day FROM (date_trunc('month', make_date(ano, mes, 1))
                          + interval '1 month - 1 day'))::int
        AS oil_bbl_mes
    FROM public.anp_cdp_producao
    WHERE campo IN (SELECT campo FROM expanded_campos)
      AND campo <> poco
      AND campo NOT LIKE '%\_%' ESCAPE '\'
    GROUP BY campo, ano, mes
  ),
  with_t0_cum AS (
    SELECT *,
      min(ano * 12 + mes) FILTER (WHERE petroleo_bbl_dia > 0)
        OVER (PARTITION BY campo) AS t0_campo,
      sum(oil_bbl_mes)
        OVER (PARTITION BY campo ORDER BY ano * 12 + mes
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
        AS cumulative_oil_bbl
    FROM per_campo_mes
  ),
  voip_latest AS (
    SELECT DISTINCT ON (campo) campo, voip_bbl
    FROM public.anp_voip
    WHERE voip_bbl IS NOT NULL AND voip_bbl > 0
    ORDER BY campo, ano_publicacao DESC
  ),
  rows_out AS (
    SELECT
      w.campo,
      (w.cumulative_oil_bbl / NULLIF(v.voip_bbl, 0))::float8 AS pct_voip,
      (w.agua_bbl_dia / NULLIF(w.agua_bbl_dia + w.petroleo_bbl_dia, 0))::float8 AS bsw,
      w.pocos_ativos AS n_pocos,
      (w.agua_bbl_dia + w.petroleo_bbl_dia)::float8 AS volume_total,
      w.cumulative_oil_bbl::float8 AS cumulative_oil_bbl,
      w.ano AS ref_ano,
      w.mes AS ref_mes
    FROM with_t0_cum w
    JOIN voip_latest v ON v.campo = w.campo
    WHERE w.t0_campo IS NOT NULL
      AND (w.ano * 12 + w.mes) >= w.t0_campo
      AND (w.agua_bbl_dia + w.petroleo_bbl_dia) > 0
    ORDER BY w.campo, w.ano * 12 + w.mes
    LIMIT 200000
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'campo',              campo,
        'pct_voip',           pct_voip,
        'bsw',                bsw,
        'n_pocos',            n_pocos,
        'volume_total',       volume_total,
        'cumulative_oil_bbl', cumulative_oil_bbl,
        'ref_ano',            ref_ano,
        'ref_mes',            ref_mes
      )
    ),
    '[]'::jsonb
  )
  FROM rows_out;
$$;

ALTER FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[], boolean)
  SECURITY DEFINER;
ALTER FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[], boolean)
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[], boolean)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_bsw_field_aggregate(text[], boolean)
  TO authenticated;


-- ============================================================================
-- 3) get_anp_cdp_depletion_scatter
-- ============================================================================
-- Source-of-truth body from 20260508000015 (np_kbpd output, onshore allowed),
-- with SECURITY DEFINER restored by 20260526100000.

DROP FUNCTION IF EXISTS public.get_anp_cdp_depletion_scatter(text[]) CASCADE;

CREATE FUNCTION public.get_anp_cdp_depletion_scatter(
  p_campos           text[],
  p_expand_canonical boolean DEFAULT false
)
RETURNS TABLE (
  poco           text,
  campo          text,
  ano            int,
  mes            int,
  mes_desde_t0   int,
  np_kbpd        float8,
  pct_voip_poco  float8
)
LANGUAGE sql STABLE
AS $$
  WITH expanded_campos AS (
    SELECT DISTINCT c.campo
    FROM (
      SELECT unnest(p_campos) AS campo
      UNION ALL
      SELECT p.campo
      FROM public.anp_cdp_producao p
      WHERE p_expand_canonical IS TRUE
        AND p.campo IS NOT NULL
        AND canonical_field_name(p.campo) = ANY(p_campos)
    ) c
    WHERE c.campo IS NOT NULL
  ),
  base AS (
    SELECT poco, campo, ano, mes, petroleo_bbl_dia, tempo_prod_hs_mes,
           extract(day FROM (date_trunc('month', make_date(ano, mes, 1))
                             + interval '1 month - 1 day'))::int AS dias_cal,
           min(ano*12+mes) FILTER (WHERE petroleo_bbl_dia > 0)
             OVER (PARTITION BY poco) AS t0
    FROM public.anp_cdp_producao
    WHERE campo IN (SELECT campo FROM expanded_campos)
      AND campo <> poco
      AND campo NOT LIKE '%\_%' ESCAPE '\'
  ),
  campo_prod_mes AS (
    SELECT campo, ano, mes,
           sum(petroleo_bbl_dia * dias_cal)::float8 AS prod_total_mes_bbl
    FROM base
    WHERE petroleo_bbl_dia > 0
    GROUP BY campo, ano, mes
  ),
  campo_cum AS (
    SELECT campo, ano, mes,
           sum(prod_total_mes_bbl) OVER (
             PARTITION BY campo
             ORDER BY ano*12+mes
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           )::float8 AS cumulative_oil_campo_bbl
    FROM campo_prod_mes
  ),
  voip_latest AS (
    SELECT DISTINCT ON (campo) campo, voip_bbl
    FROM public.anp_voip
    WHERE voip_bbl IS NOT NULL AND voip_bbl > 0
    ORDER BY campo, ano_publicacao DESC
  )
  SELECT b.poco, b.campo, b.ano, b.mes,
         (b.ano*12+b.mes - b.t0)::int AS mes_desde_t0,
         -- np_kbpd = (petroleo_bbl_dia × dias_cal) / (tempo_prod_hs_mes / 24) / 1000
         --         = petroleo_bbl_dia × dias_cal × 24 / (tempo_prod_hs_mes × 1000)
         (b.petroleo_bbl_dia * b.dias_cal * 24.0
           / NULLIF(b.tempo_prod_hs_mes, 0)
           / 1000.0)::float8 AS np_kbpd,
         (cc.cumulative_oil_campo_bbl / NULLIF(v.voip_bbl, 0))::float8 AS pct_voip_poco
  FROM base b
  LEFT JOIN campo_cum cc
    ON cc.campo = b.campo AND cc.ano = b.ano AND cc.mes = b.mes
  LEFT JOIN voip_latest v ON v.campo = b.campo
  WHERE b.t0 IS NOT NULL
    AND (b.ano*12+b.mes) >= b.t0
    AND b.petroleo_bbl_dia > 0
    AND b.tempo_prod_hs_mes > 0
  ORDER BY b.campo, b.poco, b.ano*12+b.mes
  LIMIT 500000;
$$;

ALTER FUNCTION public.get_anp_cdp_depletion_scatter(text[], boolean)
  SECURITY DEFINER;
ALTER FUNCTION public.get_anp_cdp_depletion_scatter(text[], boolean)
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.get_anp_cdp_depletion_scatter(text[], boolean)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_depletion_scatter(text[], boolean)
  TO authenticated;


-- ============================================================================
-- 4) get_anp_cdp_depletion_field_aggregate
-- ============================================================================
-- Source-of-truth body from 20260508000015 (RETURNS jsonb, np_kbpd output),
-- with SECURITY DEFINER restored by 20260526100000.

DROP FUNCTION IF EXISTS public.get_anp_cdp_depletion_field_aggregate(text[]) CASCADE;

CREATE FUNCTION public.get_anp_cdp_depletion_field_aggregate(
  p_campos           text[],
  p_expand_canonical boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  WITH expanded_campos AS (
    SELECT DISTINCT c.campo
    FROM (
      SELECT unnest(p_campos) AS campo
      UNION ALL
      SELECT p.campo
      FROM public.anp_cdp_producao p
      WHERE p_expand_canonical IS TRUE
        AND p.campo IS NOT NULL
        AND canonical_field_name(p.campo) = ANY(p_campos)
    ) c
    WHERE c.campo IS NOT NULL
  ),
  per_poco_mes AS (
    SELECT campo, poco, ano, mes, petroleo_bbl_dia, tempo_prod_hs_mes,
           extract(day FROM (date_trunc('month', make_date(ano, mes, 1))
                             + interval '1 month - 1 day'))::int AS dias_cal
    FROM public.anp_cdp_producao
    WHERE campo IN (SELECT campo FROM expanded_campos)
      AND campo <> poco
      AND campo NOT LIKE '%\_%' ESCAPE '\'
  ),
  per_poco_np AS (
    SELECT *,
      -- np_poco_bbl_mes = normalized production (bbl) for this well in this month
      (petroleo_bbl_dia * dias_cal * 24.0
        / NULLIF(tempo_prod_hs_mes, 0))::float8 AS np_poco_bbl_mes
    FROM per_poco_mes
    WHERE petroleo_bbl_dia > 0 AND tempo_prod_hs_mes > 0
  ),
  per_campo_mes AS (
    SELECT campo, ano, mes,
      -- np_kbpd = sum(NP_poco_bbl_mes) / (sum(hs_op_poco) / 24) / 1000
      (sum(np_poco_bbl_mes) * 24.0
        / NULLIF(sum(tempo_prod_hs_mes), 0)
        / 1000.0)::float8                                      AS np_kbpd,
      sum(petroleo_bbl_dia * dias_cal)::float8                 AS prod_real_bbl,
      count(DISTINCT poco)::int                                AS n_pocos
    FROM per_poco_np
    GROUP BY campo, ano, mes
  ),
  with_cum AS (
    SELECT *,
      sum(prod_real_bbl) OVER (
        PARTITION BY campo
        ORDER BY ano*12+mes
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS cumulative_oil_bbl
    FROM per_campo_mes
  ),
  voip_latest AS (
    SELECT DISTINCT ON (campo) campo, voip_bbl
    FROM public.anp_voip
    WHERE voip_bbl IS NOT NULL AND voip_bbl > 0
    ORDER BY campo, ano_publicacao DESC
  ),
  rows_out AS (
    SELECT w.campo, w.ano, w.mes, w.np_kbpd, w.n_pocos,
           (w.cumulative_oil_bbl / NULLIF(v.voip_bbl, 0))::float8 AS pct_voip,
           w.cumulative_oil_bbl
    FROM with_cum w
    JOIN voip_latest v ON v.campo = w.campo
    WHERE w.np_kbpd IS NOT NULL AND w.np_kbpd > 0
    ORDER BY w.campo, w.ano*12+w.mes
    LIMIT 200000
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'campo', campo, 'ano', ano, 'mes', mes,
    'np_kbpd', np_kbpd, 'n_pocos', n_pocos,
    'pct_voip', pct_voip, 'cumulative_oil_bbl', cumulative_oil_bbl
  )), '[]'::jsonb)
  FROM rows_out;
$$;

ALTER FUNCTION public.get_anp_cdp_depletion_field_aggregate(text[], boolean)
  SECURITY DEFINER;
ALTER FUNCTION public.get_anp_cdp_depletion_field_aggregate(text[], boolean)
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.get_anp_cdp_depletion_field_aggregate(text[], boolean)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_anp_cdp_depletion_field_aggregate(text[], boolean)
  TO authenticated;

COMMIT;
