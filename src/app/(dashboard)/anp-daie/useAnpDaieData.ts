"use client";

// ─── useAnpDaieData — the single brain for /anp-daie ─────────────────────────
//
// Owns all Supabase calls (the 2 anp_daie RPCs), filter state, debounce,
// derived aggregations. Both desktop/View.tsx and mobile/View.tsx consume this
// hook — neither View ever calls Supabase / rpc.ts wrappers directly.
//
// Principles (docs/app/anp-daie.md):
//  - All data via RPC (get_anp_daie_filtros + get_anp_daie_serie).
//  - At least 1 product selected at all times.
//  - Period pushed server-side via p_ano_inicio / p_ano_fim (debounced 400ms).
//  - Product filter applied client-side via useMemo (no refetch).
//  - Detect Import / Export operations defensively via .includes("import") /
//    .includes("export") — pt-BR alphabetic order puts "Exportação" first, so
//    do NOT trust operacoes[0]/[1].
//  - Both Imports and Exports share the same product palette (PRODUTO_COLORS).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDebouncedFetch } from "@/hooks/useDebouncedFetch";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetAnpDaieSerie,
  rpcGetAnpDaiFiltros,
  type AnpDaieRow,
  type AnpDaieFiltros,
} from "@/lib/rpc";

// ─── Constants (exported so both Views share the same palette) ───────────────

export const PRODUTO_COLORS: Record<string, string> = {
  "PETRÓLEO":                    "#1a1a1a",
  "ÓLEO DIESEL":                 "#2196F3",
  "GASOLINA A":                  "#FF5000",
  "GLP":                         "#FF9800",
  "QUEROSENE DE AVIAÇÃO":        "#8BC34A",
  "NAFTA":                       "#9C27B0",
  "ÓLEO COMBUSTÍVEL":            "#795548",
  "COQUE":                       "#607D8B",
  "COMBUSTÍVEIS PARA AERONAVES": "#00BCD4",
  "COMBUSTÍVEIS PARA NAVIOS":    "#3F51B5",
  "GASOLINA DE AVIAÇÃO":         "#E91E63",
  "QUEROSENE ILUMINANTE":        "#009688",
};

export const PALETTE = [
  "#1a1a1a", "#2196F3", "#FF5000", "#FF9800", "#8BC34A", "#9C27B0",
  "#795548", "#607D8B", "#00BCD4", "#3F51B5", "#E91E63", "#009688",
];

/** Return color for a product, falling back to PALETTE rotation. */
export function colorForProduto(p: string, idx: number): string {
  return PRODUTO_COLORS[p] ?? PALETTE[idx % PALETTE.length];
}

/** Capitalize only the first letter (rest lowercase). Accent-aware. */
export function capitalize(s: string): string {
  if (!s) return s;
  return (
    s.charAt(0).toLocaleUpperCase("pt-BR") +
    s.slice(1).toLocaleLowerCase("pt-BR")
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnpDaieFiltersState {
  /** Indices into allYears (controlled by the period slider). */
  yearRangeIdx: [number, number];
  /** Currently selected products. Min 1 always enforced. */
  selectedProdutos: string[];
}

export interface TopCountryEntry {
  /** Product name. */
  produto: string;
  /** Total volume in mil m³ (already converted) over the period. */
  totalMilM3: number;
}

export interface UseAnpDaieData {
  // Raw filtros + data
  filtros: AnpDaieFiltros;
  serieRows: AnpDaieRow[];

  // All years (built from filtros.ano_min/ano_max)
  allYears: number[];

  // Derived: actual year range from indices
  yMin: number | null;
  yMax: number | null;
  hasYears: boolean;
  hasData: boolean;

  // Detected operation labels (defensive — pt-BR alphabetic order pitfall)
  importOp: string;
  exportOp: string;

  // Loading flags
  loading: boolean;       // initial barrel
  serieLoading: boolean;  // inline (debounced refetch)

  // Filter state + setters
  filters: AnpDaieFiltersState;
  setFilters: (next: Partial<AnpDaieFiltersState>) => void;
  toggleProduto: (p: string) => void;
  resetProdutos: () => void;

  // Derived rankings (Top products by total volume in selected period)
  topImports: TopCountryEntry[];
  topExports: TopCountryEntry[];

  // Filtered rows by selected products (client-side useMemo)
  filteredRows: AnpDaieRow[];

  // Export-ready rows (already period-filtered by RPC; products applied here)
  exportRows: AnpDaieRow[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const DEFAULT_FILTROS: AnpDaieFiltros = {
  produtos: [],
  operacoes: [],
  ano_min: null,
  ano_max: null,
};

export function useAnpDaieData(): UseAnpDaieData {
  const supabase = getSupabaseClient();

  const [loading, setLoading]       = useState(true);
  const [filtros, setFiltros]       = useState<AnpDaieFiltros>(DEFAULT_FILTROS);
  const [serieRows, setSerieRows]   = useState<AnpDaieRow[]>([]);
  const [allYears, setAllYears]     = useState<number[]>([]);

  const [filters, setFiltersState] = useState<AnpDaieFiltersState>({
    yearRangeIdx: [0, 0],
    selectedProdutos: [],
  });

  // Guard for stale initial fetch
  const initFetchId = useRef(0);

  // ── Stable setFilters merger ─────────────────────────────────────────────
  const setFilters = useCallback((next: Partial<AnpDaieFiltersState>) => {
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
      const f = await rpcGetAnpDaiFiltros(supabase);
      if (cancelled || id !== initFetchId.current) return;
      setFiltros(f);

      const yMinRaw = f.ano_min ?? new Date().getFullYear() - 10;
      const yMaxRaw = f.ano_max ?? new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMinRaw; y <= yMaxRaw; y++) years.push(y);
      const startIdx = Math.max(0, years.findIndex((y) => y >= yMaxRaw - 9));
      const fromYear = years[startIdx] ?? yMinRaw;

      setAllYears(years);
      setFiltersState({
        yearRangeIdx: [startIdx, years.length - 1],
        selectedProdutos: f.produtos,
      });

      // Empty table guard: if no data, skip serie fetch
      if (!years.length || !f.produtos.length) {
        if (!cancelled) {
          setSerieRows([]);
          setLoading(false);
        }
        return;
      }

      const rows = await rpcGetAnpDaieSerie(supabase, {
        anoInicio: fromYear,
        anoFim:    yMaxRaw,
      });
      if (!cancelled && id === initFetchId.current) {
        setSerieRows(rows);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive serie fetch (debounced 400ms) — period changes only ─────────
  const { data: refetched, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      const a = allYears[filters.yearRangeIdx[0]];
      const b = allYears[filters.yearRangeIdx[1]];
      return rpcGetAnpDaieSerie(supabase, {
        anoInicio: a ?? null,
        anoFim:    b ?? null,
      });
    },
    [supabase, loading, filters.yearRangeIdx[0], filters.yearRangeIdx[1], allYears],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetched) setSerieRows(refetched);
  }, [refetched]);

  // ── Detect import / export labels defensively ────────────────────────────
  // pt-BR alphabetic order: "Exportação" sorts before "Importação".
  // Don't trust operacoes[0]/[1] — match by substring.
  const operacoes = useMemo(
    () => filtros.operacoes ?? [],
    [filtros.operacoes],
  );
  const importOp = useMemo(
    () => operacoes.find((o) => o.toLowerCase().includes("import")) ?? "",
    [operacoes],
  );
  const exportOp = useMemo(
    () => operacoes.find((o) => o.toLowerCase().includes("export")) ?? "",
    [operacoes],
  );

  // ── Derived: hasYears / hasData / yMin / yMax ─────────────────────────────
  const hasYears = allYears.length > 0;
  const hasData  = filtros.produtos.length > 0;
  const yMin = hasYears ? allYears[filters.yearRangeIdx[0]] : null;
  const yMax = hasYears ? allYears[filters.yearRangeIdx[1]] : null;

  // ── Client-side product filtering (no refetch) ────────────────────────────
  const filteredRows = useMemo(() => {
    if (!filters.selectedProdutos.length) return [];
    const sel = new Set(filters.selectedProdutos);
    return serieRows.filter((r) => sel.has(r.produto));
  }, [serieRows, filters.selectedProdutos]);

  // ── Rankings: Top products by total volume (mil m³) over selected period ─
  // Built independently for import and export operations. Volume is converted
  // here using the m³ → mil m³ scale (divide by 1000).
  function buildRanking(op: string): TopCountryEntry[] {
    if (!op) return [];
    const totals: Record<string, number> = {};
    for (const r of filteredRows) {
      if (r.operacao !== op) continue;
      const v = (r.volume_m3 ?? 0) / 1000; // m³ → mil m³
      totals[r.produto] = (totals[r.produto] ?? 0) + v;
    }
    return Object.entries(totals)
      .filter(([, t]) => t > 0)
      .map(([produto, totalMilM3]) => ({ produto, totalMilM3 }))
      .sort((a, b) => b.totalMilM3 - a.totalMilM3);
  }

  const topImports = useMemo(
    () => buildRanking(importOp),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredRows, importOp],
  );

  const topExports = useMemo(
    () => buildRanking(exportOp),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredRows, exportOp],
  );

  // ── Export rows: period-filtered (server) + product-filtered (client) ────
  const exportRows = filteredRows;

  return {
    filtros,
    serieRows,
    allYears,
    yMin,
    yMax,
    hasYears,
    hasData,
    importOp,
    exportOp,
    loading,
    serieLoading,
    filters,
    setFilters,
    toggleProduto,
    resetProdutos,
    topImports,
    topExports,
    filteredRows,
    exportRows,
  };
}
