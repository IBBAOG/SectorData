"use client";

import { useState, useEffect, useCallback } from "react";
import type { StockQuote } from "../types/stocks";

export function useStockQuote(tickers: string[]) {
  const [data, setData] = useState<StockQuote[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Serialize tickers to stable string to avoid infinite re-render
  const tickerKey = tickers.join(",");

  const refetch = useCallback(async () => {
    if (!tickerKey) {
      setData([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stocks/quote?tickers=${encodeURIComponent(tickerKey)}`);
      if (!res.ok) throw new Error("Failed to fetch quotes");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [tickerKey]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}
