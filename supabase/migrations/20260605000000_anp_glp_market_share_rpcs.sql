-- ============================================================================
-- ANP GLP — Market-Share RPC surface  (get_anp_glp_ms_*)
-- ----------------------------------------------------------------------------
-- Phase 1 (DATA layer) of repurposing the /anp-glp dashboard as a faithful
-- clone of /market-share, but over LPG/GLP sales (table public.anp_glp).
--
-- These RPCs MIRROR the contract of the get_ms_* family used by /market-share
-- (see 20260327174919_remote_schema.sql and 20260507000003_export_count_rpcs.sql)
-- so the Phase-2 frontend can reuse the existing useMarketShareData hook shape
-- with minimal rewrite.
--
-- DOMAIN MAPPING (decided by the CTO — do NOT change):
--   market-share          →  LPG / GLP
--   ────────────────────     ────────────────────────────────────────────────
--   classificacao (player) →  distribuidora            (the LPG "player")
--   nome_produto (product) →  categoria                (P13 / Outros - * )
--   segmento               →  constant 'GLP'           (LPG has no segments)
--   agente_regulado        →  distribuidora            (Others-mode group key)
--   quantidade             →  vendas_kg  (RAW float8)  (client divides by 1e6
--                                                        → thousand tons; NO
--                                                        conversion in the DB)
--
-- The column NAMES of the returned tables are kept IDENTICAL to get_ms_*
-- (date / nome_produto / segmento / classificacao / [agente_regulado] /
-- quantidade) so the frontend type MsSerieRow can be reused as-is.
--
-- WHAT LPG DOES NOT HAVE (vs market-share):
--   * NO region / UF filters         — the table has no geo dimension.
--   * NO Retail / B2B / TRR segments — single synthetic segment 'GLP'.
--   * NO agente classification       — "Others" is simply the aggregate of the
--                                       distribuidoras OUTSIDE the selected
--                                       top-N set (passed explicitly), not a
--                                       hardcoded Big-3 (Vibra/Raizen/Ipiranga
--                                       are fuel players, irrelevant to LPG).
--   * NO synthetic "Total (All LPG)" rows here — the Total product is
--     synthesized CLIENT-SIDE (analogous to makeTotalRows in the MS hook).
--     These RPCs return ONLY the real categories.
--
-- PERFORMANCE DECISION:
--   anp_glp is tiny (~3k rows). Unlike /market-share (which uses
--   mv_ms_serie_fast purely because `vendas` is large), NO materialized view
--   is created here. Direct aggregation over anp_glp per request is fast
--   enough. The (ano, mes) and (distribuidora) indexes already exist.
--
-- SECURITY (Pegadinha #18):
--   anp_glp has RLS enabled with SELECT only for `authenticated`. Therefore
--   every public RPC reading it MUST be SECURITY DEFINER + explicit
--   `SET search_path = public, pg_temp`, otherwise an anon caller gets an empty
--   result (no 42501, just []). All functions below are SECURITY DEFINER and
--   re-grant EXECUTE to anon + authenticated after the CREATE.
-- ============================================================================


-- ── RPC 1: get_anp_glp_ms_filtros ───────────────────────────────────────────
-- Analogue of get_ms_opcoes_filtros (minus regioes/ufs/mercados).
-- Returns the distinct distributors, the distinct categories, and the
-- year bounds for the period slider.
CREATE OR REPLACE FUNCTION public.get_anp_glp_ms_filtros()
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT json_build_object(
    'distribuidoras', (
      SELECT COALESCE(json_agg(DISTINCT distribuidora ORDER BY distribuidora), '[]'::json)
      FROM public.anp_glp
      WHERE distribuidora IS NOT NULL
    ),
    'categorias', (
      SELECT COALESCE(json_agg(DISTINCT categoria ORDER BY categoria), '[]'::json)
      FROM public.anp_glp
      WHERE categoria IS NOT NULL
    ),
    'ano_min', (SELECT MIN(ano) FROM public.anp_glp),
    'ano_max', (SELECT MAX(ano) FROM public.anp_glp)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_glp_ms_filtros() TO anon, authenticated;


-- ── RPC 2: get_anp_glp_ms_serie_fast ────────────────────────────────────────
-- Analogue of get_ms_serie_fast.
-- Monthly series of LPG sales aggregated by (date, distribuidora, categoria).
-- Returns the SAME column shape as get_ms_serie_fast:
--   date          text  -> 'YYYY-MM-01' (month start)
--   nome_produto  text  -> categoria
--   segmento      text  -> constant 'GLP'
--   classificacao text  -> distribuidora (the player)
--   quantidade    float8-> SUM(vendas_kg)  (RAW kg; client converts to k-tons)
-- Only REAL categories are returned; the synthetic "Total (All LPG)" product
-- is built client-side (cf. makeTotalRows).
CREATE OR REPLACE FUNCTION public.get_anp_glp_ms_serie_fast(
  p_distribuidoras text[]  DEFAULT NULL,
  p_categorias     text[]  DEFAULT NULL,
  p_ano_inicio     int     DEFAULT NULL,
  p_ano_fim        int     DEFAULT NULL
)
RETURNS TABLE(
  date          text,
  nome_produto  text,
  segmento      text,
  classificacao text,
  quantidade    double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    to_char(make_date(g.ano::int, g.mes::int, 1), 'YYYY-MM-DD') AS date,
    g.categoria        AS nome_produto,
    'GLP'::text        AS segmento,
    g.distribuidora    AS classificacao,
    SUM(g.vendas_kg)   AS quantidade
  FROM public.anp_glp g
  WHERE
    (p_distribuidoras IS NULL OR g.distribuidora = ANY(p_distribuidoras))
    AND (p_categorias IS NULL OR g.categoria     = ANY(p_categorias))
    AND (p_ano_inicio IS NULL OR g.ano          >= p_ano_inicio)
    AND (p_ano_fim    IS NULL OR g.ano          <= p_ano_fim)
  GROUP BY g.ano, g.mes, g.categoria, g.distribuidora;
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_glp_ms_serie_fast(text[], text[], int, int)
  TO anon, authenticated;


-- ── RPC 3: get_anp_glp_ms_serie_others ──────────────────────────────────────
-- Analogue of get_ms_serie_others, adapted: there is NO agente classification
-- in LPG. "Others" = the aggregate of every distribuidora NOT present in the
-- selected top-N set (p_excluir_distribuidoras). When the exclude set is NULL
-- or empty, ALL distributors are returned (caller can then decide).
-- The agente_regulado column is carried (= distribuidora) so the frontend's
-- groupBy="agente_regulado" path works unchanged; each Others distributor is
-- its own line, exactly like the MS Others drilldown.
--   date           text   -> 'YYYY-MM-01'
--   nome_produto   text   -> categoria
--   segmento       text   -> constant 'GLP'
--   classificacao  text   -> distribuidora
--   agente_regulado text  -> distribuidora (same value; Others group key)
--   quantidade     float8 -> SUM(vendas_kg)  (RAW)
CREATE OR REPLACE FUNCTION public.get_anp_glp_ms_serie_others(
  p_distribuidoras         text[]  DEFAULT NULL,
  p_categorias             text[]  DEFAULT NULL,
  p_ano_inicio             int     DEFAULT NULL,
  p_ano_fim                int     DEFAULT NULL,
  p_excluir_distribuidoras text[]  DEFAULT NULL
)
RETURNS TABLE(
  date            text,
  nome_produto    text,
  segmento        text,
  classificacao   text,
  agente_regulado text,
  quantidade      double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    to_char(make_date(g.ano::int, g.mes::int, 1), 'YYYY-MM-DD') AS date,
    g.categoria       AS nome_produto,
    'GLP'::text       AS segmento,
    g.distribuidora   AS classificacao,
    g.distribuidora   AS agente_regulado,
    SUM(g.vendas_kg)  AS quantidade
  FROM public.anp_glp g
  WHERE
    (p_distribuidoras IS NULL OR g.distribuidora = ANY(p_distribuidoras))
    AND (p_categorias IS NULL OR g.categoria     = ANY(p_categorias))
    AND (p_ano_inicio IS NULL OR g.ano          >= p_ano_inicio)
    AND (p_ano_fim    IS NULL OR g.ano          <= p_ano_fim)
    AND (
      p_excluir_distribuidoras IS NULL
      OR cardinality(p_excluir_distribuidoras) = 0
      OR NOT (g.distribuidora = ANY(p_excluir_distribuidoras))
    )
  GROUP BY g.ano, g.mes, g.categoria, g.distribuidora;
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_glp_ms_serie_others(text[], text[], int, int, text[])
  TO anon, authenticated;


-- ── RPC 4: get_anp_glp_ms_others_players ────────────────────────────────────
-- Analogue of get_others_players. Since LPG "Others" is dynamic (depends on
-- the selected top-N), this returns the FULL distinct distributor list ranked
-- by total LPG volume DESC; the frontend slices top-N and treats the tail as
-- "Others". The ranking column lets the frontend derive a dynamic Big-N
-- WITHOUT hardcoding any fuel-era player.
--   distribuidora  text
--   total_kg       float8  (total LPG volume across the whole table, for rank)
CREATE OR REPLACE FUNCTION public.get_anp_glp_ms_others_players()
RETURNS TABLE(
  distribuidora text,
  total_kg      double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT g.distribuidora, SUM(g.vendas_kg) AS total_kg
  FROM public.anp_glp g
  WHERE g.distribuidora IS NOT NULL
  GROUP BY g.distribuidora
  ORDER BY total_kg DESC NULLS LAST, g.distribuidora;
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_glp_ms_others_players()
  TO anon, authenticated;


-- ── RPC 5: get_anp_glp_ms_export_count ──────────────────────────────────────
-- Analogue of get_ms_export_count — export size calculator. Returns the number
-- of underlying anp_glp rows matched by the filter (no rows transferred), so
-- the frontend can multiply by AVG_BYTES_PER_ROW for the XLSX/CSV estimate.
-- SECURITY DEFINER here too (anp_glp RLS is authenticated-only) — note this
-- differs from get_ms_export_count which is SECURITY INVOKER over `vendas`
-- (whose RLS allows the same audience differently). For LPG we keep DEFINER to
-- guarantee anon visitors also get a correct estimate.
CREATE OR REPLACE FUNCTION public.get_anp_glp_ms_export_count(
  p_distribuidoras text[]  DEFAULT NULL,
  p_categorias     text[]  DEFAULT NULL,
  p_ano_inicio     int     DEFAULT NULL,
  p_ano_fim        int     DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::bigint
  FROM public.anp_glp g
  WHERE
    (p_distribuidoras IS NULL OR g.distribuidora = ANY(p_distribuidoras))
    AND (p_categorias IS NULL OR g.categoria     = ANY(p_categorias))
    AND (p_ano_inicio IS NULL OR g.ano          >= p_ano_inicio)
    AND (p_ano_fim    IS NULL OR g.ano          <= p_ano_fim);
$$;

GRANT EXECUTE ON FUNCTION public.get_anp_glp_ms_export_count(text[], text[], int, int)
  TO anon, authenticated;
