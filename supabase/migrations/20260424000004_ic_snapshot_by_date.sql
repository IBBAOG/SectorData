-- ============================================================================
-- Historical snapshot RPCs for the Diesel Imports Radar.
--
-- Previously the page only showed the LATEST state of every candidate. Users
-- want to scrub back through time — pick a calendar day and see which
-- vessels were already on the radar then, and where they were positioned.
--
-- State fidelity caveat: import_candidates rows are upserted per run, so we
-- can only reconstruct *which* vessels existed on date X (via first_seen_at
-- <= X) and their historical *position* (via candidate_positions). Signals,
-- ETA, destination and status shown on the snapshot come from the current
-- row — we don't track full per-field history.
-- ============================================================================

-- Distinct calendar days (YYYY-MM-DD, BRT) with any radar activity
CREATE OR REPLACE FUNCTION public.get_ic_distinct_dates()
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(json_agg(dt ORDER BY dt DESC), '[]'::json) FROM (
    SELECT DISTINCT to_char(ts AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dt
    FROM public.candidate_positions
    UNION
    SELECT DISTINCT to_char(first_seen_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dt
    FROM public.import_candidates
    WHERE first_seen_at IS NOT NULL
    UNION
    SELECT DISTINCT to_char(last_seen_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dt
    FROM public.import_candidates
    WHERE last_seen_at IS NOT NULL
  ) x
  WHERE dt IS NOT NULL;
$$;

-- Full snapshot as of the END of a given day (BRT).
-- `p_date` is 'YYYY-MM-DD' — we clamp to 23:59:59 on that day in BRT.
-- Position per vessel is the most-recent candidate_positions row on or before
-- end-of-day. Other fields come from import_candidates as-is.
-- Cabotage is filtered the same way as get_ic_active.
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
  ) x;
$$;
