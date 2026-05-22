"use client";

import { useState, useEffect, useCallback } from "react";
import { getSupabaseClient } from "../lib/supabaseClient";
import { useUserProfile } from "../context/UserProfileContext";
import type { StockPortfolio, PortfolioGroup } from "../types/stocks";

function flattenGroups(groups: PortfolioGroup[]): string[] {
  return groups.flatMap((g) => g.tickers);
}

/**
 * Loads the current user's portfolios from `stock_portfolios`.
 *
 * Three tiers (resolved via `useUserProfile().role`):
 *
 *   - Admin / Client (authenticated)
 *       Query `WHERE user_id = auth.uid()` via PostgREST.
 *       Full CRUD (create / update / delete / setActive).
 *
 *   - Anon (visitor, no session)
 *       Query `WHERE is_public = TRUE` — returns the seeded public
 *       "Brazilian Oil & Gas (default)" portfolio (and any others
 *       an admin later marks public). All mutating callbacks become
 *       no-ops, and `readOnly` is `true` so the UI can hide CRUD
 *       controls.
 *
 * The `is_public` column and the anon SELECT policy come from
 * migration `20260522000001_anonymous_access.sql` (Phase A).
 */
export function useStockPortfolios() {
  const supabase = getSupabaseClient();
  // `role` is supplied by the Phase B `UserProfileContext` rewrite. It
  // resolves to "Admin" | "Client" | "Anon". Until that frontend infra is
  // merged, TypeScript may not know about the field — that's expected.
  //
  // `loading` is also pulled here so we can gate the initial fetch on the
  // profile/session resolving. Without this gate, the hook would fire the
  // anon `is_public` query during the brief window where `role` defaults to
  // "Anon", then fire the authed query once the session resolves — wasting
  // an RPC and flashing the public portfolio at authenticated users.
  const { profile, role, loading } = useUserProfile();
  const userId = profile?.id;
  const isAnon = role === "Anon";
  const readOnly = isAnon;

  const [portfolios, setPortfolios] = useState<StockPortfolio[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    // Wait until the session/profile resolves before deciding which branch
    // (anon `is_public` vs authed `user_id = auth.uid()`) to query. Keeps
    // `isLoading` true during the gap so the UI shows the spinner rather
    // than a momentary "empty" or wrong-tier state.
    if (loading) return;
    setIsLoading(true);

    if (isAnon) {
      // Anon path — fetch all public portfolios. RLS policy
      // "anon and authed read public portfolios" allows this.
      const { data, error } = await supabase
        .from("stock_portfolios")
        .select("*")
        .eq("is_public", true)
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
      return;
    }

    if (!userId) {
      // Authenticated user object not loaded yet — wait for next refresh.
      setIsLoading(false);
      return;
    }

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
  }, [supabase, userId, isAnon, loading]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const activePortfolio =
    portfolios.find((p) => p.is_active) ?? portfolios[0] ?? null;

  const createPortfolio = useCallback(
    async (name: string, groups: PortfolioGroup[]) => {
      if (readOnly || !supabase || !userId) return;
      await supabase.from("stock_portfolios").insert({
        user_id: userId,
        name,
        groups,
        tickers: flattenGroups(groups),
        is_active: portfolios.length === 0,
      });
      await refresh();
    },
    [readOnly, supabase, userId, portfolios.length, refresh],
  );

  const updatePortfolio = useCallback(
    async (id: string, updates: { name?: string; groups?: PortfolioGroup[] }) => {
      if (readOnly || !supabase) return;
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
    [readOnly, supabase, refresh],
  );

  const deletePortfolio = useCallback(
    async (id: string) => {
      if (readOnly || !supabase) return;
      await supabase.from("stock_portfolios").delete().eq("id", id);
      await refresh();
    },
    [readOnly, supabase, refresh],
  );

  const setActivePortfolio = useCallback(
    async (id: string) => {
      if (readOnly || !supabase || !userId) return;
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
    [readOnly, supabase, userId, refresh],
  );

  return {
    portfolios,
    activePortfolio,
    isLoading,
    readOnly,
    createPortfolio,
    updatePortfolio,
    deletePortfolio,
    setActivePortfolio,
    refresh,
  };
}
