-- ============================================================================
-- AIS tracking — expose all recently captured positions (not just matched)
-- so the dashboard can render the live activity produced by the pipeline,
-- even before any monitored vessel in navios_diesel is resolved by name.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_ais_positions_all_recent(p_hours int DEFAULT 24)
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  WITH latest AS (
    SELECT DISTINCT ON (COALESCE(vp.imo, vp.mmsi))
      vp.imo, vp.mmsi, vp.ts, vp.lat, vp.lon,
      vp.sog, vp.cog, vp.nav_status, vp.inside_port
    FROM public.vessel_positions vp
    WHERE vp.ts >= now() - make_interval(hours => p_hours)
    ORDER BY COALESCE(vp.imo, vp.mmsi), vp.ts DESC
  )
  SELECT COALESCE(json_agg(row_to_json(x) ORDER BY x.ts DESC), '[]'::json) FROM (
    SELECT
      COALESCE(vr.name, 'MMSI ' || l.mmsi) AS navio,
      l.imo, l.mmsi,
      l.ts, l.lat, l.lon, l.sog, l.cog, l.nav_status, l.inside_port
    FROM latest l
    LEFT JOIN public.vessel_registry vr
      ON (l.imo IS NOT NULL AND vr.imo = l.imo)
  ) x;
$$;
