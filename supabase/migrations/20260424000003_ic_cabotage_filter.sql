-- ============================================================================
-- Import candidates — filter out cabotage.
--
-- A vessel whose last port is Brazilian and whose next destination is also a
-- Brazilian port is doing domestic coastal shipping, not importing. The
-- Radar dashboard must show imports only.
--
-- Two layers of defence:
--   1. `ais_discovery.py` skips cabotage at ingest (won't insert new rows)
--   2. The RPCs below also filter at query time, so any row that slipped
--      through (or was inserted before this change) is hidden from the UI
-- ============================================================================

-- Retroactive cleanup of existing cabotage rows
DELETE FROM public.import_candidates
WHERE UPPER(COALESCE(origin_country, '')) IN ('BRAZIL', 'BRASIL', 'BR')
   OR UPPER(COALESCE(origin_locode,  '')) LIKE 'BR%';

-- Shared predicate used by every user-facing RPC below
-- (can't use a function in a generated column reliably, so inline it)

CREATE OR REPLACE FUNCTION public.get_ic_active()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.eta NULLS LAST, x.confidence_score DESC), '[]'::json) FROM (
    SELECT
      ic.id, ic.imo, ic.mmsi, ic.navio, ic.flag,
      ic.ship_type, ic.ship_type_code, ic.length_m, ic.dwt,
      ic.destination_raw, ic.destination_slug, ic.destination_port_name, ic.eta,
      ic.origin_port_name, ic.origin_locode, ic.origin_country,
      ic.origin_is_product_hub, ic.departure_ts,
      ic.current_draught_m, ic.max_draught_m, ic.is_loaded,
      ic.confidence_score, ic.signals,
      ic.last_seen_lat, ic.last_seen_lon, ic.last_seen_ts,
      ic.first_seen_at, ic.last_seen_at, ic.status, ic.in_lineup_since
    FROM public.import_candidates ic
    WHERE ic.status IN ('active', 'in_lineup')
      AND NOT (
        UPPER(COALESCE(ic.origin_country, '')) IN ('BRAZIL', 'BRASIL', 'BR')
        OR UPPER(COALESCE(ic.origin_locode,  '')) LIKE 'BR%'
      )
  ) x;
$$;

CREATE OR REPLACE FUNCTION public.get_ic_summary()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.destination_slug), '[]'::json) FROM (
    SELECT
      destination_slug,
      COUNT(*)::int AS candidates,
      COUNT(*) FILTER (WHERE status = 'in_lineup')::int AS in_lineup,
      COUNT(*) FILTER (WHERE status = 'active')::int AS active_only,
      ROUND(AVG(confidence_score))::int AS avg_confidence,
      SUM(dwt)::bigint AS total_dwt
    FROM public.import_candidates
    WHERE status IN ('active', 'in_lineup')
      AND destination_slug IS NOT NULL
      AND NOT (
        UPPER(COALESCE(origin_country, '')) IN ('BRAZIL', 'BRASIL', 'BR')
        OR UPPER(COALESCE(origin_locode,  '')) LIKE 'BR%'
      )
    GROUP BY destination_slug
  ) x;
$$;
