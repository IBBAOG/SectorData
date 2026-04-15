-- ============================================================================
-- Navios Diesel — volume mensal v3: trava contra double-count por ERRO_COLETA
--
-- Problema corrigido:
--   Quando um porto (ex: Itaqui) falha a coleta num snapshot, o anchor_set
--   não contém nenhum navio desse porto. Sem proteção, todo navio histórico
--   desse porto seria contado como "descarregado" — falso positivo.
--
-- Correção:
--   1. vessel_last_row exclui linhas ERRO_COLETA: sentinelas de erro não
--      interferem no DISTINCT ON nem aparecem como navios descarregados.
--   2. error_ports identifica portos com falha de coleta no snapshot atual.
--   3. discharged_by_month exclui navios cujo porto teve erro de coleta —
--      eles ficam em estado "desconhecido" até o próximo snapshot válido.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_nd_volume_mensal_descarga(text);

CREATE OR REPLACE FUNCTION public.get_nd_volume_mensal_descarga(p_collected_at text)
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$

WITH
-- ── Snapshot selecionado ──────────────────────────────────────────────────────
snapshot_ts AS (
    SELECT (p_collected_at::timestamp AT TIME ZONE 'America/Sao_Paulo') AS ts
),

-- ── Portos com falha de coleta no snapshot atual ──────────────────────────────
-- Navios desses portos NÃO serão classificados como descarregados:
-- a ausência no anchor_set é por falha técnica, não por desaparecimento real.
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
-- Exclui ERRO_COLETA para que:
--   a) sentinelas de erro não vençam o DISTINCT ON sobre linhas reais;
--   b) sentinelas não apareçam como "navios" no resultado.
vessel_last_row AS (
    SELECT DISTINCT ON (navio, porto)
        navio,
        porto,
        collected_at                        AS last_seen,
        COALESCE(quantidade_convertida, 0)  AS last_volume
    FROM public.navios_diesel
    WHERE collected_at <= (SELECT ts FROM snapshot_ts)
      AND status <> 'ERRO_COLETA'
    ORDER BY navio, porto, collected_at DESC
),

-- ── Descarregados: não estão no anchor_set E o porto não teve erro ────────────
discharged_by_month AS (
    SELECT
        to_char(v.last_seen AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
        SUM(v.last_volume) AS discharged_volume
    FROM vessel_last_row v
    WHERE NOT EXISTS (
        SELECT 1 FROM anchor_set a
        WHERE a.navio = v.navio AND a.porto = v.porto
    )
    -- Trava anti-double-count: porta com ERRO_COLETA → estado desconhecido
    AND NOT EXISTS (
        SELECT 1 FROM error_ports ep
        WHERE ep.porto = v.porto
    )
    GROUP BY 1
),

-- ── Pendentes: anchor_set com status válido, mês via ETA / datas ─────────────
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

-- ── União dos dois conjuntos ──────────────────────────────────────────────────
combined AS (
    SELECT
        COALESCE(d.month, p.month)           AS month,
        COALESCE(d.discharged_volume, 0)     AS discharged_volume,
        COALESCE(p.pending_volume, 0)        AS pending_volume
    FROM discharged_by_month d
    FULL OUTER JOIN pending_by_month p ON d.month = p.month
)

-- Retorna apenas meses com volume pendente > 0
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
