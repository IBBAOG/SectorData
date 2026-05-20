"use client";

// ─── useAnpPainelImpData — the single brain for /anp-painel-importacoes ──────
//
// Owns all Supabase calls (the 3 anp_painel_imp RPCs), filter state, debounce,
// derived aggregations. Both desktop/View.tsx and mobile/View.tsx consume this
// hook — neither View ever calls Supabase / rpc.ts wrappers directly.
//
// Principles (docs/app/anp-painel-importacoes.md):
//  - All data via RPC (get_anp_painel_imp_filtros / _serie / _top_dist).
//  - At least 1 product selected at all times.
//  - Period pushed server-side via p_ano_inicio / p_ano_fim (debounced 400ms).
//  - Product filter for the line chart is applied client-side via useMemo
//    (no refetch — re-render only).
//  - Top distributors is a server-side refetch on product OR period change
//    (also debounced 400ms).
//  - Paginated wrapper (1000 rows/page) used because the source table
//    can grow if ANP releases retroactive months.
//
// Unit policy:
//   Source: volume_m3 (cubic meters).
//   UI:     mil m³ (thousand cubic meters). Conversion m³ / 1e3.
//   The hook stores raw m³ in serieRows / topRows; Views perform the
//   m3ToMilM3() conversion (preserves precision and lets export rows stay raw).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDebouncedFetch } from "@/hooks/useDebouncedFetch";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetAnpPainelImpSerie,
  rpcGetAnpPainelImpTopDist,
  rpcGetAnpPainelImpFiltros,
  type AnpPainelImpSerieRow,
  type AnpPainelImpTopDistRow,
  type AnpPainelImpFiltros,
} from "@/lib/rpc";

// ─── Constants (exported so both Views share the same palette) ───────────────

/**
 * Palette rotation used for product series lines. Matches the 16-color
 * palette declared in docs/app/anp-painel-importacoes.md (Charts esperados).
 * Imported from plotlyDefaults to keep the brand-shared rotation source.
 */
export { PALETTE } from "@/lib/plotlyDefaults";

/**
 * Solid color used by the Top Distributors horizontal bar chart on both
 * desktop and mobile Views. Locked by the sub-PRD ("Cor única `#1E88E5`").
 */
export const TOP_DIST_COLOR = "#1E88E5";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnpPainelImpFiltersState {
  /** Indices into allYears (controlled by the period slider). */
  yearRangeIdx: [number, number];
  /** Products selected for the series chart (min 1). Default = all. */
  selectedProdutos: string[];
  /** Product selected for the Top Distributors chart (single). */
  topProduto: string;
  /**
   * UFs (Brazilian states) selected for the series RPC.
   * Empty array = no filter (server returns all UFs aggregated).
   * Consumed only by the mobile View today; desktop leaves this empty.
   */
  selectedUfs: string[];
  /**
   * Distributor names selected (client-side filter applied to the Top
   * Distributors ranking — RPC contract does not accept p_distribuidores,
   * so this filter is enforced after the RPC returns).
   * Empty array = no filter (show every distributor returned).
   * Consumed only by the mobile View today.
   */
  selectedDistribuidores: string[];
}

export interface TopDistributorEntry {
  /** Distributor name (original casing from ANP feed). */
  distribuidor: string;
  /** Total volume in mil m³ (already converted) for the selected period. */
  totalMilM3: number;
}

export interface UseAnpPainelImpData {
  // Raw filtros + data
  filtros: AnpPainelImpFiltros;
  serieRows: AnpPainelImpSerieRow[];
  topRows: AnpPainelImpTopDistRow[];

  // All years (built from filtros.ano_min/ano_max)
  allYears: number[];

  // Derived: actual year range from indices
  yMin: number | null;
  yMax: number | null;
  hasYears: boolean;
  hasData: boolean;

  // Loading flags
  loading: boolean;        // initial barrel
  serieLoading: boolean;   // inline (debounced serie refetch)
  topLoading: boolean;     // inline (debounced top-distributors refetch)

  // Filter state + setters
  filters: AnpPainelImpFiltersState;
  setFilters: (next: Partial<AnpPainelImpFiltersState>) => void;
  toggleProduto: (p: string) => void;
  resetProdutos: () => void;

  // Derived: Top distributors ranking, sorted desc, converted to mil m³
  topDistributors: TopDistributorEntry[];

  // Filtered serie rows by selected products (client-side useMemo)
  filteredSerieRows: AnpPainelImpSerieRow[];

  // Export-ready rows (already period-filtered by RPC; products applied here)
  exportRows: AnpPainelImpSerieRow[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const DEFAULT_FILTROS: AnpPainelImpFiltros = {
  produtos:       [],
  ufs:            [],
  distribuidores: [],
  ano_min:        null,
  ano_max:        null,
};

export function useAnpPainelImpData(): UseAnpPainelImpData {
  const supabase = getSupabaseClient();

  const [loading, setLoading]     = useState(true);
  const [filtros, setFiltros]     = useState<AnpPainelImpFiltros>(DEFAULT_FILTROS);
  const [serieRows, setSerieRows] = useState<AnpPainelImpSerieRow[]>([]);
  const [topRows, setTopRows]     = useState<AnpPainelImpTopDistRow[]>([]);
  const [allYears, setAllYears]   = useState<number[]>([]);

  const [filters, setFiltersState] = useState<AnpPainelImpFiltersState>({
    yearRangeIdx:           [0, 0],
    selectedProdutos:       [],
    topProduto:             "",
    selectedUfs:            [],
    selectedDistribuidores: [],
  });

  // Guard for stale initial fetch
  const initFetchId = useRef(0);

  // ── Stable setFilters merger ─────────────────────────────────────────────
  const setFilters = useCallback((next: Partial<AnpPainelImpFiltersState>) => {
    setFiltersState((prev) => ({ ...prev, ...next }));
  }, []);

  // ── toggleProduto (min-1 guard) ──────────────────────────────────────────
  const toggleProduto = useCallback((p: string) => {
    setFiltersState((prev) => {
      const { selectedProdutos } = prev;
      if (selectedProdutos.includes(p)) {
        if (selectedProdutos.length <= 1) return prev; // min-1 guard
        return {
          ...prev,
          selectedProdutos: selectedProdutos.filter((x) => x !== p),
        };
      }
      return { ...prev, selectedProdutos: [...selectedProdutos, p] };
    });
  }, []);

  // ── resetProdutos: restore full product list ──────────────────────────────
  const resetProdutos = useCallback(() => {
    setFiltersState((prev) => ({ ...prev, selectedProdutos: filtros.produtos }));
  }, [filtros.produtos]);

  // ── Initial load: filtros + first serie fetch (last 10 years) ────────────
  useEffect(() => {
    if (!supabase) return;
    const id = ++initFetchId.current;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpPainelImpFiltros(supabase);
      if (cancelled || id !== initFetchId.current) return;
      setFiltros(f);

      const yMinRaw = f.ano_min ?? new Date().getFullYear() - 10;
      const yMaxRaw = f.ano_max ?? new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMinRaw; y <= yMaxRaw; y++) years.push(y);
      const startIdx = Math.max(0, years.findIndex((y) => y >= yMaxRaw - 9));
      const fromYear = years[startIdx] ?? yMinRaw;

      setAllYears(years);

      // Empty table guard: if no data, skip series fetch entirely.
      if (!years.length || !f.produtos.length) {
        if (!cancelled) {
          setSerieRows([]);
          setFiltersState({
            yearRangeIdx:           [0, 0],
            selectedProdutos:       [],
            topProduto:             "",
            selectedUfs:            [],
            selectedDistribuidores: [],
          });
          setLoading(false);
        }
        return;
      }

      // Fetch series for the visible window (server-side period filter).
      const rows = await rpcGetAnpPainelImpSerie(supabase, {
        anoInicio: fromYear,
        anoFim:    yMaxRaw,
      });
      if (cancelled || id !== initFetchId.current) return;

      // Default: all products selected for the line chart.
      // Top dropdown defaults to the product with the largest volume in window.
      const prodVols: Record<string, number> = {};
      for (const r of rows) {
        prodVols[r.nome_produto] = (prodVols[r.nome_produto] ?? 0) + (r.volume_m3 ?? 0);
      }
      const sortedByVol = Object.entries(prodVols)
        .sort((a, b) => b[1] - a[1])
        .map(([k]) => k);
      const defaultTop = sortedByVol[0] ?? f.produtos[0] ?? "";

      setFiltersState({
        yearRangeIdx:           [startIdx, years.length - 1],
        selectedProdutos:       f.produtos,
        topProduto:             defaultTop,
        selectedUfs:            [],
        selectedDistribuidores: [],
      });
      setSerieRows(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive serie fetch (debounced 400ms) — period or UF change ──────────
  // UF list is pushed to the server when non-empty (the RPC supports p_ufs).
  // When empty, server returns all UFs aggregated — same as the desktop default.
  const ufsKey = filters.selectedUfs.join("|");
  const { data: refetchedSerie, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      const a = allYears[filters.yearRangeIdx[0]];
      const b = allYears[filters.yearRangeIdx[1]];
      return rpcGetAnpPainelImpSerie(supabase, {
        anoInicio: a ?? null,
        anoFim:    b ?? null,
        ufs:       filters.selectedUfs.length ? filters.selectedUfs : null,
      });
    },
    [
      supabase,
      loading,
      filters.yearRangeIdx[0],
      filters.yearRangeIdx[1],
      allYears,
      ufsKey,
    ],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetchedSerie) setSerieRows(refetchedSerie);
  }, [refetchedSerie]);

  // ── Top distributors fetch (debounced 400ms) — topProduto or period ──────
  const { data: refetchedTop, loading: topLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || !filters.topProduto || allYears.length === 0 || loading) {
        return null;
      }
      return rpcGetAnpPainelImpTopDist(
        supabase,
        filters.topProduto,
        allYears[filters.yearRangeIdx[0]] ?? null,
        allYears[filters.yearRangeIdx[1]] ?? null,
      );
    },
    [
      supabase,
      filters.topProduto,
      filters.yearRangeIdx[0],
      filters.yearRangeIdx[1],
      allYears,
      loading,
    ],
    { ms: 400, skipInitial: false },
  );

  useEffect(() => {
    if (refetchedTop) setTopRows(refetchedTop);
  }, [refetchedTop]);

  // ── Derived flags ─────────────────────────────────────────────────────────
  const hasYears = allYears.length > 0;
  const hasData  = filtros.produtos.length > 0;
  const yMin = hasYears ? allYears[filters.yearRangeIdx[0]] : null;
  const yMax = hasYears ? allYears[filters.yearRangeIdx[1]] : null;

  // ── Client-side product filtering for the series chart (no refetch) ──────
  const filteredSerieRows = useMemo(() => {
    if (!filters.selectedProdutos.length) return [];
    const sel = new Set(filters.selectedProdutos);
    return serieRows.filter((r) => sel.has(r.nome_produto));
  }, [serieRows, filters.selectedProdutos]);

  // ── Top distributors ranking, converted to mil m³ and sorted desc ────────
  // Server-side ranking already sorted; we re-sort defensively after the
  // m³ → mil m³ conversion. If selectedDistribuidores is non-empty (mobile
  // drawer), filter the list client-side — the RPC contract does not accept
  // p_distribuidores.
  const topDistributors = useMemo<TopDistributorEntry[]>(() => {
    if (!topRows.length) return [];
    const dSel = new Set(filters.selectedDistribuidores);
    const useFilter = filters.selectedDistribuidores.length > 0;
    return [...topRows]
      .map((r) => ({
        distribuidor: r.distribuidor,
        totalMilM3:   (r.total_m3 ?? 0) / 1000, // m³ → mil m³
      }))
      .filter((e) => e.totalMilM3 > 0 && (!useFilter || dSel.has(e.distribuidor)))
      .sort((a, b) => b.totalMilM3 - a.totalMilM3);
  }, [topRows, filters.selectedDistribuidores]);

  // ── Export rows: period-filtered (server) + product-filtered (client) ────
  const exportRows = filteredSerieRows;

  return {
    filtros,
    serieRows,
    topRows,
    allYears,
    yMin,
    yMax,
    hasYears,
    hasData,
    loading,
    serieLoading,
    topLoading,
    filters,
    setFilters,
    toggleProduto,
    resetProdutos,
    topDistributors,
    filteredSerieRows,
    exportRows,
  };
}
