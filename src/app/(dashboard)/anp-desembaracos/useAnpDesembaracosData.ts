"use client";

// ─── useAnpDesembaracosData — the single brain for /anp-desembaracos ─────────
//
// Owns all Supabase calls (the 3 anp_desembaracos RPCs), filter state,
// debounce, derived rankings. Both desktop/View.tsx and mobile/View.tsx
// consume this hook — neither View ever calls Supabase / rpc.ts wrappers
// directly.
//
// Principles (docs/app/anp-desembaracos.md):
//  - All data via RPC (get_anp_desembaracos_filtros + _serie + _top_paises).
//  - At least 1 NCM selected at all times — min-1 guard in toggleNcm.
//  - Period pushed server-side via p_ano_inicio / p_ano_fim (debounced 400ms).
//  - NCM filter applied client-side via useMemo on the chart (no refetch).
//  - Top countries: refetch server-side when top-NCM or period changes
//    (separate debounced effect on get_anp_desembaracos_top_paises).
//  - Unit: source `quantidade_kg` (kg); display kt (kg / 1e6). Single source
//    of conversion in lib/units.ts (kgToMilTon + LABEL.MIL_T).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDebouncedFetch } from "@/hooks/useDebouncedFetch";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { PALETTE as PLOTLY_PALETTE } from "@/lib/plotlyDefaults";
import { kgToMilTon } from "@/lib/units";
import {
  rpcGetAnpDesembaracosSerie,
  rpcGetAnpDesembaracosTopPaises,
  rpcGetAnpDesembaracosFiltros,
  type AnpDesembaracosRow,
  type AnpDesembaracosTopPaisRow,
  type AnpDesembaracosFiltros,
} from "@/lib/rpc";

// ─── Constants (exported so both Views share the same palette) ───────────────

/** Rotating palette — shared with desktop chart traces and mobile leader dot. */
export const PALETTE = PLOTLY_PALETTE;

/** Single brand colour for Top Countries bar / leader badge. */
export const TOP_COUNTRIES_COLOR = "#1E88E5";

/** Cap on mobile chart traces so 375px viewport stays legible. */
export const MOBILE_CHART_MAX_NCMS = 5;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnpDesembaracosFiltersState {
  /** Indices into allYears (controlled by the period slider). */
  yearRangeIdx: [number, number];
  /** Currently selected NCMs for the series chart. Min 1 always enforced. */
  selectedNcms: string[];
  /** NCM chosen for the Top Origin Countries ranking. */
  topNcm: string;
}

/** Lightweight entry for the Top Countries ranking (already converted to kt). */
export interface TopCountryEntry {
  pais_origem: string;
  totalKt: number;
}

/** Lightweight entry for the Top NCMs ranking (already converted to kt). */
export interface TopNcmEntry {
  ncm_codigo: string;
  ncm_nome: string;
  totalKt: number;
}

export interface UseAnpDesembaracosData {
  // Raw filtros + data
  filtros: AnpDesembaracosFiltros;
  serieRows: AnpDesembaracosRow[];
  topRows: AnpDesembaracosTopPaisRow[];

  // All years (built from filtros.ano_min/ano_max)
  allYears: number[];

  // Derived: actual year range from indices
  yMin: number | null;
  yMax: number | null;
  hasYears: boolean;
  hasData: boolean;

  // Loading flags
  loading: boolean;       // initial barrel
  serieLoading: boolean;  // inline (debounced refetch — series)
  topLoading: boolean;    // inline (debounced refetch — top countries)

  // Filter state + setters
  filters: AnpDesembaracosFiltersState;
  setFilters: (next: Partial<AnpDesembaracosFiltersState>) => void;
  toggleNcm: (ncm: string) => void;
  resetNcms: () => void;
  setTopNcm: (ncm: string) => void;

  // Convenience: list of NCM codes + name lookup
  ncmCodigos: string[];
  ncmNomeMap: Record<string, string>;
  /** Display name for the currently chosen Top Countries NCM. */
  topNcmNome: string;
  /** Display name resolver for any NCM (falls back to the code). */
  resolveNcmNome: (ncm: string) => string;
  /** Stable colour for an NCM code (rotating palette by filtros order). */
  colorForNcm: (ncm: string) => string;

  // Derived ranking: Top NCMs by total volume in selected period (mobile use).
  topNcms: TopNcmEntry[];

  // Derived ranking: Top Countries for the chosen top-NCM (already kt).
  topCountries: TopCountryEntry[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const DEFAULT_FILTROS: AnpDesembaracosFiltros = {
  ncms: [],
  paises: [],
  ano_min: null,
  ano_max: null,
};

export function useAnpDesembaracosData(): UseAnpDesembaracosData {
  const supabase = getSupabaseClient();

  const [loading, setLoading]       = useState(true);
  const [filtros, setFiltros]       = useState<AnpDesembaracosFiltros>(DEFAULT_FILTROS);
  const [serieRows, setSerieRows]   = useState<AnpDesembaracosRow[]>([]);
  const [topRows, setTopRows]       = useState<AnpDesembaracosTopPaisRow[]>([]);
  const [allYears, setAllYears]     = useState<number[]>([]);

  const [filters, setFiltersState] = useState<AnpDesembaracosFiltersState>({
    yearRangeIdx: [0, 0],
    selectedNcms: [],
    topNcm: "",
  });

  // Guard for stale initial fetch
  const initFetchId = useRef(0);

  // ── Stable setFilters merger ─────────────────────────────────────────────
  const setFilters = useCallback((next: Partial<AnpDesembaracosFiltersState>) => {
    setFiltersState((prev) => ({ ...prev, ...next }));
  }, []);

  // ── toggleNcm (min-1 guard) ──────────────────────────────────────────────
  const toggleNcm = useCallback((ncm: string) => {
    setFiltersState((prev) => {
      const { selectedNcms } = prev;
      if (selectedNcms.includes(ncm)) {
        if (selectedNcms.length <= 1) return prev; // min-1 guard
        return {
          ...prev,
          selectedNcms: selectedNcms.filter((x) => x !== ncm),
        };
      }
      return { ...prev, selectedNcms: [...selectedNcms, ncm] };
    });
  }, []);

  // ── resetNcms: restore full NCM list ──────────────────────────────────────
  const resetNcms = useCallback(() => {
    setFiltersState((prev) => ({
      ...prev,
      selectedNcms: filtros.ncms.map((n) => n.ncm_codigo),
    }));
  }, [filtros.ncms]);

  // ── setTopNcm: stable single-NCM setter for the Top Countries selector ───
  const setTopNcm = useCallback((ncm: string) => {
    setFiltersState((prev) => ({ ...prev, topNcm: ncm }));
  }, []);

  // ── Initial load: filtros + first serie fetch (last 10 years, top 5 NCMs)─
  useEffect(() => {
    if (!supabase) return;
    const id = ++initFetchId.current;
    let cancelled = false;
    (async () => {
      const f = await rpcGetAnpDesembaracosFiltros(supabase);
      if (cancelled || id !== initFetchId.current) return;
      setFiltros(f);

      const yMinRaw = f.ano_min ?? new Date().getFullYear() - 10;
      const yMaxRaw = f.ano_max ?? new Date().getFullYear();
      const years: number[] = [];
      for (let y = yMinRaw; y <= yMaxRaw; y++) years.push(y);
      const startIdx = Math.max(0, years.findIndex((y) => y >= yMaxRaw - 9));
      const fromYear = years[startIdx] ?? yMinRaw;

      setAllYears(years);

      // Empty table guard
      if (!years.length || !f.ncms.length) {
        if (!cancelled) {
          setSerieRows([]);
          setFiltersState({
            yearRangeIdx: [0, Math.max(0, years.length - 1)],
            selectedNcms: [],
            topNcm: "",
          });
          setLoading(false);
        }
        return;
      }

      // Fetch serie for the visible window — used both to compute top-5 NCMs
      // and to feed the chart (re-filtered client-side by selected NCMs).
      const rows = await rpcGetAnpDesembaracosSerie(supabase, {
        anoInicio: fromYear,
        anoFim:    yMaxRaw,
      });
      if (cancelled || id !== initFetchId.current) return;

      // Default selection: top 5 NCMs by volume in the window.
      const ncmVols: Record<string, number> = {};
      for (const r of rows) {
        ncmVols[r.ncm_codigo] = (ncmVols[r.ncm_codigo] ?? 0) + (r.quantidade_kg ?? 0);
      }
      const top5 = Object.entries(ncmVols)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k]) => k);
      const initialNcms = top5.length
        ? top5
        : f.ncms.slice(0, 5).map((n) => n.ncm_codigo);

      setFiltersState({
        yearRangeIdx: [startIdx, years.length - 1],
        selectedNcms: initialNcms,
        topNcm: initialNcms[0] ?? "",
      });
      setSerieRows(rows);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive serie fetch (debounced 400ms) — period changes only ─────────
  const { data: refetchedSerie, loading: serieLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || loading) return null;
      const a = allYears[filters.yearRangeIdx[0]];
      const b = allYears[filters.yearRangeIdx[1]];
      return rpcGetAnpDesembaracosSerie(supabase, {
        anoInicio: a ?? null,
        anoFim:    b ?? null,
      });
    },
    [supabase, loading, filters.yearRangeIdx[0], filters.yearRangeIdx[1], allYears],
    { ms: 400, skipInitial: true },
  );

  useEffect(() => {
    if (refetchedSerie) setSerieRows(refetchedSerie);
  }, [refetchedSerie]);

  // ── Top países: refetch on topNcm or period change ────────────────────────
  const { data: refetchedTop, loading: topLoading } = useDebouncedFetch(
    async () => {
      if (!supabase || !filters.topNcm || allYears.length === 0 || loading) {
        return null;
      }
      return rpcGetAnpDesembaracosTopPaises(
        supabase,
        filters.topNcm,
        allYears[filters.yearRangeIdx[0]] ?? null,
        allYears[filters.yearRangeIdx[1]] ?? null,
      );
    },
    [supabase, filters.topNcm, filters.yearRangeIdx[0], filters.yearRangeIdx[1], allYears, loading],
    { ms: 400, skipInitial: false },
  );

  useEffect(() => {
    if (refetchedTop) setTopRows(refetchedTop);
  }, [refetchedTop]);

  // ── Derived: hasYears / hasData / yMin / yMax ─────────────────────────────
  const hasYears = allYears.length > 0;
  const hasData  = filtros.ncms.length > 0;
  const yMin = hasYears ? allYears[filters.yearRangeIdx[0]] : null;
  const yMax = hasYears ? allYears[filters.yearRangeIdx[1]] : null;

  // ── Convenience: NCM codes + name lookup ─────────────────────────────────
  const ncmCodigos = useMemo(
    () => filtros.ncms.map((n) => n.ncm_codigo),
    [filtros.ncms],
  );

  const ncmNomeMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const n of filtros.ncms) m[n.ncm_codigo] = n.ncm_nome ?? n.ncm_codigo;
    return m;
  }, [filtros.ncms]);

  const resolveNcmNome = useCallback(
    (ncm: string) => ncmNomeMap[ncm] ?? ncm,
    [ncmNomeMap],
  );

  const topNcmNome = useMemo(
    () => resolveNcmNome(filters.topNcm),
    [resolveNcmNome, filters.topNcm],
  );

  const colorForNcm = useCallback(
    (ncm: string): string => {
      const i = ncmCodigos.indexOf(ncm);
      return PALETTE[Math.max(0, i) % PALETTE.length];
    },
    [ncmCodigos],
  );

  // ── Derived ranking: Top NCMs in selected period (mobile cards) ──────────
  // Built from the serieRows currently in state (period-filtered server-side).
  // Values converted to kt here so consumers receive a single canonical unit.
  const topNcms = useMemo<TopNcmEntry[]>(() => {
    const totals: Record<string, number> = {};
    for (const r of serieRows) {
      totals[r.ncm_codigo] = (totals[r.ncm_codigo] ?? 0) + (r.quantidade_kg ?? 0);
    }
    return Object.entries(totals)
      .filter(([, t]) => t > 0)
      .map(([ncm, totalKg]) => ({
        ncm_codigo: ncm,
        ncm_nome:   ncmNomeMap[ncm] ?? ncm,
        totalKt:    kgToMilTon(totalKg),
      }))
      .sort((a, b) => b.totalKt - a.totalKt);
  }, [serieRows, ncmNomeMap]);

  // ── Derived ranking: Top Countries for the chosen NCM (already kt) ───────
  // Server already sorted; we just convert quantidade_kg → kt and drop empties.
  const topCountries = useMemo<TopCountryEntry[]>(() => {
    return [...topRows]
      .filter((r) => (r.total_kg ?? 0) > 0)
      .sort((a, b) => (b.total_kg ?? 0) - (a.total_kg ?? 0))
      .map((r) => ({
        pais_origem: r.pais_origem,
        totalKt:     kgToMilTon(r.total_kg ?? 0),
      }));
  }, [topRows]);

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
    toggleNcm,
    resetNcms,
    setTopNcm,
    ncmCodigos,
    ncmNomeMap,
    topNcmNome,
    resolveNcmNome,
    colorForNcm,
    topNcms,
    topCountries,
  };
}
