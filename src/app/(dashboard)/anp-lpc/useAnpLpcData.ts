"use client";

// ─── useAnpLpcData — the single brain for /anp-lpc ───────────────────────────
//
// Owns all Supabase calls (the 3 anp_lpc RPCs + export count), filter state
// (product multi-select + UF multi-select for export + period year-range
// slider), debounced refetches, and derived series for the National chart,
// Regional breakdown chart, and per-UF latest-price ranking used by the
// mobile View.
//
// Both desktop/View.tsx and mobile/View.tsx consume this hook exclusively.
// Neither View ever calls Supabase or rpc.ts wrappers directly.
//
// Principles (docs/app/anp-lpc.md):
//  - All data via RPC (get_anp_lpc_filtros, get_anp_lpc_nacional,
//    get_anp_lpc_serie + get_anp_lpc_export_count for the Tier 2 modal).
//  - At least 1 product is always selected (mobile + desktop enforce this
//    independently in the toggle handler — the hook does NOT block, but the
//    UI should never call setSelectedProdutos([]) without a fallback).
//  - Period is stored as INDICES into allYears (a 1-year-resolution slider)
//    even though the underlying column is DATE. Conversion to
//    `${y}-01-01` / `${y}-12-31` happens inside the fetch effects so the
//    RPC contract remains ISO-DATE; the UI keeps its familiar year slider.
//    This is the canonical pattern for any future DATE-keyed dashboard.
//  - Regional aggregation (UF → 5 macro-regions) is client-side over the
//    estadoRows, using a static UF_REGIAO map and a simple mean across UFs
//    of that region per week.
//  - Debounce 400ms on the period slider via useDebouncedFetch.

import { useCallback, useEffect, useMemo, useState } from "react";

import { useDebouncedFetch } from "@/hooks/useDebouncedFetch";
import { useExportSize } from "@/hooks/useExportSize";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetAnpLpcNacional,
  rpcGetAnpLpcSerie,
  rpcGetAnpLpcFiltros,
  getAnpLpcExportCount,
  type AnpLpcNacionalRow,
  type AnpLpcSerieRow,
  type AnpLpcFiltros,
  type AnpLpcExportCountFilters,
} from "@/lib/rpc";

// ─── Constants (exported so both Views share the same palette / map) ─────────

export const PRODUTO_COLORS: Record<string, string> = {
  "GASOLINA COMUM":      "#FF5000",
  "GASOLINA ADITIVADA":  "#FF8C42",
  "ETANOL HIDRATADO":    "#8BC34A",
  "DIESEL S10":          "#2196F3",
  "DIESEL S500":         "#64B5F6",
  "GNV":                 "#9C27B0",
  "GLP":                 "#FF9800",
};

export const PALETTE = [
  "#FF5000", "#2196F3", "#8BC34A", "#FF9800", "#9C27B0",
  "#E53935", "#00ACC1", "#FF8C42", "#64B5F6", "#7CB342",
];

/** Return color for a product, falling back to PALETTE rotation. */
export function colorForProduto(p: string, idx: number): string {
  return PRODUTO_COLORS[p] ?? PALETTE[idx % PALETTE.length];
}

/** Static UF → 5 macro-region map. Used for client-side regional rollup. */
export const UF_REGIAO: Record<string, string> = {
  AC: "N",  AM: "N",  AP: "N",  PA: "N",  RO: "N",  RR: "N",  TO: "N",
  AL: "NE", BA: "NE", CE: "NE", MA: "NE", PB: "NE", PE: "NE", PI: "NE", RN: "NE", SE: "NE",
  DF: "CO", GO: "CO", MS: "CO", MT: "CO",
  ES: "SE", MG: "SE", RJ: "SE", SP: "SE",
  PR: "S",  RS: "S",  SC: "S",
};

export const REGIAO_COLORS: Record<string, string> = {
  N: "#009688", NE: "#FF5722", CO: "#9C27B0", SE: "#F44336", S: "#3F51B5",
};

/** GLP is sold in R$/kg; every other product is R$/L. */
export function unitForProduto(produto: string): "kg" | "L" {
  return produto === "GLP" ? "kg" : "L";
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UfLatestPrice {
  /** UF (2-letter code). */
  estado: string;
  /** Macro-region (N / NE / CO / SE / S). */
  regiao: string;
  /** Latest preco_medio_venda for the selected product in this UF. */
  preco: number;
  /** Latest week (ISO YYYY-MM-DD) the price was observed. */
  data_fim: string;
  /** Rank within the current product (1 = highest price). */
  rank: number;
  /** Bar width 0–100 relative to the highest price in the list. */
  barWidth: number;
}

export interface UseAnpLpcData {
  // Raw filtros + data
  filtros: AnpLpcFiltros;
  nacionalRows: AnpLpcNacionalRow[];
  estadoRows: AnpLpcSerieRow[];

  // Year slider (DATE column converted to year-range UI)
  allYears: number[];
  yearRange: [number, number];
  setYearRange: (next: [number, number]) => void;
  hasYears: boolean;
  yMin: number | null;
  yMax: number | null;

  // Product multi-select (chart Nacional + mobile chart)
  selectedProdutos: string[];
  setSelectedProdutos: (next: string[]) => void;
  toggleProduto: (p: string) => void;

  // Single-product selector (Regional breakdown + mobile product tab)
  detailProduto: string;
  setDetailProduto: (next: string) => void;

  // Loading flags
  initialLoading: boolean;
  serieLoading: boolean;

  // Derived helpers (mobile + desktop reuse)
  /** Latest week observed across the regional data. */
  latestDate: string | null;
  /** Per-UF latest price for detailProduto, ranked desc. */
  ufLatestPrices: UfLatestPrice[];

  // ── Export modal (Tier 2) ──────────────────────────────────────────────────
  exportOpen: boolean;
  openExportModal: () => void;
  closeExportModal: () => void;
  exportProdutos: string[];
  setExportProdutos: (next: string[]) => void;
  toggleExportProduto: (p: string) => void;
  exportEstados: string[];
  setExportEstados: (next: string[]) => void;
  exportRange: [number, number];
  setExportRange: (next: [number, number]) => void;
  exportFilters: AnpLpcExportCountFilters;
  exportSizeEstimate: ReturnType<typeof useExportSize>;
  excelLoading: boolean;
  setExcelLoading: (v: boolean) => void;
  csvLoading: boolean;
  setCsvLoading: (v: boolean) => void;

  // Supabase client (export handlers in the Views need it for the count fetch
  // + serie pagination at download time)
  supabase: ReturnType<typeof getSupabaseClient>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const EMPTY_FILTROS: AnpLpcFiltros = {
  produtos: [], estados: [], data_min: null, data_max: null,
};

export function useAnpLpcData(): UseAnpLpcData {
  const supabase = getSupabaseClient();

  // Raw state
  const [initialLoading, setInitialLoading]     = useState(true);
  const [filtros, setFiltros]                   = useState<AnpLpcFiltros>(EMPTY_FILTROS);
  const [nacionalRows, setNacionalRows]         = useState<AnpLpcNacionalRow[]>([]);
  const [estadoRows, setEstadoRows]             = useState<AnpLpcSerieRow[]>([]);

  // Period slider
  const [allYears, setAllYears]                 = useState<number[]>([]);
  const [yearRange, setYearRange]               = useState<[number, number]>([0, 0]);

  // Product filters
  const [selectedProdutos, setSelectedProdutos] = useState<string[]>([]);
  const [detailProduto, setDetailProduto]       = useState<string>("");

  // Export modal state
  const [exportOpen, setExportOpen]             = useState(false);
  const [excelLoading, setExcelLoading]         = useState(false);
  const [csvLoading, setCsvLoading]             = useState(false);
  const [exportProdutos, setExportProdutos]     = useState<string[]>([]);
  const [exportEstados, setExportEstados]       = useState<string[]>([]);
  const [exportRange, setExportRange]           = useState<[number, number]>([0, 0]);

  // ── Initial load: filtros + first data fetch ────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    (async () => {
      const f = await rpcGetAnpLpcFiltros(supabase);
      if (cancelled) return;
      setFiltros(f);
      setSelectedProdutos(f.produtos);
      setDetailProduto(f.produtos[0] ?? "");

      // Build year list from data_min / data_max (DATE → year)
      const yMin = f.data_min ? parseInt(f.data_min.slice(0, 4), 10) : new Date().getFullYear() - 5;
      const yMax = f.data_max ? parseInt(f.data_max.slice(0, 4), 10) : new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMin; y <= yMax; y++) years.push(y);
      const startIdx = Math.max(0, years.findIndex((y) => y >= yMax - 4));
      const fromYear = years[startIdx] ?? yMin;
      setAllYears(years);
      setYearRange([startIdx, years.length - 1]);

      // First fetch — convert year range to ISO DATE before calling RPCs
      const dataInicio = `${fromYear}-01-01`;
      const dataFim    = `${yMax}-12-31`;

      const [nacional, estado] = await Promise.all([
        rpcGetAnpLpcNacional(supabase, { dataInicio, dataFim }),
        rpcGetAnpLpcSerie(supabase,    { dataInicio, dataFim }),
      ]);
      if (cancelled) return;

      setNacionalRows(nacional);
      setEstadoRows(estado);
      setInitialLoading(false);
    })();

    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive refetch (debounced 400ms) — driven by the year range slider ───
  const { data: refetched, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || initialLoading) return null;
      const yMin = allYears[yearRange[0]];
      const yMax = allYears[yearRange[1]];
      const dataInicio = yMin ? `${yMin}-01-01` : null;
      const dataFim    = yMax ? `${yMax}-12-31` : null;
      const [nacional, estado] = await Promise.all([
        rpcGetAnpLpcNacional(supabase, { dataInicio, dataFim }),
        rpcGetAnpLpcSerie(supabase,    { dataInicio, dataFim }),
      ]);
      return { nacional, estado };
    },
    [supabase, initialLoading, yearRange[0], yearRange[1], allYears],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) {
      setNacionalRows(refetched.nacional);
      setEstadoRows(refetched.estado);
    }
  }, [refetched]);

  // ── Derived: hasYears / yMin / yMax for the period badge ────────────────────
  const hasYears = allYears.length > 0;
  const yMin = hasYears ? allYears[yearRange[0]] : null;
  const yMax = hasYears ? allYears[yearRange[1]] : null;

  // ── Derived: latestDate (most recent week in estadoRows) ────────────────────
  const latestDate = useMemo<string | null>(() => {
    if (!estadoRows.length) return null;
    let max = estadoRows[0].data_fim;
    for (const r of estadoRows) {
      if (r.data_fim > max) max = r.data_fim;
    }
    return max;
  }, [estadoRows]);

  // ── Derived: per-UF latest price for the selected detailProduto ─────────────
  // Ranking is "highest price first" — mobile shows this as a Top-N list,
  // desktop already covers it via the Regional chart.
  const ufLatestPrices = useMemo<UfLatestPrice[]>(() => {
    if (!detailProduto || estadoRows.length === 0) return [];

    const filtered = estadoRows.filter((r) => r.produto === detailProduto);
    if (!filtered.length) return [];

    // For each UF, find the latest data_fim and its price
    const byUf = new Map<string, { preco: number; data_fim: string }>();
    for (const r of filtered) {
      const cur = byUf.get(r.estado);
      const price = r.preco_medio_venda ?? null;
      if (price == null) continue;
      if (!cur || r.data_fim > cur.data_fim) {
        byUf.set(r.estado, { preco: price, data_fim: r.data_fim });
      }
    }

    const arr = Array.from(byUf.entries())
      .map(([estado, { preco, data_fim }]) => ({
        estado,
        regiao: UF_REGIAO[estado] ?? "—",
        preco,
        data_fim,
      }))
      .sort((a, b) => b.preco - a.preco);

    const top = arr[0]?.preco ?? 1;
    return arr.map((row, idx) => ({
      ...row,
      rank: idx + 1,
      barWidth: top > 0 ? (row.preco / top) * 100 : 0,
    }));
  }, [estadoRows, detailProduto]);

  // ── Product toggles (enforces min 1 selected) ──────────────────────────────
  const toggleProduto = useCallback((p: string) => {
    setSelectedProdutos((prev) =>
      prev.includes(p)
        ? prev.length > 1 ? prev.filter((x) => x !== p) : prev
        : [...prev, p],
    );
  }, []);

  const toggleExportProduto = useCallback((p: string) => {
    setExportProdutos((prev) =>
      prev.includes(p)
        ? prev.length > 1 ? prev.filter((x) => x !== p) : prev
        : [...prev, p],
    );
  }, []);

  // ── Export modal helpers ────────────────────────────────────────────────────
  const openExportModal = useCallback(() => {
    setExportProdutos(selectedProdutos);
    setExportEstados([]);
    setExportRange(yearRange);
    setExportOpen(true);
  }, [selectedProdutos, yearRange]);

  const closeExportModal = useCallback(() => setExportOpen(false), []);

  const exportFilters = useMemo<AnpLpcExportCountFilters>(() => {
    const yMinExp = allYears[exportRange[0]] ?? null;
    const yMaxExp = allYears[exportRange[1]] ?? null;
    return {
      // null when "all" — RPC treats null as "no filter" (faster pruning)
      produtos:   exportProdutos.length === filtros.produtos.length ? null : exportProdutos,
      estados:    exportEstados.length ? exportEstados : null,
      dataInicio: yMinExp ? `${yMinExp}-01-01` : null,
      dataFim:    yMaxExp ? `${yMaxExp}-12-31` : null,
    };
  }, [exportProdutos, exportEstados, exportRange, allYears, filtros.produtos.length]);

  // Live size estimate (300ms debounced via the shared hook)
  const exportSizeEstimate = useExportSize(
    exportFilters,
    async (f) => {
      if (!supabase) return 0;
      return getAnpLpcExportCount(supabase, f);
    },
    "anp_lpc",
  );

  return {
    filtros,
    nacionalRows,
    estadoRows,

    allYears,
    yearRange,
    setYearRange,
    hasYears,
    yMin,
    yMax,

    selectedProdutos,
    setSelectedProdutos,
    toggleProduto,

    detailProduto,
    setDetailProduto,

    initialLoading,
    serieLoading,

    latestDate,
    ufLatestPrices,

    exportOpen,
    openExportModal,
    closeExportModal,
    exportProdutos,
    setExportProdutos,
    toggleExportProduto,
    exportEstados,
    setExportEstados,
    exportRange,
    setExportRange,
    exportFilters,
    exportSizeEstimate,
    excelLoading,
    setExcelLoading,
    csvLoading,
    setCsvLoading,

    supabase,
  };
}
