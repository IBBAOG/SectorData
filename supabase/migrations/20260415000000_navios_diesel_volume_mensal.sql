-- ============================================================================
-- Navios Diesel — volume mensal descarregado vs a descarregar
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_nd_volume_mensal_descarga()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$

WITH
-- ── Step 1: Anchor timestamp ──────────────────────────────────────────────────
-- The single most recent collection run. Vessels absent here are "discharged".
latest_snapshot_ts AS (
    SELECT MAX(collected_at) AS ts
    FROM public.navios_diesel
),

-- ── Step 2: Anchor set ────────────────────────────────────────────────────────
-- (navio, porto) pairs still present in the latest snapshot.
-- Excludes ERRO_COLETA: a collection error row must not keep a vessel "alive".
anchor_set AS (
    SELECT DISTINCT navio, porto
    FROM public.navios_diesel
    WHERE collected_at = (SELECT ts FROM latest_snapshot_ts)
      AND status <> 'ERRO_COLETA'
),

-- ── Step 3: Per-vessel last-seen row ──────────────────────────────────────────
-- For every (navio, porto) pair ever recorded, retrieve the most recent
-- snapshot row. DISTINCT ON picks exactly one row per vessel,
-- ordered so the latest collected_at wins.
vessel_last_row AS (
    SELECT DISTINCT ON (navio, porto)
        navio,
        porto,
        collected_at                        AS last_seen,
        COALESCE(quantidade_convertida, 0)  AS last_volume
    FROM public.navios_diesel
    ORDER BY navio, porto, collected_at DESC
),

-- ── Step 4: Discharged vessels — aggregate by month ──────────────────────────
-- Vessels whose (navio, porto) key does NOT appear in anchor_set.
-- Month: from last_seen converted to BRT.
-- Volume: from their last snapshot row (one row per vessel, no double-counting).
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

-- ── Step 5: Pending vessels — aggregate by month ──────────────────────────────
-- Vessels in the latest snapshot, excluding ERRO_COLETA and Despachado
-- (Despachado = already departed, should not count as pending inventory).
-- Month: COALESCE(eta, inicio_descarga, fim_descarga, collected_at) in BRT,
-- matching the same bucketing logic used on the frontend.
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
    WHERE nd.collected_at = (SELECT ts FROM latest_snapshot_ts)
      AND nd.status NOT IN ('ERRO_COLETA', 'Despachado')
    GROUP BY 1
),

-- ── Step 6: Full outer join — preserve all months from either set ─────────────
combined AS (
    SELECT
        COALESCE(d.month, p.month)           AS month,
        COALESCE(d.discharged_volume, 0)     AS discharged_volume,
        COALESCE(p.pending_volume, 0)        AS pending_volume
    FROM discharged_by_month d
    FULL OUTER JOIN pending_by_month p ON d.month = p.month
)

-- ── Final output ──────────────────────────────────────────────────────────────
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
FROM combined;

$$;
