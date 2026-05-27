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
//   + Panel D (unit price by origin country, USD/m³) + price summary table.
// Exports tab: stacked area by destination country (top-10 + Others) + YoY table.
//   Source: mdic_comex (migration 20260525000110). RPC get_imports_exports_exports_serie DROPPED.
//   For Crude Oil: unit price by destination country + price summary table.
//
// Panel C ("Import Price USD/bbl") was removed 2026-05-28. The orphaned RPC
// get_imports_exports_fob_price_serie was dropped in migration 20260528960000.
// Replacement is the new Imports / Exports Price Summary tables — top-2 origin
// countries by volume + weighted-average "Others" row (imports) or top-N
// destinations (exports), with Latest / MoM% / YoY% columns derived from the
// existing unit-price RPCs (now augmented with vol_m3 server-side).
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
  rpcGetImportsExportsImportsUnitPrice,
  rpcGetImportsExportsExportsUnitPrice,
} from "@/lib/rpc";
import type {
  IEExportsPaisesStackedRow,
  IEExportsYoyRow,
  IEUnitPriceRow,
} from "@/lib/rpc";
import { PALETTE } from "@/lib/plotlyDefaults";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type UnifiedProduct = "Diesel" | "Gasoline" | "Crude Oil";

export type ImportsExportsTab = "imports" | "exports";

export type ExportsYAxis = "volume" | "usd";

// Imports Panel D unit toggle — also drives the imports price summary table.
// "usd_per_ton" applies a per-product density (Diesel 832, Gasoline 745,
// Crude Oil 870 kg/m³). "cents_per_gal" applies 264.172 gal per m³ × 100.
export type ImportsUnitPriceMetric = "usd_per_ton" | "cents_per_gal";

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

export interface ImportsExportsFilters {
  unifiedProduct: UnifiedProduct;
  period: Period;
  tab: ImportsExportsTab;
  exportsYAxis: ExportsYAxis;
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

// One row of the Imports / Exports price summary table.
// `latest` is already converted to the display unit (USD/ton or ¢/gal for
// imports — chosen by the local toggle; USD/bbl for exports — fixed).
// `momPct` / `yoyPct` are computed on the SAME converted unit so the
// percentage deltas match the displayed Latest value.
// `color` mirrors the chart legend color so the table dots align with the
// per-country line on the chart above.
export interface PriceSummaryRow {
  country: string;        // English label as rendered in the chart legend
  latest: number;
  momPct: number | null;  // null when prior month is missing or zero
  yoyPct: number | null;  // null when same-month-prev-year is missing or zero
  color?: string;
}

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

  // Imports tab — Panel D (unit price by origin country, USD/m³)
  importsUnitPriceData: IEUnitPriceRow[];
  importsUnitPriceLoading: boolean;

  // Panel D chart-only derivation. Exactly 3 series (top-2 origin countries
  // by SUM(vol_m3) in the window + an "Others" row whose monthly value is
  // Σ(usd_per_m3 × vol_m3) / Σ(vol_m3) across the remaining countries).
  // Months where Σ(vol_m3) == 0 for Others are silently dropped.
  // Rows carry English country labels (Russia / United States / Others) so
  // the chart legend matches the Imports Price Summary table 1:1.
  // The underlying `importsUnitPriceData` (raw top-N from RPC) remains
  // available for the table's per-country ranking and other consumers.
  importsUnitPriceChartData: IEUnitPriceRow[];
  /** Ordered list of the 3 chart entity labels (top-2 + "Others"). */
  importsUnitPriceChartEntities: string[];
  /** Color per chart entity. Pinned countries use their fixed palette color;
   *  non-pinned countries fall back to PALETTE rotation; "Others" is grey. */
  importsUnitPriceChartColorMap: Record<string, string>;

  // Exports tab — unit price by destination country (USD/m³)
  exportsUnitPriceData: IEUnitPriceRow[];
  exportsUnitPriceLoading: boolean;

  // Local toggle for the imports unit price view (chart + summary table).
  // Lives in the hook (not local View state) so both desktop and mobile share
  // the same value and the price summary derivation uses the same unit math.
  importsUPMetric: ImportsUnitPriceMetric;
  setImportsUPMetric: (next: ImportsUnitPriceMetric) => void;

  // Imports / Exports price summary tables (derived client-side from
  // importsUnitPriceData / exportsUnitPriceData and the active unit toggle).
  // Imports: exactly 3 rows — top-2 origin countries by total vol_m3 in the
  // window + an "Others" row carrying the volume-weighted average price of
  // the remaining countries. Values are in the unit dictated by importsUPMetric.
  // Exports: all top-N destination countries returned by the RPC, no Others.
  // Values are in USD/bbl (fixed).
  importsPriceSummary: PriceSummaryRow[];
  exportsPriceSummary: PriceSummaryRow[];

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

// Density by unified product (kg/m³). Mirrors the constants declared in both
// Views — duplicated here because the price summary derivation needs the same
// math (USD/m³ → USD/ton requires density). Values match ncm_densidade_kg_m3
// (Diesel 832, Gasoline 745, Crude Oil 870).
const PRODUCT_DENSITY_KG_M3: Record<string, number> = {
  Diesel: 832,
  Gasoline: 745,
  "Crude Oil": 870,
};

// Gallons per m³ (US liquid gallon).
const GAL_PER_M3 = 264.172;

// 1 m³ = 6.2898 bbl (international standard for petroleum). Used for the
// exports price summary (Crude Oil only).
const M3_PER_BBL = 6.2898;

// Pinned origin-country palette — duplicated from the Views because both
// Views share the same pin set and the price summary's color column must
// match the chart legend exactly. Keep in sync with desktop/View.tsx and
// mobile/View.tsx if the pin set ever changes.
const ORIGIN_COUNTRY_PINS_DATA: ReadonlyArray<{
  dbName: string;
  label: string;
  color: string;
}> = [
  { dbName: "Rússia", label: "Russia", color: "#000000" },
  { dbName: "Estados Unidos", label: "United States", color: "#FF5000" },
  { dbName: "Emirados Árabes Unidos", label: "UAE", color: "#73C6A1" },
  { dbName: "Países Baixos (Holanda)", label: "Netherlands", color: "#FFAE66" },
  { dbName: "Índia", label: "India", color: "#8258A0" },
  { dbName: "Arábia Saudita", label: "Saudi Arabia", color: "#D2FF00" },
];

const ORIGIN_LABEL_BY_DB_DATA: Record<string, string> = ORIGIN_COUNTRY_PINS_DATA.reduce(
  (acc, p) => ({ ...acc, [p.dbName]: p.label }),
  {} as Record<string, string>,
);

const ORIGIN_COLOR_BY_LABEL_DATA: Record<string, string> = ORIGIN_COUNTRY_PINS_DATA.reduce(
  (acc, p) => ({ ...acc, [p.label]: p.color }),
  {} as Record<string, string>,
);

const OTHERS_COLOR_DATA = "#7F7F7F";
const OTHERS_LABEL_DATA = "Others";

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

  // Panel D — imports unit price by origin country (USD/m³, mdic_comex)
  const [importsUnitPriceData, setImportsUnitPriceData] = useState<IEUnitPriceRow[]>([]);
  const [importsUnitPriceLoading, setImportsUnitPriceLoading] = useState(false);

  // Exports tab — unit price by destination country (USD/m³, mdic_comex)
  const [exportsUnitPriceData, setExportsUnitPriceData] = useState<IEUnitPriceRow[]>([]);
  const [exportsUnitPriceLoading, setExportsUnitPriceLoading] = useState(false);

  // Imports unit price view toggle (shared across views + summary table).
  const [importsUPMetric, setImportsUPMetric] = useState<ImportsUnitPriceMetric>("usd_per_ton");

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

  // ── 7. Panel D — imports unit price by origin country (mdic_comex) ──────────
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

  // ── 8. Exports unit price by destination country (mdic_comex) ───────────────
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

  // ── Derived: Imports / Exports price summary tables ─────────────────────────
  //
  // Algorithm (mirror description in CLAUDE.md § B2 of the price-summary plan):
  //  1. Choose the source rows (importsUnitPriceData / exportsUnitPriceData)
  //     and apply the same unit conversion that the chart uses, so that the
  //     `latest` cell in the table matches the rightmost line in the chart.
  //     - Imports `usd_per_ton` (default toggle): density-based conversion.
  //     - Imports `cents_per_gal`: divide by gal/m³, ×100.
  //     - Exports: USD/bbl fixed (Crude Oil only renders, but we compute for all).
  //  2. Imports only: rank countries by SUM(vol_m3) over the entire window
  //     (server already returns top-N — typically 8 — so we just sort by the
  //     in-period total). Keep top-2. Collapse the rest into an "Others"
  //     synthetic series whose monthly value is a volume-weighted average of
  //     remaining countries: y(m) = Σ(usd_per_m3 × vol_m3) / Σ(vol_m3).
  //     If Σ(vol_m3) == 0 for that month, the value is null.
  //  3. Exports: every country returned by the RPC becomes a row (no Others).
  //  4. For each surviving series, find the latest month (period.end if
  //     present, otherwise the last available non-null point).
  //     - latest    = value at that month
  //     - momPct    = (latest − prior_month) / prior_month × 100; null if
  //                   the prior month value is missing or zero.
  //     - yoyPct    = (latest − same_month_year_before) / same_month_year_before × 100;
  //                   null if missing/zero.
  //  5. Apply the unit conversion BEFORE computing momPct / yoyPct so that the
  //     deltas are computed on the displayed unit (the percentage is unit-
  //     agnostic for linear conversions, so this is mostly cosmetic, but it
  //     avoids surprises in edge cases).
  //  6. Attach the chart legend color (`color`) so the table dot matches.

  // Imports price summary
  const importsPriceSummary: PriceSummaryRow[] = useMemo(() => {
    if (!importsUnitPriceData.length) return [];

    // 1. Unit conversion fn for the active metric.
    const density = PRODUCT_DENSITY_KG_M3[filters.unifiedProduct] ?? 840;
    const convert: (usdPerM3: number) => number =
      importsUPMetric === "usd_per_ton"
        ? (v) => v / (density / 1000)
        : (v) => (v / GAL_PER_M3) * 100;

    // 2. Group rows by country, compute total vol_m3 in the window, sort desc.
    type Aggr = { totalVol: number; byMonth: Map<string, { p: number | null; v: number }> };
    const byCountry = new Map<string, Aggr>();
    for (const r of importsUnitPriceData) {
      const key = `${r.ano}-${String(r.mes).padStart(2, "0")}`;
      let agg = byCountry.get(r.pais);
      if (!agg) {
        agg = { totalVol: 0, byMonth: new Map() };
        byCountry.set(r.pais, agg);
      }
      agg.totalVol += r.vol_m3;
      agg.byMonth.set(key, { p: r.usd_per_m3, v: r.vol_m3 });
    }
    const countries = Array.from(byCountry.entries()).sort(
      ([, a], [, b]) => b.totalVol - a.totalVol,
    );

    // 3. Helper — given a per-month value lookup and an anchor month cursor,
    // compute latest / mom / yoy on the converted unit.
    type MonthAgg = Map<string, { p: number | null; v: number }>;
    function evaluateSeries(byMonth: MonthAgg): {
      latest: number;
      momPct: number | null;
      yoyPct: number | null;
    } | null {
      // Find latest non-null month, prefer period.end if present.
      const endKey = `${periodEndAno}-${String(periodEndMes).padStart(2, "0")}`;
      let anchorAno = periodEndAno;
      let anchorMes = periodEndMes;
      let anchorEntry = byMonth.get(endKey);
      if (!anchorEntry || anchorEntry.p == null) {
        // Walk backwards through months until we find a non-null point or
        // run out of in-window data.
        let y = periodEndAno;
        let m = periodEndMes;
        anchorEntry = undefined;
        for (let i = 0; i < 600; i += 1) {
          m -= 1;
          if (m === 0) {
            m = 12;
            y -= 1;
          }
          if (y < periodStartAno || (y === periodStartAno && m < periodStartMes)) break;
          const k = `${y}-${String(m).padStart(2, "0")}`;
          const e = byMonth.get(k);
          if (e && e.p != null) {
            anchorEntry = e;
            anchorAno = y;
            anchorMes = m;
            break;
          }
        }
      }
      if (!anchorEntry || anchorEntry.p == null) return null;

      const latestUsdPerM3 = anchorEntry.p;
      const latest = convert(latestUsdPerM3);

      // Prior-month cursor.
      const priorMes = anchorMes === 1 ? 12 : anchorMes - 1;
      const priorAno = anchorMes === 1 ? anchorAno - 1 : anchorAno;
      const priorKey = `${priorAno}-${String(priorMes).padStart(2, "0")}`;
      const priorEntry = byMonth.get(priorKey);
      const momPct =
        priorEntry && priorEntry.p != null && priorEntry.p !== 0
          ? ((latestUsdPerM3 - priorEntry.p) / priorEntry.p) * 100
          : null;

      // YoY cursor (same month, 1 year back).
      const yoyKey = `${anchorAno - 1}-${String(anchorMes).padStart(2, "0")}`;
      const yoyEntry = byMonth.get(yoyKey);
      const yoyPct =
        yoyEntry && yoyEntry.p != null && yoyEntry.p !== 0
          ? ((latestUsdPerM3 - yoyEntry.p) / yoyEntry.p) * 100
          : null;

      return { latest, momPct, yoyPct };
    }

    // 4. Top-2 countries → individual rows.
    const top2 = countries.slice(0, 2);
    const rest = countries.slice(2);

    const out: PriceSummaryRow[] = [];
    for (const [pais, agg] of top2) {
      const ev = evaluateSeries(agg.byMonth);
      if (!ev) continue;
      const englishLabel = ORIGIN_LABEL_BY_DB_DATA[pais] ?? pais;
      const color = ORIGIN_COLOR_BY_LABEL_DATA[englishLabel];
      out.push({ country: englishLabel, latest: ev.latest, momPct: ev.momPct, yoyPct: ev.yoyPct, color });
    }

    // 5. "Others" — volume-weighted monthly average of `rest`.
    if (rest.length) {
      const othersByMonth = new Map<string, { p: number | null; v: number }>();
      // Union of all (rest) month keys
      const monthKeys = new Set<string>();
      for (const [, agg] of rest) {
        for (const k of agg.byMonth.keys()) monthKeys.add(k);
      }
      for (const k of monthKeys) {
        let weightedNum = 0;
        let weightDen = 0;
        for (const [, agg] of rest) {
          const e = agg.byMonth.get(k);
          if (!e || e.p == null || e.v <= 0) continue;
          weightedNum += e.p * e.v;
          weightDen += e.v;
        }
        const avg = weightDen > 0 ? weightedNum / weightDen : null;
        const totalV = (() => {
          let s = 0;
          for (const [, agg] of rest) {
            const e = agg.byMonth.get(k);
            if (e && e.v > 0) s += e.v;
          }
          return s;
        })();
        othersByMonth.set(k, { p: avg, v: totalV });
      }
      const ev = evaluateSeries(othersByMonth);
      if (ev) {
        out.push({
          country: OTHERS_LABEL_DATA,
          latest: ev.latest,
          momPct: ev.momPct,
          yoyPct: ev.yoyPct,
          color: OTHERS_COLOR_DATA,
        });
      }
    }

    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    importsUnitPriceData,
    importsUPMetric,
    filters.unifiedProduct,
    periodStartAno,
    periodStartMes,
    periodEndAno,
    periodEndMes,
  ]);

  // Panel D chart data — same top-2 ranking as importsPriceSummary, but
  // emitted as IEUnitPriceRow[] rows in raw USD/m³ so the chart applies its
  // own unit conversion (USD/ton or ¢/gal). The "Others" series carries the
  // volume-weighted average across non-top-2 countries per month; months
  // where Σ(vol_m3) == 0 are silently omitted (no zero/null row emitted).
  //
  // Rationale: the prior implementation rendered the 6 pinned origin
  // countries on the chart while the summary table beneath rendered only 3
  // rows (top-2 + Others). The user requested chart ↔ table parity, so the
  // chart now also collapses to exactly 3 series.
  //
  // Side outputs (importsUnitPriceChartEntities + importsUnitPriceChartColorMap)
  // let the Views pass the canonical legend order and color map to their
  // local buildUnitPriceTraces helper without re-deriving the top-2 ranking.
  const importsUnitPriceChartDerivation = useMemo(() => {
    if (!importsUnitPriceData.length) {
      return {
        rows: [] as IEUnitPriceRow[],
        entities: [] as string[],
        colorMap: {} as Record<string, string>,
      };
    }

    // 1. Group rows by country (DB name), compute total vol_m3 in window,
    //    sort desc. Top-2 by total volume → kept as individual series;
    //    rest collapsed into a single "Others" series per month.
    type Aggr = { totalVol: number; rows: IEUnitPriceRow[] };
    const byCountry = new Map<string, Aggr>();
    for (const r of importsUnitPriceData) {
      let agg = byCountry.get(r.pais);
      if (!agg) {
        agg = { totalVol: 0, rows: [] };
        byCountry.set(r.pais, agg);
      }
      agg.totalVol += r.vol_m3;
      agg.rows.push(r);
    }
    const ranked = Array.from(byCountry.entries()).sort(
      ([, a], [, b]) => b.totalVol - a.totalVol,
    );
    const top2 = ranked.slice(0, 2);
    const rest = ranked.slice(2);

    const out: IEUnitPriceRow[] = [];
    const entities: string[] = [];
    const colorMap: Record<string, string> = {};

    // 2. Top-2: emit rows directly under their English label; colors come
    //    from the pinned-country palette when the country is in the pin set,
    //    PALETTE rotation otherwise.
    for (let i = 0; i < top2.length; i += 1) {
      const [dbName, agg] = top2[i];
      const englishLabel = ORIGIN_LABEL_BY_DB_DATA[dbName] ?? dbName;
      const color =
        ORIGIN_COLOR_BY_LABEL_DATA[englishLabel] ?? PALETTE[i % PALETTE.length] ?? OTHERS_COLOR_DATA;
      entities.push(englishLabel);
      colorMap[englishLabel] = color;
      for (const r of agg.rows) {
        out.push({
          ano: r.ano,
          mes: r.mes,
          pais: englishLabel,
          usd_per_m3: r.usd_per_m3,
          vol_m3: r.vol_m3,
        });
      }
    }

    // 3. Others: per-(ano,mes), volume-weighted average across remaining
    //    countries. Month-key set = union of all months the rest cover.
    //    If Σ(vol_m3) == 0 for a month (no usable rows), skip that month
    //    entirely — no null/zero point emitted, so the chart simply has a
    //    gap there (connectgaps handles it visually).
    if (rest.length) {
      const monthBuckets = new Map<string, { num: number; den: number; ano: number; mes: number }>();
      for (const [, agg] of rest) {
        for (const r of agg.rows) {
          if (r.usd_per_m3 == null || r.vol_m3 <= 0) continue;
          const key = `${r.ano}-${String(r.mes).padStart(2, "0")}`;
          let bucket = monthBuckets.get(key);
          if (!bucket) {
            bucket = { num: 0, den: 0, ano: r.ano, mes: r.mes };
            monthBuckets.set(key, bucket);
          }
          bucket.num += r.usd_per_m3 * r.vol_m3;
          bucket.den += r.vol_m3;
        }
      }
      const hasOthers = Array.from(monthBuckets.values()).some((b) => b.den > 0);
      if (hasOthers) {
        entities.push(OTHERS_LABEL_DATA);
        colorMap[OTHERS_LABEL_DATA] = OTHERS_COLOR_DATA;
        for (const bucket of monthBuckets.values()) {
          if (bucket.den <= 0) continue;
          out.push({
            ano: bucket.ano,
            mes: bucket.mes,
            pais: OTHERS_LABEL_DATA,
            usd_per_m3: bucket.num / bucket.den,
            vol_m3: bucket.den,
          });
        }
      }
    }

    return { rows: out, entities, colorMap };
  }, [importsUnitPriceData]);

  const importsUnitPriceChartData = importsUnitPriceChartDerivation.rows;
  const importsUnitPriceChartEntities = importsUnitPriceChartDerivation.entities;
  const importsUnitPriceChartColorMap = importsUnitPriceChartDerivation.colorMap;

  // Exports price summary — every top-N destination, USD/bbl fixed.
  const exportsPriceSummary: PriceSummaryRow[] = useMemo(() => {
    if (!exportsUnitPriceData.length) return [];

    const convert = (v: number) => v / M3_PER_BBL;

    type Aggr = { totalVol: number; byMonth: Map<string, { p: number | null; v: number }> };
    const byCountry = new Map<string, Aggr>();
    for (const r of exportsUnitPriceData) {
      const key = `${r.ano}-${String(r.mes).padStart(2, "0")}`;
      let agg = byCountry.get(r.pais);
      if (!agg) {
        agg = { totalVol: 0, byMonth: new Map() };
        byCountry.set(r.pais, agg);
      }
      agg.totalVol += r.vol_m3;
      agg.byMonth.set(key, { p: r.usd_per_m3, v: r.vol_m3 });
    }
    const countries = Array.from(byCountry.entries()).sort(
      ([, a], [, b]) => b.totalVol - a.totalVol,
    );

    // For exports the chart legend colors come from PALETTE rotation in the
    // Views (no pinned palette for destinations). We attach undefined here
    // and let the View pick the color via the same `colourForEntity` it uses
    // for the chart — this keeps the table dot in lockstep with the chart.
    const out: PriceSummaryRow[] = [];
    for (const [pais, agg] of countries) {
      // Inline evaluator (same shape as imports' evaluateSeries).
      const endKey = `${periodEndAno}-${String(periodEndMes).padStart(2, "0")}`;
      let anchorAno = periodEndAno;
      let anchorMes = periodEndMes;
      let anchorEntry = agg.byMonth.get(endKey);
      if (!anchorEntry || anchorEntry.p == null) {
        let y = periodEndAno;
        let m = periodEndMes;
        anchorEntry = undefined;
        for (let i = 0; i < 600; i += 1) {
          m -= 1;
          if (m === 0) {
            m = 12;
            y -= 1;
          }
          if (y < periodStartAno || (y === periodStartAno && m < periodStartMes)) break;
          const k = `${y}-${String(m).padStart(2, "0")}`;
          const e = agg.byMonth.get(k);
          if (e && e.p != null) {
            anchorEntry = e;
            anchorAno = y;
            anchorMes = m;
            break;
          }
        }
      }
      if (!anchorEntry || anchorEntry.p == null) continue;
      const latest = convert(anchorEntry.p);
      const priorMes = anchorMes === 1 ? 12 : anchorMes - 1;
      const priorAno = anchorMes === 1 ? anchorAno - 1 : anchorAno;
      const priorKey = `${priorAno}-${String(priorMes).padStart(2, "0")}`;
      const priorEntry = agg.byMonth.get(priorKey);
      const momPct =
        priorEntry && priorEntry.p != null && priorEntry.p !== 0
          ? ((anchorEntry.p - priorEntry.p) / priorEntry.p) * 100
          : null;
      const yoyKey = `${anchorAno - 1}-${String(anchorMes).padStart(2, "0")}`;
      const yoyEntry = agg.byMonth.get(yoyKey);
      const yoyPct =
        yoyEntry && yoyEntry.p != null && yoyEntry.p !== 0
          ? ((anchorEntry.p - yoyEntry.p) / yoyEntry.p) * 100
          : null;
      out.push({ country: pais, latest, momPct, yoyPct });
    }

    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    exportsUnitPriceData,
    periodStartAno,
    periodStartMes,
    periodEndAno,
    periodEndMes,
  ]);

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
    importsUnitPriceData,
    importsUnitPriceLoading,
    importsUnitPriceChartData,
    importsUnitPriceChartEntities,
    importsUnitPriceChartColorMap,
    exportsUnitPriceData,
    exportsUnitPriceLoading,
    importsUPMetric,
    setImportsUPMetric,
    importsPriceSummary,
    exportsPriceSummary,
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
