-- ============================================================================
-- Monthly diesel-volume series: past months show ONLY discharged volume.
--
-- Context (after 20260527100000 + 20260527400000 + 20260527500000)
--   The previous iteration (Option A) reclassified the last snapshot's
--   "Pending" bucket into "Indeterminate" for closed past months — the idea
--   was to preserve those vessels in the historical estimate but under a
--   conceptually honest label.
--
--   The user rejected Option A. The correct semantics for a CLOSED past
--   month is a SINGLE number: what actually discharged. Any vessel still
--   pending or indeterminate at the last snapshot of the month is, in
--   retrospect, noise — those vessels either never arrived, were
--   redirected, or otherwise did not become real imports for that month.
--   They should not pollute the retrospective view.
--
-- Fix (this migration)
--   For CLOSED months (month < v_current_mo): zero BOTH pending_volume
--   AND indeterminate_volume. Keep discharged_volume as computed.
--
--   Current month (month = v_current_mo): unchanged — all three buckets
--   remain meaningful (live).
--
--   Future months (from future_months_estimate): unchanged — Pending bar
--   only, marked is_current=true.
--
-- Frontend impact
--   None expected. The Plotly stacked-bar chart skips zero-height segments
--   by construction, so past months will render with a single Discharged
--   bar (no Pending, no Indeterminate). Tooltip on past bars will show
--   only the Discharged line.
--
-- Cabotagem
--   `NOT is_cabotagem` is applied at every read from public.navios_diesel.
--
-- Security
--   SECURITY DEFINER + SET search_path = public, pg_temp (Pegadinha #18).
--   GRANT EXECUTE re-applied to anon + authenticated.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_nd_volume_mensal_historico(p_collected_at text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    -- p_collected_at arrives in two formats:
    --   (a) SP-local naive, e.g. '2026-05-26T16:00:00' — what the frontend
    --       sends, because get_nd_coletas_distintas serialises
    --       (collected_at AT TIME ZONE 'America/Sao_Paulo') without an offset.
    --   (b) UTC with offset, e.g. '2026-05-26 19:00:00+00' — what an ad-hoc
    --       SQL caller produces with MAX(collected_at)::text.
    v_current_ts   timestamptz := CASE
        WHEN p_collected_at ~ '([+-][0-9]{2}(:?[0-9]{2})?|Z)$'
            THEN p_collected_at::timestamptz
        ELSE (p_collected_at::timestamp AT TIME ZONE 'America/Sao_Paulo')
    END;
    v_current_mo   text        := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM');
    v_baseline_mo  text        := '2026-04';
    v_result       json;
BEGIN
    WITH
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
    month_anchors_full AS (
        SELECT * FROM month_anchors
        UNION
        SELECT v_current_mo, v_current_ts
        WHERE v_current_mo NOT IN (SELECT month FROM month_anchors)
          AND v_current_mo >= v_baseline_mo
    ),
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
    -- Past + current months.
    --
    -- For CLOSED months (ma.month < v_current_mo): the user-decided contract
    -- is a SINGLE number per past month — the discharged volume. Both
    -- pending_volume and indeterminate_volume are forced to 0. Vessels that
    -- were still pending/indeterminate at the last snapshot of the month
    -- are intentionally discarded from the retrospective view (they did not
    -- become real imports for that month).
    --
    -- For the CURRENT month (ma.month = v_current_mo): all three buckets
    -- are preserved as computed (live estimate).
    past_and_current AS (
        SELECT
            ma.month AS month,
            COALESCE(d.discharged_volume, 0) AS discharged_volume,
            CASE
                WHEN ma.month < v_current_mo THEN 0
                ELSE COALESCE(p.pending_volume, 0)
            END AS pending_volume,
            CASE
                WHEN ma.month < v_current_mo THEN 0
                ELSE COALESCE(i.indeterminate_volume, 0)
            END AS indeterminate_volume,
            (ma.month = v_current_mo) AS is_current
        FROM month_anchors_full ma
        LEFT JOIN discharged d
          ON d.anchor_month = ma.month AND d.attribution_month = ma.month
        LEFT JOIN pending p
          ON p.anchor_month = ma.month AND p.attribution_month = ma.month
        LEFT JOIN indeterminate i
          ON i.anchor_month = ma.month AND i.attribution_month = ma.month
        WHERE ma.month >= v_baseline_mo
    ),
    -- Future months from live snapshot — unchanged from 20260527500000.
    future_months_estimate AS (
        SELECT
            to_char(
                COALESCE(nd.eta, nd.inicio_descarga, nd.fim_descarga, nd.collected_at)
                    AT TIME ZONE 'America/Sao_Paulo',
                'YYYY-MM'
            ) AS month,
            0::numeric                                       AS discharged_volume,
            SUM(COALESCE(nd.quantidade_convertida, 0))       AS pending_volume,
            0::numeric                                       AS indeterminate_volume,
            true                                             AS is_current
        FROM public.navios_diesel nd
        WHERE nd.collected_at = v_current_ts
          AND nd.status NOT IN ('ERRO_COLETA', 'Despachado')
          AND NOT nd.is_cabotagem
        GROUP BY 1
        HAVING to_char(
                   COALESCE(nd.eta, nd.inicio_descarga, nd.fim_descarga, nd.collected_at)
                       AT TIME ZONE 'America/Sao_Paulo',
                   'YYYY-MM'
               ) > v_current_mo
    ),
    combined AS (
        SELECT * FROM past_and_current
        UNION ALL
        SELECT * FROM future_months_estimate
    )
    SELECT COALESCE(json_agg(
        json_build_object(
            'month',                month,
            'discharged_volume',    discharged_volume,
            'pending_volume',       pending_volume,
            'indeterminate_volume', indeterminate_volume,
            'is_current',           is_current
        ) ORDER BY month ASC
    ), '[]'::json)
    INTO v_result
    FROM combined
    WHERE discharged_volume    > 0
       OR pending_volume       > 0
       OR indeterminate_volume > 0;

    RETURN COALESCE(v_result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_nd_volume_mensal_historico(text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_nd_volume_mensal_historico(text) IS
'Monthly diesel-import estimate series. PAST closed months show ONLY discharged_volume (pending_volume and indeterminate_volume forced to 0; vessels still pending/indeterminate at the month''s last snapshot are intentionally discarded as retrospective noise). CURRENT month uses p_collected_at with all three buckets live. FUTURE months derive from the live snapshot using ETA-based attribution (Pending only, is_current=true). Cabotage rows excluded at every read. v_current_ts handles both SP-local-naive (frontend) and UTC-with-offset (SQL caller) input formats via a regex-gated CASE.';
