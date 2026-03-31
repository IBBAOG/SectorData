"use client";

import { useState, useEffect, useCallback } from "react";
import { getSupabaseClient } from "../lib/supabaseClient";
import { useUserProfile } from "../context/UserProfileContext";
import type { StockPortfolio, PortfolioGroup } from "../types/stocks";

function flattenGroups(groups: PortfolioGroup[]): string[] {
  return groups.flatMap((g) => g.tickers);
}

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

    if (!error && data) {
      setPortfolios(
        data.map((row: StockPortfolio) => ({
          ...row,
          groups: Array.isArray(row.groups) ? row.groups : [],
        })),
      );
    }
    setIsLoading(false);
  }, [supabase, userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activePortfolio = portfolios.find((p) => p.is_active) ?? portfolios[0] ?? null;

  const createPortfolio = useCallback(
    async (name: string, groups: PortfolioGroup[]) => {
      if (!supabase || !userId) return;
      await supabase.from("stock_portfolios").insert({
        user_id: userId,
        name,
        groups,
        tickers: flattenGroups(groups),
        is_active: portfolios.length === 0,
      });
      await refresh();
    },
    [supabase, userId, portfolios.length, refresh],
  );

  const updatePortfolio = useCallback(
    async (id: string, updates: { name?: string; groups?: PortfolioGroup[] }) => {
      if (!supabase) return;
      const payload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.groups !== undefined) {
        payload.groups = updates.groups;
        payload.tickers = flattenGroups(updates.groups);
      }
      await supabase
        .from("stock_portfolios")
        .update(payload)
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
