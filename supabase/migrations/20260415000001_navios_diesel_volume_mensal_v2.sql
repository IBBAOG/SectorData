-- ============================================================================
-- Navios Diesel — volume mensal v2: snapshot-aware, filtra meses sem pendente
-- Substitui a função sem parâmetro pela versão que aceita o timestamp do snapshot
-- ============================================================================

-- Remove versão anterior (sem parâmetro)
DROP FUNCTION IF EXISTS public.get_nd_volume_mensal_descarga();

-- Nova versão: aceita timestamp BRT do snapshot selecionado (igual às outras RPCs)
CREATE OR REPLACE FUNCTION public.get_nd_volume_mensal_descarga(p_collected_at text)
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$

WITH
-- ── Snapshot selecionado (converte BRT → UTC, igual às demais funções) ────────
snapshot_ts AS (
    SELECT (p_collected_at::timestamp AT TIME ZONE 'America/Sao_Paulo') AS ts
),

-- ── Anchor set: navios presentes nesse snapshot específico ───────────────────
anchor_set AS (
    SELECT DISTINCT navio, porto
    FROM public.navios_diesel
    WHERE collected_at = (SELECT ts FROM snapshot_ts)
      AND status <> 'ERRO_COLETA'
),

-- ── Última aparição de cada (navio, porto) até esse snapshot ─────────────────
-- Limita ao histórico anterior ou igual ao snapshot selecionado para que
-- snapshots futuros não "ressuscitem" navios já descarregados nessa visão.
vessel_last_row AS (
    SELECT DISTINCT ON (navio, porto)
        navio,
        porto,
        collected_at                        AS last_seen,
        COALESCE(quantidade_convertida, 0)  AS last_volume
    FROM public.navios_diesel
    WHERE collected_at <= (SELECT ts FROM snapshot_ts)
    ORDER BY navio, porto, collected_at DESC
),

-- ── Descarregados: apareceram no histórico mas NÃO estão no anchor set ───────
-- Mês = mês em que o navio foi visto pela última vez (em BRT)
discharged_by_month AS (
    SELECT
        to_char(v.last_seen AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
        SUM(v.last_volume) AS discharged_volume
    FROM vessel_last_row v
    WHERE NOT EXISTS (
        SELECT 1 FROM anchor_set a
        WHERE a.navio = v.navio AND a.porto = v.porto
    )
    GROUP BY 1
),

-- ── Pendentes: navios no anchor set excluindo Despachado / ERRO_COLETA ────────
-- Mês = COALESCE(eta, inicio_descarga, fim_descarga, collected_at) em BRT
pending_by_month AS (
    SELECT
        to_char(
            COALESCE(nd.eta, nd.inicio_descarga, nd.fim_descarga, nd.collected_at)
                AT TIME ZONE 'America/Sao_Paulo',
            'YYYY-MM'
        ) AS month,
        SUM(COALESCE(nd.quantidade_convertida, 0)) AS pending_volume
    FROM public.navios_diesel nd
    INNER JOIN anchor_set a ON a.navio = nd.navio AND a.porto = nd.porto
    WHERE nd.collected_at = (SELECT ts FROM snapshot_ts)
      AND nd.status NOT IN ('ERRO_COLETA', 'Despachado')
    GROUP BY 1
),

-- ── Une todos os meses presentes em qualquer dos dois conjuntos ───────────────
combined AS (
    SELECT
        COALESCE(d.month, p.month)           AS month,
        COALESCE(d.discharged_volume, 0)     AS discharged_volume,
        COALESCE(p.pending_volume, 0)        AS pending_volume
    FROM discharged_by_month d
    FULL OUTER JOIN pending_by_month p ON d.month = p.month
)

-- ── Retorna apenas meses com volume pendente > 0 ─────────────────────────────
SELECT COALESCE(
    json_agg(
        json_build_object(
            'month',             month,
            'discharged_volume', discharged_volume,
            'pending_volume',    pending_volume
        )
        ORDER BY month ASC
    ),
    '[]'::json
)
FROM combined
WHERE pending_volume > 0;

$$;
