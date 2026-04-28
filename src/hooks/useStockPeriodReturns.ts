"use client";

import { useState, useEffect, useCallback } from "react";

export interface PeriodReturn {
  symbol: string;
  ytdPct: number | null;
  mtdPct: number | null;
}

export function useStockPeriodReturns(tickers: string[]) {
  const [data, setData] = useState<Map<string, PeriodReturn>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  const tickerKey = tickers.join(",");

  const refetch = useCallback(async () => {
    if (!tickerKey) { setData(new Map()); return; }
    setIsLoading(true);
    try {
      const res = await fetch(`/api/stocks/period-returns?tickers=${encodeURIComponent(tickerKey)}`);
      if (!res.ok) throw new Error("Failed to fetch period returns");
      const json: PeriodReturn[] = await res.json();
      const m = new Map<string, PeriodReturn>();
      for (const r of json) m.set(r.symbol, r);
      setData(m);
    } catch {
      // fail silently — columns will show "—"
    } finally {
      setIsLoading(false);
    }
  }, [tickerKey]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, refetch };
}
