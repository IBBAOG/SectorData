"use client";

import { useState, useEffect } from "react";
import type { HistoricalDataPoint, TimeRange } from "../types/stocks";

export function useStockHistory(ticker: string, range: TimeRange = "1y", interval = "1d") {
  const [data, setData] = useState<HistoricalDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!ticker) {
      setData([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    fetch(`/api/stocks/history?ticker=${encodeURIComponent(ticker)}&range=${range}&interval=${encodeURIComponent(interval)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed");
        return res.json();
      })
      .then((json: HistoricalDataPoint[]) => {
        if (!cancelled) {
          setData(json.sort((a, b) => a.date - b.date));
        }
      })
      .catch(() => {
        if (!cancelled) setData([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [ticker, range, interval]);

  return { data, isLoading };
}
