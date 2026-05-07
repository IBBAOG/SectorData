-- ============================================================================
-- Export aggregated RPCs — Tier 2 granularity toggle
--
-- Two generic RPCs that accept p_group_by text[] and execute a dynamic GROUP BY.
-- SQL injection prevention: p_group_by values are validated against a strict
-- whitelist; SELECT/GROUP BY clauses are built from hardcoded identifier strings,
-- NOT from user input. Filter values use %L (pg literal escaping) inside format().
--
-- SECURITY INVOKER: RLS applies as the calling user (same as export_count RPCs).
-- STABLE: aggregations don't change within a single transaction.
-- GRANT EXECUTE TO authenticated: same audience as the serie RPCs.
--
-- Divergence from spec:
--   mdic_comex table has no 'uf' column (PK: ano,mes,flow,ncm_codigo,pais).
--   Dimension 'uf' and parameter p_ufs were dropped from get_mdic_comex_aggregated.
--   The return type and p_group_by whitelist reflect only existing columns.
-- ============================================================================


-- ── RPC 1: get_anp_cdp_aggregated ───────────────────────────────────────────
-- Accepted p_group_by values: 'ano','mes','campo','bacia','operador','estado',
--   'local','instalacao_destino','tipo_instalacao'
-- Dimensions absent from p_group_by appear as NULL in result rows.

CREATE OR REPLACE FUNCTION public.get_anp_cdp_aggregated(
    p_pocos              text[]   DEFAULT NULL,
    p_campos             text[]   DEFAULT NULL,
    p_bacoes             text[]   DEFAULT NULL,
    p_locais             text[]   DEFAULT NULL,
    p_estados            text[]   DEFAULT NULL,
    p_operadores         text[]   DEFAULT NULL,
    p_instalacoes        text[]   DEFAULT NULL,
    p_tipos_instalacao   text[]   DEFAULT NULL,
    p_ano_inicio         integer  DEFAULT NULL,
    p_ano_fim            integer  DEFAULT NULL,
    p_group_by           text[]   DEFAULT ARRAY['ano','mes']
)
RETURNS TABLE (
    ano                         int,
    mes                         int,
    campo                       text,
    bacia                       text,
    operador                    text,
    estado                      text,
    local                       text,
    instalacao_destino          text,
    tipo_instalacao             text,
    petroleo_bbl_dia            numeric,
    oleo_bbl_dia                numeric,
    condensado_bbl_dia          numeric,
    gas_total_mm3_dia           numeric,
    gas_natural_assoc_mm3_dia   numeric,
    gas_natural_n_assoc_mm3_dia numeric,
    gas_royalties               numeric,
    agua_bbl_dia                numeric,
    tempo_prod_hs_mes           numeric
)
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    -- Allowed dimensions and their SQL column expressions (hardcoded — no user input)
    v_allowed   text[]  := ARRAY[
        'ano', 'mes', 'campo', 'bacia', 'operador',
        'estado', 'local', 'instalacao_destino', 'tipo_instalacao'
    ];
    -- Map dimension name → column expression (all identifiers hardcoded)
    v_dim       text;
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
        RAISE EXCEPTION 'Invalid p_group_by dimension: %. Allowed: ano,mes,campo,bacia,operador,estado,local,instalacao_destino,tipo_instalacao', v_bad;
    END IF;

    -- ── Build SELECT clause: real column or NULL for each of the 9 dimensions ──
    -- Order must match RETURNS TABLE declaration above.
    v_select :=
        CASE WHEN 'ano'                = ANY(p_group_by) THEN 'ano::int'                    ELSE 'NULL::int'  END  || ',' ||
        CASE WHEN 'mes'                = ANY(p_group_by) THEN 'mes::int'                    ELSE 'NULL::int'  END  || ',' ||
        CASE WHEN 'campo'              = ANY(p_group_by) THEN 'campo::text'                 ELSE 'NULL::text' END  || ',' ||
        CASE WHEN 'bacia'              = ANY(p_group_by) THEN 'bacia::text'                 ELSE 'NULL::text' END  || ',' ||
        CASE WHEN 'operador'           = ANY(p_group_by) THEN 'operador::text'              ELSE 'NULL::text' END  || ',' ||
        CASE WHEN 'estado'             = ANY(p_group_by) THEN 'estado::text'                ELSE 'NULL::text' END  || ',' ||
        CASE WHEN 'local'              = ANY(p_group_by) THEN '"local"::text'               ELSE 'NULL::text' END  || ',' ||
        CASE WHEN 'instalacao_destino' = ANY(p_group_by) THEN 'instalacao_destino::text'    ELSE 'NULL::text' END  || ',' ||
        CASE WHEN 'tipo_instalacao'    = ANY(p_group_by) THEN 'tipo_instalacao::text'       ELSE 'NULL::text' END;

    -- ── Build GROUP BY clause from hardcoded names for validated dimensions ───
    SELECT string_agg(
        CASE d
            WHEN 'ano'                THEN 'ano'
            WHEN 'mes'                THEN 'mes'
            WHEN 'campo'              THEN 'campo'
            WHEN 'bacia'              THEN 'bacia'
            WHEN 'operador'           THEN 'operador'
            WHEN 'estado'             THEN 'estado'
            WHEN 'local'              THEN '"local"'
            WHEN 'instalacao_destino' THEN 'instalacao_destino'
            WHEN 'tipo_instalacao'    THEN 'tipo_instalacao'
        END,
        ', ' ORDER BY array_position(v_allowed, d)
    )
    INTO v_group
    FROM unnest(p_group_by) AS d;

    -- ── Assemble full query ───────────────────────────────────────────────────
    -- Filter values use %L (pg_catalog.quote_literal equivalent via format()).
    -- Array comparisons use the runtime parameters directly via USING clause.
    v_query := format(
        $q$
        SELECT
            %s,
            SUM(petroleo_bbl_dia)::numeric,
            SUM(oleo_bbl_dia)::numeric,
            SUM(condensado_bbl_dia)::numeric,
            SUM(gas_total_mm3_dia)::numeric,
            SUM(gas_natural_assoc_mm3_dia)::numeric,
            SUM(gas_natural_n_assoc_mm3_dia)::numeric,
            SUM(gas_royalties)::numeric,
            SUM(agua_bbl_dia)::numeric,
            SUM(tempo_prod_hs_mes)::numeric
        FROM public.anp_cdp_producao
        WHERE
            ($1  IS NULL OR poco               = ANY($1))
            AND ($2  IS NULL OR campo              = ANY($2))
            AND ($3  IS NULL OR bacia              = ANY($3))
            AND ($4  IS NULL OR "local"            = ANY($4))
            AND ($5  IS NULL OR estado             = ANY($5))
            AND ($6  IS NULL OR operador           = ANY($6))
            AND ($7  IS NULL OR instalacao_destino = ANY($7))
            AND ($8  IS NULL OR tipo_instalacao    = ANY($8))
            AND ($9  IS NULL OR ano                >= $9)
            AND ($10 IS NULL OR ano                <= $10)
        GROUP BY %s
        ORDER BY %s
        $q$,
        v_select,   -- %1$s  SELECT cols
        v_group,    -- %2$s  GROUP BY
        v_group     -- %3$s  ORDER BY
    );

    RETURN QUERY EXECUTE v_query
        USING
            p_pocos,            -- $1
            p_campos,           -- $2
            p_bacoes,           -- $3
            p_locais,           -- $4
            p_estados,          -- $5
            p_operadores,       -- $6
            p_instalacoes,      -- $7
            p_tipos_instalacao, -- $8
            p_ano_inicio,       -- $9
            p_ano_fim;          -- $10
END;
$$;

COMMENT ON FUNCTION public.get_anp_cdp_aggregated(
    text[], text[], text[], text[], text[], text[], text[], text[], integer, integer, text[]
) IS
'Aggregated production data from anp_cdp_producao with dynamic GROUP BY.
p_group_by accepted values: ano, mes, campo, bacia, operador, estado, local,
instalacao_destino, tipo_instalacao.
Dimensions not listed in p_group_by appear as NULL.
Metrics are SUM-aggregated. SECURITY INVOKER — RLS applies as calling user.';

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_aggregated(
    text[], text[], text[], text[], text[], text[], text[], text[], integer, integer, text[]
) TO authenticated;


-- ── RPC 2: get_mdic_comex_aggregated ────────────────────────────────────────
-- NOTE: mdic_comex has no 'uf' column (table PK: ano,mes,flow,ncm_codigo,pais).
-- Accepted p_group_by values: 'ano','mes','flow','ncm_codigo','ncm_nome','pais'
-- Dimensions absent from p_group_by appear as NULL in result rows.

CREATE OR REPLACE FUNCTION public.get_mdic_comex_aggregated(
    p_flow        text    DEFAULT NULL,
    p_ncms        text[]  DEFAULT NULL,
    p_ano_inicio  int     DEFAULT NULL,
    p_ano_fim     int     DEFAULT NULL,
    p_paises      text[]  DEFAULT NULL,
    p_group_by    text[]  DEFAULT ARRAY['ano','mes']
)
RETURNS TABLE (
    ano          int,
    mes          int,
    flow         text,
    ncm_codigo   text,
    ncm_nome     text,
    pais         text,
    volume_kg    numeric,
    valor_fob_usd numeric
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
        CASE WHEN 'ano'       = ANY(p_group_by) THEN 'ano::int'       ELSE 'NULL::int'  END || ',' ||
        CASE WHEN 'mes'       = ANY(p_group_by) THEN 'mes::int'       ELSE 'NULL::int'  END || ',' ||
        CASE WHEN 'flow'      = ANY(p_group_by) THEN 'flow::text'     ELSE 'NULL::text' END || ',' ||
        CASE WHEN 'ncm_codigo'= ANY(p_group_by) THEN 'ncm_codigo::text' ELSE 'NULL::text' END || ',' ||
        CASE WHEN 'ncm_nome'  = ANY(p_group_by) THEN 'MAX(ncm_nome)::text' ELSE 'NULL::text' END || ',' ||
        CASE WHEN 'pais'      = ANY(p_group_by) THEN 'pais::text'     ELSE 'NULL::text' END;

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
        v_group := 'NULL::int';  -- degenerate: aggregate everything into one row
        -- Rebuild select for this edge case
        v_select :=
            'NULL::int, NULL::int, NULL::text, NULL::text, MAX(ncm_nome)::text, NULL::text';
    END IF;

    -- ── Assemble full query ───────────────────────────────────────────────────
    v_query := format(
        $q$
        SELECT
            %s,
            SUM(volume_kg)::numeric,
            SUM(valor_fob_usd)::numeric
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
        v_select,   -- SELECT cols
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
Metrics (volume_kg, valor_fob_usd) are SUM-aggregated.
SECURITY INVOKER — RLS applies as calling user.';

GRANT EXECUTE ON FUNCTION public.get_mdic_comex_aggregated(
    text, text[], int, int, text[], text[]
) TO authenticated;
