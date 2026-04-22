-- ============================================================================
-- Filter cabotage (domestic coastal shipping) vessels from the line-up.
-- The dashboard must show *import* diesel volumes only, so any vessel that
-- is Brazilian-flagged or whose previous port is a Brazilian port is
-- excluded from all user-facing RPCs.
--
-- Primary signal: vessel flag (captured by vessel_lookup.py from VesselFinder
-- search results). Fallback: origem column ending in "-BRA" (Suape already
-- filters this at scrape time; here it catches any stragglers).
-- ============================================================================

-- 1. Add `flag` column and backfill from vessel_registry where we already know it
ALTER TABLE public.navios_diesel ADD COLUMN IF NOT EXISTS flag text;

UPDATE public.navios_diesel nd
SET    flag = vr.flag
FROM   public.vessel_registry vr
WHERE  nd.imo = vr.imo AND nd.flag IS NULL AND vr.flag IS NOT NULL;

-- 2. Generated column `is_cabotagem` — computed once, filterable via index
ALTER TABLE public.navios_diesel ADD COLUMN IF NOT EXISTS is_cabotagem boolean
  GENERATED ALWAYS AS (
    UPPER(COALESCE(flag, '')) IN ('BRAZIL', 'BRASIL', 'BR')
    OR UPPER(COALESCE(origem, '')) LIKE '%-BRA'
    OR UPPER(COALESCE(origem, '')) LIKE '%BRASIL%'
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_nd_cabotagem
  ON public.navios_diesel (is_cabotagem) WHERE is_cabotagem = false;

-- 3. Patch every user-facing RPC to exclude cabotage. Each was previously
-- defined in its own migration; we redefine them here with an added filter.

-- ── get_nd_ultima_coleta ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_nd_ultima_coleta()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  SELECT json_build_object(
    'ultima_coleta',
    to_char(MAX(collected_at) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS')
  )
  FROM public.navios_diesel
  WHERE NOT is_cabotagem;
$$;

-- ── get_nd_coletas_distintas ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_nd_coletas_distintas()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(json_agg(ts ORDER BY ts DESC), '[]'::json)
  FROM (
    SELECT DISTINCT
      to_char(collected_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS') AS ts
    FROM public.navios_diesel
    WHERE NOT is_cabotagem
  ) sub;
$$;

-- ── get_nd_navios ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_nd_navios(p_collected_at text)
RETURNS SETOF public.navios_diesel LANGUAGE sql SECURITY DEFINER AS $$
  SELECT * FROM public.navios_diesel
  WHERE collected_at = (p_collected_at::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND NOT is_cabotagem
  ORDER BY porto, status, navio;
$$;

-- ── get_nd_resumo_portos ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_nd_resumo_portos(p_collected_at text)
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(json_agg(row_to_json(sub)), '[]'::json)
  FROM (
    SELECT
      porto,
      COUNT(*)::int                              AS total_navios,
      COALESCE(SUM(quantidade), 0)               AS total_quantidade,
      COALESCE(SUM(quantidade_convertida), 0)    AS total_convertida
    FROM public.navios_diesel
    WHERE collected_at = (p_collected_at::timestamp AT TIME ZONE 'America/Sao_Paulo')
      AND NOT is_cabotagem
    GROUP BY porto
    ORDER BY total_navios DESC
  ) sub;
$$;

-- ── get_nd_unresolved (re-definition to add NOT is_cabotagem) ────────────────
CREATE OR REPLACE FUNCTION public.get_nd_unresolved(p_collected_at timestamptz)
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(json_agg(navio ORDER BY navio), '[]'::json)
  FROM (
    SELECT DISTINCT navio
    FROM public.navios_diesel
    WHERE collected_at = p_collected_at
      AND status NOT IN ('Despachado', 'ERRO_COLETA')
      AND imo IS NULL
      AND mmsi IS NULL
      AND NOT is_cabotagem
  ) x;
$$;

-- ── get_nd_volume_mensal_descarga (v4 + cabotage filter) ─────────────────────
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
      AND status <> 'ERRO_COLETA'
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

-- ── get_nd_navios_descarregados (+ cabotage filter) ──────────────────────────
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
    SELECT DISTINCT navio, porto
    FROM public.navios_diesel
    WHERE collected_at = (SELECT ts FROM snapshot_ts)
      AND status <> 'ERRO_COLETA'
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

-- ── get_nd_resumo_mensal_portos (+ cabotage filter) ──────────────────────────
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
      AND status <> 'ERRO_COLETA'
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

-- ── get_ais_positions_latest (+ cabotage filter on navios input) ─────────────
CREATE OR REPLACE FUNCTION public.get_ais_positions_latest(p_collected_at timestamptz)
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  WITH navios AS (
    SELECT DISTINCT navio, imo, mmsi
    FROM public.navios_diesel
    WHERE collected_at = p_collected_at
      AND NOT is_cabotagem
  ),
  resolved AS (
    SELECT n.navio,
           COALESCE(n.imo, r.imo)   AS imo,
           COALESCE(n.mmsi, r.mmsi) AS mmsi
    FROM navios n
    LEFT JOIN public.vessel_registry r
      ON r.name_norm = upper(regexp_replace(n.navio, '[^A-Za-z0-9]', '', 'g'))
  ),
  latest AS (
    SELECT DISTINCT ON (vp.imo, vp.mmsi)
      vp.imo, vp.mmsi, vp.ts, vp.lat, vp.lon, vp.sog, vp.cog, vp.nav_status, vp.inside_port
    FROM public.vessel_positions vp
    WHERE vp.ts >= now() - interval '7 days'
    ORDER BY vp.imo, vp.mmsi, vp.ts DESC
  )
  SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json) FROM (
    SELECT r.navio, r.imo, r.mmsi,
           l.ts, l.lat, l.lon, l.sog, l.cog, l.nav_status, l.inside_port
    FROM resolved r
    LEFT JOIN latest l
      ON (r.imo IS NOT NULL AND l.imo = r.imo)
      OR (r.imo IS NULL AND r.mmsi IS NOT NULL AND l.mmsi = r.mmsi)
    WHERE l.lat IS NOT NULL
  ) x;
$$;
