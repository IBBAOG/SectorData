"use client";

// Single shared data brain for /anp-ppi (dual-view: desktop + mobile).
//
// Rules:
//   • All Supabase RPC calls live here — Views never import rpc.ts directly.
//   • get_anp_ppi_media_serie is fetched ONCE on mount (one-shot). Product and
//     period filtering on the national-average chart is client-side via useMemo.
//   • get_anp_ppi_locais_serie is debounced (400ms) on detailProduto / yearRange.
//   • Minimum 1 product selected is enforced here: toggleProduto guards the
//     invariant so Views never have to think about it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetAnpPpiMediaSerie,
  rpcGetAnpPpiLocaisSerie,
  rpcGetAnpPpiFiltros,
  type AnpPpiSerieRow,
  type AnpPpiLocaisRow,
} from "@/lib/rpc";
import { useDebouncedFetch } from "@/hooks/useDebouncedFetch";

// ── Constants ─────────────────────────────────────────────────────────────────

export const PRODUTO_INFO: Record<string, { label: string; color: string; unidade: string }> = {
  "Gasolina A Comum": { label: "Regular Gasoline A", color: "#FF5000", unidade: "R$/liter" },
  "Diesel A S10":     { label: "Diesel A S10",       color: "#2196F3", unidade: "R$/liter" },
  "QAV":              { label: "Jet Fuel",           color: "#8BC34A", unidade: "R$/liter" },
  "GLP":              { label: "LPG",                color: "#FF9800", unidade: "R$/13kg"  },
};

export const ALL_PRODUTOS = Object.keys(PRODUTO_INFO);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AnpPpiFilters {
  /** Products selected for the national-average chart (always ≥1). */
  selectedProdutos: string[];
  /** Year range indices into allYears (client-side period). */
  yearRange: [number, number];
  /** Product selected for the per-location detail chart. */
  detailProduto: string;
}

export interface UseAnpPpiData {
  // Raw series
  allSerie:  AnpPpiSerieRow[];
  locaisRows: AnpPpiLocaisRow[];

  // Derived
  allYears: number[];

  // Loading states
  loading:       boolean; // initial load
  locaisLoading: boolean; // debounced locais refetch
  error: Error | null;

  // Export loading
  excelLoading: boolean;
  setExcelLoading: (v: boolean) => void;

  // Filters
  filters: AnpPpiFilters;
  setFilters: (next: Partial<AnpPpiFilters>) => void;
  /** Enforces min-1 invariant. */
  toggleProduto: (p: string) => void;

  // Convenience: resolved year bounds
  yMin: number | null;
  yMax: number | null;
  hasYears: boolean;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const DEFAULT_FILTERS: AnpPpiFilters = {
  selectedProdutos: ALL_PRODUTOS,
  yearRange: [0, 0],
  detailProduto: "Gasolina A Comum",
};

export function useAnpPpiData(): UseAnpPpiData {
  const supabase = getSupabaseClient();

  const [loading, setLoading]         = useState(true);
  const [allSerie, setAllSerie]       = useState<AnpPpiSerieRow[]>([]);
  const [allYears, setAllYears]       = useState<number[]>([]);
  const [locaisRows, setLocaisRows]   = useState<AnpPpiLocaisRow[]>([]);
  const [error, setError]             = useState<Error | null>(null);
  const [excelLoading, setExcelLoading] = useState(false);

  const [filters, setFiltersState] = useState<AnpPpiFilters>(DEFAULT_FILTERS);

  const setFilters = useCallback((next: Partial<AnpPpiFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...next }));
  }, []);

  // Enforce min-1 product selected
  const toggleProduto = useCallback((p: string) => {
    setFiltersState((prev) => {
      const { selectedProdutos } = prev;
      if (selectedProdutos.includes(p)) {
        if (selectedProdutos.length <= 1) return prev; // guard: keep at least 1
        return { ...prev, selectedProdutos: selectedProdutos.filter((x) => x !== p) };
      }
      return { ...prev, selectedProdutos: [...selectedProdutos, p] };
    });
  }, []);

  // ── One-shot mount fetch ──────────────────────────────────────────────────
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!supabase || mountedRef.current) return;
    mountedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const [, serie] = await Promise.all([
          rpcGetAnpPpiFiltros(supabase),
          rpcGetAnpPpiMediaSerie(supabase),
        ]);
        if (cancelled) return;

        const years = Array.from(
          new Set(serie.map((r) => parseInt(r.data_fim.slice(0, 4))))
        ).sort((a, b) => a - b);

        setAllYears(years);
        if (years.length > 0) {
          const currentYear = new Date().getFullYear();
          const startIdx = Math.max(0, years.findIndex((y) => y >= currentYear - 9));
          setFilters({ yearRange: [startIdx, years.length - 1] });
        }
        setAllSerie(serie);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  // ── Debounced locais fetch (400ms) ────────────────────────────────────────
  const { data: refetched, loading: locaisLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading || !filters.detailProduto) return null;
      const yMin = allYears[filters.yearRange[0]];
      const yMax = allYears[filters.yearRange[1]];
      return rpcGetAnpPpiLocaisSerie(supabase, filters.detailProduto, {
        dataInicio: yMin ? `${yMin}-01-01` : null,
        dataFim:    yMax ? `${yMax}-12-31` : null,
      });
    },
    [supabase, loading, filters.detailProduto, filters.yearRange[0], filters.yearRange[1], allYears],
    { ms: 400, skipInitial: false },
  );

  useEffect(() => {
    if (refetched) setLocaisRows(refetched);
  }, [refetched]);

  // ── Derived values ────────────────────────────────────────────────────────
  const hasYears = allYears.length > 0;
  const yMin = hasYears ? allYears[filters.yearRange[0]] : null;
  const yMax = hasYears ? allYears[filters.yearRange[1]] : null;

  return useMemo(() => ({
    allSerie,
    locaisRows,
    allYears,
    loading,
    locaisLoading,
    error,
    excelLoading,
    setExcelLoading,
    filters,
    setFilters,
    toggleProduto,
    yMin,
    yMax,
    hasYears,
  }), [
    allSerie, locaisRows, allYears,
    loading, locaisLoading, error,
    excelLoading, setExcelLoading,
    filters, setFilters, toggleProduto,
    yMin, yMax, hasYears,
  ]);
}
