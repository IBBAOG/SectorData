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
import { useMarketDrivers, resolveDriverValue } from "@/hooks/useMarketDrivers";
import {
  rpcGetStockGuideComps,
  rpcGetStockGuideConfig,
  rpcGetStockGuideDrivers,
  rpcGetStockGuideSensitivityTables,
} from "@/lib/rpc";
import { downloadGenericExcel } from "@/lib/exportExcel";
import { downloadCsv } from "@/lib/exportCsv";
import {
  computeSensitivityCellValue,
  formatSensitivityValue,
  unitForValueMode,
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

      // P/E is not meaningful for non-positive earnings → null.
      const peY1 =
        marketCapBrlMn != null && r.net_income_y1 != null && r.net_income_y1 > 0
          ? marketCapBrlMn / r.net_income_y1
          : null;
      const peY2 =
        marketCapBrlMn != null && r.net_income_y2 != null && r.net_income_y2 > 0
          ? marketCapBrlMn / r.net_income_y2
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
          { header: "Target price",       key: "target_price",  width: 13, format: "0.00", align: "center" },
          { header: "Recommendation",     key: "recommendation",width: 15, align: "center" },
          { header: "Live price",         key: "livePrice",     width: 12, format: "0.00", align: "center" },
          { header: "Upside %",           value: (r) => (r.upsidePct as number | null) != null ? (r.upsidePct as number) * 100 : null, width: 11, format: "0.0", align: "center" },
          { header: "Market cap (BRL mn)", key: "marketCapBrlMn", width: 18, format: "#,##0", align: "center" },
          { header: `EV/EBITDA ${y1}`,    key: "evEbitdaY1",    width: 14, format: "0.0", align: "center" },
          { header: `EV/EBITDA ${y2}`,    key: "evEbitdaY2",    width: 14, format: "0.0", align: "center" },
          { header: `P/E ${y1}`,          key: "peY1",          width: 11, format: "0.0", align: "center" },
          { header: `P/E ${y2}`,          key: "peY2",          width: 11, format: "0.0", align: "center" },
          { header: `FCFE Yield ${y1} %`, key: "fcfeYieldY1",   width: 16, format: "0.0", align: "center" },
          { header: `FCFE Yield ${y2} %`, key: "fcfeYieldY2",   width: 16, format: "0.0", align: "center" },
          { header: `Div Yield ${y1} %`,  key: "divYieldY1",    width: 15, format: "0.0", align: "center" },
          { header: `Div Yield ${y2} %`,  key: "divYieldY2",    width: 15, format: "0.0", align: "center" },
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
          target_price: r.target_price,
          recommendation: r.recommendation,
          live_price: r.livePrice,
          upside_pct: r.upsidePct != null ? r.upsidePct * 100 : null,
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
    exportExcel,
    exportCsv,
    excelLoading,
    csvLoading,
  };
}
