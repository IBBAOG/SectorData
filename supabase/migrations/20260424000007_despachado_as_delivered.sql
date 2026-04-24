-- ============================================================================
-- Treat "Despachado" (Paranaguá DESPACHADOS / Suape / etc.) as a delivered
-- vessel rather than an active one.
--
-- Context: some ports (notably APPA/Paranaguá) keep a vessel visible in their
-- line-up for weeks after discharge under the "Despachado" status. The old
-- logic put those rows into `anchor_set`, so the "Delivered Vessels" table
-- never received them even though they represent completed deliveries.
--
-- Fix: exclude `status = 'Despachado'` from `anchor_set` in every RPC that
-- uses the discharged / pending split. Despachado rows still feed
-- `vessel_last_row`, so their volume is preserved in the Delivered tally.
-- `pending` already excludes Despachado — no change needed there.
--
-- Affected RPCs:
--   - get_nd_navios_descarregados     (Delivered Vessels table)
--   - get_nd_volume_mensal_descarga   (monthly volume chart — 3 buckets)
--   - get_nd_resumo_mensal_portos     (per-port x month summary)
-- ============================================================================

-- ── get_nd_navios_descarregados ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_nd_navios_descarregados(p_collected_at text)
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
WITH
snapshot_ts AS (
    SELECT (p_collected_at::timestamp AT TIME ZONE 'America/Sao_Paulo') AS ts
),
error_ports AS (
    SELECT DISTINCT porto
    FROM public.navios_diesel
    WHERE collected_at = (SELECT ts FROM snapshot_ts)
      AND status = 'ERRO_COLETA'
      AND NOT is_cabotagem
),
anchor_set AS (
    -- Only *active* vessels anchor the "still in line-up" set. Despachado
    -- in the current snapshot means the port flagged the vessel as having
    -- finished discharge, so it belongs in the Delivered table.
    SELECT DISTINCT navio, porto
    FROM public.navios_diesel
    WHERE collected_at = (SELECT ts FROM snapshot_ts)
      AND status NOT IN ('ERRO_COLETA', 'Despachado')
      AND NOT is_cabotagem
),
vessel_last_row AS (
    SELECT DISTINCT ON (navio, porto)
        navio, porto,
        collected_at                        AS last_seen,
        COALESCE(quantidade_convertida, 0)  AS last_volume,
        eta, inicio_descarga, fim_descarga
    FROM public.navios_diesel
    WHERE collected_at <= (SELECT ts FROM snapshot_ts)
      AND status <> 'ERRO_COLETA'
      AND NOT is_cabotagem
    ORDER BY navio, porto, collected_at DESC
)
SELECT COALESCE(json_agg(
    json_build_object(
        'navio',           v.navio,
        'porto',           v.porto,
        'last_seen',       to_char(v.last_seen AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI'),
        'last_volume',     v.last_volume,
        'discharge_month', to_char(
                               COALESCE(v.eta, v.inicio_descarga, v.fim_descarga, v.last_seen)
                                   AT TIME ZONE 'America/Sao_Paulo',
                               'YYYY-MM'
                           )
    ) ORDER BY v.last_seen DESC
), '[]'::json)
FROM vessel_last_row v
WHERE NOT EXISTS (SELECT 1 FROM anchor_set a WHERE a.navio = v.navio AND a.porto = v.porto)
  AND NOT EXISTS (SELECT 1 FROM error_ports ep WHERE ep.porto = v.porto);
$$;

-- ── get_nd_volume_mensal_descarga ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_nd_volume_mensal_descarga(p_collected_at text)
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
WITH
snapshot_ts AS (
    SELECT (p_collected_at::timestamp AT TIME ZONE 'America/Sao_Paulo') AS ts
),
error_ports AS (
    SELECT DISTINCT porto
    FROM public.navios_diesel
    WHERE collected_at = (SELECT ts FROM snapshot_ts)
      AND status = 'ERRO_COLETA'
      AND NOT is_cabotagem
),
anchor_set AS (
    SELECT DISTINCT navio, porto
    FROM public.navios_diesel
    WHERE collected_at = (SELECT ts FROM snapshot_ts)
      AND status NOT IN ('ERRO_COLETA', 'Despachado')
      AND NOT is_cabotagem
),
vessel_last_row AS (
    SELECT DISTINCT ON (navio, porto)
        navio, porto,
        collected_at                        AS last_seen,
        COALESCE(quantidade_convertida, 0)  AS last_volume,
        eta, inicio_descarga, fim_descarga
    FROM public.navios_diesel
    WHERE collected_at <= (SELECT ts FROM snapshot_ts)
      AND status <> 'ERRO_COLETA'
      AND NOT is_cabotagem
    ORDER BY navio, porto, collected_at DESC
),
discharged_by_month AS (
    SELECT
        to_char(v.last_seen AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
        SUM(v.last_volume) AS discharged_volume
    FROM vessel_last_row v
    WHERE NOT EXISTS (SELECT 1 FROM anchor_set a WHERE a.navio = v.navio AND a.porto = v.porto)
      AND NOT EXISTS (SELECT 1 FROM error_ports ep WHERE ep.porto = v.porto)
    GROUP BY 1
),
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
      AND NOT nd.is_cabotagem
    GROUP BY 1
),
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
combined AS (
    SELECT
        COALESCE(d.month, p.month, i.month)   AS month,
        COALESCE(d.discharged_volume, 0)      AS discharged_volume,
        COALESCE(p.pending_volume, 0)         AS pending_volume,
        COALESCE(i.indeterminate_volume, 0)   AS indeterminate_volume
    FROM discharged_by_month d
    FULL OUTER JOIN pending_by_month p ON d.month = p.month
    FULL OUTER JOIN indeterminate_by_month i ON COALESCE(d.month, p.month) = i.month
)
SELECT COALESCE(json_agg(
    json_build_object(
        'month',                month,
        'discharged_volume',    discharged_volume,
        'pending_volume',       pending_volume,
        'indeterminate_volume', indeterminate_volume
    ) ORDER BY month ASC
), '[]'::json)
FROM combined
WHERE pending_volume > 0 OR indeterminate_volume > 0;
$$;

-- ── get_nd_resumo_mensal_portos ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_nd_resumo_mensal_portos(p_collected_at text)
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
WITH
snapshot_ts AS (
    SELECT (p_collected_at::timestamp AT TIME ZONE 'America/Sao_Paulo') AS ts
),
error_ports AS (
    SELECT DISTINCT porto
    FROM public.navios_diesel
    WHERE collected_at = (SELECT ts FROM snapshot_ts)
      AND status = 'ERRO_COLETA'
      AND NOT is_cabotagem
),
anchor_set AS (
    SELECT DISTINCT navio, porto
    FROM public.navios_diesel
    WHERE collected_at = (SELECT ts FROM snapshot_ts)
      AND status NOT IN ('ERRO_COLETA', 'Despachado')
      AND NOT is_cabotagem
),
vessel_last_row AS (
    SELECT DISTINCT ON (navio, porto)
        navio, porto,
        collected_at                        AS last_seen,
        COALESCE(quantidade_convertida, 0)  AS last_volume,
        eta, inicio_descarga, fim_descarga
    FROM public.navios_diesel
    WHERE collected_at <= (SELECT ts FROM snapshot_ts)
      AND status <> 'ERRO_COLETA'
      AND NOT is_cabotagem
    ORDER BY navio, porto, collected_at DESC
),
discharged AS (
    SELECT v.porto,
           to_char(v.last_seen AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
           COUNT(*)::int AS vessels,
           SUM(v.last_volume) AS volume
    FROM vessel_last_row v
    WHERE NOT EXISTS (SELECT 1 FROM anchor_set a WHERE a.navio = v.navio AND a.porto = v.porto)
      AND NOT EXISTS (SELECT 1 FROM error_ports ep WHERE ep.porto = v.porto)
    GROUP BY v.porto, month
),
pending AS (
    SELECT nd.porto,
           to_char(
               COALESCE(nd.eta, nd.inicio_descarga, nd.fim_descarga, nd.collected_at)
                   AT TIME ZONE 'America/Sao_Paulo',
               'YYYY-MM'
           ) AS month,
           COUNT(*)::int AS vessels,
           SUM(COALESCE(nd.quantidade_convertida, 0)) AS volume
    FROM public.navios_diesel nd
    INNER JOIN anchor_set a ON a.navio = nd.navio AND a.porto = nd.porto
    WHERE nd.collected_at = (SELECT ts FROM snapshot_ts)
      AND nd.status NOT IN ('ERRO_COLETA', 'Despachado')
      AND NOT nd.is_cabotagem
    GROUP BY nd.porto, month
),
indeterminate AS (
    SELECT v.porto,
           to_char(
               COALESCE(v.eta, v.inicio_descarga, v.fim_descarga, v.last_seen)
                   AT TIME ZONE 'America/Sao_Paulo',
               'YYYY-MM'
           ) AS month,
           COUNT(*)::int AS vessels,
           SUM(v.last_volume) AS volume
    FROM vessel_last_row v
    INNER JOIN error_ports ep ON ep.porto = v.porto
    GROUP BY v.porto, month
),
active_months AS (
    SELECT DISTINCT month FROM pending
    UNION
    SELECT DISTINCT month FROM indeterminate
),
combined AS (
    SELECT porto, month, vessels, volume FROM discharged WHERE month IN (SELECT month FROM active_months)
    UNION ALL
    SELECT porto, month, vessels, volume FROM pending
    UNION ALL
    SELECT porto, month, vessels, volume FROM indeterminate
)
SELECT COALESCE(json_agg(
    json_build_object(
        'porto',   porto,
        'month',   month,
        'vessels', total_vessels,
        'volume',  total_volume
    ) ORDER BY porto ASC, month ASC
), '[]'::json)
FROM (
    SELECT porto, month,
           SUM(vessels) AS total_vessels,
           SUM(volume)  AS total_volume
    FROM combined
    GROUP BY porto, month
) sub;
$$;
