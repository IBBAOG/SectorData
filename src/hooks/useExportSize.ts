// Real-time size estimate for export operations.
//
// Wraps a count-fetcher (typically a `count: 'exact', head: true` Supabase
// query, or a dedicated RPC like `get_<dataset>_count`) with debounce + stale
// response cancellation so the modal can show "~12.4 MB · 87 200 linhas" and
// update live as the user tweaks filters.
//
// Contract:
// - `fetcher(filters)` returns a row count.
// - `datasetKey` selects the heuristic in `AVG_BYTES_PER_ROW`.
// - Debounce defaults to 300ms.
//
// Returns `{ estimate, loading, error }`. `estimate` is null until the first
// fetch resolves. Stale results (from a previous filter snapshot) are dropped.

"use client";

import { useEffect, useRef, useState } from "react";
import { estimateSize, type ExportSizeEstimate } from "@/lib/exportSizeHeuristics";

export type UseExportSizeResult = {
  estimate: ExportSizeEstimate | null;
  loading: boolean;
  error: string | null;
};

export function useExportSize<F>(
  filters: F,
  fetcher: (f: F) => Promise<number>,
  datasetKey: string,
  debounceMs = 300,
): UseExportSizeResult {
  const [estimate, setEstimate] = useState<ExportSizeEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);

  // Stable JSON serialization so deep filter changes trigger refetch but
  // referential equality alone (e.g. parent re-render) does not.
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const myId = ++fetchIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const count = await fetcher(filters);
        if (myId !== fetchIdRef.current) return; // stale
        setEstimate(estimateSize(count, datasetKey));
      } catch (e) {
        if (myId !== fetchIdRef.current) return;
        // Supabase RPC errors are plain `PostgrestError` objects (not Error
        // instances) but expose a `.message` field. Extract whatever message
        // we can find, otherwise fall back to a generic label.
        let msg = "Erro ao estimar tamanho";
        if (e instanceof Error) {
          msg = e.message;
        } else if (e && typeof e === "object" && "message" in e) {
          const m = (e as { message?: unknown }).message;
          if (typeof m === "string" && m.length > 0) msg = m;
        }
        setError(msg);
      } finally {
        if (myId === fetchIdRef.current) setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, datasetKey, debounceMs]);

  // Invalidate any in-flight fetch when the component unmounts.
  useEffect(() => {
    return () => {
      fetchIdRef.current++;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { estimate, loading, error };
}
