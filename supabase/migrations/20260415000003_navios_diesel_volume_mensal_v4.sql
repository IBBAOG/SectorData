-- ============================================================================
-- Navios Diesel — volume mensal v4: barra "Status Indeterminado"
--
-- Quando um porto tem ERRO_COLETA no snapshot selecionado, seus navios
-- aparecem como terceira categoria com o último volume conhecido.
-- Isso evita que o total das barras caia artificialmente por falha de coleta.
--
-- Mudanças em relação à v3:
--   1. vessel_last_row inclui eta, inicio_descarga, fim_descarga para que
--      os navios indeterminados sejam corretamente bucketados por mês.
--   2. Novo CTE indeterminate_by_month: navios de portos com ERRO_COLETA,
--      usando último volume conhecido e datas do último snapshot válido.
--   3. combined e output incluem indeterminate_volume.
--   4. Filtro: mostra meses com pending > 0 OU indeterminate > 0.
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
-- Inclui eta/inicio_descarga/fim_descarga para bucketing correto de
-- navios indeterminados (usam as datas do último snapshot válido).
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
discharged_by_month AS (
    SELECT
        to_char(v.last_seen AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
        SUM(v.last_volume) AS discharged_volume
    FROM vessel_last_row v
    WHERE NOT EXISTS (
        SELECT 1 FROM anchor_set a
        WHERE a.navio = v.navio AND a.porto = v.porto
    )
    AND NOT EXISTS (
        SELECT 1 FROM error_ports ep
        WHERE ep.porto = v.porto
    )
    GROUP BY 1
),

-- ── Pendentes: anchor_set com status válido ───────────────────────────────────
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

-- ── Indeterminados: navios de portos com ERRO_COLETA ─────────────────────────
-- Usa o ÚLTIMO volume e datas conhecidos (vessel_last_row) para:
--   a) não sumir do gráfico por falha de coleta
--   b) manter o volume total estável entre iterações
-- Bucketing por mês usa COALESCE(eta, inicio_descarga, fim_descarga, last_seen)
-- igual ao dos navios pendentes, para aparecer na coluna correta da tabela.
indeterminate_by_month AS (
    SELECT
        to_char(
            COALESCE(v.eta, v.inicio_descarga, v.fim_descarga, v.last_seen)
                AT TIME ZONE 'America/Sao_Paulo',
            'YYYY-MM'
        ) AS month,
        SUM(v.last_volume) AS indeterminate_volume
    FROM vessel_last_row v
    INNER JOIN error_ports ep ON ep.porto = v.porto
    GROUP BY 1
),

-- ── União dos três conjuntos ──────────────────────────────────────────────────
combined AS (
    SELECT
        COALESCE(d.month, p.month, i.month)  AS month,
        COALESCE(d.discharged_volume, 0)      AS discharged_volume,
        COALESCE(p.pending_volume, 0)         AS pending_volume,
        COALESCE(i.indeterminate_volume, 0)   AS indeterminate_volume
    FROM discharged_by_month d
    FULL OUTER JOIN pending_by_month p
        ON d.month = p.month
    FULL OUTER JOIN indeterminate_by_month i
        ON COALESCE(d.month, p.month) = i.month
)

-- Mostra meses com volume pendente OU indeterminado (ambos representam
-- navios que ainda não descarregaram — certeza ou incerteza de dado)
SELECT COALESCE(
    json_agg(
        json_build_object(
            'month',                month,
            'discharged_volume',    discharged_volume,
            'pending_volume',       pending_volume,
            'indeterminate_volume', indeterminate_volume
        )
        ORDER BY month ASC
    ),
    '[]'::json
)
FROM combined
WHERE pending_volume > 0 OR indeterminate_volume > 0;

$$;
