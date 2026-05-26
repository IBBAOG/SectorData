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
//   + Panel C (import price from mdic_comex — FOB/bbl | FOB/m³ | FOB/ton, single-line series).
// Exports tab: stacked area by destination country (top-10 + Others) + YoY table.
//   Source: mdic_comex (migration 20260525000110). RPC get_imports_exports_exports_serie DROPPED.
//
// Temporal granularity — MONTHLY (migration 20260526800000).
//   Period is now { start: {ano, mes}, end: {ano, mes} }. RPCs accept the 4-int
//   bounds (p_ano_inicio, p_mes_inicio, p_ano_fim, p_mes_fim). Single-month view
//   supported: set start === end.
//   Default: last 12 months ending at (filtros.ano_max, filtros.mes_max).
//   Month-array (YYYY-MM-01 strings) is derived client-side from filtros bounds
//   and powers the PeriodSlider in dates mode.
//
// Debounce: 400ms on all reactive fetches (useDebouncedFetch).
// Top-N: 10 (server-side aggregation, Others bucket returned from RPC).
// Units:
//   Panel A → quantidade_kg / 1e6 = kt. Label "kt".
//   Panel B → total_mil_m3 from RPC (server converts kg→m³ via density). Label "mil m³".
//   Panel C → fob_per_bbl (USD/bbl) | fob_per_m3 (USD/m³) | fob_per_ton (USD/ton). Sourced from mdic_comex.
//   Exports (metric=volume) → server returns mil m³ directly — DO NOT divide client-side. Label "mil m³".
//   Exports (metric=usd)    → server returns raw USD. Label "USD".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { useModuleVisibilityGuard } from "@/hooks/useModuleVisibilityGuard";
import {
  rpcGetImportsExportsFiltros,
  rpcGetImportsExportsPaisesStacked,
  rpcGetImportsExportsImportersStacked,
  rpcGetImportsExportsYoyTable,
  rpcGetImportsExportsExportsPaisesStacked,
  rpcGetImportsExportsExportsYoyTable,
  rpcGetImportsExportsFobPriceSerie,
  rpcGetImportsExportsImportsUnitPrice,
  rpcGetImportsExportsExportsUnitPrice,
} from "@/lib/rpc";
import type {
  IEExportsPaisesStackedRow,
  IEExportsYoyRow,
  IEUnitPriceRow,
} from "@/lib/rpc";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type UnifiedProduct = "Diesel" | "Gasoline" | "Crude Oil";

export type ImportsExportsTab = "imports" | "exports";

export type ExportsYAxis = "volume" | "usd";

export type PriceMetric = "fob_per_bbl" | "fob_per_m3" | "fob_per_ton";

// Single-point month cursor (1-12).
export interface MonthCursor {
  ano: number;
  mes: number;
}

// Monthly period — start and end are both inclusive. start === end → 1-month view.
export interface Period {
  start: MonthCursor;
  end: MonthCursor;
}

// Panel C — one point per (month × product) flattened for the 3-line chart
export interface PricePoint {
  ano: number;
  mes: number;
  product: UnifiedProduct;
  value: number | null;
}

export interface ImportsExportsFilters {
  unifiedProduct: UnifiedProduct;
  period: Period;
  tab: ImportsExportsTab;
  exportsYAxis: ExportsYAxis;
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

// Exports stacked row — value already in mil m³ (metric=volume) or USD (metric=usd) from RPC
export type { IEExportsPaisesStackedRow as ExportsPaisesStackedRow } from "@/lib/rpc";
export type { IEExportsYoyRow as ExportsYoyRow } from "@/lib/rpc";

// Unit price rows (USD/m³ per country per month) — imports + exports
export type { IEUnitPriceRow as UnitPriceRow } from "@/lib/rpc";

export interface FiltrosResult {
  ano_min: number;
  mes_min: number;
  ano_max: number;
  mes_max: number;
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

  // Exports tab — stacked area by destination country + YoY table
  exportsPaisesData: IEExportsPaisesStackedRow[];
  exportsPaisesLoading: boolean;
  yoyExportsData: IEExportsYoyRow[];
  yoyExportsLoading: boolean;

  // Imports tab — Panel C (import price from mdic_comex)
  priceData: PricePoint[];
  priceLoading: boolean;

  // Imports tab — Panel D (unit price by origin country, USD/m³)
  importsUnitPriceData: IEUnitPriceRow[];
  importsUnitPriceLoading: boolean;

  // Exports tab — unit price by destination country (USD/m³)
  exportsUnitPriceData: IEUnitPriceRow[];
  exportsUnitPriceLoading: boolean;

  // Derived helpers
  /** Month-array (YYYY-MM-01) from ano_min/mes_min to ano_max/mes_max. */
  monthList: string[];
  /** Pretty month range, e.g. "Jan 2025 – May 2026"; if start===end → "May 2026". */
  periodBadge: string;
  yoyEndAno: number;
  yoyEndMes: number;          // derived from actual paisesData (countries panel)
  yoyImportersEndMes: number; // derived from actual importersData (importers panel)
  yoyExportsEndMes: number;   // derived from actual exportsPaisesData

  // Visibility guard
  visible: boolean;
  visibilityLoading: boolean;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const TOP_N = 10;

const MONTH_LABELS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ─── Helpers (exported for the views) ──────────────────────────────────────────

/**
 * Build the full month array (YYYY-MM-01) for the slider, from a min (ano,mes)
 * to a max (ano,mes), inclusive on both ends.
 */
export function buildMonthList(
  anoMin: number,
  mesMin: number,
  anoMax: number,
  mesMax: number,
): string[] {
  const out: string[] = [];
  let y = anoMin;
  let m = mesMin;
  while (y < anoMax || (y === anoMax && m <= mesMax)) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    // Safety net to avoid runaway loop if min > max
    if (out.length > 1200) break; // 100 years cap
  }
  return out;
}

/**
 * Convert an (ano, mes) tuple to a Date at midnight UTC of the 1st of that month.
 * Use UTC to avoid timezone drift when Plotly renders the x-axis as `type:'date'`.
 */
export function monthKeyToDate(ano: number, mes: number): Date {
  return new Date(Date.UTC(ano, mes - 1, 1));
}

/**
 * Format an (ano, mes) tuple as "MMM YYYY" (English month abbrev).
 */
export function formatMonth(ano: number, mes: number): string {
  const label = MONTH_LABELS_SHORT[mes - 1] ?? String(mes);
  return `${label} ${ano}`;
}

/**
 * Subtract `n` months from a (ano, mes) cursor. Result is clamped to (1,1)
 * when going past the year 1.
 */
export function addMonths(c: MonthCursor, n: number): MonthCursor {
  const totalIdx = c.ano * 12 + (c.mes - 1) + n;
  if (totalIdx < 0) return { ano: 1, mes: 1 };
  return {
    ano: Math.floor(totalIdx / 12),
    mes: (totalIdx % 12) + 1,
  };
}

/**
 * Lexicographic compare of two month cursors: -1, 0, +1.
 */
export function cmpMonth(a: MonthCursor, b: MonthCursor): number {
  if (a.ano !== b.ano) return a.ano - b.ano < 0 ? -1 : 1;
  if (a.mes !== b.mes) return a.mes - b.mes < 0 ? -1 : 1;
  return 0;
}

// ─── Defaults ──────────────────────────────────────────────────────────────────

// Initial placeholder before filtros loads. Replaced on first fetch.
// Use a recent 12-month window centred on the current year/month so charts have
// a stable initial layout while data is still loading.
const NOW = new Date();
const INITIAL_END: MonthCursor = { ano: NOW.getFullYear(), mes: NOW.getMonth() + 1 };
const INITIAL_START: MonthCursor = addMonths(INITIAL_END, -11);

const DEFAULT_FILTERS: ImportsExportsFilters = {
  unifiedProduct: "Diesel",
  period: { start: INITIAL_START, end: INITIAL_END },
  tab: "imports",
  exportsYAxis: "volume",
  priceMetric: "fob_per_bbl",
};

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useImportsExportsData(): UseImportsExportsData {
  const supabase = getSupabaseClient();
  const { visible, loading: visibilityLoading } = useModuleVisibilityGuard("imports-exports");

  const [filters, setFiltersState] = useState<ImportsExportsFilters>(DEFAULT_FILTERS);

  // Meta filtros (year+month bounds + product list)
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

  // Exports tab — stacked by country + YoY
  const [exportsPaisesData, setExportsPaisesData] = useState<IEExportsPaisesStackedRow[]>([]);
  const [exportsPaisesLoading, setExportsPaisesLoading] = useState(false);
  const [yoyExportsData, setYoyExportsData] = useState<IEExportsYoyRow[]>([]);
  const [yoyExportsLoading, setYoyExportsLoading] = useState(false);

  // Panel C — import price (mdic_comex)
  const [priceData, setPriceData] = useState<PricePoint[]>([]);
  const [priceLoading, setPriceLoading] = useState(false);

  // Panel D — imports unit price by origin country (USD/m³, mdic_comex)
  const [importsUnitPriceData, setImportsUnitPriceData] = useState<IEUnitPriceRow[]>([]);
  const [importsUnitPriceLoading, setImportsUnitPriceLoading] = useState(false);

  // Exports tab — unit price by destination country (USD/m³, mdic_comex)
  const [exportsUnitPriceData, setExportsUnitPriceData] = useState<IEUnitPriceRow[]>([]);
  const [exportsUnitPriceLoading, setExportsUnitPriceLoading] = useState(false);

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
        const next: FiltrosResult = {
          ano_min: result.ano_min,
          mes_min: result.mes_min,
          ano_max: result.ano_max,
          mes_max: result.mes_max,
          produtos: result.produtos as UnifiedProduct[],
        };
        setFiltros(next);
        // Default period: last 12 months ending at (ano_max, mes_max).
        const end: MonthCursor = { ano: next.ano_max, mes: next.mes_max };
        let start = addMonths(end, -11);
        // Clamp start ≥ (ano_min, mes_min)
        const lowerBound: MonthCursor = { ano: next.ano_min, mes: next.mes_min };
        if (cmpMonth(start, lowerBound) < 0) start = lowerBound;
        setFiltersState((prev) => ({
          ...prev,
          period: { start, end },
        }));
      })
      .catch((err) => console.error("get_imports_exports_filtros:", err))
      .finally(() => setFiltrosLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Memoised stable filter snapshot for effect dependencies
  const periodStartAno = filters.period.start.ano;
  const periodStartMes = filters.period.start.mes;
  const periodEndAno = filters.period.end.ano;
  const periodEndMes = filters.period.end.mes;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional shallow snapshot
  const stableFilters = useMemo(() => ({ ...filters }), [
    filters.unifiedProduct,
    periodStartAno,
    periodStartMes,
    periodEndAno,
    periodEndMes,
    filters.tab,
    filters.exportsYAxis,
    filters.priceMetric,
  ]);

  // ── Derived: YoY anchor = period.end (single-month semantics) ───────────────
  // Since migration 20260527000000_imports_exports_yoy_single_month.sql, the
  // YoY RPCs compare a single anchor month vs the SAME month one year prior
  // (previously: trailing 12m vs prior 12m). The anchor is always period.end
  // — never data-driven — so that the user's explicit choice is honoured even
  // when the trailing month has incomplete/zero data (renders as "n/a").
  // The legacy var names (yoyEndAno, yoyEndMes, yoyImportersEndMes, yoyExportsEndMes)
  // are preserved as part of the hook contract; they all collapse to period.end.
  const yoyEndAno = periodEndAno;
  const yoyEndMes = periodEndMes;
  const yoyImportersEndMes = periodEndMes;
  const yoyExportsEndMes = periodEndMes;

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
          periodStartAno,
          periodStartMes,
          periodEndAno,
          periodEndMes,
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
  }, [stableFilters.tab, stableFilters.unifiedProduct, periodStartAno, periodStartMes, periodEndAno, periodEndMes]);

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
          periodStartAno,
          periodStartMes,
          periodEndAno,
          periodEndMes,
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
  }, [stableFilters.tab, stableFilters.unifiedProduct, periodStartAno, periodStartMes, periodEndAno, periodEndMes]);

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
  }, [stableFilters.tab, stableFilters.unifiedProduct, yoyEndAno, yoyEndMes]);

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
  }, [stableFilters.tab, stableFilters.unifiedProduct, yoyEndAno, yoyImportersEndMes]);

  // ── 6a. Exports tab — stacked by destination country ───────────────────────
  const exportsPaisesFetchIdRef = useRef(0);
  const exportsPaisesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!supabase || stableFilters.tab !== "exports") return;
    if (exportsPaisesTimerRef.current) clearTimeout(exportsPaisesTimerRef.current);
    const myId = ++exportsPaisesFetchIdRef.current;
    exportsPaisesTimerRef.current = setTimeout(async () => {
      setExportsPaisesLoading(true);
      try {
        const rows = await rpcGetImportsExportsExportsPaisesStacked(
          supabase,
          stableFilters.unifiedProduct,
          periodStartAno,
          periodStartMes,
          periodEndAno,
          periodEndMes,
          stableFilters.exportsYAxis,
          10,
        );
        if (myId === exportsPaisesFetchIdRef.current) setExportsPaisesData(rows);
      } catch (err) {
        console.error("get_imports_exports_exports_paises_stacked:", err);
      } finally {
        if (myId === exportsPaisesFetchIdRef.current) setExportsPaisesLoading(false);
      }
    }, 400);
    return () => { if (exportsPaisesTimerRef.current) clearTimeout(exportsPaisesTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableFilters.tab, stableFilters.unifiedProduct, periodStartAno, periodStartMes, periodEndAno, periodEndMes, stableFilters.exportsYAxis]);

  // ── 6b. Exports tab — YoY table by destination country ─────────────────────
  const yoyExportsFetchIdRef = useRef(0);
  const yoyExportsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!supabase || stableFilters.tab !== "exports") return;
    if (yoyExportsTimerRef.current) clearTimeout(yoyExportsTimerRef.current);
    const myId = ++yoyExportsFetchIdRef.current;
    yoyExportsTimerRef.current = setTimeout(async () => {
      setYoyExportsLoading(true);
      try {
        const rows = await rpcGetImportsExportsExportsYoyTable(
          supabase,
          stableFilters.unifiedProduct,
          yoyEndAno,
          yoyExportsEndMes,
          stableFilters.exportsYAxis,
          10,
        );
        if (myId === yoyExportsFetchIdRef.current) setYoyExportsData(rows);
      } catch (err) {
        console.error("get_imports_exports_exports_yoy_table:", err);
      } finally {
        if (myId === yoyExportsFetchIdRef.current) setYoyExportsLoading(false);
      }
    }, 400);
    return () => { if (yoyExportsTimerRef.current) clearTimeout(yoyExportsTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableFilters.tab, stableFilters.unifiedProduct, stableFilters.exportsYAxis, yoyEndAno, yoyExportsEndMes]);

  // ── 7. Panel C — import price (mdic_comex, single active product) ────────────
  const priceFetchIdRef = useRef(0);
  const priceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!supabase || stableFilters.tab !== "imports") return;
    if (priceTimerRef.current) clearTimeout(priceTimerRef.current);
    const myId = ++priceFetchIdRef.current;
    priceTimerRef.current = setTimeout(async () => {
      setPriceLoading(true);
      try {
        const rows = await rpcGetImportsExportsFobPriceSerie(
          supabase,
          stableFilters.unifiedProduct,
          periodStartAno,
          periodStartMes,
          periodEndAno,
          periodEndMes,
        );
        if (myId !== priceFetchIdRef.current) return;
        const metric = stableFilters.priceMetric;
        const points: PricePoint[] = rows.map((r) => ({
          ano: r.ano,
          mes: r.mes,
          product: stableFilters.unifiedProduct,
          value: r[metric],
        }));
        setPriceData(points);
      } catch (err) {
        console.error("get_imports_exports_fob_price_serie:", err);
      } finally {
        if (myId === priceFetchIdRef.current) setPriceLoading(false);
      }
    }, 400);
    return () => { if (priceTimerRef.current) clearTimeout(priceTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableFilters.tab, stableFilters.unifiedProduct, periodStartAno, periodStartMes, periodEndAno, periodEndMes, stableFilters.priceMetric]);

  // ── 8. Panel D — imports unit price by origin country (mdic_comex) ──────────
  const importsUPFetchIdRef = useRef(0);
  const importsUPTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!supabase || stableFilters.tab !== "imports") return;
    if (importsUPTimerRef.current) clearTimeout(importsUPTimerRef.current);
    const myId = ++importsUPFetchIdRef.current;
    importsUPTimerRef.current = setTimeout(async () => {
      setImportsUnitPriceLoading(true);
      try {
        const rows = await rpcGetImportsExportsImportsUnitPrice(
          supabase,
          stableFilters.unifiedProduct,
          periodStartAno,
          periodStartMes,
          periodEndAno,
          periodEndMes,
          8,
        );
        if (myId === importsUPFetchIdRef.current) setImportsUnitPriceData(rows);
      } catch (err) {
        console.error("get_imports_exports_imports_unit_price:", err);
      } finally {
        if (myId === importsUPFetchIdRef.current) setImportsUnitPriceLoading(false);
      }
    }, 400);
    return () => { if (importsUPTimerRef.current) clearTimeout(importsUPTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableFilters.tab, stableFilters.unifiedProduct, periodStartAno, periodStartMes, periodEndAno, periodEndMes]);

  // ── 9. Exports unit price by destination country (mdic_comex) ───────────────
  const exportsUPFetchIdRef = useRef(0);
  const exportsUPTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!supabase || stableFilters.tab !== "exports") return;
    if (exportsUPTimerRef.current) clearTimeout(exportsUPTimerRef.current);
    const myId = ++exportsUPFetchIdRef.current;
    exportsUPTimerRef.current = setTimeout(async () => {
      setExportsUnitPriceLoading(true);
      try {
        const rows = await rpcGetImportsExportsExportsUnitPrice(
          supabase,
          stableFilters.unifiedProduct,
          periodStartAno,
          periodStartMes,
          periodEndAno,
          periodEndMes,
          8,
        );
        if (myId === exportsUPFetchIdRef.current) setExportsUnitPriceData(rows);
      } catch (err) {
        console.error("get_imports_exports_exports_unit_price:", err);
      } finally {
        if (myId === exportsUPFetchIdRef.current) setExportsUnitPriceLoading(false);
      }
    }, 400);
    return () => { if (exportsUPTimerRef.current) clearTimeout(exportsUPTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableFilters.tab, stableFilters.unifiedProduct, periodStartAno, periodStartMes, periodEndAno, periodEndMes]);

  // ── Derived: month list + period badge ──────────────────────────────────────
  const monthList = useMemo(() => {
    if (!filtros) return [];
    return buildMonthList(filtros.ano_min, filtros.mes_min, filtros.ano_max, filtros.mes_max);
  }, [filtros]);

  const periodBadge = useMemo(() => {
    const startLbl = formatMonth(periodStartAno, periodStartMes);
    const endLbl = formatMonth(periodEndAno, periodEndMes);
    if (startLbl === endLbl) return startLbl;
    return `${startLbl} – ${endLbl}`;
  }, [periodStartAno, periodStartMes, periodEndAno, periodEndMes]);

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
    exportsPaisesData,
    exportsPaisesLoading,
    yoyExportsData,
    yoyExportsLoading,
    priceData,
    priceLoading,
    importsUnitPriceData,
    importsUnitPriceLoading,
    exportsUnitPriceData,
    exportsUnitPriceLoading,
    monthList,
    periodBadge,
    yoyEndAno,
    yoyEndMes,
    yoyImportersEndMes,
    yoyExportsEndMes,
    visible,
    visibilityLoading,
  };
}
