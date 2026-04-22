-- ============================================================================
-- Add last-seen AIS position to import_candidates so the Radar page can
-- render a world map with the actual current location of each candidate,
-- not just the origin port centroid.
--
-- AISStream includes lat/lon in the MetaData block of every message type,
-- including ShipStaticData — so `ais_discovery.py` can populate these
-- without needing a separate PositionReport subscription.
-- ============================================================================

ALTER TABLE public.import_candidates
    ADD COLUMN IF NOT EXISTS last_seen_lat double precision,
    ADD COLUMN IF NOT EXISTS last_seen_lon double precision,
    ADD COLUMN IF NOT EXISTS last_seen_ts  timestamptz;

CREATE INDEX IF NOT EXISTS idx_ic_last_seen_ts
    ON public.import_candidates (last_seen_ts DESC);

-- Re-define get_ic_active to include the new position fields
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
  ) x;
$$;
