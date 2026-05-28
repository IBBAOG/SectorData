"use client";

// Live size estimator for the export modal.
//
// Wraps a row-count fetcher with debounce + stale-response cancellation so the
// modal can show "~12.4 MB · 87,200 rows" and refresh as filters change.
//
// Reuses the empirical AVG_BYTES_PER_ROW table from the legacy
// src/lib/exportSizeHeuristics.ts (kept until that file is finally retired).

import { useEffect, useRef, useState } from "react";

import {
  AVG_BYTES_PER_ROW,
  formatBytes,
} from "@/lib/exportSizeHeuristics";

export type SizeEstimatorProps = {
  /** Current filter snapshot (re-fires the count fetch on change). */
  filters: Record<string, unknown>;
  /** Count RPC — called debounced (default 300ms). */
  countRpc: (filters: Record<string, unknown>) => Promise<number>;
  /** Optional dataset key to pick the byte-per-row heuristic. Defaults to "default". */
  datasetKey?: string;
  /** Debounce window in ms (default 300). */
  debounceMs?: number;
  /** Notifies the parent each time a new estimate resolves (e.g. enable/disable Download). */
  onEstimate?: (info: { rows: number; bytes: number }) => void;
};

const NUMBER_FMT = new Intl.NumberFormat("en-US");

export default function SizeEstimator({
  filters,
  countRpc,
  datasetKey = "default",
  debounceMs = 300,
  onEstimate,
}: SizeEstimatorProps): React.ReactElement {
  const [rows, setRows] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);

  // Stable JSON serialization so deep filter changes trigger refetch but
  // referential equality alone (parent re-render) does not.
  const filtersKey = JSON.stringify(filters);

  // Pick the heuristic — fall back to default if dataset is unknown.
  const avg =
    AVG_BYTES_PER_ROW[datasetKey] ?? AVG_BYTES_PER_ROW.default;

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const myId = ++fetchIdRef.current;
      setLoading(true);
      setError(null);
      try {
        const count = await countRpc(filters);
        if (myId !== fetchIdRef.current) return; // stale
        setRows(count);
        onEstimate?.({ rows: count, bytes: count * avg.xlsx });
      } catch (e) {
        if (myId !== fetchIdRef.current) return;
        let msg = "Error estimating size";
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
    const fetchIdRefCurrent = fetchIdRef;
    const timerRefCurrent = timerRef;
    return () => {
      fetchIdRefCurrent.current++;
      if (timerRefCurrent.current) clearTimeout(timerRefCurrent.current);
    };
  }, []);

  if (error) {
    return (
      <div style={{ fontSize: 12, color: "#c0392b" }}>
        Error calculating size: {error}
      </div>
    );
  }

  if (loading || rows === null) {
    return (
      <div style={{ fontSize: 12, color: "#888" }}>Calculating…</div>
    );
  }

  if (rows === 0) {
    return (
      <div style={{ fontSize: 12, color: "#888" }}>
        No rows for the current filters.
      </div>
    );
  }

  return (
    <div style={{ fontSize: 12.5, color: "#444" }}>
      <strong style={{ color: "#1a1a1a" }}>
        ~{NUMBER_FMT.format(rows)} rows
      </strong>
      {" · "}
      <span>
        ~{formatBytes(rows * avg.xlsx)} (Excel)
      </span>
      {" · "}
      <span>~{formatBytes(rows * avg.csv)} (CSV)</span>
    </div>
  );
}
