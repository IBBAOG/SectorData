"use client";

// ─── useSindicomData — the single brain for /sindicom ────────────────────────
//
// Owns all Supabase calls, filter state, debounce, derived aggregations.
// Both desktop/View.tsx and mobile/View.tsx consume this hook — neither View
// ever calls Supabase / rpc.ts wrappers directly. Chart-building helpers stay
// inside each View (desktop = multi-line + horizontal bar, mobile = stacked
// area + ranking cards) because the shapes differ, but they share serieRows.
//
// Principles (docs/app/sindicom.md):
//  - Always via RPC — never direct table query.
//  - Minimum 1 product AND 1 segment selected — both length === 0 is disallowed.
//  - Product / segment filtering is client-side via useMemo (finite list).
//  - Market Share aggregation is client-side over the filtered rows: sum by
//    company, sort desc, top 15, percentage over the top-15 total.
//  - Period pushed server-side via p_ano_inicio / p_ano_fim (debounced 400ms).
//  - Barrel loading only on initial fetch; later refetches use serieLoading.
//  - Empty state (Cloudflare not yet ingested) → filtros.produtos.length === 0
//    and the consumer Views render an instructional card instead of charts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSupabaseClient } from "@/lib/supabaseClient";
import { useDebouncedFetch } from "@/hooks/useDebouncedFetch";
import {
  rpcGetSindicomSerie,
  rpcGetSindicomFiltros,
  type SindicomSerieRow,
  type SindicomFiltros,
} from "@/lib/rpc";

// ─── Constants ────────────────────────────────────────────────────────────────

export const PRODUTO_COLORS: Record<string, string> = {
  "GASOLINA C COMUM":     "#FF5000",
  "GASOLINA C ADITIVADA": "#FF8C42",
  "ETANOL HIDRATADO":     "#8BC34A",
  "DIESEL B S10":         "#2196F3",
  "DIESEL B S500":        "#64B5F6",
  "GLP":                  "#FF9800",
  "GNV":                  "#9C27B0",
  "ÓLEO DIESEL A S10":    "#1565C0",
  "ÓLEO DIESEL A S500":   "#42A5F5",
};

export const PALETTE = [
  "#FF5000", "#2196F3", "#8BC34A", "#FF9800", "#9C27B0",
  "#E53935", "#00ACC1", "#FF8C42", "#64B5F6", "#7CB342",
  "#FF7043", "#26C6DA", "#D4E157", "#AB47BC", "#EF5350",
];

/** Resolve the chart colour for a product, falling back to a rotating palette. */
export function colorForProduto(produto: string, allProdutos: string[]): string {
  if (PRODUTO_COLORS[produto]) return PRODUTO_COLORS[produto];
  const i = allProdutos.indexOf(produto);
  return PALETTE[(i >= 0 ? i : 0) % PALETTE.length];
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SindicomFilters {
  /** Indices into allYears array (controlled by the period slider). */
  yearRangeIdx: [number, number];
  /** Products visible in the volume chart. Min 1 always enforced. */
  selectedProdutos: string[];
  /** Segments included in the aggregation. Min 1 always enforced. */
  selectedSegmentos: string[];
  /** Single product driving the Market Share by Company chart. */
  msProduto: string;
}

export interface MarketShareEntry {
  empresa: string;
  volume: number;       // m³ — raw sum
  sharePct: number;     // percentage over the top-15 total (0-100)
}

export interface UseSindicomData {
  // ── Raw data ─────────────────────────────────────────────────────────────
  serieRows: SindicomSerieRow[];
  /** Result of rpcGetSindicomFiltros — drives the filter lists + empty state. */
  filtros: SindicomFiltros;

  // ── Years (built from filtros.ano_min / ano_max) ─────────────────────────
  allYears: number[];
  /** Derived: actual year numbers based on yearRangeIdx (or null when empty). */
  yMin: number | null;
  yMax: number | null;
  hasYears: boolean;

  // ── Empty state flag — true when the sindicom table has 0 rows ───────────
  hasData: boolean;

  // ── Loading ──────────────────────────────────────────────────────────────
  loading: boolean;        // initial barrel
  serieLoading: boolean;   // inline (debounced refetch)

  // ── Filters + setters ────────────────────────────────────────────────────
  filters: SindicomFilters;
  setFilters: (next: Partial<SindicomFilters>) => void;
  /** Toggle product with min-1 guard. */
  toggleProduto: (p: string) => void;
  /** Toggle segment with min-1 guard. */
  toggleSegmento: (s: string) => void;
  /** Restore all products (used by "Clear" button on multi-select). */
  resetProdutos: () => void;
  /** Restore all segments. */
  resetSegmentos: () => void;

  // ── Derived: rows filtered by current product + segment selection ────────
  filteredSerieRows: SindicomSerieRow[];

  // ── Derived: market-share for filters.msProduto ───────────────────────────
  marketShare: MarketShareEntry[];

  // ── Export data (raw serieRows, already period-filtered by RPC) ──────────
  exportRows: SindicomSerieRow[];
}

const EMPTY_RPC_FILTROS: SindicomFiltros = {
  empresas: [], produtos: [], segmentos: [], ano_min: null, ano_max: null,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSindicomData(): UseSindicomData {
  const supabase = getSupabaseClient();

  // ── Raw state ────────────────────────────────────────────────────────────
  const [loading, setLoading]     = useState(true);
  const [filtros, setFiltros]     = useState<SindicomFiltros>(EMPTY_RPC_FILTROS);
  const [serieRows, setSerieRows] = useState<SindicomSerieRow[]>([]);
  const [allYears, setAllYears]   = useState<number[]>([]);

  const [filters, setFiltersState] = useState<SindicomFilters>({
    yearRangeIdx:      [0, 0],
    selectedProdutos:  [],
    selectedSegmentos: [],
    msProduto:         "",
  });

  // Guard for stale initial fetch
  const initFetchId = useRef(0);

  // ── Stable setFilters ────────────────────────────────────────────────────
  const setFilters = useCallback((next: Partial<SindicomFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...next }));
  }, []);

  // ── toggleProduto / toggleSegmento — min-1 guard ─────────────────────────
  const toggleProduto = useCallback((p: string) => {
    setFiltersState((prev) => {
      const { selectedProdutos } = prev;
      if (selectedProdutos.includes(p)) {
        if (selectedProdutos.length <= 1) return prev; // min-1 guard
        return { ...prev, selectedProdutos: selectedProdutos.filter((x) => x !== p) };
      }
      return { ...prev, selectedProdutos: [...selectedProdutos, p] };
    });
  }, []);

  const toggleSegmento = useCallback((s: string) => {
    setFiltersState((prev) => {
      const { selectedSegmentos } = prev;
      if (selectedSegmentos.includes(s)) {
        if (selectedSegmentos.length <= 1) return prev; // min-1 guard
        return { ...prev, selectedSegmentos: selectedSegmentos.filter((x) => x !== s) };
      }
      return { ...prev, selectedSegmentos: [...selectedSegmentos, s] };
    });
  }, []);

  const resetProdutos  = useCallback(() => {
    setFiltersState((prev) => ({ ...prev, selectedProdutos: [...filtros.produtos] }));
  }, [filtros.produtos]);

  const resetSegmentos = useCallback(() => {
    setFiltersState((prev) => ({ ...prev, selectedSegmentos: [...filtros.segmentos] }));
  }, [filtros.segmentos]);

  // ── Initial load: filtros → first serie fetch (last 5 years window) ──────
  useEffect(() => {
    if (!supabase) return;
    const id = ++initFetchId.current;
    let cancelled = false;

    (async () => {
      const f = await rpcGetSindicomFiltros(supabase);
      if (cancelled || id !== initFetchId.current) return;
      setFiltros(f);

      setFiltersState((prev) => ({
        ...prev,
        selectedProdutos:  f.produtos,
        selectedSegmentos: f.segmentos,
        msProduto:         f.produtos[0] ?? "",
      }));

      // Build years array. Empty when the table is still empty (ano_min/max null).
      if (f.ano_min != null && f.ano_max != null) {
        const years: number[] = [];
        for (let y = f.ano_min; y <= f.ano_max; y++) years.push(y);
        const currentYear = new Date().getFullYear();
        const startIdx    = Math.max(0, years.findIndex((y) => y >= currentYear - 5));
        const fromYear    = years[startIdx] ?? f.ano_min;
        const toYear      = f.ano_max;

        setAllYears(years);
        setFiltersState((prev) => ({
          ...prev,
          yearRangeIdx: [startIdx, years.length - 1],
        }));

        const rows = await rpcGetSindicomSerie(supabase, {
          anoInicio: fromYear,
          anoFim:    toYear,
        });
        if (cancelled || id !== initFetchId.current) return;
        setSerieRows(rows);
      }

      if (!cancelled && id === initFetchId.current) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [supabase]);

  // ── Debounced refetch on period slider change ────────────────────────────
  const { data: refetched, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading || allYears.length === 0) return null;
      const [i0, i1] = filters.yearRangeIdx;
      return rpcGetSindicomSerie(supabase, {
        anoInicio: allYears[i0] ?? null,
        anoFim:    allYears[i1] ?? null,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supabase, loading, filters.yearRangeIdx[0], filters.yearRangeIdx[1], allYears],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) setSerieRows(refetched);
  }, [refetched]);

  // ── Derived: actual year labels ──────────────────────────────────────────
  const hasYears = allYears.length > 0;
  const yMin = hasYears ? (allYears[filters.yearRangeIdx[0]] ?? null) : null;
  const yMax = hasYears ? (allYears[filters.yearRangeIdx[1]] ?? null) : null;

  // ── Empty-state flag ─────────────────────────────────────────────────────
  const hasData = filtros.produtos.length > 0;

  // ── Derived: rows filtered by current product + segment selection ────────
  const filteredSerieRows = useMemo<SindicomSerieRow[]>(() => {
    const segSet = new Set(filters.selectedSegmentos);
    const prodSet = new Set(filters.selectedProdutos);
    return serieRows.filter(
      (r) => prodSet.has(r.nome_produto) && segSet.has(r.segmento),
    );
  }, [serieRows, filters.selectedProdutos, filters.selectedSegmentos]);

  // ── Derived: market-share by company (Top 15) for filters.msProduto ──────
  const marketShare = useMemo<MarketShareEntry[]>(() => {
    if (!filters.msProduto) return [];
    const segSet = new Set(filters.selectedSegmentos);
    const byEmpresa: Record<string, number> = {};
    for (const r of serieRows) {
      if (r.nome_produto !== filters.msProduto) continue;
      if (!segSet.has(r.segmento)) continue;
      byEmpresa[r.empresa] = (byEmpresa[r.empresa] ?? 0) + (r.volume ?? 0);
    }
    const sorted = Object.entries(byEmpresa)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15);
    const total = sorted.reduce((s, [, v]) => s + v, 0);
    return sorted.map(([empresa, volume]) => ({
      empresa,
      volume,
      sharePct: total > 0 ? (volume / total) * 100 : 0,
    }));
  }, [serieRows, filters.msProduto, filters.selectedSegmentos]);

  return {
    serieRows,
    filtros,
    allYears,
    yMin,
    yMax,
    hasYears,
    hasData,
    loading,
    serieLoading,
    filters,
    setFilters,
    toggleProduto,
    toggleSegmento,
    resetProdutos,
    resetSegmentos,
    filteredSerieRows,
    marketShare,
    exportRows: serieRows,
  };
}
