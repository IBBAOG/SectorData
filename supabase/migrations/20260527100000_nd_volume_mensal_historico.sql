-- ============================================================================
-- Preserve historical monthly diesel-import estimates (frozen-by-month).
--
-- Problem: get_nd_volume_mensal_descarga(p_collected_at) computes the three
-- buckets (discharged / pending / indeterminate) by ALWAYS walking the
-- vessel_last_row up to p_collected_at. Once a month rolls over and new
-- snapshots arrive, the buckets for that past month are silently recomputed
-- from a different anchor_set — we lose the "estimate we had during that
-- month" forever.
--
-- Fix: derive each *closed* month from the LAST snapshot collected within
-- that month (`MAX(collected_at) WITHIN month`). The bucket math is the
-- same; only the snapshot anchor changes. The CURRENT month keeps using
-- `p_collected_at` (live).
--
-- Baseline: 2026-04 (first full month with usable line-up data). Earlier
-- months are excluded — we never had a reliable estimate before that.
--
-- This is a NEW function — get_nd_volume_mensal_descarga is left intact so
-- the old behavior is recoverable if a regression appears.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_nd_volume_mensal_historico(p_collected_at text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_ts   timestamp := (p_collected_at::timestamp AT TIME ZONE 'America/Sao_Paulo');
    v_current_mo   text      := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM');
    v_baseline_mo  text      := '2026-04';
    v_result       json;
BEGIN
    WITH
    -- 1. Every month present in navios_diesel >= baseline. For each one,
    --    pick the snapshot anchor:
    --      - current month → p_collected_at (live)
    --      - past month    → max(collected_at) within that month
    month_anchors AS (
        SELECT
            month,
            CASE
                WHEN month = v_current_mo THEN v_current_ts
                ELSE last_snapshot_in_month
            END AS anchor_ts
        FROM (
            SELECT
                to_char(collected_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
                MAX(collected_at) AS last_snapshot_in_month
            FROM public.navios_diesel
            WHERE NOT is_cabotagem
            GROUP BY 1
        ) m
        WHERE month >= v_baseline_mo
          AND month <= v_current_mo
    ),
    -- Ensure current month is in the set even if no snapshot has landed yet
    -- (edge case: very first hours of a new month before the first crawl).
    -- If no current-month snapshot exists, anchor it to p_collected_at and
    -- the bucket math will just produce empty rows — graceful no-op.
    month_anchors_full AS (
        SELECT * FROM month_anchors
        UNION
        SELECT v_current_mo, v_current_ts
        WHERE v_current_mo NOT IN (SELECT month FROM month_anchors)
          AND v_current_mo >= v_baseline_mo
    ),
    -- 2. error_ports / anchor_set / vessel_last_row, but expanded across
    --    every month_anchor (one row per (month, vessel)).
    error_ports AS (
        SELECT ma.month, nd.porto
        FROM month_anchors_full ma
        JOIN public.navios_diesel nd
          ON nd.collected_at = ma.anchor_ts
        WHERE nd.status = 'ERRO_COLETA'
          AND NOT nd.is_cabotagem
        GROUP BY ma.month, nd.porto
    ),
    anchor_set AS (
        SELECT ma.month, nd.navio, nd.porto
        FROM month_anchors_full ma
        JOIN public.navios_diesel nd
          ON nd.collected_at = ma.anchor_ts
        WHERE nd.status NOT IN ('ERRO_COLETA', 'Despachado')
          AND NOT nd.is_cabotagem
        GROUP BY ma.month, nd.navio, nd.porto
    ),
    vessel_last_row AS (
        SELECT DISTINCT ON (ma.month, nd.navio, nd.porto)
            ma.month,
            nd.navio,
            nd.porto,
            nd.collected_at                       AS last_seen,
            COALESCE(nd.quantidade_convertida, 0) AS last_volume,
            nd.eta,
            nd.inicio_descarga,
            nd.fim_descarga
        FROM month_anchors_full ma
        JOIN public.navios_diesel nd
          ON nd.collected_at <= ma.anchor_ts
        WHERE nd.status <> 'ERRO_COLETA'
          AND NOT nd.is_cabotagem
        ORDER BY ma.month, nd.navio, nd.porto, nd.collected_at DESC
    ),
    -- 3. The three buckets, computed per (anchor_month, attribution_month).
    --    The "attribution month" is where the volume lands on the chart;
    --    we ONLY emit the row when attribution_month = anchor_month, since
    --    that anchor froze the estimate FOR that month.
    discharged AS (
        SELECT
            v.month AS anchor_month,
            to_char(v.last_seen AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS attribution_month,
            SUM(v.last_volume) AS discharged_volume
        FROM vessel_last_row v
        WHERE NOT EXISTS (
            SELECT 1 FROM anchor_set a
            WHERE a.month = v.month AND a.navio = v.navio AND a.porto = v.porto
        )
          AND NOT EXISTS (
            SELECT 1 FROM error_ports ep
            WHERE ep.month = v.month AND ep.porto = v.porto
        )
        GROUP BY 1, 2
    ),
    pending AS (
        SELECT
            ma.month AS anchor_month,
            to_char(
                COALESCE(nd.eta, nd.inicio_descarga, nd.fim_descarga, nd.collected_at)
                    AT TIME ZONE 'America/Sao_Paulo',
                'YYYY-MM'
            ) AS attribution_month,
            SUM(COALESCE(nd.quantidade_convertida, 0)) AS pending_volume
        FROM month_anchors_full ma
        JOIN public.navios_diesel nd
          ON nd.collected_at = ma.anchor_ts
        JOIN anchor_set a
          ON a.month = ma.month AND a.navio = nd.navio AND a.porto = nd.porto
        WHERE nd.status NOT IN ('ERRO_COLETA', 'Despachado')
          AND NOT nd.is_cabotagem
        GROUP BY 1, 2
    ),
    indeterminate AS (
        SELECT
            v.month AS anchor_month,
            to_char(
                COALESCE(v.eta, v.inicio_descarga, v.fim_descarga, v.last_seen)
                    AT TIME ZONE 'America/Sao_Paulo',
                'YYYY-MM'
            ) AS attribution_month,
            SUM(v.last_volume) AS indeterminate_volume
        FROM vessel_last_row v
        JOIN error_ports ep
          ON ep.month = v.month AND ep.porto = v.porto
        GROUP BY 1, 2
    ),
    -- 4. Keep ONLY rows where attribution_month = anchor_month. That is the
    --    contract: each chart bar shows the estimate FROZEN by the snapshot
    --    of that month itself. Volume that the anchor expected to land in a
    --    DIFFERENT month is intentionally dropped — that volume will appear
    --    on its own bar via that other month's anchor.
    combined AS (
        SELECT
            anchor_month AS month,
            COALESCE(d.discharged_volume,    0) AS discharged_volume,
            COALESCE(p.pending_volume,       0) AS pending_volume,
            COALESCE(i.indeterminate_volume, 0) AS indeterminate_volume
        FROM month_anchors_full ma
        LEFT JOIN discharged d
          ON d.anchor_month = ma.month AND d.attribution_month = ma.month
        LEFT JOIN pending p
          ON p.anchor_month = ma.month AND p.attribution_month = ma.month
        LEFT JOIN indeterminate i
          ON i.anchor_month = ma.month AND i.attribution_month = ma.month
        WHERE ma.month >= v_baseline_mo
    )
    SELECT COALESCE(json_agg(
        json_build_object(
            'month',                month,
            'discharged_volume',    discharged_volume,
            'pending_volume',       pending_volume,
            'indeterminate_volume', indeterminate_volume,
            'is_current',           (month = v_current_mo)
        ) ORDER BY month ASC
    ), '[]'::json)
    INTO v_result
    FROM combined
    WHERE discharged_volume > 0
       OR pending_volume    > 0
       OR indeterminate_volume > 0;

    RETURN COALESCE(v_result, '[]'::json);
END;
$$;

-- Grants: anon + authenticated, matching the rest of the navios-diesel surface.
GRANT EXECUTE ON FUNCTION public.get_nd_volume_mensal_historico(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_nd_volume_mensal_historico(text) IS
'Returns the monthly diesel-import estimate series with frozen history: each closed month is anchored to the LAST snapshot collected within that month, so past bars never get retroactively recomputed. The current month uses p_collected_at (live). Baseline 2026-04. Cabotage rows excluded at every CTE.';
