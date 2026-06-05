"use client";

// ─── useStockGuideData — single brain for the /stock-guide dual-view ──────────
//
// Both desktop/View.tsx and mobile/View.tsx consume this hook exclusively.
// Neither View calls Supabase, fetches quotes, or derives the table independently.
//
// Contract (canonical dual-view shape + Stock Guide extras):
//   { rows, loading, error, refetch, filters, setFilters, ...derived }
//
// What this hook owns
// ───────────────────
//   a. Fetch comps + config + drivers + sensitivity tables on mount (one
//      batched Promise.all, fetch-id guard — subsidy-tracker pattern).
//   b. Partition: `visibleRows` (full comps) vs `restrictedNames` (hidden →
//      company_name only). The restricted footnote is built from `restrictedNames`.
//   c. LIVE QUOTES via the existing Yahoo proxy (`useStockQuote` →
//      `/api/stocks/quote?tickers=`). Collect `yahoo_symbol` (fallback ticker)
//      of VISIBLE rows → ONE batched fetch on load + a manual `refreshQuotes()`.
//      No polling ticker — comps are snapshots; respect the proxy rate limit.
//      (Hidden tickers are stripped server-side from the sensitivity tables too,
//      so the visible-comps quote list already covers every ticker that can
//      appear in any table.)
//   d. Derive per visible row: livePrice / marketCapBrlMn / upsidePct + the 4
//      live multiples (null-safe). A `liveByTicker` index exposes livePrice +
//      marketCapBrlMn per ticker for the sensitivity-cell helper.
//   e. Sensitivity drill-down (REDESIGNED): expose `drivers` + `sensitivityTables`
//      and a derived `selectedTables` = tables where `selectedTicker ∈ companies`,
//      sorted by display_order. `selectedTicker`/`selectTicker` default = first
//      visible company (NO per-table fetch — tables arrive in the initial batch).
//      `computeSensitivityCell()` turns a (table,row,col) into a DISPLAY value;
//      `resolveDriverAxis()` maps a driver axis → { driver, scenarios }.
//   f. Optional sectorFilter; `setFilters` merges partials.
//   g. Desktop-only export (Excel + CSV) of the computed VISIBLE table.
//
// Hidden companies' financials never reach this hook for a non-admin: the
// SECURITY DEFINER RPC nulls them server-side (incl. yahoo_symbol), so a
// restricted ticker is structurally absent from the quote request.
//
// Binding sync rule (CLAUDE.md § Dual-view): a meaningful change here usually
// serves BOTH views; a change to one View must land in the other in the same
// commit or carry a [desktop-only]/[mobile-only] tag.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getSupabaseClient } from "@/lib/supabaseClient";
import { useStockQuote } from "@/hooks/useStockQuote";
import {
  useMarketDrivers,
  resolveDriverValue,
  MARKET_DRIVER_CATALOG_BY_KEY,
} from "@/hooks/useMarketDrivers";
import {
  rpcGetStockGuideComps,
  rpcGetStockGuideConfig,
  rpcGetStockGuideDrivers,
  rpcGetStockGuideSensitivityTables,
  rpcGetStockGuideScenarioGrid,
} from "@/lib/rpc";
import { downloadGenericExcel } from "@/lib/exportExcel";
import { downloadCsv } from "@/lib/exportCsv";
import {
  computeSensitivityCellValue,
  formatSensitivityValue,
  unitForValueMode,
  interpolateGrid,
  type GridPoint,
} from "@/lib/stockGuideSensitivity";
import type {
  StockGuideCompany,
  StockGuideComputedRow,
  StockGuideConfig,
  StockGuideSector,
  StockGuideDriver,
  SensitivityAxis,
  SensitivityTable,
} from "@/types/stockGuide";

// ─── Filters ───────────────────────────────────────────────────────────────

export interface StockGuideFilters {
  /** When set, only visible rows of this sector are shown. null = all sectors. */
  sectorFilter: StockGuideSector | null;
}

const DEFAULT_FILTERS: StockGuideFilters = {
  sectorFilter: null,
};

// ─── Hook return shape ───────────────────────────────────────────────────────

export interface UseStockGuideData {
  /** Raw comps (all companies, hide-aware) straight from the RPC. */
  rows: StockGuideCompany[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;

  filters: StockGuideFilters;
  setFilters: (next: Partial<StockGuideFilters>) => void;

  /** Global config (forward-year labels + assumptions note). */
  config: StockGuideConfig;

  /** Visible companies with live-derived fields, after the sector filter. */
  computedRows: StockGuideComputedRow[];
  /** Distinct sectors present among visible rows (drives the filter UI). */
  sectorsPresent: StockGuideSector[];

  /** Names of hidden companies (for the "Currently restricted" footnote). */
  restrictedNames: string[];

  /**
   * Derived unit-margin footnote for the fuel distributors (EBITDA ÷ volumes,
   * R$/m³, whole number), or null if neither distributor has the data. Built
   * from `ebitda_yN` (BRL mn) and `volumes_yN` (thousand m³) for VBBR3 + UGPA3.
   * Rendered in both Views.
   */
  unitMarginNote: string | null;

  /**
   * Footnote flagging the companies whose P/E denominator uses ADJUSTED net
   * income (e.g. Vibra), or null when none. Rendered in both Views next to the
   * live-derivation note.
   */
  adjustedEarningsNote: string | null;

  /** Live-quote state for the batched fetch. */
  quotesLoading: boolean;
  quotesError: string | null;
  /** Manual one-shot re-fetch of all visible tickers' quotes. */
  refreshQuotes: () => void;

  // ── Redesigned sensitivity model ──────────────────────────────────────────
  /** Central driver registry (Brent, USD/BRL, …) — drives axis highlighting. */
  drivers: StockGuideDriver[];
  /**
   * Live-computed values for the DYNAMIC drivers (catalog key → number | null).
   * Static drivers are absent here; resolve any driver's effective value via the
   * `resolveDriverAxis` helper (which already folds this in). Exposed for callers
   * that want the raw map.
   */
  marketValues: Record<string, number | null>;
  /** True while the market-data fetch backing the dynamic drivers is in flight. */
  marketDriversLoading: boolean;
  /** All hide-aware sensitivity tables (display_order), straight from the RPC. */
  sensitivityTables: SensitivityTable[];

  // Drill-down: which company's tables are shown.
  selectedTicker: string | null;
  selectTicker: (ticker: string) => void;
  /** Tables involving `selectedTicker`, sorted by display_order. */
  selectedTables: SensitivityTable[];

  /**
   * Pure helper: compute a cell's DISPLAY value for (table, rowIdx, colIdx)
   * given the live numbers. Returns `null` (→ render "—") when missing data or
   * a guarded divide-by-zero / non-positive denominator. Stable identity.
   */
  computeSensitivityCell: (
    table: SensitivityTable,
    rowIdx: number,
    colIdx: number,
  ) => SensitivityCellValue;

  /**
   * Pure helper: resolve a driver axis → its `StockGuideDriver` (or null if the
   * axis isn't a driver / the id is unknown) + the per-table scenario values.
   * Stable identity.
   */
  resolveDriverAxis: (axis: SensitivityAxis) => ResolvedDriverAxis;

  // ── Scenario-grid (1-D Brent interpolation) sensitivity ─────────────────────
  /**
   * True when a table is a SCENARIO GRID (has `definition.grid`). Views switch to
   * the Brent-slider interpolation panel for these and keep the static matrix for
   * the rest. Pure.
   */
  isGridTable: (table: SensitivityTable) => boolean;
  /**
   * Resolve the FULL live grid model for a table: the Brent slider (domain from
   * the uploaded mesh + the live "today" marker) and one interpolated Target
   * price / Upside row per visible ticker that has points. Returns null for a
   * non-grid table or while the mesh is still loading / empty. The slider value
   * lives in SHARED per-table state, so both Views drag the same slider. The mesh
   * is fetched lazily on first selection and cached by table id. Stable id.
   */
  getGridModel: (table: SensitivityTable) => GridTableModel | null;
  /** True while a selected grid table's mesh is being fetched. */
  gridLoading: boolean;
  /** Set the Brent slider value for a grid table (re-interpolates live). */
  setGridBrent: (tableId: number, value: number) => void;
  /** Reset the Brent slider back to the live "today" value for a grid table. */
  resetGridBrent: (tableId: number) => void;

  // Desktop-only export — hook owns the busy state.
  exportExcel: () => Promise<void>;
  exportCsv: () => void;
  excelLoading: boolean;
  csvLoading: boolean;
}

/** Result of `computeSensitivityCell`: the display value + the unit to format with. */
export interface SensitivityCellValue {
  /** The DISPLAY value, or null to render "—". */
  value: number | null;
  /**
   * The unit the View should format with: 'absolute' → the table.unit; 'yield'
   * & 'upside' → '%'; 'pe' & 'ev_ebitda' → '×'. (Mirrors value_mode → unit.)
   */
  unit: string;
}

/** Result of `resolveDriverAxis`. */
export interface ResolvedDriverAxis {
  driver: StockGuideDriver | null;
  scenarios: number[];
  /**
   * The driver's EFFECTIVE "today" value, already resolved through
   * `resolveDriverValue`: the live market value for a DYNAMIC driver (its
   * `source` is a catalog key) or the admin-typed `current_value` for a STATIC
   * one. `null` → no highlight / "—". Views must use THIS, not
   * `driver.current_value`, so dynamic drivers drive the highlight from the live
   * computed value.
   */
  currentValue: number | null;
}

// ─── Scenario-grid (1-D Brent interpolation) — shared types for the panel ──────

/** The single Brent slider of a scenario-grid table. */
export interface GridSlider {
  /** Catalog driver key driving the X position (e.g. `avg_brent_2026`). */
  key: string;
  /** Axis label (from `definition.grid.x_label`, fallback the catalog/driver name). */
  label: string;
  /** Axis unit (e.g. "USD/bbl"). */
  unit: string;
  /** Current slider value (state) — the Brent level we interpolate at. */
  value: number;
  /** Live "today" Brent value (the marker), or null if the market data is missing. */
  liveValue: number | null;
  /** Slider domain = span of the uploaded mesh (min/max x across all tickers). */
  min: number;
  max: number;
  /** Suggested step (≈ span/100 rounded to a tidy 1/2/5×10ⁿ). */
  step: number;
}

/** One interpolated output row of a scenario-grid table (per visible ticker with points). */
export interface GridCompanyRow {
  ticker: string;
  companyName: string;
  /** Interpolated target price at the current Brent value (BRL/share). */
  targetPrice: number | null;
  /** `targetPrice / livePrice − 1` (ratio). Null unless livePrice > 0. */
  upside: number | null;
  /** Live share price (BRL). */
  livePrice: number | null;
}

/** The whole resolved scenario-grid model for one table (slider + interpolated rows). */
export interface GridTableModel {
  /** The single Brent slider (domain from the mesh, marker at the live value). */
  slider: GridSlider;
  /** Interpolated rows for every visible ticker that has points in the mesh. */
  rows: GridCompanyRow[];
  /** The output label (e.g. "Target price"). */
  outputLabel: string;
}

// ─── Formatting helpers (shared by both Views) ───────────────────────────────

/** Generic number formatter with `—` for null/NaN. */
export function fmtNum(v: number | null | undefined, digits = 2): string {
  return v != null && Number.isFinite(v) ? v.toFixed(digits) : "—";
}

/** Percent formatter (value is already in percent points, e.g. 12.5 → "12.5%"). */
export function fmtPct(v: number | null | undefined, digits = 1): string {
  return v != null && Number.isFinite(v) ? `${v.toFixed(digits)}%` : "—";
}

/** Ratio → signed percent (e.g. 0.123 → "+12.3%"). Used for upside. */
export function fmtSignedPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const pct = v * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

/**
 * Ratio → signed WHOLE-percent (e.g. 0.275 → "+28%", 0.556 → "+56%"). Used for
 * the upside column, which is rounded to the nearest integer percentage point.
 */
export function fmtSignedPctWhole(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const pct = Math.round(v * 100);
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct}%`;
}

/** Whole-number formatter (e.g. 64.00 → "64"). Used for the target price column. */
export function fmtInt(v: number | null | undefined): string {
  return v != null && Number.isFinite(v) ? String(Math.round(v)) : "—";
}

/** Thousands-grouped integer (BRL million market cap). */
export function fmtMn(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString("en-US");
}

/** Human label for a recommendation code. */
export function recommendationLabel(code: string | null | undefined): string {
  switch (code) {
    case "OP":
      return "Outperform";
    case "MP":
      return "Marketperform";
    case "UP":
      return "Underperform";
    default:
      return "—";
  }
}

/** Brand-aligned chip colors for a recommendation. */
export function recommendationColors(code: string | null | undefined): {
  bg: string;
  fg: string;
} {
  switch (code) {
    case "OP":
      return { bg: "rgba(22,163,74,0.12)", fg: "#15803d" }; // green
    case "MP":
      return { bg: "rgba(245,158,11,0.14)", fg: "#b45309" }; // amber
    case "UP":
      return { bg: "rgba(220,38,38,0.12)", fg: "#b91c1c" }; // red
    default:
      return { bg: "var(--mobile-divider, #e5e5e5)", fg: "#6b7280" };
  }
}

/** Footnote describing the volume unit per sector (constant copy). */
export const VOLUME_UNIT_NOTE =
  "Volumes: oil & gas in kbpd, fuel distribution in thousand m³.";

// ─── Scenario-grid (1-D Brent interpolation) helpers (module-level, pure) ───────

/** A table is a SCENARIO GRID when its definition carries a `grid` block. */
export function tableIsGrid(table: SensitivityTable): boolean {
  return table.definition?.grid != null;
}

/**
 * Suggested slider step for the Brent axis given its [min,max] span: ≈ span/100
 * rounded to a tidy 1/2/5×10ⁿ value, floored at 0.01. Pure.
 */
function gridSliderStep(min: number, max: number): number {
  const span = Math.max(max - min, 0);
  if (span === 0) return 1;
  const rawStep = span / 100;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const norm = rawStep / mag;
  const niceUnit = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return Math.max(niceUnit * mag, 0.01);
}

/** Clamp `v` to [min,max] (returns min when the bounds are degenerate). */
function clampTo(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return v < min ? min : v > max ? max : v;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const EMPTY_CONFIG: StockGuideConfig = {
  y1_label: "Y1",
  y2_label: "Y2",
  assumptions_note: "",
};

/**
 * Format a computed sensitivity-cell value by its unit. Re-exported from the
 * shared `@/lib/stockGuideSensitivity` single source of truth so desktop,
 * mobile and the admin builder preview render identically. Kept exported under
 * this name to preserve the hook's public API (both Views import it from here).
 */
export const formatSensitivityCell = formatSensitivityValue;

export function useStockGuideData(): UseStockGuideData {
  const supabase = getSupabaseClient();

  const [rows, setRows] = useState<StockGuideCompany[]>([]);
  const [config, setConfig] = useState<StockGuideConfig>(EMPTY_CONFIG);
  const [drivers, setDrivers] = useState<StockGuideDriver[]>([]);
  const [sensitivityTables, setSensitivityTables] = useState<SensitivityTable[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [filters, setFiltersState] = useState<StockGuideFilters>(DEFAULT_FILTERS);
  const [excelLoading, setExcelLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  const fetchIdRef = useRef(0);
  const fetchedRef = useRef(false);

  // Live market values backing the DYNAMIC drivers (computed in the browser from
  // the Yahoo proxy). Reused as-is by `resolveDriverAxis` below.
  const { values: marketValues, loading: marketDriversLoading } =
    useMarketDrivers();

  // ── a. Fetch comps + config + drivers + sensitivity tables (fetch-id guard) ─
  const fetchData = useCallback(() => {
    if (!supabase) return;
    const myId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    Promise.all([
      rpcGetStockGuideComps(supabase),
      rpcGetStockGuideConfig(supabase),
      rpcGetStockGuideDrivers(supabase),
      rpcGetStockGuideSensitivityTables(supabase),
    ])
      .then(([compsData, configData, driversData, tablesData]) => {
        if (myId !== fetchIdRef.current) return;
        setRows(compsData);
        setConfig(configData);
        setDrivers(driversData);
        setSensitivityTables(tablesData);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (myId !== fetchIdRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [supabase]);

  useEffect(() => {
    if (!supabase || fetchedRef.current) return;
    fetchedRef.current = true;
    fetchData();
  }, [supabase, fetchData]);

  // Stable partial-merge setter.
  const setFilters = useCallback((next: Partial<StockGuideFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...next }));
  }, []);

  // ── b. Partition visible vs restricted ────────────────────────────────────
  const visibleRows = useMemo(
    () =>
      rows
        .filter((r) => r.is_visible)
        .sort((a, b) => a.display_order - b.display_order),
    [rows],
  );

  const restrictedNames = useMemo(
    () =>
      rows
        .filter((r) => !r.is_visible)
        .sort((a, b) => a.display_order - b.display_order)
        .map((r) => r.company_name),
    [rows],
  );

  // Ticker → company_name / display_order, over ALL rows the hook can see
  // (visible to this caller). Used to label + order scenario-grid rows.
  const companyNameByTicker = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.ticker, r.company_name);
    return m;
  }, [rows]);

  const displayOrderByTicker = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.ticker, r.display_order);
    return m;
  }, [rows]);

  const sectorsPresent = useMemo(() => {
    const seen = new Set<StockGuideSector>();
    for (const r of visibleRows) {
      if (r.sector) seen.add(r.sector);
    }
    // Stable order: oil_gas first, then fuel_distribution.
    return (["oil_gas", "fuel_distribution"] as StockGuideSector[]).filter((s) =>
      seen.has(s),
    );
  }, [visibleRows]);

  // Derived unit-margin footnote (EBITDA ÷ volumes, R$/m³) for the fuel
  // distributors. EBITDA is BRL mn, volumes are thousand m³, so the unit margin
  // = (ebitda × 1e6) / (volumes × 1e3) = (ebitda / volumes) × 1000 R$/m³.
  // Derived from real data — never hardcoded. Rounded to whole R$/m³.
  const unitMarginNote = useMemo<string | null>(() => {
    const byTicker = new Map(rows.map((r) => [r.ticker, r] as const));
    const unitMargin = (
      ebitda: number | null | undefined,
      volumes: number | null | undefined,
    ): number | null =>
      ebitda != null && volumes != null && volumes > 0
        ? Math.round((ebitda / volumes) * 1000)
        : null;

    const build = (ticker: string) => {
      const r = byTicker.get(ticker);
      if (!r) return null;
      const m1 = unitMargin(r.ebitda_y1, r.volumes_y1);
      const m2 = unitMargin(r.ebitda_y2, r.volumes_y2);
      if (m1 == null && m2 == null) return null;
      return { name: r.company_name, m1, m2 };
    };

    const vibra = build("VBBR3");
    const ultra = build("UGPA3");
    const parts: string[] = [];
    const fmt = (label: string, e: { m1: number | null; m2: number | null }) => {
      const seg: string[] = [];
      if (e.m1 != null) seg.push(`R$ ${e.m1}/m³ (${config.y1_label})`);
      if (e.m2 != null) seg.push(`R$ ${e.m2}/m³ (${config.y2_label})`);
      return `${label} ${seg.join(", ")}`;
    };
    if (vibra) parts.push(fmt(vibra.name, vibra));
    if (ultra) parts.push(fmt(ultra.name, ultra));
    if (parts.length === 0) return null;
    return `Assumed unit margin (EBITDA ÷ volumes): ${parts.join("; ")}.`;
  }, [rows, config.y1_label, config.y2_label]);

  // Footnote: which visible companies' P/E uses adjusted earnings (data-driven).
  const adjustedEarningsNote = useMemo<string | null>(() => {
    const names = rows
      .filter(
        (r) =>
          r.is_visible &&
          (r.net_income_adj_y1 != null || r.net_income_adj_y2 != null),
      )
      .sort((a, b) => a.display_order - b.display_order)
      .map((r) => r.company_name);
    if (names.length === 0) return null;
    return `P/E for ${names.join(
      ", ",
    )} uses adjusted net income (recurring earnings, excluding non-recurring tax credits).`;
  }, [rows]);

  // ── c. Live quotes — ONE batched fetch of visible rows' symbols ───────────
  // Quote symbol = yahoo_symbol (fallback ticker). Hidden rows have a null
  // yahoo_symbol AND are excluded here, so restricted tickers never leave the
  // browser in the quote request.
  const quoteSymbols = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of visibleRows) {
      const sym = r.yahoo_symbol ?? r.ticker;
      if (sym && !seen.has(sym)) {
        seen.add(sym);
        out.push(sym);
      }
    }
    return out;
  }, [visibleRows]);

  // useStockQuote fetches once on mount + whenever the symbol list changes, and
  // exposes `refetch` for the manual refresh button. There is NO polling here —
  // comps are snapshots and the proxy is per-IP rate-limited.
  const {
    data: quotes,
    isLoading: quotesLoading,
    error: quotesError,
    refetch: refreshQuotes,
  } = useStockQuote(quoteSymbols);

  // Index quotes by stripped symbol (proxy returns `symbol` with `.SA` removed).
  // We match on both the stripped symbol and the raw yahoo_symbol/ticker so the
  // lookup is robust regardless of the `.SA` suffix.
  const priceByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of quotes) {
      if (q?.symbol != null && Number.isFinite(q.regularMarketPrice)) {
        m.set(q.symbol.toUpperCase(), q.regularMarketPrice);
      }
    }
    return m;
  }, [quotes]);

  function livePriceFor(r: StockGuideCompany): number | null {
    const sym = (r.yahoo_symbol ?? r.ticker).toUpperCase();
    // proxy strips `.SA`; our stored symbols are already suffix-free, but guard.
    const stripped = sym.replace(/\.SA$/, "");
    const p = priceByKey.get(stripped) ?? priceByKey.get(sym);
    return p != null && Number.isFinite(p) ? p : null;
  }

  // ── d. Derive computed rows (sector filter applied) ───────────────────────
  const computedRows = useMemo<StockGuideComputedRow[]>(() => {
    const scoped = filters.sectorFilter
      ? visibleRows.filter((r) => r.sector === filters.sectorFilter)
      : visibleRows;

    return scoped.map((r) => {
      const livePrice = livePriceFor(r);
      // Market cap (BRL mn) = absolute share count × live BRL price / 1e6.
      const marketCapBrlMn =
        r.shares_outstanding != null && livePrice != null
          ? (r.shares_outstanding * livePrice) / 1e6
          : null;
      const upsidePct =
        r.target_price != null && livePrice != null && livePrice > 0
          ? r.target_price / livePrice - 1
          : null;

      // ── Live derivation of the 4 price-sensitive multiples ────────────────
      // All monetary inputs are BRL mn → EV/EBITDA and P/E are dimensionless;
      // the yields are ×100 for percent points. Every denominator is guarded:
      // EBITDA≤0 and Net income≤0 → null (multiple not meaningful); market cap
      // must be > 0 for the yields. Null-safe throughout → renders "—", no NaN.

      // EV is FORWARD PER YEAR: market cap (single current value) + the net debt
      // of that forward year. Net debt may be negative (net cash), which
      // legitimately lowers EV.
      const evBrlMnY1 =
        marketCapBrlMn != null && r.net_debt_y1 != null
          ? marketCapBrlMn + r.net_debt_y1
          : null;
      const evBrlMnY2 =
        marketCapBrlMn != null && r.net_debt_y2 != null
          ? marketCapBrlMn + r.net_debt_y2
          : null;

      const evEbitdaY1 =
        evBrlMnY1 != null && r.ebitda_y1 != null && r.ebitda_y1 > 0
          ? evBrlMnY1 / r.ebitda_y1
          : null;
      const evEbitdaY2 =
        evBrlMnY2 != null && r.ebitda_y2 != null && r.ebitda_y2 > 0
          ? evBrlMnY2 / r.ebitda_y2
          : null;

      // P/E uses the ADJUSTED net income when present (e.g. Vibra, which strips
      // non-recurring tax credits), else falls back to the reported net income.
      // The Net Income column always shows the reported value. P/E is not
      // meaningful for non-positive earnings → null.
      const peEarningsY1 = r.net_income_adj_y1 ?? r.net_income_y1;
      const peEarningsY2 = r.net_income_adj_y2 ?? r.net_income_y2;
      const peY1 =
        marketCapBrlMn != null && peEarningsY1 != null && peEarningsY1 > 0
          ? marketCapBrlMn / peEarningsY1
          : null;
      const peY2 =
        marketCapBrlMn != null && peEarningsY2 != null && peEarningsY2 > 0
          ? marketCapBrlMn / peEarningsY2
          : null;

      // FCFE yield = FCFE / market cap × 100. FCFE may be negative → negative
      // yield is fine to show; only require market cap > 0.
      const fcfeYieldY1 =
        r.fcfe_y1 != null && marketCapBrlMn != null && marketCapBrlMn > 0
          ? (r.fcfe_y1 / marketCapBrlMn) * 100
          : null;
      const fcfeYieldY2 =
        r.fcfe_y2 != null && marketCapBrlMn != null && marketCapBrlMn > 0
          ? (r.fcfe_y2 / marketCapBrlMn) * 100
          : null;

      // Dividend yield = total dividends / market cap × 100.
      const divYieldY1 =
        r.dividends_y1 != null && marketCapBrlMn != null && marketCapBrlMn > 0
          ? (r.dividends_y1 / marketCapBrlMn) * 100
          : null;
      const divYieldY2 =
        r.dividends_y2 != null && marketCapBrlMn != null && marketCapBrlMn > 0
          ? (r.dividends_y2 / marketCapBrlMn) * 100
          : null;

      return {
        ...r,
        livePrice,
        marketCapBrlMn,
        upsidePct,
        evBrlMnY1,
        evBrlMnY2,
        evEbitdaY1,
        evEbitdaY2,
        peY1,
        peY2,
        fcfeYieldY1,
        fcfeYieldY2,
        divYieldY1,
        divYieldY2,
      };
    });
    // priceByKey captures the quote dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows, filters.sectorFilter, priceByKey]);

  // Live numbers per ticker for the sensitivity-cell helper. Built from
  // visibleRows (NOT the sector-filtered computedRows) so a table cell can
  // always resolve its company's live price / market cap even when the sector
  // filter would have hidden that company from the comps view. Hidden companies
  // are absent from visibleRows AND stripped from the tables server-side.
  const liveByTicker = useMemo(() => {
    const m = new Map<
      string,
      { livePrice: number | null; marketCapBrlMn: number | null }
    >();
    for (const r of visibleRows) {
      const livePrice = livePriceFor(r);
      const marketCapBrlMn =
        r.shares_outstanding != null && livePrice != null
          ? (r.shares_outstanding * livePrice) / 1e6
          : null;
      m.set(r.ticker, { livePrice, marketCapBrlMn });
    }
    return m;
    // priceByKey captures the quote dependency (livePriceFor reads it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows, priceByKey]);

  // ── e. Sensitivity drill-down (redesigned: first-class tables) ─────────────
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const selectTicker = useCallback((ticker: string) => {
    setSelectedTicker(ticker);
  }, []);

  // Default selection = first visible company, once comps land. Re-selects only
  // if the current selection is gone (e.g. the company was hidden between fetches).
  useEffect(() => {
    if (visibleRows.length === 0) return;
    const stillVisible =
      selectedTicker != null &&
      visibleRows.some((r) => r.ticker === selectedTicker);
    if (!stillVisible) {
      setSelectedTicker(visibleRows[0].ticker);
    }
    // we intentionally key on the visible-row identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows]);

  // Tables involving the selected company, in display_order. The RPC already
  // sorts by display_order; we re-sort defensively.
  const selectedTables = useMemo<SensitivityTable[]>(() => {
    if (selectedTicker == null) return [];
    return sensitivityTables
      .filter((t) => t.companies.includes(selectedTicker))
      .sort((a, b) => a.display_order - b.display_order);
  }, [sensitivityTables, selectedTicker]);

  // Driver index for resolveDriverAxis (by id).
  const driversById = useMemo(() => {
    const m = new Map<number, StockGuideDriver>();
    for (const d of drivers) m.set(d.id, d);
    return m;
  }, [drivers]);

  // Pure helper: resolve a driver axis → { driver, scenarios, currentValue }.
  // `currentValue` is the driver's EFFECTIVE today value — live-computed for a
  // dynamic driver (its `source` is a catalog key), else the static
  // `current_value` — via `resolveDriverValue`. Views highlight/interpolate on
  // this, never on `driver.current_value`, so dynamic drivers track the market.
  const resolveDriverAxis = useCallback(
    (axis: SensitivityAxis): ResolvedDriverAxis => {
      const driver =
        axis.kind === "driver" && axis.driver_id != null
          ? (driversById.get(axis.driver_id) ?? null)
          : null;
      const currentValue =
        driver != null ? resolveDriverValue(driver, marketValues) : null;
      return { driver, scenarios: axis.scenarios ?? [], currentValue };
    },
    [driversById, marketValues],
  );

  // Pure helper: compute a cell's DISPLAY value for (table, rowIdx, colIdx).
  const computeSensitivityCell = useCallback(
    (
      table: SensitivityTable,
      rowIdx: number,
      colIdx: number,
    ): SensitivityCellValue => {
      const def = table.definition;
      const mode = table.value_mode;
      // 'absolute' has no fixed unit → use the table's own unit; the other modes
      // have a fixed display unit ('%', '×'). Shared single source of truth.
      const unitFor = unitForValueMode(mode, table.unit);

      // 1. Resolve the cell's company.
      //    row company axis → companies[rowIdx];
      //    else col company axis → companies[colIdx];
      //    else single-company table → table.companies[0].
      let company: string | null = null;
      if (def.row_axis.kind === "company") {
        company = def.row_axis.companies?.[rowIdx] ?? null;
      } else if (def.col_axis.kind === "company") {
        company = def.col_axis.companies?.[colIdx] ?? null;
      } else {
        company = table.companies[0] ?? null;
      }

      // 2. Live numbers for that company (null if unknown / no quote yet).
      const live = company != null ? liveByTicker.get(company) : undefined;
      const livePrice = live?.livePrice ?? null;
      const marketCapBrlMn = live?.marketCapBrlMn ?? null;

      // 3. Typed cell value(s).
      const primary = def.cells?.[rowIdx]?.[colIdx] ?? null;
      const secondary = def.cells_secondary?.[rowIdx]?.[colIdx] ?? null;

      // 4. Apply value_mode via the shared compute helper (every denominator
      //    guarded; null-safe → "—"). This is the SAME function the admin
      //    builder's live preview calls, so the two render byte-for-byte.
      const value = computeSensitivityCellValue({
        valueMode: mode,
        primary,
        secondary,
        marketCapBrlMn,
        livePrice,
      });

      return { value, unit: unitFor };
    },
    [liveByTicker],
  );

  // ── f. Scenario-grid (1-D Brent interpolation) — shared slider state ───────
  //
  // A SCENARIO-GRID table (definition.grid) holds, per company, a dense mesh of
  // (Brent → target price) points (the SENSITIVE values live in the relational
  // `stock_guide_scenario_grid`, fetched on demand via the hide-aware RPC). The
  // dashboard interpolates that mesh live against ONE Brent slider whose value
  // lives in the hook so BOTH Views drag the same slider.

  const isGridTable = useCallback(
    (table: SensitivityTable) => tableIsGrid(table),
    [],
  );

  // Lazy per-table mesh cache: tableId → ScenarioGridPoint[] (ordered by ticker,
  // x_value). Fetched once on first selection of a grid table, then memoized.
  const [gridMeshById, setGridMeshById] = useState<
    Record<number, { ticker: string; x: number; y: number }[]>
  >({});
  const gridFetchedRef = useRef<Set<number>>(new Set());
  const [gridLoading, setGridLoading] = useState(false);

  // tableId → the user's Brent slider value (absent until the user drags; until
  // then the model uses the live "today" value).
  const [gridBrentById, setGridBrentById] = useState<Record<number, number>>({});

  // Fetch the mesh for the selected grid tables (lazy, cached by id).
  useEffect(() => {
    if (!supabase) return;
    const toFetch = selectedTables.filter(
      (t) => tableIsGrid(t) && !gridFetchedRef.current.has(t.id),
    );
    if (toFetch.length === 0) return;
    for (const t of toFetch) gridFetchedRef.current.add(t.id);
    setGridLoading(true);
    Promise.all(
      toFetch.map((t) =>
        rpcGetStockGuideScenarioGrid(supabase, t.id)
          .then((points) => ({ id: t.id, points }))
          .catch(() => ({ id: t.id, points: [] })),
      ),
    ).then((results) => {
      setGridMeshById((prev) => {
        const next = { ...prev };
        for (const { id, points } of results) {
          next[id] = points.map((p) => ({
            ticker: p.ticker,
            x: p.x_value,
            y: p.primary_value,
          }));
        }
        return next;
      });
      setGridLoading(false);
    });
    // selectedTables drives which meshes we need; the mesh cache + the
    // fetched-set ref guard re-fetch, so neither needs to be a dep.
  }, [supabase, selectedTables]);

  const setGridBrent = useCallback((tableId: number, value: number) => {
    setGridBrentById((prev) => ({ ...prev, [tableId]: value }));
  }, []);

  const resetGridBrent = useCallback((tableId: number) => {
    setGridBrentById((prev) => {
      if (!(tableId in prev)) return prev;
      const next = { ...prev };
      delete next[tableId];
      return next;
    });
  }, []);

  // Per-ticker ascending series for a table's mesh (interpolation input).
  const gridSeriesByTicker = useCallback(
    (tableId: number): Map<string, GridPoint[]> => {
      const mesh = gridMeshById[tableId] ?? [];
      const m = new Map<string, GridPoint[]>();
      for (const p of mesh) {
        const arr = m.get(p.ticker) ?? [];
        arr.push({ x: p.x, y: p.y });
        m.set(p.ticker, arr);
      }
      // The RPC already orders by ticker, x_value; re-sort defensively.
      for (const arr of m.values()) arr.sort((a, b) => a.x - b.x);
      return m;
    },
    [gridMeshById],
  );

  const getGridModel = useCallback(
    (table: SensitivityTable): GridTableModel | null => {
      const grid = table.definition.grid;
      if (grid == null) return null;

      const series = gridSeriesByTicker(table.id);
      if (series.size === 0) return null; // mesh not loaded / empty → caller shows loading/empty

      // Slider domain = span of every x across all tickers in the mesh.
      let min = Infinity;
      let max = -Infinity;
      for (const arr of series.values()) {
        for (const p of arr) {
          if (p.x < min) min = p.x;
          if (p.x > max) max = p.x;
        }
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
      if (min === max) {
        // single x across the whole mesh → open a tiny window so the slider works
        const pad = Math.max(Math.abs(min) * 0.1, 1);
        min -= pad;
        max += pad;
      }
      const step = gridSliderStep(min, max);

      // Live "today" Brent value for the X driver (dynamic catalog metric).
      const rawLive = marketValues[grid.x_driver_key];
      const liveValue =
        rawLive != null && Number.isFinite(rawLive) ? rawLive : null;

      // Slider value: the user's drag, else the live value (clamped to domain),
      // else the domain midpoint when there's no market data yet.
      const dragged = gridBrentById[table.id];
      const value =
        dragged != null && Number.isFinite(dragged)
          ? clampTo(dragged, min, max)
          : liveValue != null
            ? clampTo(liveValue, min, max)
            : (min + max) / 2;

      const label =
        grid.x_label ||
        MARKET_DRIVER_CATALOG_BY_KEY[grid.x_driver_key]?.label ||
        "Brent";
      const unit =
        grid.x_unit ||
        MARKET_DRIVER_CATALOG_BY_KEY[grid.x_driver_key]?.unit ||
        "USD/bbl";

      const slider: GridSlider = {
        key: grid.x_driver_key,
        label,
        unit,
        value,
        liveValue,
        min,
        max,
        step,
      };

      // One interpolated row per VISIBLE ticker that has points (hide-strip: the
      // RPC only returns visible tickers, so every mesh ticker is renderable).
      const rows: GridCompanyRow[] = [];
      for (const [ticker, points] of series.entries()) {
        const targetPrice = interpolateGrid(points, value);
        const live = liveByTicker.get(ticker);
        const livePrice = live?.livePrice ?? null;
        const upside =
          targetPrice != null && livePrice != null && livePrice > 0
            ? targetPrice / livePrice - 1
            : null;
        rows.push({
          ticker,
          companyName: companyNameByTicker.get(ticker) ?? ticker,
          targetPrice,
          upside,
          livePrice,
        });
      }
      rows.sort(
        (a, b) =>
          (displayOrderByTicker.get(a.ticker) ?? 0) -
          (displayOrderByTicker.get(b.ticker) ?? 0),
      );

      const outputLabel =
        grid.output === "target_price" || !grid.output
          ? "Target price"
          : grid.output;

      return { slider, rows, outputLabel };
    },
    [
      gridSeriesByTicker,
      gridBrentById,
      marketValues,
      liveByTicker,
      companyNameByTicker,
      displayOrderByTicker,
    ],
  );

  // ── g. Desktop-only export of the computed visible table ──────────────────
  const exportExcel = useCallback(async () => {
    if (computedRows.length === 0) return;
    setExcelLoading(true);
    try {
      const y1 = config.y1_label;
      const y2 = config.y2_label;
      await downloadGenericExcel<Record<string, unknown>>({
        rows: computedRows as unknown as Record<string, unknown>[],
        filename: "stock_guide_comps",
        title: "Stock Guide — Comps Table",
        sheetName: "Comps",
        mergeTitleCells: true,
        columns: [
          { header: "Company",            key: "company_name",  width: 20, align: "left"   },
          { header: "Ticker",             key: "ticker",        width: 10, align: "left"   },
          { header: "Last update",        key: "last_update",   width: 13, align: "center" },
          { header: "Recommendation",     key: "recommendation",width: 15, align: "center" },
          { header: "Target price",       key: "target_price",  width: 13, format: "0", align: "center" },
          { header: "Current price",      key: "livePrice",     width: 13, format: "0.00", align: "center" },
          { header: "Upside %",           value: (r) => (r.upsidePct as number | null) != null ? Math.round((r.upsidePct as number) * 100) : null, width: 11, format: "0", align: "center" },
          { header: "Market cap (BRL mn)", key: "marketCapBrlMn", width: 18, format: "#,##0", align: "center" },
          { header: `EV/EBITDA ${y1}`,    key: "evEbitdaY1",    width: 14, format: "0.0", align: "center" },
          { header: `EV/EBITDA ${y2}`,    key: "evEbitdaY2",    width: 14, format: "0.0", align: "center" },
          { header: `P/E ${y1}`,          key: "peY1",          width: 11, format: "0.0", align: "center" },
          { header: `P/E ${y2}`,          key: "peY2",          width: 11, format: "0.0", align: "center" },
          { header: `FCFE Yield ${y1} %`, key: "fcfeYieldY1",   width: 16, format: "0.0", align: "center" },
          { header: `FCFE Yield ${y2} %`, key: "fcfeYieldY2",   width: 16, format: "0.0", align: "center" },
          { header: `Div Yield ${y1} %`,  key: "divYieldY1",    width: 15, format: "0.0", align: "center" },
          { header: `Div Yield ${y2} %`,  key: "divYieldY2",    width: 15, format: "0.0", align: "center" },
          { header: `Net income ${y1} (mn)`, key: "net_income_y1", width: 16, format: "#,##0", align: "center" },
          { header: `Net income ${y2} (mn)`, key: "net_income_y2", width: 16, format: "#,##0", align: "center" },
          { header: `EBITDA ${y1} (mn)`,  key: "ebitda_y1",     width: 16, format: "#,##0", align: "center" },
          { header: `EBITDA ${y2} (mn)`,  key: "ebitda_y2",     width: 16, format: "#,##0", align: "center" },
          { header: `Volumes ${y1}`,      key: "volumes_y1",    width: 13, format: "#,##0", align: "center" },
          { header: `Volumes ${y2}`,      key: "volumes_y2",    width: 13, format: "#,##0", align: "center" },
        ],
      });
    } catch (e) {
      console.error("Stock Guide Excel export failed", e);
    } finally {
      setExcelLoading(false);
    }
  }, [computedRows, config]);

  const exportCsv = useCallback(() => {
    if (computedRows.length === 0) return;
    setCsvLoading(true);
    try {
      const y1 = config.y1_label;
      const y2 = config.y2_label;
      downloadCsv({
        rows: computedRows.map((r) => ({
          company: r.company_name,
          ticker: r.ticker,
          last_update: r.last_update,
          recommendation: r.recommendation,
          target_price: r.target_price,
          current_price: r.livePrice,
          upside_pct: r.upsidePct != null ? Math.round(r.upsidePct * 100) : null,
          market_cap_brl_mn: r.marketCapBrlMn,
          [`ev_brl_mn_${y1}`]: r.evBrlMnY1,
          [`ev_brl_mn_${y2}`]: r.evBrlMnY2,
          [`ev_ebitda_${y1}`]: r.evEbitdaY1,
          [`ev_ebitda_${y2}`]: r.evEbitdaY2,
          [`pe_${y1}`]: r.peY1,
          [`pe_${y2}`]: r.peY2,
          [`fcfe_yield_${y1}`]: r.fcfeYieldY1,
          [`fcfe_yield_${y2}`]: r.fcfeYieldY2,
          [`div_yield_${y1}`]: r.divYieldY1,
          [`div_yield_${y2}`]: r.divYieldY2,
          [`net_income_${y1}`]: r.net_income_y1,
          [`net_income_${y2}`]: r.net_income_y2,
          [`ebitda_${y1}`]: r.ebitda_y1,
          [`ebitda_${y2}`]: r.ebitda_y2,
          [`volumes_${y1}`]: r.volumes_y1,
          [`volumes_${y2}`]: r.volumes_y2,
        })) as unknown as Record<string, unknown>[],
        filename: "stock_guide_comps",
        includeBom: true,
      });
    } finally {
      setCsvLoading(false);
    }
  }, [computedRows, config]);

  return {
    rows,
    loading,
    error,
    refetch: fetchData,
    filters,
    setFilters,
    config,
    computedRows,
    sectorsPresent,
    restrictedNames,
    unitMarginNote,
    adjustedEarningsNote,
    quotesLoading,
    quotesError,
    refreshQuotes,
    drivers,
    marketValues,
    marketDriversLoading,
    sensitivityTables,
    selectedTicker,
    selectTicker,
    selectedTables,
    computeSensitivityCell,
    resolveDriverAxis,
    isGridTable,
    getGridModel,
    gridLoading,
    setGridBrent,
    resetGridBrent,
    exportExcel,
    exportCsv,
    excelLoading,
    csvLoading,
  };
}
