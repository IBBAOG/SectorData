"use client";

// ─── useAnpGlpData — the single brain for /anp-glp ───────────────────────────
//
// Owns all Supabase calls, filter state, debounce, derived aggregations.
// Both desktop/View.tsx and mobile/View.tsx consume this hook — neither View
// ever calls Supabase / rpc.ts wrappers directly. Unit conversions live here;
// chart-building helpers are duplicated per View because each View has different
// chart shapes (desktop: line + horizontal bar; mobile: stacked area + top-N list).
//
// Principles (docs/app/anp-glp.md):
//  - 3 fixed categories: P13 / Outros - GLP / Outros - Especiais.
//  - selectedCats minimum 1 always enforced here.
//  - Period pushed server-side via p_ano_inicio / p_ano_fim (debounced 400ms).
//  - topDistCat aggregate is client-side useMemo over serieRows.
//  - Barrel loading only on initial fetch; subsequent refetches use serieLoading.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSupabaseClient } from "@/lib/supabaseClient";
import { useDebouncedFetch } from "@/hooks/useDebouncedFetch";
import { kgToMilTon } from "@/lib/units";
import {
  rpcGetAnpGlpSerie,
  rpcGetAnpGlpFiltros,
  type AnpGlpSerieRow,
  type AnpGlpFiltros,
} from "@/lib/rpc";

// ─── Category constants ───────────────────────────────────────────────────────

export const CATEGORIA_INFO: Record<string, { label: string; color: string }> =
  {
    P13:                  { label: "P13 (13 kg cylinder)", color: "#2196F3" },
    "Outros - GLP":       { label: "Other - LPG",          color: "#4CAF50" },
    "Outros - Especiais": { label: "Other - Special",      color: "#9C27B0" },
  };

export const MAIN_CATEGORIAS = Object.keys(CATEGORIA_INFO) as Array<
  keyof typeof CATEGORIA_INFO
>;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnpGlpFilters {
  /** Indices into allYears array (controlled by the period slider). */
  yearRangeIdx: [number, number];
  /** Which categories are shown in the trend chart. Min 1 always enforced. */
  selectedCats: string[];
  /** Which category drives the Top 15 Distributors ranking. */
  topDistCat: string;
}

export interface TopDistEntry {
  distribuidora: string;
  totalKt: number;      // already converted: kg / 1e6
}

export interface UseAnpGlpData {
  // Raw data from RPC
  serieRows: AnpGlpSerieRow[];

  // All years available (built from filtros)
  allYears: number[];

  // Derived: year range expressed as actual year numbers
  yMin: number | null;
  yMax: number | null;

  // Derived: Top 15 distributors for topDistCat (kt, sorted desc)
  topDist: TopDistEntry[];

  // Loading states
  loading: boolean;         // initial barrel
  serieLoading: boolean;    // inline (debounced refetch)

  // Filters + setters
  filters: AnpGlpFilters;
  setFilters: (next: Partial<AnpGlpFilters>) => void;

  // Stable toggle helpers (min-1 guard included)
  toggleCat: (c: string) => void;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAnpGlpData(): UseAnpGlpData {
  const supabase = getSupabaseClient();

  // ── State ────────────────────────────────────────────────────────────────
  const [loading, setLoading]       = useState(true);
  const [, setFiltros]              = useState<AnpGlpFiltros>({
    distribuidoras: [],
    categorias: [],
    ano_min: null,
    ano_max: null,
  });
  const [serieRows, setSerieRows]   = useState<AnpGlpSerieRow[]>([]);
  const [allYears, setAllYears]     = useState<number[]>([]);

  const [filters, setFiltersState]  = useState<AnpGlpFilters>({
    yearRangeIdx: [0, 0],
    selectedCats: [...MAIN_CATEGORIAS],
    topDistCat: "P13",
  });

  // Guard for stale initial fetch
  const initFetchId = useRef(0);

  // ── Stable setFilters ─────────────────────────────────────────────────────
  const setFilters = useCallback((next: Partial<AnpGlpFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...next }));
  }, []);

  // ── toggleCat (min-1 guard) ───────────────────────────────────────────────
  const toggleCat = useCallback((c: string) => {
    setFiltersState((prev) => {
      const { selectedCats } = prev;
      if (selectedCats.includes(c)) {
        if (selectedCats.length <= 1) return prev; // min-1 guard
        return { ...prev, selectedCats: selectedCats.filter((x) => x !== c) };
      }
      return { ...prev, selectedCats: [...selectedCats, c] };
    });
  }, []);

  // ── Initial load: filtros → first serie fetch (last 10 years) ────────────
  useEffect(() => {
    if (!supabase) return;
    const id = ++initFetchId.current;

    (async () => {
      const f = await rpcGetAnpGlpFiltros(supabase);
      if (id !== initFetchId.current) return;
      setFiltros(f);

      const yMin = f.ano_min ?? new Date().getFullYear() - 10;
      const yMax = f.ano_max ?? new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMin; y <= yMax; y++) years.push(y);

      const startIdx = Math.max(0, years.findIndex((y) => y >= yMax - 9));
      const fromYear = years[startIdx] ?? yMin;

      setAllYears(years);
      setFilters({ yearRangeIdx: [startIdx, years.length - 1] });

      const rows = await rpcGetAnpGlpSerie(supabase, {
        anoInicio: fromYear,
        anoFim: yMax,
      });

      if (id !== initFetchId.current) return;
      setSerieRows(rows);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  // ── Debounced refetch on period slider change ─────────────────────────────
  const { data: refetched, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      const [i0, i1] = filters.yearRangeIdx;
      return rpcGetAnpGlpSerie(supabase, {
        anoInicio: allYears[i0] ?? null,
        anoFim: allYears[i1] ?? null,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supabase, loading, filters.yearRangeIdx[0], filters.yearRangeIdx[1], allYears],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) setSerieRows(refetched);
  }, [refetched]);

  // ── Derived: actual year labels ───────────────────────────────────────────
  const hasYears = allYears.length > 0;
  const yMin = hasYears ? (allYears[filters.yearRangeIdx[0]] ?? null) : null;
  const yMax = hasYears ? (allYears[filters.yearRangeIdx[1]] ?? null) : null;

  // ── Derived: Top 15 Distributors for topDistCat ───────────────────────────
  const topDist = useMemo<TopDistEntry[]>(() => {
    const cat = filters.topDistCat;
    const byDist: Record<string, number> = {};
    for (const r of serieRows) {
      if (r.categoria !== cat) continue;
      byDist[r.distribuidora] = (byDist[r.distribuidora] ?? 0) + (r.vendas_kg ?? 0);
    }
    return Object.entries(byDist)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([distribuidora, kg]) => ({
        distribuidora,
        totalKt: kgToMilTon(kg),
      }));
  }, [serieRows, filters.topDistCat]);

  return {
    serieRows,
    allYears,
    yMin,
    yMax,
    topDist,
    loading,
    serieLoading,
    filters,
    setFilters,
    toggleCat,
  };
}
