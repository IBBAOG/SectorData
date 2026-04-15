-- ============================================================================
-- Navios Diesel — navios descarregados (por navio individual)
--
-- Retorna um registro por (navio, porto) que desapareceu do snapshot
-- selecionado. Usado na tabela de sanity-check "Delivered Vessels".
--
-- Exclui navios de portos com ERRO_COLETA (status indeterminado).
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_nd_navios_descarregados(text);

CREATE OR REPLACE FUNCTION public.get_nd_navios_descarregados(p_collected_at text)
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
)

-- Navios ausentes do anchor_set E cujo porto não tem ERRO_COLETA → entregues
SELECT COALESCE(
    json_agg(
        json_build_object(
            'navio',           v.navio,
            'porto',           v.porto,
            -- Data/hora da última aparição em BRT (exibição na tabela)
            'last_seen',       to_char(
                                   v.last_seen AT TIME ZONE 'America/Sao_Paulo',
                                   'YYYY-MM-DD HH24:MI'
                               ),
            'last_volume',     v.last_volume,
            -- Mês de descarga estimado (igual ao bucketing do gráfico)
            'discharge_month', to_char(
                                   COALESCE(v.eta, v.inicio_descarga, v.fim_descarga, v.last_seen)
                                       AT TIME ZONE 'America/Sao_Paulo',
                                   'YYYY-MM'
                               )
        )
        ORDER BY v.last_seen DESC
    ),
    '[]'::json
)
FROM vessel_last_row v
WHERE NOT EXISTS (
    SELECT 1 FROM anchor_set a
    WHERE a.navio = v.navio AND a.porto = v.porto
)
AND NOT EXISTS (
    SELECT 1 FROM error_ports ep
    WHERE ep.porto = v.porto
);

$$;
