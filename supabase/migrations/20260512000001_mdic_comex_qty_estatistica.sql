-- ============================================================================
-- mdic_comex: add quantidade_estatistica + unidade_estatistica columns
-- and update 3 RPCs to include the new fields in their return shapes.
--
-- Existing columns are preserved in the same order. The two new columns are
-- appended at the end of every RETURNS TABLE / SELECT to avoid breaking
-- legacy clients that depend on positional column order.
--
-- RPCs updated:
--   get_mdic_comex_serie        (7 cols → 9 cols)
--   get_mdic_comex_top_paises   (4 cols → 6 cols)
--   get_mdic_comex_aggregated   (8 cols → 10 cols, dynamic GROUP BY)
--
-- NOT changed:
--   get_mdic_comex_export_count  (COUNT(*) — signature and body unchanged)
--   get_mdic_comex_filtros       (returns anos + NCMs — unrelated)
-- ============================================================================

-- ── 1. Extend table ──────────────────────────────────────────────────────────
ALTER TABLE public.mdic_comex
    ADD COLUMN IF NOT EXISTS quantidade_estatistica float8,
    ADD COLUMN IF NOT EXISTS unidade_estatistica    text;

-- ── 2. Drop old RPC signatures (return-row changed, CREATE OR REPLACE ────────
--       cannot replace a function with a different return type)
DROP FUNCTION IF EXISTS public.get_mdic_comex_serie(text, text[], int, int);
DROP FUNCTION IF EXISTS public.get_mdic_comex_top_paises(text, text, int, int, int);
DROP FUNCTION IF EXISTS public.get_mdic_comex_aggregated(text, text[], int, int, text[], text[]);

-- ── 3. Recreate get_mdic_comex_serie ─────────────────────────────────────────
-- Monthly time series aggregated by NCM (no country breakdown).
-- Returns at most ~2 100 rows for full history (3 NCMs × 2 flows × 350 months).
CREATE OR REPLACE FUNCTION public.get_mdic_comex_serie(
    p_flow        text     DEFAULT NULL,
    p_ncms        text[]   DEFAULT NULL,
    p_ano_inicio  int      DEFAULT NULL,
    p_ano_fim     int      DEFAULT NULL
)
RETURNS TABLE(
    ano                    smallint,
    mes                    smallint,
    flow                   text,
    ncm_codigo             text,
    ncm_nome               text,
    volume_kg              float8,
    valor_fob_usd          float8,
    quantidade_estatistica float8,
    unidade_estatistica    text
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT
        ano,
        mes,
        flow,
        ncm_codigo,
        MAX(ncm_nome)                AS ncm_nome,
        SUM(volume_kg)               AS volume_kg,
        SUM(valor_fob_usd)           AS valor_fob_usd,
        SUM(quantidade_estatistica)  AS quantidade_estatistica,
        MAX(unidade_estatistica)     AS unidade_estatistica
    FROM public.mdic_comex
    WHERE
        (p_flow       IS NULL OR flow       = p_flow)
        AND (p_ncms   IS NULL OR ncm_codigo = ANY(p_ncms))
        AND (p_ano_inicio IS NULL OR ano    >= p_ano_inicio)
        AND (p_ano_fim    IS NULL OR ano    <= p_ano_fim)
    GROUP BY ano, mes, flow, ncm_codigo
    ORDER BY ano, mes, flow, ncm_codigo;
$$;

GRANT EXECUTE ON FUNCTION public.get_mdic_comex_serie(text, text[], int, int)
    TO authenticated;

-- ── 4. Recreate get_mdic_comex_top_paises ────────────────────────────────────
-- Top countries for a given product / period.
CREATE OR REPLACE FUNCTION public.get_mdic_comex_top_paises(
    p_flow        text    DEFAULT NULL,
    p_ncm_codigo  text    DEFAULT NULL,
    p_ano_inicio  int     DEFAULT NULL,
    p_ano_fim     int     DEFAULT NULL,
    p_limit       int     DEFAULT 15
)
RETURNS TABLE(
    pais                   text,
    ncm_codigo             text,
    volume_kg              float8,
    valor_fob_usd          float8,
    quantidade_estatistica float8,
    unidade_estatistica    text
)
LANGUAGE sql SECURITY DEFINER AS $$
    SELECT
        pais,
        ncm_codigo,
        SUM(volume_kg)              AS volume_kg,
        SUM(valor_fob_usd)          AS valor_fob_usd,
        SUM(quantidade_estatistica) AS quantidade_estatistica,
        MAX(unidade_estatistica)    AS unidade_estatistica
    FROM public.mdic_comex
    WHERE
        (p_flow        IS NULL OR flow        = p_flow)
        AND (p_ncm_codigo IS NULL OR ncm_codigo = p_ncm_codigo)
        AND (p_ano_inicio  IS NULL OR ano        >= p_ano_inicio)
        AND (p_ano_fim     IS NULL OR ano        <= p_ano_fim)
    GROUP BY pais, ncm_codigo
    ORDER BY SUM(volume_kg) DESC NULLS LAST
    LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_mdic_comex_top_paises(text, text, int, int, int)
    TO authenticated;

-- ── 5. Recreate get_mdic_comex_aggregated ────────────────────────────────────
-- Dynamic GROUP BY export aggregation.
-- NOTE: mdic_comex has no 'uf' column (PK: ano,mes,flow,ncm_codigo,pais).
-- Accepted p_group_by values: 'ano','mes','flow','ncm_codigo','ncm_nome','pais'
-- Dimensions absent from p_group_by appear as NULL in result rows.
-- The two new metric columns are always appended last (positional safety).
CREATE OR REPLACE FUNCTION public.get_mdic_comex_aggregated(
    p_flow        text    DEFAULT NULL,
    p_ncms        text[]  DEFAULT NULL,
    p_ano_inicio  int     DEFAULT NULL,
    p_ano_fim     int     DEFAULT NULL,
    p_paises      text[]  DEFAULT NULL,
    p_group_by    text[]  DEFAULT ARRAY['ano','mes']
)
RETURNS TABLE (
    ano                    int,
    mes                    int,
    flow                   text,
    ncm_codigo             text,
    ncm_nome               text,
    pais                   text,
    volume_kg              numeric,
    valor_fob_usd          numeric,
    quantidade_estatistica numeric,
    unidade_estatistica    text
)
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_allowed   text[]  := ARRAY['ano', 'mes', 'flow', 'ncm_codigo', 'ncm_nome', 'pais'];
    v_bad       text;
    v_select    text;
    v_group     text;
    v_query     text;
BEGIN
    -- ── Validate p_group_by against whitelist ─────────────────────────────────
    IF p_group_by IS NULL OR array_length(p_group_by, 1) IS NULL THEN
        RAISE EXCEPTION 'p_group_by must contain at least one dimension';
    END IF;

    SELECT d INTO v_bad
    FROM unnest(p_group_by) AS d
    WHERE d <> ALL(v_allowed)
    LIMIT 1;

    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION 'Invalid p_group_by dimension: %. Allowed: ano,mes,flow,ncm_codigo,ncm_nome,pais', v_bad;
    END IF;

    -- ── Build SELECT clause: real column or NULL for each of the 6 dimensions ──
    -- ncm_nome: use MAX() in non-grouped case (functional dependency on ncm_codigo,
    -- but not enforced by DB; MAX avoids aggregation error when grouping by ncm_codigo
    -- without ncm_nome).
    v_select :=
        CASE WHEN 'ano'        = ANY(p_group_by) THEN 'ano::int'              ELSE 'NULL::int'  END || ',' ||
        CASE WHEN 'mes'        = ANY(p_group_by) THEN 'mes::int'              ELSE 'NULL::int'  END || ',' ||
        CASE WHEN 'flow'       = ANY(p_group_by) THEN 'flow::text'            ELSE 'NULL::text' END || ',' ||
        CASE WHEN 'ncm_codigo' = ANY(p_group_by) THEN 'ncm_codigo::text'      ELSE 'NULL::text' END || ',' ||
        CASE WHEN 'ncm_nome'   = ANY(p_group_by) THEN 'MAX(ncm_nome)::text'   ELSE 'NULL::text' END || ',' ||
        CASE WHEN 'pais'       = ANY(p_group_by) THEN 'pais::text'            ELSE 'NULL::text' END;

    -- ── Build GROUP BY clause (ncm_nome excluded — it uses MAX()) ─────────────
    SELECT string_agg(
        CASE d
            WHEN 'ano'        THEN 'ano'
            WHEN 'mes'        THEN 'mes'
            WHEN 'flow'       THEN 'flow'
            WHEN 'ncm_codigo' THEN 'ncm_codigo'
            WHEN 'ncm_nome'   THEN NULL   -- aggregated via MAX, not grouped
            WHEN 'pais'       THEN 'pais'
        END,
        ', ' ORDER BY array_position(v_allowed, d)
    )
    INTO v_group
    FROM unnest(p_group_by) AS d
    WHERE d <> 'ncm_nome';   -- exclude ncm_nome from GROUP BY (MAX-aggregated)

    -- Edge case: if p_group_by = ARRAY['ncm_nome'] only, v_group would be NULL.
    -- Fallback to prevent "GROUP BY <empty>" syntax error.
    IF v_group IS NULL THEN
        v_group  := 'NULL::int';  -- degenerate: aggregate everything into one row
        v_select := 'NULL::int, NULL::int, NULL::text, NULL::text, MAX(ncm_nome)::text, NULL::text';
    END IF;

    -- ── Assemble full query ───────────────────────────────────────────────────
    -- The two new metric columns (quantidade_estatistica, unidade_estatistica)
    -- are appended unconditionally at the end to match RETURNS TABLE declaration.
    v_query := format(
        $q$
        SELECT
            %s,
            SUM(volume_kg)::numeric,
            SUM(valor_fob_usd)::numeric,
            SUM(quantidade_estatistica)::numeric,
            MAX(unidade_estatistica)::text
        FROM public.mdic_comex
        WHERE
            ($1 IS NULL OR flow       = $1)
            AND ($2 IS NULL OR ncm_codigo = ANY($2))
            AND ($3 IS NULL OR ano     >= $3)
            AND ($4 IS NULL OR ano     <= $4)
            AND ($5 IS NULL OR pais    = ANY($5))
        GROUP BY %s
        ORDER BY %s
        $q$,
        v_select,   -- SELECT cols (dimensions)
        v_group,    -- GROUP BY
        v_group     -- ORDER BY
    );

    RETURN QUERY EXECUTE v_query
        USING
            p_flow,        -- $1
            p_ncms,        -- $2
            p_ano_inicio,  -- $3
            p_ano_fim,     -- $4
            p_paises;      -- $5
END;
$$;

COMMENT ON FUNCTION public.get_mdic_comex_aggregated(
    text, text[], int, int, text[], text[]
) IS
'Aggregated trade data from mdic_comex with dynamic GROUP BY.
p_group_by accepted values: ano, mes, flow, ncm_codigo, ncm_nome, pais.
NOTE: table has no uf column — uf dimension from original spec was dropped.
ncm_nome is always MAX-aggregated (not grouped directly).
Dimensions not listed in p_group_by appear as NULL.
Metrics (volume_kg, valor_fob_usd, quantidade_estatistica) are SUM-aggregated.
unidade_estatistica is MAX-aggregated (constant per NCM).
SECURITY INVOKER — RLS applies as calling user.';

GRANT EXECUTE ON FUNCTION public.get_mdic_comex_aggregated(
    text, text[], int, int, text[], text[]
) TO authenticated;
