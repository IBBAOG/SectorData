"use client";

/**
 * useDieselGasolineMarginsData — single brain for the dual-view pattern.
 *
 * Both desktop/View.tsx and mobile/View.tsx consume THIS hook exclusively.
 * No View ever calls supabase.rpc() directly.
 *
 * Exports:
 *   - allRows       : full unfiltered dataset (for variation tables, YoY, QTD)
 *   - filteredRows  : rows visible under the current week-range selection
 *   - weeks         : ordered week strings from get_dg_margins_filters
 *   - weekRange     : [startIndex, endIndex] into `weeks`
 *   - setWeekRange  : filter setter
 *   - visibleWeeks  : weeks.slice(weekRange[0], weekRange[1] + 1)
 *   - latestVisibleWeek : last week in visibleWeeks | null
 *   - loading / error
 *   - excelLoading / setExcelLoading : Excel export busy state shared across views
 *
 * Week helpers (parseWeek, weekToDateRange, weekLastDay, weekLastDayShort)
 * are exported so both Views can format labels without duplicating logic.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetDgMarginsData,
  rpcGetDgMarginsFilters,
  type DgMarginsRow,
} from "@/lib/rpc";

// ── Re-export the row type so Views don't need to import from rpc.ts ─────────
export type { DgMarginsRow };

// ── Constants ─────────────────────────────────────────────────────────────────

export const STACK_COLORS: Record<string, string> = {
  base_fuel:                       "#1a1a1a",
  biofuel_component:               "#73C6A1",
  federal_tax:                     "#9A9A9A",
  state_tax:                       "#C8C8C8",
  distribution_and_resale_margin:  "#FF5000",
};

export const ANNOT_COLORS: Record<string, string> = {
  base_fuel:                       "#1a1a1a",
  biofuel_component:               "#3d8a6e",
  federal_tax:                     "#555555",
  state_tax:                       "#888888",
  distribution_and_resale_margin:  "#FF5000",
};

// Diesel B line uses brand orange #FF5000 for the Distribution & Resale Margin
// comparison chart. Gasoline C stays at #1a1a1a (dark/black) so the two lines
// remain clearly distinguishable without relying on saturation alone.
export const MARGIN_LINE_COLORS: Record<string, string> = {
  "Diesel B":   "#FF5000",
  "Gasoline C": "#1a1a1a",
};

/** Stacked chart order: bottom → top */
export const STACK_COMPONENTS: { key: keyof DgMarginsRow }[] = [
  { key: "base_fuel" },
  { key: "biofuel_component" },
  { key: "federal_tax" },
  { key: "state_tax" },
  { key: "distribution_and_resale_margin" },
];

/** Table component order (most relevant first) */
export const TABLE_KEYS: (keyof DgMarginsRow)[] = [
  "distribution_and_resale_margin",
  "state_tax",
  "federal_tax",
  "biofuel_component",
  "base_fuel",
  "total",
];

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const MONTHS_SHORT = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];

// ── Week helpers ──────────────────────────────────────────────────────────────

export function parseWeek(w: string): { weekNum: number; year: number } | null {
  const p = w.split("/");
  if (p.length !== 2) return null;
  const weekNum = parseInt(p[0], 10);
  const year    = parseInt(p[1], 10);
  return isNaN(weekNum) || isNaN(year) ? null : { weekNum, year };
}

/** "13/2026" → "Week 13 — March 24 to March 30" (ISO 8601) */
export function weekToDateRange(weekStr: string): string {
  const parsed = parseWeek(weekStr);
  if (!parsed) return weekStr;
  const { weekNum, year } = parsed;
  const jan4 = new Date(year, 0, 4);
  const dow  = jan4.getDay() || 7;
  const w1Mon = new Date(year, 0, 4 - dow + 1);
  const start = new Date(w1Mon);
  start.setDate(w1Mon.getDate() + (weekNum - 1) * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return (
    `Week ${weekNum} — ` +
    `${MONTHS[start.getMonth()]} ${start.getDate()} ` +
    `to ${MONTHS[end.getMonth()]} ${end.getDate()}, ${year}`
  );
}

/** "15/2026" → "Apr 11, 2026" (last day = Saturday of that week) */
export function weekLastDay(weekStr: string): string {
  const parsed = parseWeek(weekStr);
  if (!parsed) return weekStr;
  const { weekNum, year } = parsed;
  const jan4 = new Date(year, 0, 4);
  const dow = jan4.getDay() || 7;
  const w1Mon = new Date(year, 0, 4 - dow + 1);
  const end = new Date(w1Mon);
  end.setDate(w1Mon.getDate() + (weekNum - 1) * 7 + 5);
  return `${MONTHS_SHORT[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
}

/** "15/2026" → "Apr 11" (compact, for slider handle labels) */
export function weekLastDayShort(weekStr: string): string {
  const parsed = parseWeek(weekStr);
  if (!parsed) return weekStr;
  const { weekNum, year } = parsed;
  const jan4 = new Date(year, 0, 4);
  const dow = jan4.getDay() || 7;
  const w1Mon = new Date(year, 0, 4 - dow + 1);
  const end = new Date(w1Mon);
  end.setDate(w1Mon.getDate() + (weekNum - 1) * 7 + 5);
  return `${MONTHS_SHORT[end.getMonth()]} ${end.getDate()}`;
}

/**
 * "15/2026" → "11-Apr-26"  (dd-mmm-yy, en-US month abbreviation).
 * Used as x-axis tick labels on all time-series charts in both views.
 */
export function weekLastDayFormatted(weekStr: string): string {
  const parsed = parseWeek(weekStr);
  if (!parsed) return weekStr;
  const { weekNum, year } = parsed;
  const jan4 = new Date(year, 0, 4);
  const dow = jan4.getDay() || 7;
  const w1Mon = new Date(year, 0, 4 - dow + 1);
  const end = new Date(w1Mon);
  end.setDate(w1Mon.getDate() + (weekNum - 1) * 7 + 5);
  const dd  = String(end.getDate()).padStart(2, "0");
  const mmm = MONTHS_SHORT[end.getMonth()];
  const yy  = String(end.getFullYear()).slice(-2);
  return `${dd}-${mmm}-${yy}`;
}

/** Human-readable label per component key + fuel type */
export function compLabel(key: string, fuelType: string): string {
  if (key === "base_fuel")         return fuelType === "Diesel B" ? "Diesel A"           : "Gasoline A";
  if (key === "biofuel_component") return fuelType === "Diesel B" ? "Biodiesel"           : "An. Ethanol";
  if (key === "federal_tax")       return "Federal Tax";
  if (key === "state_tax")         return "State Tax";
  if (key === "distribution_and_resale_margin") return "Dist. & Resale Margin";
  return key;
}

// ── Hook interface ────────────────────────────────────────────────────────────

export interface UseDieselGasolineMarginsData {
  /** Full unfiltered dataset — needed by VariationsTable for YoY/QTD lookups */
  allRows: DgMarginsRow[];
  /** Rows matching the current week-range selection */
  filteredRows: DgMarginsRow[];
  /** All week strings ordered chronologically (from get_dg_margins_filters) */
  weeks: string[];
  /** [startIndex, endIndex] into `weeks` */
  weekRange: [number, number];
  setWeekRange: (next: [number, number]) => void;
  /** weeks.slice(weekRange[0], weekRange[1] + 1) */
  visibleWeeks: string[];
  /** Last element of visibleWeeks, or null */
  latestVisibleWeek: string | null;
  loading: boolean;
  error: Error | null;
  /** Excel export busy flag (shared so both Views render consistent busy state) */
  excelLoading: boolean;
  setExcelLoading: (v: boolean) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useDieselGasolineMarginsData(): UseDieselGasolineMarginsData {
  const supabase = getSupabaseClient();

  const [allRows, setAllRows]         = useState<DgMarginsRow[]>([]);
  const [weeks, setWeeks]             = useState<string[]>([]);
  const [weekRange, setWeekRange]     = useState<[number, number]>([0, 0]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<Error | null>(null);
  const [excelLoading, setExcelLoading] = useState(false);

  const fetchIdRef = useRef(0);

  useEffect(() => {
    if (!supabase) return;
    const id = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    Promise.all([
      rpcGetDgMarginsFilters(supabase),
      rpcGetDgMarginsData(supabase),
    ])
      .then(([filters, data]) => {
        if (id !== fetchIdRef.current) return;
        const w = filters.weeks;
        setWeeks(w);
        setWeekRange([0, Math.max(0, w.length - 1)]);
        setAllRows(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (id !== fetchIdRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [supabase]);

  const filteredRows = useMemo(() => {
    if (weeks.length === 0) return [];
    const vis = new Set(weeks.slice(weekRange[0], weekRange[1] + 1));
    return allRows.filter((r) => vis.has(r.week));
  }, [allRows, weekRange, weeks]);

  const visibleWeeks = useMemo(
    () => weeks.slice(weekRange[0], weekRange[1] + 1),
    [weeks, weekRange],
  );

  const latestVisibleWeek = visibleWeeks[visibleWeeks.length - 1] ?? null;

  const stableSetWeekRange = useCallback((next: [number, number]) => {
    setWeekRange(next);
  }, []);

  return {
    allRows,
    filteredRows,
    weeks,
    weekRange,
    setWeekRange: stableSetWeekRange,
    visibleWeeks,
    latestVisibleWeek,
    loading,
    error,
    excelLoading,
    setExcelLoading,
  };
}
