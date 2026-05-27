-- ============================================================================
-- 20260601000000_field_canonical_expansion_cache.sql
--
-- Drops the 27-30s tax that `p_expand_canonical=true` was paying on the 4 CDP
-- RPCs. Slot picked: 20260601000000 (next clean prefix after the existing
-- 20260530000000_cdp_rpcs_canonical_expansion). Verified free via list_migrations
-- on remote + `ls supabase/migrations/202606*.sql` empty.
--
-- ── Problem ────────────────────────────────────────────────────────────────
-- Migration 20260530000000 added an `expanded_campos` CTE that, when
-- p_expand_canonical=true, does
--     SELECT DISTINCT campo FROM public.anp_cdp_producao
--     WHERE p_expand_canonical IS TRUE AND campo IS NOT NULL
-- to enumerate the ~543 distinct raw campos and resolve their canonical names.
-- Postgres materializes that CTE by a parallel-aware seq scan over the full
-- 2.2M-row table EVERY CALL — 2.2M+ buffer hits, ~30 seconds wall.
--
-- A footnote in 20260530000000 claimed "index-only scan via
-- anp_cdp_producao_campo_idx" but the actual plan does a Parallel Seq Scan
-- (confirmed via EXPLAIN ANALYZE 2026-05-30):
--   Function Scan on get_anp_cdp_bsw_scatter  (actual time=30214..30215, rows=1761)
--     Buffers: shared hit=2252518 read=55630
--   Execution Time: 30225 ms
--
-- The optimizer never picks the index because, with no WHERE narrowing campo,
-- DISTINCT over a 2.2M table is cheaper to compute by full scan than by an
-- index-only scan that still has to visit every leaf page (the index has 543
-- distinct values but ~2.2M index entries — same problem in different shape).
--
-- ── Fix ────────────────────────────────────────────────────────────────────
-- Materialize the canonical→raw_variants map once into a tiny cache table
-- (`field_canonical_expansion`, ~534 rows), kept in sync by an explicit
-- refresh RPC that the CDP ETL is expected to call after each upload.
--
-- Each RPC then resolves expansion in O(rows_in_cache) ≈ 534, not
-- O(rows_in_production) ≈ 2.2M. Expected drop: 30s → <1s on canonical=true,
-- with backward-compat preserved (p_expand_canonical=false path unchanged).
--
-- ── Why a table (not a materialized view) ──────────────────────────────────
-- - The mapping changes only when new raw campo names appear in
--   anp_cdp_producao (rare, monthly ANP cadence) OR when an admin edits
--   field_canonical_names (also rare). A MV with CONCURRENTLY refresh would
--   still need an explicit owner and a UNIQUE INDEX; a plain table is simpler
--   and lets the ETL upsert deterministically.
-- - Strict idempotence via INSERT ... ON CONFLICT (canonical) DO UPDATE.
-- - RLS: SELECT open to all (the data is harmless — public field names);
--   writes restricted to service_role through the absence of any non-SELECT
--   policy (RLS = deny by default for anon / authenticated).
--
-- ── Backward-compat / signature stability ──────────────────────────────────
-- The 4 RPC signatures are kept identical: (text[], boolean DEFAULT false)
-- → same shape, same return types, same names. PostgREST clients require zero
-- changes. We DROP+CREATE to swap the body, then re-apply SECURITY DEFINER,
-- search_path and grants (Pegadinha #18). p_expand_canonical=false path
-- remains byte-identical in behavior.
--
-- ── ETL hook ───────────────────────────────────────────────────────────────
-- The ETL pipeline (`scripts/pipelines/anp/cdp/02_upload.py`) should call
-- `public.refresh_field_canonical_expansion()` after every successful upload
-- of anp_cdp_producao. Worker_supabase scope ends at the SQL boundary, so the
-- ETL wiring is delegated to worker_etl-pipelines (TODO ETL hook — see PR
-- description). The migration seeds the cache once on apply so the system is
-- usable immediately even before the ETL is wired.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1) Cache table
-- ============================================================================
-- One row per canonical field name. raw_variants stores every distinct raw
-- `campo` value present in anp_cdp_producao whose canonical_field_name() maps
-- to this canonical. Includes the canonical itself when it appears as a raw
-- variant (typical: 'TUPI' is both a canonical and a variant of itself).

CREATE TABLE IF NOT EXISTS public.field_canonical_expansion (
  canonical    text PRIMARY KEY,
  raw_variants text[] NOT NULL CHECK (array_length(raw_variants, 1) >= 1),
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.field_canonical_expansion IS
  'Cache mapping canonical_field_name() -> distinct raw campo values present '
  'in anp_cdp_producao. Refreshed by ETL via refresh_field_canonical_expansion(). '
  'Used by /anp-cdp-bsw and /anp-cdp-depletion RPCs to avoid scanning 2.2M rows '
  'every time p_expand_canonical=true.';

-- Lookup pattern: WHERE canonical = ANY(p_campos) — PK index covers it.
-- No additional index needed (table is ~534 rows total).

ALTER TABLE public.field_canonical_expansion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can read field_canonical_expansion"
  ON public.field_canonical_expansion;
CREATE POLICY "anyone can read field_canonical_expansion"
  ON public.field_canonical_expansion
  FOR SELECT
  USING (true);

-- Explicit grant so PostgREST exposes the table to anon/authenticated for
-- SELECT (writes still blocked: no policy = deny for non-service-role).
GRANT SELECT ON public.field_canonical_expansion TO anon, authenticated;


-- ============================================================================
-- 2) Refresh function (SECURITY DEFINER, called by ETL with service_role)
-- ============================================================================
-- Rebuilds the cache by re-aggregating distinct raw campos from
-- anp_cdp_producao, then UPSERTing into the cache. The DELETE step removes
-- canonicals that no longer have any row in the source (e.g. data correction
-- migrations that re-canonicalize a variant). Wrapped in a single statement
-- via NOT EXISTS so there is no inconsistent intermediate state visible to
-- concurrent readers.

CREATE OR REPLACE FUNCTION public.refresh_field_canonical_expansion()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  -- Insert / update every canonical present in current production data.
  WITH src AS (
    SELECT
      canonical_field_name(campo) AS canonical,
      array_agg(DISTINCT campo ORDER BY campo) AS raw_variants
    FROM (
      SELECT DISTINCT campo
      FROM public.anp_cdp_producao
      WHERE campo IS NOT NULL
    ) s
    GROUP BY canonical_field_name(campo)
  )
  INSERT INTO public.field_canonical_expansion (canonical, raw_variants, refreshed_at)
  SELECT canonical, raw_variants, now()
  FROM src
  ON CONFLICT (canonical) DO UPDATE
    SET raw_variants = EXCLUDED.raw_variants,
        refreshed_at = EXCLUDED.refreshed_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Remove canonicals that no longer appear in production data.
  DELETE FROM public.field_canonical_expansion fce
   WHERE NOT EXISTS (
     SELECT 1 FROM public.anp_cdp_producao p
      WHERE p.campo IS NOT NULL
        AND canonical_field_name(p.campo) = fce.canonical
   );

  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.refresh_field_canonical_expansion() IS
  'Rebuilds field_canonical_expansion from current anp_cdp_producao state. '
  'Returns the number of upserted rows. Intended to be called by the CDP ETL '
  'after every upload (scripts/pipelines/anp/cdp/02_upload.py).';

REVOKE ALL ON FUNCTION public.refresh_field_canonical_expansion()
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_field_canonical_expansion()
  TO service_role;


-- ============================================================================
-- 3) Initial populate
-- ============================================================================
-- Seed the cache once on apply, so the new RPC bodies have data to read.

SELECT public.refresh_field_canonical_expansion();


-- ============================================================================
-- 4) Rewrite the 4 RPCs to read from the cache (not seq-scan production)
-- ============================================================================
-- Each RPC keeps the EXACT same signature, return type, SECURITY DEFINER,
-- search_path and grants — only the `expanded_campos` CTE changes.
--
-- New shape (identical across all 4):
--   WITH expanded_campos AS (
--     SELECT unnest(p_campos) AS campo
--     UNION
--     SELECT unnest(fce.raw_variants)
--     FROM public.field_canonical_expansion fce
--     WHERE p_expand_canonical IS TRUE
--       AND fce.canonical = ANY(p_campos)
--   )
--
-- - p_expand_canonical=false: cache scan is filtered out → CTE = unnest(p_campos).
--   Backward compat strict; identical to pre-cache behavior.
-- - p_expand_canonical=true: cache scan returns raw_variants for matching
--   canonicals. UNION (not UNION ALL) dedupes if a raw value appears both in
--   p_campos and in raw_variants.
-- - NULL safety: unnest(NULL::text[]) returns 0 rows; cache scan returns 0
--   rows when p_campos is NULL. Either way → empty result. Same as today.
--
-- The downstream body of each RPC is byte-identical to 20260530000000.

-- ---------------------------------------------------------------------------
-- 4a) get_anp_cdp_bsw_scatter
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_anp_cdp_bsw_scatter(text[], boolean) CASCADE;

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
  WITH expanded_campos AS (
    SELECT unnest(p_campos) AS campo
    UNION
    SELECT unnest(fce.raw_variants)
    FROM public.field_canonical_expansion fce
    WHERE p_expand_canonical IS TRUE
      AND fce.canonical = ANY(p_campos)
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
    WHERE campo IN (SELECT campo FROM expanded_campos WHERE campo IS NOT NULL)
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


-- ---------------------------------------------------------------------------
-- 4b) get_anp_cdp_bsw_field_aggregate
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_anp_cdp_bsw_field_aggregate(text[], boolean) CASCADE;

CREATE FUNCTION public.get_anp_cdp_bsw_field_aggregate(
  p_campos           text[],
  p_expand_canonical boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  WITH expanded_campos AS (
    SELECT unnest(p_campos) AS campo
    UNION
    SELECT unnest(fce.raw_variants)
    FROM public.field_canonical_expansion fce
    WHERE p_expand_canonical IS TRUE
      AND fce.canonical = ANY(p_campos)
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
    WHERE campo IN (SELECT campo FROM expanded_campos WHERE campo IS NOT NULL)
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


-- ---------------------------------------------------------------------------
-- 4c) get_anp_cdp_depletion_scatter
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_anp_cdp_depletion_scatter(text[], boolean) CASCADE;

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
    SELECT unnest(p_campos) AS campo
    UNION
    SELECT unnest(fce.raw_variants)
    FROM public.field_canonical_expansion fce
    WHERE p_expand_canonical IS TRUE
      AND fce.canonical = ANY(p_campos)
  ),
  base AS (
    SELECT poco, campo, ano, mes, petroleo_bbl_dia, tempo_prod_hs_mes,
           extract(day FROM (date_trunc('month', make_date(ano, mes, 1))
                             + interval '1 month - 1 day'))::int AS dias_cal,
           min(ano*12+mes) FILTER (WHERE petroleo_bbl_dia > 0)
             OVER (PARTITION BY poco) AS t0
    FROM public.anp_cdp_producao
    WHERE campo IN (SELECT campo FROM expanded_campos WHERE campo IS NOT NULL)
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


-- ---------------------------------------------------------------------------
-- 4d) get_anp_cdp_depletion_field_aggregate
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_anp_cdp_depletion_field_aggregate(text[], boolean) CASCADE;

CREATE FUNCTION public.get_anp_cdp_depletion_field_aggregate(
  p_campos           text[],
  p_expand_canonical boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  WITH expanded_campos AS (
    SELECT unnest(p_campos) AS campo
    UNION
    SELECT unnest(fce.raw_variants)
    FROM public.field_canonical_expansion fce
    WHERE p_expand_canonical IS TRUE
      AND fce.canonical = ANY(p_campos)
  ),
  per_poco_mes AS (
    SELECT campo, poco, ano, mes, petroleo_bbl_dia, tempo_prod_hs_mes,
           extract(day FROM (date_trunc('month', make_date(ano, mes, 1))
                             + interval '1 month - 1 day'))::int AS dias_cal
    FROM public.anp_cdp_producao
    WHERE campo IN (SELECT campo FROM expanded_campos WHERE campo IS NOT NULL)
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
