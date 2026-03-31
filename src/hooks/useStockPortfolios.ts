"use client";

import { useState, useEffect, useCallback } from "react";
import { getSupabaseClient } from "../lib/supabaseClient";
import { useUserProfile } from "../context/UserProfileContext";
import type { StockPortfolio } from "../types/stocks";

export function useStockPortfolios() {
  const supabase = getSupabaseClient();
  const { profile } = useUserProfile();
  const userId = profile?.id;

  const [portfolios, setPortfolios] = useState<StockPortfolio[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase || !userId) return;
    setIsLoading(true);
    const { data, error } = await supabase
      .from("stock_portfolios")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (!error && data) setPortfolios(data);
    setIsLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activePortfolio = portfolios.find((p) => p.is_active) ?? portfolios[0] ?? null;

  const createPortfolio = useCallback(
    async (name: string, tickers: string[]) => {
      if (!supabase || !userId) return;
      await supabase.from("stock_portfolios").insert({
        user_id: userId,
        name,
        tickers,
        is_active: portfolios.length === 0,
      });
      await refresh();
    },
    [supabase, userId, portfolios.length, refresh],
  );

  const updatePortfolio = useCallback(
    async (id: string, updates: { name?: string; tickers?: string[] }) => {
      if (!supabase) return;
      await supabase
        .from("stock_portfolios")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id);
      await refresh();
    },
    [supabase, refresh],
  );

  const deletePortfolio = useCallback(
    async (id: string) => {
      if (!supabase) return;
      await supabase.from("stock_portfolios").delete().eq("id", id);
      await refresh();
    },
    [supabase, refresh],
  );

  const setActivePortfolio = useCallback(
    async (id: string) => {
      if (!supabase || !userId) return;
      // Deactivate all, then activate the chosen one
      await supabase
        .from("stock_portfolios")
        .update({ is_active: false })
        .eq("user_id", userId);
      await supabase
        .from("stock_portfolios")
        .update({ is_active: true })
        .eq("id", id);
      await refresh();
    },
    [supabase, userId, refresh],
  );

  return {
    portfolios,
    activePortfolio,
    isLoading,
    createPortfolio,
    updatePortfolio,
    deletePortfolio,
    setActivePortfolio,
    refresh,
  };
}
