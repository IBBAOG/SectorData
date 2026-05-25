-- ============================================================================
-- ANP CDP: drop 4 unused metric columns from anp_cdp_producao + refresh 2 RPCs.
--
-- Dropped columns (no remaining frontend or ETL consumer needs them):
--   1. condensado_bbl_dia            (float4)
--   2. gas_natural_assoc_mm3_dia     (float4)
--   3. gas_natural_n_assoc_mm3_dia   (float4)
--   4. gas_royalties                 (float4)
--
-- Pre-flight check (no indices/MVs/generated cols depend on these — verified via
-- grep across supabase/migrations/). DROP without CASCADE is safe; if any
-- silent dependency exists, the migration will fail and we fix forward.
--
-- Touched RPCs (re-created without the 4 columns):
--   - get_anp_cdp_poco_serie    (last live def: 20260514100000_anp_cdp_records_count.sql)
--   - get_anp_cdp_aggregated    (last live def: 20260507000004_export_aggregated_rpcs.sql)
-- ============================================================================


-- ── Step 1: drop the 4 columns from anp_cdp_producao ────────────────────────
-- DROP FUNCTION first to release any cached dependency on column types, since
-- both RPCs reference these columns in RETURNS TABLE / SELECT clauses.

DROP FUNCTION IF EXISTS public.get_anp_cdp_poco_serie(text[], text[], text[], text[], text[], text[], text[], text[], integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.get_anp_cdp_aggregated(text[], text[], text[], text[], text[], text[], text[], text[], integer, integer, text[]) CASCADE;

ALTER TABLE public.anp_cdp_producao
  DROP COLUMN condensado_bbl_dia,
  DROP COLUMN gas_natural_assoc_mm3_dia,
  DROP COLUMN gas_natural_n_assoc_mm3_dia,
  DROP COLUMN gas_royalties;


-- ── Step 2: re-create get_anp_cdp_poco_serie without the 4 columns ───────────
-- Preserves wells_count, fields_count, records_count (added 20260514100000).

CREATE FUNCTION public.get_anp_cdp_poco_serie(
  p_pocos              text[]  DEFAULT NULL,
  p_campos             text[]  DEFAULT NULL,
  p_bacoes             text[]  DEFAULT NULL,
  p_locais             text[]  DEFAULT NULL,
  p_estados            text[]  DEFAULT NULL,
  p_operadores         text[]  DEFAULT NULL,
  p_instalacoes        text[]  DEFAULT NULL,
  p_tipos_instalacao   text[]  DEFAULT NULL,
  p_ano_inicio         integer DEFAULT NULL,
  p_ano_fim            integer DEFAULT NULL
)
RETURNS TABLE(
  ano                          integer,
  mes                          integer,
  petroleo_bbl_dia             float8,
  oleo_bbl_dia                 float8,
  gas_total_mm3_dia            float8,
  agua_bbl_dia                 float8,
  tempo_prod_hs_mes            float8,
  wells_count                  bigint,
  fields_count                 bigint,
  records_count                bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ano, mes,
    COALESCE(SUM(petroleo_bbl_dia),             0)::float8,
    COALESCE(SUM(oleo_bbl_dia),                 0)::float8,
    COALESCE(SUM(gas_total_mm3_dia),            0)::float8,
    COALESCE(SUM(agua_bbl_dia),                 0)::float8,
    COALESCE(SUM(tempo_prod_hs_mes),            0)::float8,
    COUNT(DISTINCT poco)::bigint                    AS wells_count,
    COUNT(DISTINCT campo)::bigint                   AS fields_count,
    COUNT(*)::bigint                                AS records_count
  FROM public.anp_cdp_producao
  WHERE
    (p_pocos            IS NULL OR poco               = ANY(p_pocos))
    AND (p_campos       IS NULL OR campo              = ANY(p_campos))
    AND (p_bacoes       IS NULL OR bacia              = ANY(p_bacoes))
    AND (p_locais       IS NULL OR local              = ANY(p_locais))
    AND (p_estados      IS NULL OR estado             = ANY(p_estados))
    AND (p_operadores   IS NULL OR operador           = ANY(p_operadores))
    AND (p_instalacoes  IS NULL OR instalacao_destino  = ANY(p_instalacoes))
    AND (p_tipos_instalacao IS NULL OR tipo_instalacao = ANY(p_tipos_instalacao))
    AND (p_ano_inicio   IS NULL OR ano                >= p_ano_inicio)
    AND (p_ano_fim      IS NULL OR ano                <= p_ano_fim)
  GROUP BY ano, mes
  ORDER BY ano, mes;
$$;


-- ── Step 3: re-create get_anp_cdp_aggregated without the 4 columns ───────────
-- Same dynamic GROUP BY contract as the original (20260507000004). The 4 metric
-- columns are removed from RETURNS TABLE, the SELECT clause inside the dynamic
-- query, and the COALESCE/SUM list. Everything else (whitelist, validation,
-- USING params) is identical.

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
    gas_total_mm3_dia           numeric,
    agua_bbl_dia                numeric,
    tempo_prod_hs_mes           numeric
)
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_allowed   text[]  := ARRAY[
        'ano', 'mes', 'campo', 'bacia', 'operador',
        'estado', 'local', 'instalacao_destino', 'tipo_instalacao'
    ];
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

    v_query := format(
        $q$
        SELECT
            %s,
            SUM(petroleo_bbl_dia)::numeric,
            SUM(oleo_bbl_dia)::numeric,
            SUM(gas_total_mm3_dia)::numeric,
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
        v_select,
        v_group,
        v_group
    );

    RETURN QUERY EXECUTE v_query
        USING
            p_pocos,
            p_campos,
            p_bacoes,
            p_locais,
            p_estados,
            p_operadores,
            p_instalacoes,
            p_tipos_instalacao,
            p_ano_inicio,
            p_ano_fim;
END;
$$;

COMMENT ON FUNCTION public.get_anp_cdp_aggregated(
    text[], text[], text[], text[], text[], text[], text[], text[], integer, integer, text[]
) IS
'Aggregated production data from anp_cdp_producao with dynamic GROUP BY.
p_group_by accepted values: ano, mes, campo, bacia, operador, estado, local,
instalacao_destino, tipo_instalacao.
Dimensions not listed in p_group_by appear as NULL.
Metrics are SUM-aggregated. SECURITY INVOKER — RLS applies as calling user.
Updated 20260525160000: removed condensado_bbl_dia, gas_natural_assoc_mm3_dia,
gas_natural_n_assoc_mm3_dia, gas_royalties from result set.';

GRANT EXECUTE ON FUNCTION public.get_anp_cdp_aggregated(
    text[], text[], text[], text[], text[], text[], text[], text[], integer, integer, text[]
) TO authenticated;
