"use client";

// useImportsExportsData — single shared brain for /imports-exports.
//
// Both desktop/View.tsx and mobile/View.tsx consume this hook.
// Neither view ever calls Supabase directly or derives data on its own.
// All RPC calls, filter state, unit derivations, and type definitions live here.
//
// Tab: 'imports' | 'exports'
// Imports tab: Panel A (countries stacked, kt) + Panel B (importers stacked, mil m³)
//   + YoY tables for each panel.
// Exports tab: multi-line series (volume_m3 or valor_usd) for selected products.
//
// Debounce: 400ms on all reactive fetches (useDebouncedFetch).
// Top-N: 10 (server-side aggregation, Others bucket returned from RPC).
// Units:
//   Panel A → quantidade_kg / 1e6 = kt. Label "kt".
//   Panel B → total_mil_m3 from RPC (server converts kg→m³ via density). Label "mil m³".
//   Exports → volume_m3 / 1e3 = mil m³. Toggle to valor_usd (label "USD").

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useModuleVisibilityGuard } from "@/hooks/useModuleVisibilityGuard";
import {
  rpcGetImportsExportsFiltros,
  rpcGetImportsExportsPaisesStacked,
  rpcGetImportsExportsImportersStacked,
  rpcGetImportsExportsYoyTable,
  rpcGetImportsExportsExportsSerie,
} from "@/lib/rpc";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type UnifiedProduct = "Diesel" | "Gasoline" | "Crude Oil";

export type ImportsExportsTab = "imports" | "exports";

export type ExportsYAxis = "volume" | "usd";

export interface ImportsExportsFilters {
  unifiedProduct: UnifiedProduct;
  period: [number, number];            // [anoInicio, anoFim]
  tab: ImportsExportsTab;
  exportsYAxis: ExportsYAxis;
  exportsProductsVisible: UnifiedProduct[]; // which products show in exports chart
}

// Panel A row (countries) — raw from RPC, quantity in kg; UI divides by 1e6 for kt
export interface PaisesStackedRow {
  ano: number;
  mes: number;
  pais_origem: string;
  total_kg: number;
}

// Panel B row (importers) — quantity already in mil m³ from RPC
export interface ImportersStackedRow {
  ano: number;
  mes: number;
  unified_importer: string;
  total_mil_m3: number;
}

// YoY table row — paises in kt, importers in mil m³ (server-side)
export interface YoyTableRow {
  entity: string;
  last_12m: number;
  prev_12m: number;
  yoy_pct: number | null;
}

// Exports series row — volume_m3 raw, UI divides by 1e3 for mil m³
export interface ExportsSerieRow {
  ano: number;
  mes: number;
  produto: string;
  volume_m3: number;
  valor_usd: number;
}

export interface FiltrosResult {
  ano_min: number;
  ano_max: number;
  produtos: UnifiedProduct[];
}

export interface UseImportsExportsData {
  // Filter state
  filters: ImportsExportsFilters;
  setFilters: (next: Partial<ImportsExportsFilters>) => void;

  // Meta
  filtros: FiltrosResult | null;
  filtrosLoading: boolean;

  // Imports tab — Panel A (countries)
  paisesData: PaisesStackedRow[];
  paisesLoading: boolean;

  // Imports tab — Panel B (importers)
  importersData: ImportersStackedRow[];
  importersLoading: boolean;

  // YoY tables (one per panel)
  yoyPaisesData: YoyTableRow[];
  yoyPaisesLoading: boolean;
  yoyImportersData: YoyTableRow[];
  yoyImportersLoading: boolean;

  // Exports tab
  exportsData: ExportsSerieRow[];
  exportsLoading: boolean;

  // Derived helpers
  periodBadge: string;    // e.g. "2015 – 2024"
  yoyEndAno: number;
  yoyEndMes: number;

  // Visibility guard
  visible: boolean;
  visibilityLoading: boolean;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const ALL_PRODUCTS: UnifiedProduct[] = ["Diesel", "Gasoline", "Crude Oil"];
const TOP_N = 10;
const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_PERIOD: [number, number] = [CURRENT_YEAR - 9, CURRENT_YEAR];

const DEFAULT_FILTERS: ImportsExportsFilters = {
  unifiedProduct: "Diesel",
  period: DEFAULT_PERIOD,
  tab: "imports",
  exportsYAxis: "volume",
  exportsProductsVisible: [...ALL_PRODUCTS],
};

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useImportsExportsData(): UseImportsExportsData {
  const supabase = getSupabaseClient();
  const { visible, loading: visibilityLoading } = useModuleVisibilityGuard("imports-exports");

  const [filters, setFiltersState] = useState<ImportsExportsFilters>(DEFAULT_FILTERS);

  // Meta filtros (year bounds + product list)
  const [filtros, setFiltros] = useState<FiltrosResult | null>(null);
  const [filtrosLoading, setFiltrosLoading] = useState(true);

  // Panels
  const [paisesData, setPaisesData] = useState<PaisesStackedRow[]>([]);
  const [paisesLoading, setPaisesLoading] = useState(false);

  const [importersData, setImportersData] = useState<ImportersStackedRow[]>([]);
  const [importersLoading, setImportersLoading] = useState(false);

  // YoY tables
  const [yoyPaisesData, setYoyPaisesData] = useState<YoyTableRow[]>([]);
  const [yoyPaisesLoading, setYoyPaisesLoading] = useState(false);

  const [yoyImportersData, setYoyImportersData] = useState<YoyTableRow[]>([]);
  const [yoyImportersLoading, setYoyImportersLoading] = useState(false);

  // Exports
  const [exportsData, setExportsData] = useState<ExportsSerieRow[]>([]);
  const [exportsLoading, setExportsLoading] = useState(false);

  // Stable setter merging partial filter updates
  const setFilters = useCallback((next: Partial<ImportsExportsFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...next }));
  }, []);

  // ── 1. Fetch filtros once on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    setFiltrosLoading(true);
    rpcGetImportsExportsFiltros(supabase)
      .then((result) => {
        if (!result) return;
        setFiltros({
          ano_min: result.ano_min,
          ano_max: result.ano_max,
          produtos: result.produtos as UnifiedProduct[],
        });
        // Update default period to last 10 years relative to actual data max
        const anoMax = result.ano_max;
        const anoMin = Math.max(result.ano_min, anoMax - 9);
        setFiltersState((prev) => ({
          ...prev,
          period: [anoMin, anoMax],
        }));
      })
      .catch((err) => console.error("get_imports_exports_filtros:", err))
      .finally(() => setFiltrosLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Memoised stable filter snapshot for effect dependencies
  const stableFilters = useMemo(() => ({ ...filters }), [
    filters.unifiedProduct,
    filters.period[0],
    filters.period[1],
    filters.tab,
    filters.exportsYAxis,
    // exportsProductsVisible as JSON key so shallow equality works
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(filters.exportsProductsVisible),
  ]);

  // ── Derived: YoY end date = period[1] with last month = December ──────────
  const yoyEndAno = stableFilters.period[1];
  const yoyEndMes = 12; // assume full year; actual data cap is whatever the DB has

  // ── 2. Imports tab — Panel A (paises stacked) ───────────────────────────────
  const importsAFetchIdRef = useRef(0);
  const importsATimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!supabase || stableFilters.tab !== "imports") return;
    if (importsATimerRef.current) clearTimeout(importsATimerRef.current);
    const myId = ++importsAFetchIdRef.current;
    importsATimerRef.current = setTimeout(async () => {
      setPaisesLoading(true);
      try {
        const rows = await rpcGetImportsExportsPaisesStacked(
          supabase,
          stableFilters.unifiedProduct,
          stableFilters.period[0],
          stableFilters.period[1],
          TOP_N,
        );
        if (myId === importsAFetchIdRef.current) setPaisesData(rows);
      } catch (err) {
        console.error("get_imports_exports_paises_stacked:", err);
      } finally {
        if (myId === importsAFetchIdRef.current) setPaisesLoading(false);
      }
    }, 400);
    return () => { if (importsATimerRef.current) clearTimeout(importsATimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableFilters.tab, stableFilters.unifiedProduct, stableFilters.period[0], stableFilters.period[1]]);

  // ── 3. Imports tab — Panel B (importers stacked) ────────────────────────────
  const importsBFetchIdRef = useRef(0);
  const importsBTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!supabase || stableFilters.tab !== "imports") return;
    if (importsBTimerRef.current) clearTimeout(importsBTimerRef.current);
    const myId = ++importsBFetchIdRef.current;
    importsBTimerRef.current = setTimeout(async () => {
      setImportersLoading(true);
      try {
        const rows = await rpcGetImportsExportsImportersStacked(
          supabase,
          stableFilters.unifiedProduct,
          stableFilters.period[0],
          stableFilters.period[1],
          TOP_N,
        );
        if (myId === importsBFetchIdRef.current) setImportersData(rows);
      } catch (err) {
        console.error("get_imports_exports_importers_stacked:", err);
      } finally {
        if (myId === importsBFetchIdRef.current) setImportersLoading(false);
      }
    }, 400);
    return () => { if (importsBTimerRef.current) clearTimeout(importsBTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableFilters.tab, stableFilters.unifiedProduct, stableFilters.period[0], stableFilters.period[1]]);

  // ── 4. YoY table — paises ───────────────────────────────────────────────────
  const yoyPFetchIdRef = useRef(0);
  const yoyPTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!supabase || stableFilters.tab !== "imports") return;
    if (yoyPTimerRef.current) clearTimeout(yoyPTimerRef.current);
    const myId = ++yoyPFetchIdRef.current;
    yoyPTimerRef.current = setTimeout(async () => {
      setYoyPaisesLoading(true);
      try {
        const rows = await rpcGetImportsExportsYoyTable(
          supabase,
          "paises",
          stableFilters.unifiedProduct,
          yoyEndAno,
          yoyEndMes,
          TOP_N,
        );
        if (myId === yoyPFetchIdRef.current) setYoyPaisesData(rows);
      } catch (err) {
        console.error("get_imports_exports_yoy_table (paises):", err);
      } finally {
        if (myId === yoyPFetchIdRef.current) setYoyPaisesLoading(false);
      }
    }, 400);
    return () => { if (yoyPTimerRef.current) clearTimeout(yoyPTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableFilters.tab, stableFilters.unifiedProduct, stableFilters.period[1], yoyEndAno, yoyEndMes]);

  // ── 5. YoY table — importers ────────────────────────────────────────────────
  const yoyIFetchIdRef = useRef(0);
  const yoyITimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!supabase || stableFilters.tab !== "imports") return;
    if (yoyITimerRef.current) clearTimeout(yoyITimerRef.current);
    const myId = ++yoyIFetchIdRef.current;
    yoyITimerRef.current = setTimeout(async () => {
      setYoyImportersLoading(true);
      try {
        const rows = await rpcGetImportsExportsYoyTable(
          supabase,
          "importers",
          stableFilters.unifiedProduct,
          yoyEndAno,
          yoyEndMes,
          TOP_N,
        );
        if (myId === yoyIFetchIdRef.current) setYoyImportersData(rows);
      } catch (err) {
        console.error("get_imports_exports_yoy_table (importers):", err);
      } finally {
        if (myId === yoyIFetchIdRef.current) setYoyImportersLoading(false);
      }
    }, 400);
    return () => { if (yoyITimerRef.current) clearTimeout(yoyITimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableFilters.tab, stableFilters.unifiedProduct, stableFilters.period[1], yoyEndAno, yoyEndMes]);

  // ── 6. Exports tab — multi-line series ─────────────────────────────────────
  const exportsFetchIdRef = useRef(0);
  const exportsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!supabase || stableFilters.tab !== "exports") return;
    if (exportsTimerRef.current) clearTimeout(exportsTimerRef.current);
    const myId = ++exportsFetchIdRef.current;
    exportsTimerRef.current = setTimeout(async () => {
      setExportsLoading(true);
      try {
        const rows = await rpcGetImportsExportsExportsSerie(
          supabase,
          ALL_PRODUCTS,          // always fetch all 3; UI filters visibility
          stableFilters.period[0],
          stableFilters.period[1],
        );
        if (myId === exportsFetchIdRef.current) setExportsData(rows);
      } catch (err) {
        console.error("get_imports_exports_exports_serie:", err);
      } finally {
        if (myId === exportsFetchIdRef.current) setExportsLoading(false);
      }
    }, 400);
    return () => { if (exportsTimerRef.current) clearTimeout(exportsTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableFilters.tab, stableFilters.period[0], stableFilters.period[1]]);

  // ── Derived: period badge ───────────────────────────────────────────────────
  const periodBadge = `${stableFilters.period[0]} – ${stableFilters.period[1]}`;

  return {
    filters,
    setFilters,
    filtros,
    filtrosLoading,
    paisesData,
    paisesLoading,
    importersData,
    importersLoading,
    yoyPaisesData,
    yoyPaisesLoading,
    yoyImportersData,
    yoyImportersLoading,
    exportsData,
    exportsLoading,
    periodBadge,
    yoyEndAno,
    yoyEndMes,
    visible,
    visibilityLoading,
  };
}
