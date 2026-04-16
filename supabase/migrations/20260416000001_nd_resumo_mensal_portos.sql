-- ============================================================================
-- Navios Diesel — resumo mensal por porto: todas as três categorias
--
-- Retorna (porto, month, vessels, volume) somando Discharged + Pending
-- Discharge + Indeterminate Status, espelhando a lógica de
-- get_nd_volume_mensal_descarga v4 com porto como dimensão extra.
--
-- Só inclui meses com pending > 0 OR indeterminate > 0
-- (consistente com o filtro do gráfico mensal).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_nd_resumo_mensal_portos(p_collected_at text)
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$

WITH
-- ── Snapshot selecionado ──────────────────────────────────────────────────────
snapshot_ts AS (
    SELECT (p_collected_at::timestamp AT TIME ZONE 'America/Sao_Paulo') AS ts
),

-- ── Portos com falha de coleta no snapshot atual ──────────────────────────────
error_ports AS (
    SELECT DISTINCT porto
    FROM public.navios_diesel
    WHERE collected_at = (SELECT ts FROM snapshot_ts)
      AND status = 'ERRO_COLETA'
),

-- ── Anchor set: navios presentes e válidos no snapshot selecionado ───────────
anchor_set AS (
    SELECT DISTINCT navio, porto
    FROM public.navios_diesel
    WHERE collected_at = (SELECT ts FROM snapshot_ts)
      AND status <> 'ERRO_COLETA'
),

-- ── Última aparição válida de cada (navio, porto) até esse snapshot ───────────
vessel_last_row AS (
    SELECT DISTINCT ON (navio, porto)
        navio,
        porto,
        collected_at                        AS last_seen,
        COALESCE(quantidade_convertida, 0)  AS last_volume,
        eta,
        inicio_descarga,
        fim_descarga
    FROM public.navios_diesel
    WHERE collected_at <= (SELECT ts FROM snapshot_ts)
      AND status <> 'ERRO_COLETA'
    ORDER BY navio, porto, collected_at DESC
),

-- ── Descarregados: não estão no anchor_set E porto sem erro ──────────────────
-- Bucketing por last_seen (igual ao get_nd_volume_mensal_descarga v4).
discharged AS (
    SELECT
        v.porto,
        to_char(v.last_seen AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
        COUNT(*)::int                                                      AS vessels,
        SUM(v.last_volume)                                                 AS volume
    FROM vessel_last_row v
    WHERE NOT EXISTS (
        SELECT 1 FROM anchor_set a
        WHERE a.navio = v.navio AND a.porto = v.porto
    )
    AND NOT EXISTS (
        SELECT 1 FROM error_ports ep
        WHERE ep.porto = v.porto
    )
    GROUP BY v.porto, month
),

-- ── Pendentes: anchor_set com status válido ───────────────────────────────────
-- Bucketing por COALESCE(eta, inicio, fim, collected_at).
pending AS (
    SELECT
        nd.porto,
        to_char(
            COALESCE(nd.eta, nd.inicio_descarga, nd.fim_descarga, nd.collected_at)
                AT TIME ZONE 'America/Sao_Paulo',
            'YYYY-MM'
        )                                                AS month,
        COUNT(*)::int                                    AS vessels,
        SUM(COALESCE(nd.quantidade_convertida, 0))       AS volume
    FROM public.navios_diesel nd
    INNER JOIN anchor_set a ON a.navio = nd.navio AND a.porto = nd.porto
    WHERE nd.collected_at = (SELECT ts FROM snapshot_ts)
      AND nd.status NOT IN ('ERRO_COLETA', 'Despachado')
    GROUP BY nd.porto, month
),

-- ── Indeterminados: portos com ERRO_COLETA, último volume conhecido ───────────
-- Bucketing por COALESCE(eta, inicio, fim, last_seen).
indeterminate AS (
    SELECT
        v.porto,
        to_char(
            COALESCE(v.eta, v.inicio_descarga, v.fim_descarga, v.last_seen)
                AT TIME ZONE 'America/Sao_Paulo',
            'YYYY-MM'
        )                    AS month,
        COUNT(*)::int        AS vessels,
        SUM(v.last_volume)   AS volume
    FROM vessel_last_row v
    INNER JOIN error_ports ep ON ep.porto = v.porto
    GROUP BY v.porto, month
),

-- ── Meses ativos: onde há pending ou indeterminate ────────────────────────────
-- Discharged só entra nos meses que também têm pending ou indeterminate,
-- mantendo consistência com o filtro do gráfico mensal.
active_months AS (
    SELECT DISTINCT month FROM pending
    UNION
    SELECT DISTINCT month FROM indeterminate
),

-- ── União das três categorias (só meses ativos) ───────────────────────────────
combined AS (
    SELECT porto, month, vessels, volume
    FROM   discharged
    WHERE  month IN (SELECT month FROM active_months)

    UNION ALL
    SELECT porto, month, vessels, volume FROM pending

    UNION ALL
    SELECT porto, month, vessels, volume FROM indeterminate
)

SELECT COALESCE(
    json_agg(
        json_build_object(
            'porto',   porto,
            'month',   month,
            'vessels', total_vessels,
            'volume',  total_volume
        )
        ORDER BY porto ASC, month ASC
    ),
    '[]'::json
)
FROM (
    SELECT
        porto,
        month,
        SUM(vessels) AS total_vessels,
        SUM(volume)  AS total_volume
    FROM combined
    GROUP BY porto, month
) sub;

$$;
