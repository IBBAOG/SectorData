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
//   + Panel C (import price from mdic_comex — FOB/bbl | FOB/m³ | FOB/ton, 3-line series).
// Exports tab: multi-line series (volume_m3 or valor_usd) for selected products.
//
// Debounce: 400ms on all reactive fetches (useDebouncedFetch).
// Top-N: 10 (server-side aggregation, Others bucket returned from RPC).
// Units:
//   Panel A → quantidade_kg / 1e6 = kt. Label "kt".
//   Panel B → total_mil_m3 from RPC (server converts kg→m³ via density). Label "mil m³".
//   Panel C → fob_per_bbl (USD/bbl) | fob_per_m3 (USD/m³) | fob_per_ton (USD/ton). Sourced from mdic_comex.
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
  rpcGetImportsExportsFobPriceSerie,
} from "@/lib/rpc";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type UnifiedProduct = "Diesel" | "Gasoline" | "Crude Oil";

export type ImportsExportsTab = "imports" | "exports";

export type ExportsYAxis = "volume" | "usd";

export type PriceMetric = "fob_per_bbl" | "fob_per_m3" | "fob_per_ton";

// Panel C — one point per (month × product) flattened for the 3-line chart
export interface PricePoint {
  ano: number;
  mes: number;
  product: UnifiedProduct;
  value: number | null;
}

export interface ImportsExportsFilters {
  unifiedProduct: UnifiedProduct;
  period: [number, number];            // [anoInicio, anoFim]
  tab: ImportsExportsTab;
  exportsYAxis: ExportsYAxis;
  exportsProductsVisible: UnifiedProduct[]; // which products show in exports chart
  priceMetric: PriceMetric;           // Panel C metric toggle
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

  // Imports tab — Panel C (import price from mdic_comex)
  priceData: PricePoint[];
  priceLoading: boolean;

  // Derived helpers
  periodBadge: string;    // e.g. "2015 – 2024"
  yoyEndAno: number;
  yoyEndMes: number;         // derived from actual paisesData (countries panel)
  yoyImportersEndMes: number; // derived from actual importersData (importers panel)

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
  priceMetric: "fob_per_bbl",
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

  // Panel C — import price (mdic_comex)
  const [priceData, setPriceData] = useState<PricePoint[]>([]);
  const [priceLoading, setPriceLoading] = useState(false);

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
    filters.priceMetric,
    // exportsProductsVisible as JSON key so shallow equality works
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(filters.exportsProductsVisible),
  ]);

  // ── Derived: YoY end date = period[1], last month derived from actual data ─
  // Prevents partial-year bias: if anoFim is current year and only months 1–5
  // exist, hardcoding 12 makes the RPC compare 5 partial vs 12 full months.
  // Falls back to 12 when no rows for anoFim (RPC returns null prev_12m → "n/a").
  const yoyEndAno = stableFilters.period[1];

  const yoyEndMes = useMemo(() => {
    const anoFim = stableFilters.period[1];
    const rowsForYear = paisesData.filter(
      (r) => r.ano === anoFim && r.total_kg > 0,
    );
    if (!rowsForYear.length) return 12;
    return Math.max(...rowsForYear.map((r) => r.mes));
  }, [paisesData, stableFilters.period[1]]);

  const yoyImportersEndMes = useMemo(() => {
    const anoFim = stableFilters.period[1];
    const rowsForYear = importersData.filter(
      (r) => r.ano === anoFim && r.total_mil_m3 > 0,
    );
    if (!rowsForYear.length) return yoyEndMes;
    return Math.max(...rowsForYear.map((r) => r.mes));
  }, [importersData, stableFilters.period[1], yoyEndMes]);

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
          yoyImportersEndMes,
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
  }, [stableFilters.tab, stableFilters.unifiedProduct, stableFilters.period[1], yoyEndAno, yoyImportersEndMes]);

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

  // ── 7. Panel C — import price (mdic_comex, all 3 products in parallel) ──────
  const priceFetchIdRef = useRef(0);
  const priceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!supabase || stableFilters.tab !== "imports") return;
    if (priceTimerRef.current) clearTimeout(priceTimerRef.current);
    const myId = ++priceFetchIdRef.current;
    priceTimerRef.current = setTimeout(async () => {
      setPriceLoading(true);
      try {
        const [diesel, gasoline, crude] = await Promise.all([
          rpcGetImportsExportsFobPriceSerie(
            supabase,
            "Diesel",
            stableFilters.period[0],
            stableFilters.period[1],
          ),
          rpcGetImportsExportsFobPriceSerie(
            supabase,
            "Gasoline",
            stableFilters.period[0],
            stableFilters.period[1],
          ),
          rpcGetImportsExportsFobPriceSerie(
            supabase,
            "Crude Oil",
            stableFilters.period[0],
            stableFilters.period[1],
          ),
        ]);
        if (myId !== priceFetchIdRef.current) return;
        const metric = stableFilters.priceMetric;
        const points: PricePoint[] = [
          ...diesel.map((r) => ({
            ano: r.ano,
            mes: r.mes,
            product: "Diesel" as UnifiedProduct,
            value: r[metric],
          })),
          ...gasoline.map((r) => ({
            ano: r.ano,
            mes: r.mes,
            product: "Gasoline" as UnifiedProduct,
            value: r[metric],
          })),
          ...crude.map((r) => ({
            ano: r.ano,
            mes: r.mes,
            product: "Crude Oil" as UnifiedProduct,
            value: r[metric],
          })),
        ];
        setPriceData(points);
      } catch (err) {
        console.error("get_imports_exports_fob_price_serie:", err);
      } finally {
        if (myId === priceFetchIdRef.current) setPriceLoading(false);
      }
    }, 400);
    return () => { if (priceTimerRef.current) clearTimeout(priceTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableFilters.tab, stableFilters.period[0], stableFilters.period[1], stableFilters.priceMetric]);

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
    priceData,
    priceLoading,
    periodBadge,
    yoyEndAno,
    yoyEndMes,
    yoyImportersEndMes,
    visible,
    visibilityLoading,
  };
}
