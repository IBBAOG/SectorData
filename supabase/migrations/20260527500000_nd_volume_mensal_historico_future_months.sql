-- ============================================================================
-- Monthly diesel-volume series: add future-month bars + reclassify past
-- "Pending" → "Indeterminate" (Option A) + fix latent timezone bug.
--
-- Context (after 20260527100000 + 20260527400000_ambiguous fix)
--   The previous version of get_nd_volume_mensal_historico iterated only the
--   set of months that appear in navios_diesel.collected_at, then for each
--   anchor month emitted a bar where attribution_month == anchor_month. As a
--   result:
--     * Future months (vessels with ETA past current month-end) were silently
--       dropped — the snapshot row falls into the *current* anchor but its
--       attribution lands in a future month, which has no own anchor, so the
--       `combined` filter `WHERE attribution_month = anchor_month` discarded it.
--     * Past months kept showing a "Pending" bar that was conceptually
--       impossible — the month is closed; a vessel that was pending at the
--       last snapshot of the month either eventually discharged or did not
--       arrive. The honest classification for a CLOSED month is either
--       Discharged or Indeterminate, never Pending.
--     * LATENT TZ BUG: v_current_ts was declared `timestamp` and computed as
--       `(p_collected_at::timestamp AT TIME ZONE 'America/Sao_Paulo')`. The
--       caller passes a UTC timestamptz string (e.g. '2026-05-26 19:00:00+00'),
--       which `::timestamp` strips into the naive value '2026-05-26 19:00:00',
--       then `AT TIME ZONE 'America/Sao_Paulo'` interprets *that naive value
--       as São Paulo local time*, returning '2026-05-26 22:00:00+00' — a 3-hour
--       shift. Downstream `nd.collected_at = ma.anchor_ts` then matched nothing
--       for the current month, so the pending CTE was always empty and all
--       current-month vessels fell through to "discharged".
--
-- Fix (this migration)
--   1. Reclassify past-month Pending → Indeterminate (Option A). The estimate
--      preserved at month-end is the snapshot's foto, but the *labels* now
--      reflect retrospective semantics. We pick Indeterminate (over
--      Discharged) because we genuinely don't know which vessels eventually
--      arrived — "Indeterminate Status" already means "we cannot reconcile
--      this vessel's outcome from the line-up alone".
--   2. Add a third CTE `future_months_estimate` that scans the live snapshot
--      (p_collected_at) and emits a Pending bar for every attribution month
--      strictly greater than the current month. These bars are marked
--      `is_current = true` so the frontend treats them as LIVE (outline +
--      "(live)" suffix), matching the current month's rendering.
--   3. Fix v_current_ts to `timestamptz` and parse p_collected_at with the
--      `::timestamptz` cast so the UTC offset is preserved. All anchor_ts
--      values are now timestamptz, matching navios_diesel.collected_at.
--
-- Frontend impact
--   None. `is_current = true` already triggers the live-bar styling in both
--   desktop/View.tsx (Plotly outline + "(live)" label) and mobile/View.tsx
--   (orange outline + "live" caption). Future months reuse that path.
--
-- Cabotagem
--   `NOT is_cabotagem` is applied at every read from public.navios_diesel
--   (3 spots), per the dashboard's hard contract.
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
    -- Use timestamptz throughout so the parser preserves the caller's UTC
    -- offset and matches navios_diesel.collected_at (also timestamptz).
    -- The previous `::timestamp AT TIME ZONE 'America/Sao_Paulo'` chain
    -- shifted the anchor by 3h and silently broke current-month buckets.
    v_current_ts   timestamptz := p_collected_at::timestamptz;
    v_current_mo   text        := to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM');
    v_baseline_mo  text        := '2026-04';
    v_result       json;
BEGIN
    WITH
    -- Anchor each month present in navios_diesel >= baseline:
    --   current month → p_collected_at (live)
    --   past month    → max(collected_at) within that month (frozen)
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
    -- Past + current months. Each chart bar = the estimate FROZEN by the
    -- snapshot of that month itself; cross-month attribution from a past
    -- anchor is dropped (those months own their own bars).
    --
    -- Option A reclassification (this migration):
    --   For CLOSED months (month < current), Pending is conceptually
    --   impossible — fold it into Indeterminate. We zero out the pending
    --   bucket and add the same volume to the indeterminate bucket.
    --   The current month keeps its Pending bar (live, still meaningful).
    past_and_current AS (
        SELECT
            ma.month AS month,
            COALESCE(d.discharged_volume, 0) AS discharged_volume,
            CASE
                WHEN ma.month < v_current_mo THEN 0
                ELSE COALESCE(p.pending_volume, 0)
            END AS pending_volume,
            CASE
                WHEN ma.month < v_current_mo
                    THEN COALESCE(i.indeterminate_volume, 0)
                       + COALESCE(p.pending_volume, 0)
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
    -- Future months: from the LIVE snapshot (p_collected_at), every vessel
    -- in the active line-up whose attribution month is strictly greater
    -- than the current month. These rows are inherently LIVE (the snapshot
    -- evolves with every new crawl); marked is_current = true so the
    -- frontend renders them with the same "(live)" outline as current month.
    --
    -- Cabotage filter and ERRO_COLETA/Despachado exclusion mirror the
    -- pending CTE above.
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
'Monthly diesel-import estimate series with three temporal categories: PAST months are frozen at the last snapshot of the month (Pending reclassified into Indeterminate — Option A — since a closed month cannot have pending vessels); CURRENT month uses p_collected_at (live, all three buckets meaningful); FUTURE months derive from the live snapshot using ETA-based attribution (Pending only, marked is_current=true so the frontend renders as live). Cabotage rows excluded at every read.';
