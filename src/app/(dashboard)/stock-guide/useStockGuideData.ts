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
//   a. Fetch comps + config on mount (fetch-id guard — subsidy-tracker pattern).
//   b. Partition: `visibleRows` (full comps) vs `restrictedNames` (hidden →
//      company_name only). The restricted footnote is built from `restrictedNames`.
//   c. LIVE QUOTES via the existing Yahoo proxy (`useStockQuote` →
//      `/api/stocks/quote?tickers=`). Collect `yahoo_symbol` (fallback ticker)
//      of VISIBLE rows → ONE batched fetch on load + a manual `refreshQuotes()`.
//      No polling ticker — comps are snapshots; respect the proxy rate limit.
//   d. Derive per visible row: livePrice / marketCapBrlMn / upsidePct (null-safe).
//   e. Drill-down: selectedTicker / selectedGrid / selectedGridLoading;
//      `selectTicker()` lazily calls rpcGetStockGuideSensitivity. Default = first
//      visible row.
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
  rpcGetStockGuideComps,
  rpcGetStockGuideConfig,
  rpcGetStockGuideSensitivity,
} from "@/lib/rpc";
import { downloadGenericExcel } from "@/lib/exportExcel";
import { downloadCsv } from "@/lib/exportCsv";
import type {
  StockGuideCompany,
  StockGuideComputedRow,
  StockGuideConfig,
  StockGuideSector,
  SensitivityGrid,
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

  // Drill-down
  selectedTicker: string | null;
  selectedGrid: SensitivityGrid | null;
  selectedGridLoading: boolean;
  selectedGridError: Error | null;
  selectTicker: (ticker: string) => void;

  // Desktop-only export — hook owns the busy state.
  exportExcel: () => Promise<void>;
  exportCsv: () => void;
  excelLoading: boolean;
  csvLoading: boolean;
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

export function useStockGuideData(): UseStockGuideData {
  const supabase = getSupabaseClient();

  const [rows, setRows] = useState<StockGuideCompany[]>([]);
  const [config, setConfig] = useState<StockGuideConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [filters, setFiltersState] = useState<StockGuideFilters>(DEFAULT_FILTERS);
  const [excelLoading, setExcelLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  const fetchIdRef = useRef(0);
  const fetchedRef = useRef(false);

  // ── a. Fetch comps + config (fetch-id guard) ──────────────────────────────
  const fetchData = useCallback(() => {
    if (!supabase) return;
    const myId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    Promise.all([
      rpcGetStockGuideComps(supabase),
      rpcGetStockGuideConfig(supabase),
    ])
      .then(([compsData, configData]) => {
        if (myId !== fetchIdRef.current) return;
        setRows(compsData);
        setConfig(configData);
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
      const marketCapBrlMn =
        r.shares_outstanding != null && livePrice != null
          ? (r.shares_outstanding * livePrice) / 1e6
          : null;
      const upsidePct =
        r.target_price != null && livePrice != null && livePrice > 0
          ? r.target_price / livePrice - 1
          : null;
      return { ...r, livePrice, marketCapBrlMn, upsidePct };
    });
    // priceByKey captures the quote dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows, filters.sectorFilter, priceByKey]);

  // ── e. Drill-down state ────────────────────────────────────────────────────
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [selectedGrid, setSelectedGrid] = useState<SensitivityGrid | null>(null);
  const [selectedGridLoading, setSelectedGridLoading] = useState(false);
  const [selectedGridError, setSelectedGridError] = useState<Error | null>(null);
  const gridFetchIdRef = useRef(0);

  const selectTicker = useCallback(
    (ticker: string) => {
      setSelectedTicker(ticker);
      if (!supabase) return;
      const myId = ++gridFetchIdRef.current;
      setSelectedGridLoading(true);
      setSelectedGridError(null);
      setSelectedGrid(null);
      rpcGetStockGuideSensitivity(supabase, ticker)
        .then((grid) => {
          if (myId !== gridFetchIdRef.current) return;
          setSelectedGrid(grid);
          setSelectedGridLoading(false);
        })
        .catch((err: unknown) => {
          if (myId !== gridFetchIdRef.current) return;
          setSelectedGridError(
            err instanceof Error ? err : new Error(String(err)),
          );
          setSelectedGridLoading(false);
        });
    },
    [supabase],
  );

  // Default selection = first visible row, once comps land. Re-selects only if
  // the current selection is gone (e.g. the company was hidden between fetches).
  useEffect(() => {
    if (visibleRows.length === 0) return;
    const stillVisible =
      selectedTicker != null &&
      visibleRows.some((r) => r.ticker === selectedTicker);
    if (!stillVisible) {
      selectTicker(visibleRows[0].ticker);
    }
    // selectTicker is stable; we intentionally key on the visible-row identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows]);

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
          { header: `EV/EBITDA ${y1}`,    key: "ev_ebitda_y1",  width: 14, format: "0.0", align: "center" },
          { header: `EV/EBITDA ${y2}`,    key: "ev_ebitda_y2",  width: 14, format: "0.0", align: "center" },
          { header: `P/E ${y1}`,          key: "pe_y1",         width: 11, format: "0.0", align: "center" },
          { header: `P/E ${y2}`,          key: "pe_y2",         width: 11, format: "0.0", align: "center" },
          { header: `FCFE Yield ${y1} %`, key: "fcfe_yield_y1", width: 16, format: "0.0", align: "center" },
          { header: `FCFE Yield ${y2} %`, key: "fcfe_yield_y2", width: 16, format: "0.0", align: "center" },
          { header: `Div Yield ${y1} %`,  key: "div_yield_y1",  width: 15, format: "0.0", align: "center" },
          { header: `Div Yield ${y2} %`,  key: "div_yield_y2",  width: 15, format: "0.0", align: "center" },
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
          [`ev_ebitda_${y1}`]: r.ev_ebitda_y1,
          [`ev_ebitda_${y2}`]: r.ev_ebitda_y2,
          [`pe_${y1}`]: r.pe_y1,
          [`pe_${y2}`]: r.pe_y2,
          [`fcfe_yield_${y1}`]: r.fcfe_yield_y1,
          [`fcfe_yield_${y2}`]: r.fcfe_yield_y2,
          [`div_yield_${y1}`]: r.div_yield_y1,
          [`div_yield_${y2}`]: r.div_yield_y2,
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
    selectedTicker,
    selectedGrid,
    selectedGridLoading,
    selectedGridError,
    selectTicker,
    exportExcel,
    exportCsv,
    excelLoading,
    csvLoading,
  };
}
