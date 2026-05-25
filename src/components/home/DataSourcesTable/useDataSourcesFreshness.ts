"use client";

// useDataSourcesFreshness — polls get_data_sources_freshness() every 60 seconds.
//
// Returns a Map<source_key, { lastUpdate: Date | null; rowCount: number }>
// so consumers can look up freshness by key in O(1).

import { useState, useEffect, useCallback } from "react";
import { getSupabaseClient } from "../../../lib/supabaseClient";

export interface SourceFreshness {
  lastUpdate: Date | null;
  rowCount: number;
}

export type FreshnessMap = Map<string, SourceFreshness>;

export interface UseDataSourcesFreshnessResult {
  freshness: FreshnessMap;
  loading: boolean;
  lastFetchedAt: Date | null;
}

const REFRESH_INTERVAL_MS = 60_000;

export function useDataSourcesFreshness(): UseDataSourcesFreshnessResult {
  const [freshness, setFreshness] = useState<FreshnessMap>(new Map());
  const [loading, setLoading] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);

  const fetch = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    try {
      const { data, error } = await supabase.rpc("get_data_sources_freshness");
      if (error) {
        console.warn("get_data_sources_freshness error:", error.message);
        return;
      }
      const rows = (data ?? []) as {
        source_key: string;
        last_update: string | null;
        row_count: number;
      }[];
      const map = new Map<string, SourceFreshness>();
      for (const row of rows) {
        map.set(row.source_key, {
          lastUpdate: row.last_update ? new Date(row.last_update) : null,
          rowCount: Number(row.row_count ?? 0),
        });
      }
      setFreshness(map);
      setLastFetchedAt(new Date());
    } catch (e) {
      console.warn("useDataSourcesFreshness fetch failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    const interval = setInterval(fetch, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetch]);

  return { freshness, loading, lastFetchedAt };
}
