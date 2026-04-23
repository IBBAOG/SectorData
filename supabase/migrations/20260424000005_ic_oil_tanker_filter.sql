-- ============================================================================
-- Import candidates — keep oil-focused tankers only.
--
-- The Radar was surfacing vessels whose AIS Destination mentioned a BR port
-- but whose ship type makes them irrelevant for diesel imports: General
-- Cargo, Container, Bulk Carrier, RoRo, etc. A diesel cargo only ships on
-- a liquid-bulk tanker, so everything else is noise.
--
-- Definition of "oil-focused tanker" applied here:
--   * VF `ship_type` contains the word "tanker"
--       (covers "Oil Products Tanker", "Chemical/Oil Products Tanker",
--        "Crude Oil Tanker", "Oil/Chemical Tanker", "Chemical Tanker",
--        generic "Tanker"), MINUS
--     explicitly non-oil cargoes: LNG, LPG, gas, asphalt, bitumen, water.
--   * If VF type is missing, fall back to AIS ship-type code 80–89 (the
--     "Tanker" bucket) — same band already used by the scoring step.
--
-- Two layers of defence (mirrors the cabotage filter):
--   1. `ais_discovery.py` skips non-tankers at ingest
--   2. The RPCs below filter at query time so any row that slipped through
--      (or was inserted before this change) is hidden from the UI
-- ============================================================================

-- Retroactive cleanup of existing non-oil-tanker rows
DELETE FROM public.import_candidates
WHERE NOT (
  CASE
    WHEN ship_type IS NOT NULL THEN
           ship_type ILIKE '%tanker%'
       AND ship_type NOT ILIKE '%lpg%'
       AND ship_type NOT ILIKE '%lng%'
       AND ship_type NOT ILIKE '%gas%'
       AND ship_type NOT ILIKE '%asphalt%'
       AND ship_type NOT ILIKE '%bitumen%'
       AND ship_type NOT ILIKE '%water%'
    ELSE
      ship_type_code BETWEEN 80 AND 89
  END
);

-- Also clean up any orphaned position rows for deleted candidates
DELETE FROM public.candidate_positions cp
WHERE NOT EXISTS (
  SELECT 1 FROM public.import_candidates ic WHERE ic.imo = cp.imo
);


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
      AND (
        CASE
          WHEN ic.ship_type IS NOT NULL THEN
                 ic.ship_type ILIKE '%tanker%'
             AND ic.ship_type NOT ILIKE '%lpg%'
             AND ic.ship_type NOT ILIKE '%lng%'
             AND ic.ship_type NOT ILIKE '%gas%'
             AND ic.ship_type NOT ILIKE '%asphalt%'
             AND ic.ship_type NOT ILIKE '%bitumen%'
             AND ic.ship_type NOT ILIKE '%water%'
          ELSE
            ic.ship_type_code BETWEEN 80 AND 89
        END
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
      AND (
        CASE
          WHEN ship_type IS NOT NULL THEN
                 ship_type ILIKE '%tanker%'
             AND ship_type NOT ILIKE '%lpg%'
             AND ship_type NOT ILIKE '%lng%'
             AND ship_type NOT ILIKE '%gas%'
             AND ship_type NOT ILIKE '%asphalt%'
             AND ship_type NOT ILIKE '%bitumen%'
             AND ship_type NOT ILIKE '%water%'
          ELSE
            ship_type_code BETWEEN 80 AND 89
        END
      )
    GROUP BY destination_slug
  ) x;
$$;


CREATE OR REPLACE FUNCTION public.get_ic_snapshot(p_date text)
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  WITH cutoff AS (
    SELECT ((p_date || ' 23:59:59')::timestamp AT TIME ZONE 'America/Sao_Paulo') AS ts
  ),
  latest_pos AS (
    SELECT DISTINCT ON (cp.imo)
      cp.imo, cp.lat, cp.lon, cp.ts AS pos_ts
    FROM public.candidate_positions cp
    WHERE cp.ts <= (SELECT ts FROM cutoff)
    ORDER BY cp.imo, cp.ts DESC
  )
  SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.eta NULLS LAST, x.confidence_score DESC), '[]'::json) FROM (
    SELECT
      ic.id, ic.imo, ic.mmsi, ic.navio, ic.flag,
      ic.ship_type, ic.ship_type_code, ic.length_m, ic.dwt,
      ic.destination_raw, ic.destination_slug, ic.destination_port_name, ic.eta,
      ic.origin_port_name, ic.origin_locode, ic.origin_country,
      ic.origin_is_product_hub, ic.departure_ts,
      ic.current_draught_m, ic.max_draught_m, ic.is_loaded,
      ic.confidence_score, ic.signals,
      lp.lat      AS last_seen_lat,
      lp.lon      AS last_seen_lon,
      lp.pos_ts   AS last_seen_ts,
      ic.first_seen_at,
      COALESCE(lp.pos_ts, ic.last_seen_at) AS last_seen_at,
      ic.status, ic.in_lineup_since
    FROM public.import_candidates ic
    LEFT JOIN latest_pos lp ON lp.imo = ic.imo
    WHERE ic.first_seen_at <= (SELECT ts FROM cutoff)
      AND NOT (
        UPPER(COALESCE(ic.origin_country, '')) IN ('BRAZIL', 'BRASIL', 'BR')
        OR UPPER(COALESCE(ic.origin_locode,  '')) LIKE 'BR%'
      )
      AND (
        CASE
          WHEN ic.ship_type IS NOT NULL THEN
                 ic.ship_type ILIKE '%tanker%'
             AND ic.ship_type NOT ILIKE '%lpg%'
             AND ic.ship_type NOT ILIKE '%lng%'
             AND ic.ship_type NOT ILIKE '%gas%'
             AND ic.ship_type NOT ILIKE '%asphalt%'
             AND ic.ship_type NOT ILIKE '%bitumen%'
             AND ic.ship_type NOT ILIKE '%water%'
          ELSE
            ic.ship_type_code BETWEEN 80 AND 89
        END
      )
  ) x;
$$;
