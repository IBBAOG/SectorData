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
//   e. Consolidated sensitivity (REDESIGNED 2026-06-11 — ALWAYS VISIBLE, no
//      selection): expose `drivers` + `sensitivityTables` and derive `panels`
//      (tagged single-row static tables merged into the fixed "brent"/"margin"
//      blocks, grouped by column-scenario signature), `unpanneledTables` (untagged
//      static → generic full-width fallback) and `gridTables` (scenario grids,
//      always visible with a lazy mesh fetch). `computeSensitivityCell()` turns a
//      (table,row,col) into a DISPLAY value; `resolveDriverAxis()` maps a driver
//      axis → { driver, scenarios, currentValue }. The grid mesh is fetched via
//      `ensureGridLoaded(tableId)` only when the Views scroll it into view.
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
  buildGridMesh,
  interpolateMesh,
  type GridMesh,
  type MeshPoint,
} from "@/lib/stockGuideSensitivity";
import type {
  StockGuideCompany,
  StockGuideComputedRow,
  StockGuideConfig,
  StockGuideSector,
  StockGuideDriver,
  SensitivityAxis,
  SensitivityTable,
  SensitivityPanelKey,
  ScenarioGridPoint,
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

  // ── Consolidated sensitivity (always-visible, selection-independent) ────────
  /**
   * The two consolidated panels ("brent" then "margin"). Each panel renders ONE
   * TABLE PER DRIVER (`driverTables`); inside a driver table each underlying
   * tagged static table is a gray band followed by one row per company in its
   * row_axis. ONLY non-empty panels are returned — the Views own the fixed
   * two-block scaffold + the placeholder for a missing/empty panel. Look one up
   * via `panelByKey`.
   */
  panels: SensitivityPanel[];
  /** Convenience index: panel key → its `SensitivityPanel` (absent if empty). */
  panelByKey: Partial<Record<SensitivityPanelKey, SensitivityPanel>>;
  /**
   * Static, non-grid tables WITHOUT a valid panel tag (or that violate the
   * single-row company-axis guard) — rendered full-width via the generic
   * `SensitivityTableView`. In display_order.
   */
  unpanneledTables: SensitivityTable[];
  /** Scenario-grid tables (`isGridTable`), in display_order — always visible, lazy mesh. */
  gridTables: SensitivityTable[];

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

  // ── Scenario-grid (multi-axis Brent mesh) sensitivity ───────────────────────
  /**
   * True when a table is a SCENARIO GRID (has `definition.grid`). Views switch to
   * the multi-slider interpolation panel for these and keep the static matrix for
   * the rest. Pure.
   */
  isGridTable: (table: SensitivityTable) => boolean;
  /**
   * Resolve the FULL live grid model for a table: one slider PER AXIS (1..3,
   * domain from the uploaded mesh + the live "today" marker), the configured
   * OUTPUT columns, and one row per visible ticker with a MULTILINEARLY
   * interpolated display cell per output (target price/upside, FCFE yield, …).
   * Returns null for a non-grid table or while the mesh is still loading / empty.
   * The per-axis values live in SHARED per-table state, so both Views drag the
   * same sliders. The mesh is fetched lazily on first selection, and each
   * ticker's `GridMesh` is built ONCE per fetch (memoized in `gridIndexById`),
   * never per drag. Stable id.
   */
  getGridModel: (table: SensitivityTable) => GridTableModel | null;
  /**
   * Idempotently fetch + cache the mesh for ONE grid table (guarded by an
   * internal fetched-set ref, so repeat calls are no-ops). The Views call this
   * when the grid panel scrolls into view (`useInViewOnce`) — the ~194k-point
   * mesh is NEVER fetched on page load. Stable identity.
   */
  ensureGridLoaded: (tableId: number) => void;
  /** True while ANY grid table's mesh is being fetched. */
  gridLoading: boolean;
  /** Set the value of ONE axis slider of a grid table (re-interpolates live). */
  setGridAxisValue: (tableId: number, axisIdx: number, value: number) => void;
  /** Reset ONE axis slider back to its live "today" value. */
  resetGridAxis: (tableId: number, axisIdx: number) => void;
  /** Reset ALL axis sliders of a grid table back to their live "today" values. */
  resetGridAll: (tableId: number) => void;

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

// ─── Scenario-grid (multi-axis Brent mesh) — shared types for the panel ────────

/** One axis slider of a scenario-grid table (1..3 of these per table). */
export interface GridAxisModel {
  /** Catalog driver key driving this axis (e.g. `avg_brent_2026`). */
  key: string;
  /** Axis label (from `definition.grid.axes[i].label`, fallback the catalog name). */
  label: string;
  /** Axis unit (e.g. "USD/bbl"). */
  unit: string;
  /** Current slider value (state) — the level we interpolate at on this axis. */
  value: number;
  /** Live "today" value (the marker), or null if the market data is missing. */
  liveValue: number | null;
  /** Slider domain = union of this axis's distinct levels across all tickers. */
  min: number;
  max: number;
  /** Suggested step (≈ span/100 rounded to a tidy 1/2/5×10ⁿ). */
  step: number;
  /** True when the axis has a single level (the slider is fixed / disabled). */
  disabled: boolean;
  /** True when the user has dragged this axis away from its live value. */
  overridden: boolean;
}

/** One configured output column of a scenario-grid table (resolved for the panel). */
export interface GridOutputModel {
  /** The metric key (matches a `stock_guide_scenario_grid.metric`). */
  key: string;
  /** Column label (e.g. "Target price", "FCFE yield"). */
  label: string;
  /** How the interpolated raw value is turned into the displayed number. */
  mode: SensitivityTable["value_mode"];
  /**
   * The DISPLAY unit the View formats with: 'absolute' → the table's unit;
   * 'yield'/'upside' → '%'; 'pe'/'ev_ebitda' → '×'. Use `formatSensitivityCell`.
   */
  unit: string;
}

/** One interpolated cell of a scenario-grid output row (per (ticker, output)). */
export interface GridCellValue {
  /**
   * Raw multilinearly interpolated value at the current axis levels (the metric's
   * native units — BRL/share for a target price, BRL mn for a flow, …). Null when
   * the ticker has no mesh for this metric or a required corner is missing.
   */
  raw: number | null;
  /**
   * Display value after the output's `mode` transform (`computeSensitivityCellValue`):
   * upside/yield in percent points, pe/ev_ebitda a multiple, absolute = raw. Null →
   * render "—". Format with `formatSensitivityCell(value, unit)`.
   */
  value: number | null;
}

/** One interpolated output row of a scenario-grid table (per visible ticker with points). */
export interface GridCompanyRow {
  ticker: string;
  companyName: string;
  /** Live share price (BRL). */
  livePrice: number | null;
  /** One display cell per configured output, keyed by the output's `key`. */
  values: Record<string, GridCellValue>;
}

/** The whole resolved scenario-grid model for one table (sliders + interpolated rows). */
export interface GridTableModel {
  /** One slider per axis (1..3), in storage order (x, y, z). */
  axes: GridAxisModel[];
  /** Interpolated rows for every visible ticker that has points in the mesh. */
  rows: GridCompanyRow[];
  /** Configured output columns (≥1), in definition order. */
  outputs: GridOutputModel[];
  /** True when ANY axis has been dragged away from its live value (drives "Reset all"). */
  anyOverridden: boolean;
}

// ─── Consolidated sensitivity panels (per-driver tables, stacked) ──────────────
//
// REWORK (iteration 2): a panel renders ONE TABLE PER DRIVER, stacked. Each
// driver table has a shared scenario column header (all its rows share the same
// driver + scenarios) and a SINGLE column-axis interpolation marker. Inside the
// driver table, each underlying tagged STATIC table contributes a gray "band"
// subheader row (the metric label) followed by ONE BODY ROW PER COMPANY in that
// table's row_axis (multi-company tables are now the canonical shape).

/** One company body row under a band (a row of the table's row_axis). */
export interface SensitivityBandRow {
  /** Index into the source table's row_axis (companies[rowIdx]) → computeSensitivityCell. */
  rowIdx: number;
  /** The company ticker for this row (row_axis.companies[rowIdx]). */
  ticker: string;
  /** Display name from the comps data; falls back to the ticker. */
  companyName: string;
}

/** One band (= one underlying tagged static table) inside a driver table. */
export interface SensitivityBand {
  /** The source single-driver × company table (value_mode-aware). */
  table: SensitivityTable;
  /** The band's metric label (`definition.row_label` ?? `table.title`). */
  bandLabel: string;
  /** One body row per company in the table's row_axis (empty bands are dropped). */
  rows: SensitivityBandRow[];
}

/**
 * One driver table inside a consolidated panel — all its bands share the SAME
 * driver (and scenario signature), so a single scenario column header + a single
 * column-axis interpolation marker cover the whole table.
 */
export interface SensitivityDriverTable {
  /** The bound driver id (col_axis.driver_id). */
  driverId: number;
  /** Title-ready driver label, e.g. "Avg. Brent 2026" (the driver's stored name). */
  driverLabel: string;
  /** Driver unit, e.g. "USD/bbl" (may be empty). */
  driverUnit: string;
  /** The shared column-axis scenario values (e.g. [50,60,…,150]). */
  colScenarios: number[];
  /** Live "today" value of the driver (for the marker + caption); null if unknown. */
  currentValue: number | null;
  /** The bands (underlying tables), in display_order; each has ≥1 company row. */
  bands: SensitivityBand[];
}

/** One consolidated, always-visible sensitivity block ("brent" / "margin"). */
export interface SensitivityPanel {
  key: SensitivityPanelKey;
  /** One table per driver (≥1 — non-empty panels only), in display_order. */
  driverTables: SensitivityDriverTable[];
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

    // Derive the four mcap-driven multiples + the per-year EV from a given pair
    // of market-cap bases (year-1 / year-2). Pure; null-safe; every denominator
    // guarded. Shared by the NORMAL row (basis = the RAW live market cap, same
    // value both years) and the EX-TAX-CREDIT companion row (basis PER YEAR =
    // mcap − npv_tax_credit_yN, so the two years may differ). Net income / EBITDA
    // / dividends / FCFE are the company's own fundamentals in both cases — only
    // the equity-value basis differs.
    const deriveMultiples = (
      r: StockGuideCompany,
      basisY1: number | null,
      basisY2: number | null,
    ) => {
      // EV is FORWARD PER YEAR: the year's market-cap basis + that forward year's
      // net debt (net debt may be negative = net cash → lowers EV).
      const evBrlMnY1 =
        basisY1 != null && r.net_debt_y1 != null ? basisY1 + r.net_debt_y1 : null;
      const evBrlMnY2 =
        basisY2 != null && r.net_debt_y2 != null ? basisY2 + r.net_debt_y2 : null;
      const evEbitdaY1 =
        evBrlMnY1 != null && r.ebitda_y1 != null && r.ebitda_y1 > 0
          ? evBrlMnY1 / r.ebitda_y1
          : null;
      const evEbitdaY2 =
        evBrlMnY2 != null && r.ebitda_y2 != null && r.ebitda_y2 > 0
          ? evBrlMnY2 / r.ebitda_y2
          : null;
      // P/E uses the REPORTED net income; not meaningful for non-positive earnings.
      const peY1 =
        basisY1 != null && r.net_income_y1 != null && r.net_income_y1 > 0
          ? basisY1 / r.net_income_y1
          : null;
      const peY2 =
        basisY2 != null && r.net_income_y2 != null && r.net_income_y2 > 0
          ? basisY2 / r.net_income_y2
          : null;
      const fcfeYieldY1 =
        r.fcfe_y1 != null && basisY1 != null && basisY1 > 0
          ? (r.fcfe_y1 / basisY1) * 100
          : null;
      const fcfeYieldY2 =
        r.fcfe_y2 != null && basisY2 != null && basisY2 > 0
          ? (r.fcfe_y2 / basisY2) * 100
          : null;
      const divYieldY1 =
        r.dividends_y1 != null && basisY1 != null && basisY1 > 0
          ? (r.dividends_y1 / basisY1) * 100
          : null;
      const divYieldY2 =
        r.dividends_y2 != null && basisY2 != null && basisY2 > 0
          ? (r.dividends_y2 / basisY2) * 100
          : null;
      return {
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
    };

    const out: StockGuideComputedRow[] = [];
    for (const r of scoped) {
      const livePrice = livePriceFor(r);
      // Market cap (BRL mn) = absolute share count × live BRL price / 1e6 — a
      // single current value.
      const marketCapBrlMn =
        r.shares_outstanding != null && livePrice != null
          ? (r.shares_outstanding * livePrice) / 1e6
          : null;

      // Upside vs the RAW live price: `target_price / livePrice − 1` (guard
      // livePrice > 0). The normal row uses the unadjusted market cap throughout;
      // the only tax-credit mechanism is the EX-TAX-CREDIT companion row below.
      const upsidePct =
        r.target_price != null && livePrice != null && livePrice > 0
          ? r.target_price / livePrice - 1
          : null;

      // ── Live derivation of the 4 price-sensitive multiples (raw market cap) ──
      const m = deriveMultiples(r, marketCapBrlMn, marketCapBrlMn);

      out.push({
        ...r,
        isExTaxCredit: false,
        displayName: r.company_name,
        livePrice,
        marketCapBrlMn,
        adjMcapY1: marketCapBrlMn,
        adjMcapY2: marketCapBrlMn,
        upsidePct,
        ...m,
      });

      // ── EX-TAX-CREDIT companion row ───────────────────────────────────────
      // Analyst-locked: when npv_tax_credit_y1 > 0 OR npv_tax_credit_y2 > 0,
      // render an extra row right below this company whose equity basis is the
      // LIVE market cap MINUS that year's NPV — PER YEAR (`basisY1 = mcap −
      // (npv_y1 ?? 0)`, `basisY2 = mcap − (npv_y2 ?? 0)`), so the two years may
      // differ. Every mcap-derived figure recomputes per year on that basis (26E
      // columns on basisY1, 27E on basisY2). The Market cap column shows the
      // YEAR-1 basis (`basisY1`) — the headline convention, consistent with
      // forward-per-year EV. TP / recommendation / upside / current price + the
      // fundamentals (EBITDA, Net income, Volumes) REPEAT the parent's values
      // verbatim (explicit analyst decision).
      const npv1 = r.npv_tax_credit_y1 ?? 0;
      const npv2 = r.npv_tax_credit_y2 ?? 0;
      if ((npv1 > 0 || npv2 > 0) && marketCapBrlMn != null) {
        const basisY1 = marketCapBrlMn - npv1;
        const basisY2 = marketCapBrlMn - npv2;
        // Optional ADJUSTED net income for the ex-credit row's P/E denominator:
        // `net_income_ex_yN ?? net_income_yN` (filled → adjusted; NULL → reported).
        // We derive on a CLONE of `r` whose `net_income_yN` carries the effective
        // (adjusted) earnings, so deriveMultiples' P/E and the displayed Net Income
        // column (spread below) stay consistent. Every OTHER fundamental is
        // untouched — only the P/E denominator + the Net Income figure change.
        const exR: StockGuideCompany = {
          ...r,
          net_income_y1: r.net_income_ex_y1 ?? r.net_income_y1,
          net_income_y2: r.net_income_ex_y2 ?? r.net_income_y2,
        };
        const mEx = deriveMultiples(exR, basisY1, basisY2);
        out.push({
          ...exR,
          isExTaxCredit: true,
          displayName: `${r.company_name} ex-tax credit`,
          livePrice,
          // Market cap column shows the year-1 ex-credit equity value (headline).
          marketCapBrlMn: basisY1,
          adjMcapY1: basisY1,
          adjMcapY2: basisY2,
          // Upside REPEATS the parent (TP + current price unchanged).
          upsidePct,
          ...mEx,
        });
      }
    }
    return out;
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
  // Defined BEFORE the panels memo (which folds in the driver label/value).
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

  // ── e. Consolidated sensitivity (always-visible, selection-independent) ─────
  //
  // The section no longer drills down per selected company. Instead the tagged
  // company × driver static tables are grouped per driver into ONE table each
  // inside two fixed blocks (brent / margin); untagged static tables fall to a
  // generic full-width list, and grid tables render always-visible below (mesh
  // fetched lazily on scroll-into-view).

  // A table qualifies for a CONSOLIDATED panel when it is a tagged, NON-grid
  // static table whose ROW axis is a COMPANY axis (of ANY length — multi-company
  // is now canonical) and whose COLUMN axis is a DRIVER axis (the scenarios live
  // there). Anything failing this guard — wrong axis kinds, or an unknown panel
  // value — falls to the generic full-width fallback.
  const isPanelTable = useCallback((t: SensitivityTable): boolean => {
    if (tableIsGrid(t)) return false;
    const rowAxis = t.definition.row_axis;
    const colAxis = t.definition.col_axis;
    return (
      rowAxis.kind === "company" &&
      Array.isArray(rowAxis.companies) &&
      rowAxis.companies.length >= 1 &&
      colAxis.kind === "driver" &&
      colAxis.driver_id != null
    );
  }, []);

  // Build the two panels + the fallback + grid lists from sensitivityTables, all
  // in display_order. A tagged "brent"/"margin" table that passes the guard joins
  // that panel; within a panel the tables are grouped by (driver_id + scenario
  // signature) into ONE rendered driver table each. Every other static table goes
  // to `unpanneledTables`; grids go to `gridTables`.
  const { panels, panelByKey, unpanneledTables, gridTables } = useMemo(() => {
    const ordered = [...sensitivityTables].sort(
      (a, b) => a.display_order - b.display_order,
    );

    const panelTables: Record<SensitivityPanelKey, SensitivityTable[]> = {
      brent: [],
      margin: [],
    };
    const fallback: SensitivityTable[] = [];
    const grids: SensitivityTable[] = [];

    for (const t of ordered) {
      if (tableIsGrid(t)) {
        grids.push(t);
        continue;
      }
      const panel = t.definition.panel;
      if ((panel === "brent" || panel === "margin") && isPanelTable(t)) {
        panelTables[panel].push(t);
      } else {
        fallback.push(t);
      }
    }

    // Group a panel's tables by (driver_id + scenario signature) into one rendered
    // driver table each (display order = the first table's order). Each band's
    // company rows come from its own row_axis; empty bands / driver tables are
    // dropped (e.g. all companies hidden server-side).
    const buildDriverTables = (
      tables: SensitivityTable[],
    ): SensitivityDriverTable[] => {
      const out: SensitivityDriverTable[] = [];
      const byKey = new Map<string, SensitivityDriverTable>();
      for (const t of tables) {
        const colAxis = t.definition.col_axis;
        const driverId = colAxis.driver_id;
        if (driverId == null) continue; // guarded above, but be safe
        const scenarios = colAxis.scenarios ?? [];
        const key = `${driverId}|${scenarios.join(",")}`;

        // Build this table's band: one company row per row_axis entry.
        const companies = t.definition.row_axis.companies ?? [];
        const bandRows: SensitivityBandRow[] = companies.map((ticker, rowIdx) => ({
          rowIdx,
          ticker,
          companyName: companyNameByTicker.get(ticker) ?? ticker,
        }));
        if (bandRows.length === 0) continue; // empty band → skip

        let dt = byKey.get(key);
        if (!dt) {
          const { driver, currentValue } = resolveDriverAxis(colAxis);
          dt = {
            driverId,
            driverLabel: driver?.name ?? "",
            driverUnit: driver?.unit ?? "",
            colScenarios: scenarios,
            currentValue,
            bands: [],
          };
          byKey.set(key, dt);
          out.push(dt);
        }
        dt.bands.push({
          table: t,
          bandLabel: t.definition.row_label?.trim() || t.title,
          rows: bandRows,
        });
      }
      // Drop any driver table that ended up with no bands.
      return out.filter((dt) => dt.bands.length > 0);
    };

    const built: SensitivityPanel[] = [];
    const byKey: Partial<Record<SensitivityPanelKey, SensitivityPanel>> = {};
    for (const key of ["brent", "margin"] as SensitivityPanelKey[]) {
      const tables = panelTables[key];
      if (tables.length === 0) continue; // empty panels omitted — Views own the scaffold
      const driverTables = buildDriverTables(tables);
      if (driverTables.length === 0) continue;
      const panel: SensitivityPanel = { key, driverTables };
      built.push(panel);
      byKey[key] = panel;
    }

    return {
      panels: built,
      panelByKey: byKey,
      unpanneledTables: fallback,
      gridTables: grids,
    };
  }, [sensitivityTables, isPanelTable, companyNameByTicker, resolveDriverAxis]);

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

  // ── f. Scenario-grid (multi-axis Brent mesh) — shared slider state ─────────
  //
  // A SCENARIO-GRID table (definition.grid) holds, per company, a REGULAR mesh of
  // (axis levels → target price) points over 1..3 driver axes (the SENSITIVE
  // values live in the relational `stock_guide_scenario_grid`, fetched on demand
  // via the hide-aware RPC). The dashboard interpolates that mesh MULTILINEARLY
  // against ONE slider per axis, whose values live in the hook so BOTH Views drag
  // the same sliders. The per-ticker `GridMesh` index is built ONCE per fetch
  // (memoized in `gridIndexById`), never per drag.

  const isGridTable = useCallback(
    (table: SensitivityTable) => tableIsGrid(table),
    [],
  );

  // Lazy per-table mesh cache: tableId → ScenarioGridPoint[] (ordered by ticker,
  // then coordinate axes). Fetched once on first selection of a grid table.
  const [gridMeshById, setGridMeshById] = useState<
    Record<number, ScenarioGridPoint[]>
  >({});
  const gridFetchedRef = useRef<Set<number>>(new Set());
  const [gridLoading, setGridLoading] = useState(false);

  // tableId → per-axis user overrides. The array is indexed by axis position;
  // `null` means "follow the live value" (LAZY: we never eager-init from market
  // values, which arrive async — a fresh entry stays all-null until a drag).
  const [gridAxisValuesById, setGridAxisValuesById] = useState<
    Record<number, (number | null)[]>
  >({});

  // Idempotently fetch ONE grid table's mesh (cached by id, guarded by the
  // fetched-set ref). Called by the Views when the grid panel scrolls into view
  // (`useInViewOnce`) — NEVER on page load, because the mesh is ~194k points.
  const ensureGridLoaded = useCallback(
    (tableId: number) => {
      if (!supabase) return;
      if (gridFetchedRef.current.has(tableId)) return; // already fetched / fetching
      gridFetchedRef.current.add(tableId);
      setGridLoading(true);
      rpcGetStockGuideScenarioGrid(supabase, tableId)
        .then((points) => ({ points }))
        .catch(() => ({ points: [] as ScenarioGridPoint[] }))
        .then(({ points }) => {
          setGridMeshById((prev) => ({ ...prev, [tableId]: points }));
          setGridLoading(false);
        });
    },
    [supabase],
  );

  const setGridAxisValue = useCallback(
    (tableId: number, axisIdx: number, value: number) => {
      setGridAxisValuesById((prev) => {
        const cur = prev[tableId] ? [...prev[tableId]] : [];
        while (cur.length <= axisIdx) cur.push(null);
        cur[axisIdx] = value;
        return { ...prev, [tableId]: cur };
      });
    },
    [],
  );

  const resetGridAxis = useCallback((tableId: number, axisIdx: number) => {
    setGridAxisValuesById((prev) => {
      const arr = prev[tableId];
      if (!arr || arr[axisIdx] == null) return prev;
      const cur = [...arr];
      cur[axisIdx] = null;
      return { ...prev, [tableId]: cur };
    });
  }, []);

  const resetGridAll = useCallback((tableId: number) => {
    setGridAxisValuesById((prev) => {
      if (!(tableId in prev)) return prev;
      const next = { ...prev };
      delete next[tableId];
      return next;
    });
  }, []);

  // Per-table, per-ticker, per-METRIC mesh INDEX — built ONCE per fetch (NOT per
  // drag). Maps tableId → (ticker → (metric → GridMesh)), dimensioned by the
  // table's axis count. The dimension comes from `definition.grid.axes.length`,
  // so a degenerate axis (a single level) is still a real axis (its slider just
  // renders disabled). Each configured output interpolates its OWN metric mesh on
  // the SAME axis coordinates.
  const gridIndexById = useMemo(() => {
    const out: Record<number, Map<string, Map<string, GridMesh>>> = {};
    for (const table of sensitivityTables) {
      const grid = table.definition.grid;
      if (grid == null) continue;
      const mesh = gridMeshById[table.id];
      if (!mesh || mesh.length === 0) continue;
      const dim = Math.min(Math.max(grid.axes.length, 1), 3);
      // Bucket the flat point cloud by ticker → metric, projecting to `dim` coords.
      const byTicker = new Map<string, Map<string, MeshPoint[]>>();
      for (const p of mesh) {
        const coords = [p.x_value, p.y_value, p.z_value].slice(0, dim);
        let byMetric = byTicker.get(p.ticker);
        if (!byMetric) {
          byMetric = new Map<string, MeshPoint[]>();
          byTicker.set(p.ticker, byMetric);
        }
        const arr = byMetric.get(p.metric);
        if (arr) arr.push({ coords, value: p.primary_value });
        else byMetric.set(p.metric, [{ coords, value: p.primary_value }]);
      }
      const meshes = new Map<string, Map<string, GridMesh>>();
      for (const [ticker, byMetric] of byTicker.entries()) {
        const metricMeshes = new Map<string, GridMesh>();
        for (const [metric, points] of byMetric.entries()) {
          const built = buildGridMesh(points, dim);
          if (built) metricMeshes.set(metric, built);
        }
        if (metricMeshes.size > 0) meshes.set(ticker, metricMeshes);
      }
      if (meshes.size > 0) out[table.id] = meshes;
    }
    return out;
  }, [sensitivityTables, gridMeshById]);

  const getGridModel = useCallback(
    (table: SensitivityTable): GridTableModel | null => {
      const grid = table.definition.grid;
      if (grid == null) return null;

      const meshes = gridIndexById[table.id];
      if (!meshes || meshes.size === 0) return null; // not loaded / empty

      const dim = Math.min(Math.max(grid.axes.length, 1), 3);
      const overrides = gridAxisValuesById[table.id] ?? [];

      // Per-axis: union of distinct levels across all tickers + metrics → domain.
      const axes: GridAxisModel[] = [];
      const atValues: number[] = []; // the interpolation query, one per axis
      for (let a = 0; a < dim; a++) {
        const levelSet = new Set<number>();
        for (const byMetric of meshes.values()) {
          for (const m of byMetric.values()) {
            for (const lvl of m.levels[a] ?? []) levelSet.add(lvl);
          }
        }
        const sorted = Array.from(levelSet).sort((x, y) => x - y);
        if (sorted.length === 0) continue;
        const min = sorted[0];
        const max = sorted[sorted.length - 1];
        const disabled = sorted.length === 1; // single level → fixed axis
        const step = gridSliderStep(min, max);

        const axisDef = grid.axes[a];
        // Resolve the axis's live "today" value: prefer the registry driver_id
        // (static current_value OR dynamic market value via resolveDriverValue),
        // else the legacy direct catalog key.
        const driver =
          axisDef?.driver_id != null
            ? (driversById.get(axisDef.driver_id) ?? null)
            : null;
        const key = axisDef?.driver_key ?? driver?.source ?? "";
        let rawLive: number | null = null;
        if (driver != null) {
          rawLive = resolveDriverValue(driver, marketValues);
        } else if (key) {
          const mv = marketValues[key];
          rawLive = mv != null && Number.isFinite(mv) ? mv : null;
        }
        const liveValue =
          rawLive != null && Number.isFinite(rawLive) ? rawLive : null;

        // value: override ?? clamp(live) ?? midpoint. (Degenerate axis → its
        // single level.) Live values arrive async, so a fresh axis follows live.
        const override = overrides[a];
        const value = disabled
          ? min
          : override != null && Number.isFinite(override)
            ? clampTo(override, min, max)
            : liveValue != null
              ? clampTo(liveValue, min, max)
              : (min + max) / 2;

        const label =
          axisDef?.label ||
          driver?.name ||
          (key ? MARKET_DRIVER_CATALOG_BY_KEY[key]?.label : "") ||
          "Driver";
        const unit =
          axisDef?.unit ||
          driver?.unit ||
          (key ? MARKET_DRIVER_CATALOG_BY_KEY[key]?.unit : "") ||
          "";

        axes.push({
          key,
          label,
          unit,
          value,
          liveValue,
          min,
          max,
          step,
          disabled,
          overridden: !disabled && override != null,
        });
        atValues.push(value);
      }
      if (axes.length === 0) return null;

      // Resolved output columns (display unit per mode). ≥1 (legacy → 1).
      const outputs: GridOutputModel[] = grid.outputs.map((o) => ({
        key: o.key,
        label: o.label || o.key,
        mode: o.mode,
        unit: unitForValueMode(o.mode, table.unit),
      }));

      // One MULTILINEARLY interpolated row per VISIBLE ticker that has a mesh
      // (the RPC only returns visible tickers, so every mesh ticker is renderable).
      const rows: GridCompanyRow[] = [];
      for (const [ticker, byMetric] of meshes.entries()) {
        const live = liveByTicker.get(ticker);
        const livePrice = live?.livePrice ?? null;
        const marketCapBrlMn = live?.marketCapBrlMn ?? null;

        const values: Record<string, GridCellValue> = {};
        for (const o of grid.outputs) {
          const mesh = byMetric.get(o.key);
          const raw = mesh ? interpolateMesh(mesh, atValues) : null;
          // Reuse the static-sensitivity math: the interpolated value is the
          // "primary" base; the mode turns it into the displayed number.
          const value = computeSensitivityCellValue({
            valueMode: o.mode,
            primary: raw,
            secondary: null,
            marketCapBrlMn,
            livePrice,
          });
          values[o.key] = { raw, value };
        }
        rows.push({
          ticker,
          companyName: companyNameByTicker.get(ticker) ?? ticker,
          livePrice,
          values,
        });
      }
      rows.sort(
        (a, b) =>
          (displayOrderByTicker.get(a.ticker) ?? 0) -
          (displayOrderByTicker.get(b.ticker) ?? 0),
      );

      return {
        axes,
        rows,
        outputs,
        anyOverridden: axes.some((ax) => ax.overridden),
      };
    },
    [
      gridIndexById,
      gridAxisValuesById,
      driversById,
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
          { header: "Company",            key: "displayName",   width: 24, align: "left"   },
          { header: "Ticker",             value: (r) => (r.isExTaxCredit ? null : r.ticker),      width: 10, align: "left"   },
          { header: "Last update",        value: (r) => (r.isExTaxCredit ? null : r.last_update), width: 13, align: "center" },
          // Ex-tax-credit companion rows leave Ticker/Last update/Recommendation/TP/
          // Current price/Upside/Market cap BLANK (display parity with the table) —
          // only the EV/EBITDA-onward multiples are shown.
          { header: "Recommendation",     value: (r) => (r.isExTaxCredit ? null : r.recommendation), width: 15, align: "center" },
          { header: "Target price",       value: (r) => (r.isExTaxCredit ? null : r.target_price),   width: 13, format: "0", align: "center" },
          { header: "Current price",      value: (r) => (r.isExTaxCredit ? null : r.livePrice),      width: 13, format: "0.00", align: "center" },
          { header: "Upside %",           value: (r) => (r.isExTaxCredit ? null : (r.upsidePct as number | null) != null ? Math.round((r.upsidePct as number) * 100) : null), width: 11, format: "0", align: "center" },
          { header: "Market cap (BRL mn)", value: (r) => (r.isExTaxCredit ? null : r.marketCapBrlMn), width: 18, format: "#,##0", align: "center" },
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
          company: r.displayName,
          // Ex-tax-credit companion rows leave Ticker/Last update + these 5
          // columns blank (display parity with the table).
          ticker: r.isExTaxCredit ? null : r.ticker,
          last_update: r.isExTaxCredit ? null : r.last_update,
          recommendation: r.isExTaxCredit ? null : r.recommendation,
          target_price: r.isExTaxCredit ? null : r.target_price,
          current_price: r.isExTaxCredit ? null : r.livePrice,
          upside_pct: r.isExTaxCredit ? null : r.upsidePct != null ? Math.round(r.upsidePct * 100) : null,
          market_cap_brl_mn: r.isExTaxCredit ? null : r.marketCapBrlMn,
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
    quotesLoading,
    quotesError,
    refreshQuotes,
    drivers,
    marketValues,
    marketDriversLoading,
    sensitivityTables,
    panels,
    panelByKey,
    unpanneledTables,
    gridTables,
    computeSensitivityCell,
    resolveDriverAxis,
    isGridTable,
    getGridModel,
    ensureGridLoaded,
    gridLoading,
    setGridAxisValue,
    resetGridAxis,
    resetGridAll,
    exportExcel,
    exportCsv,
    excelLoading,
    csvLoading,
  };
}
