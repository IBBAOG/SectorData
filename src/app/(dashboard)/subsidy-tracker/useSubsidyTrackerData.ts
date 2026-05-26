"use client";

// ─── useSubsidyTrackerData — single brain for the /subsidy-tracker dual-view ──
//
// Both desktop/View.tsx and mobile/View.tsx consume this hook exclusively.
// Neither View calls Supabase directly or derives chart data independently.
//
// Contract (canonical dual-view shape):
//   { rows, loading, error, filters, setFilters, ...derived }
//
// Dual-agent layout (4 traces per grid as of the 2026-05-27 subsidy reform):
//   - Importador grid: IPP (solid) / IPP_adjusted (dashed) /
//                      ANP Reference / ANP Commercialization
//   - Produtor grid : Petrobras (solid) / Petrobras_adjusted (dashed) /
//                      ANP Reference / ANP Commercialization
//
// Adjusted traces (`ipp_adjusted`, `petrobras_adjusted`) come pre-computed
// from the RPC via the SQL function `compute_subsidy_reimbursement()` — the
// frontend never recomputes the reimbursement. Caps live in
// `anp_subsidy_caps` (importador 1.52 / produtor 1.12 from 2026-04-07).
//
// IPP_adjusted is placed ONLY on the importador grid (uses the importador
// cap). Petrobras_adjusted is placed ONLY on the produtor grid (uses the
// produtor cap). This is intentional — both reflect distinct policy effects
// on distinct agent populations.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Annotations, Layout, PlotData } from "plotly.js";

import { getSupabaseClient } from "@/lib/supabaseClient";
import {
  rpcGetSubsidyTrackerDiesel,
  type SubsidyTrackerRow,
} from "@/lib/rpc";
import { downloadGenericExcel } from "@/lib/exportExcel";
import { downloadCsv } from "@/lib/exportCsv";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "@/lib/plotlyDefaults";

export type { SubsidyTrackerRow };

// ─── Colors (locked by sub-PRD — do not change without coordination) ──────────

export const COLOR_IPP   = "#111111"; // black  — IPP / IPP_adjusted
export const COLOR_REF   = "#F59E0B"; // orange — ANP Reference
export const COLOR_COMM  = "#B91C1C"; // dark red — ANP Commercialization
export const COLOR_PETRO = "#0F766E"; // teal   — Petrobras / Petrobras_adjusted

// ─── Series definitions (shared between both Views) ──────────────────────────

export type SeriesField =
  | "ipp"
  | "ipp_adjusted"
  | "petrobras"
  | "petrobras_adjusted"
  | "anp_reference_importador"
  | "anp_reference_produtor"
  | "anp_commercialization_importador"
  | "anp_commercialization_produtor";

export interface SeriesDef {
  label: string;
  field: SeriesField;
  color: string;
  /** Line style — `solid` (default) or `dash` for the *_adjusted traces. */
  dash?: "solid" | "dash";
  /** When set, the trace carries regional customdata from this row field. */
  regionsField?: "regions_importador" | "regions_produtor";
}

// Importador-agent series (chart 1) — 4 traces
//   IPP (solid)  /  IPP_adjusted (dashed)  /  ANP Reference  /  ANP Commercialization
export const SERIES_IMPORTADOR: SeriesDef[] = [
  { label: "IPP",                   field: "ipp",                              color: COLOR_IPP                  },
  { label: "IPP (adjusted)",        field: "ipp_adjusted",                     color: COLOR_IPP,  dash: "dash"   },
  { label: "ANP Reference",         field: "anp_reference_importador",         color: COLOR_REF, regionsField: "regions_importador" },
  { label: "ANP Commercialization", field: "anp_commercialization_importador", color: COLOR_COMM                 },
];

// Produtor-agent series (chart 2) — 4 traces
//   Petrobras (solid) / Petrobras_adjusted (dashed) / ANP Reference / ANP Commercialization
export const SERIES_PRODUTOR: SeriesDef[] = [
  { label: "Petrobras",             field: "petrobras",                        color: COLOR_PETRO                },
  { label: "Petrobras (adjusted)",  field: "petrobras_adjusted",               color: COLOR_PETRO, dash: "dash"  },
  { label: "ANP Reference",         field: "anp_reference_produtor",           color: COLOR_REF, regionsField: "regions_produtor" },
  { label: "ANP Commercialization", field: "anp_commercialization_produtor",   color: COLOR_COMM                 },
];

// Back-compat aliases — kept so any external import keeps building until next
// audit pass. New code should prefer the SERIES_IMPORTADOR / SERIES_PRODUTOR
// names which match the PT suffixes from the RPC.
export const SERIES_IMPORTER = SERIES_IMPORTADOR;
export const SERIES_PRODUCER = SERIES_PRODUTOR;
export const SERIES = SERIES_IMPORTADOR;

// Hardcoded floor for the chart window — matches the previous page.tsx.
export const MIN_DATE = "2026-02-01";

// ─── Regional hover formatter ────────────────────────────────────────────────

export const REGION_ORDER = [
  "NORTE",
  "NORDESTE",
  "CENTRO-OESTE",
  "SUDESTE",
  "SUL",
] as const;

export function formatRegions(
  regions: Record<string, number | null> | null,
): string {
  if (!regions) return "No regional breakdown";
  const parts: string[] = [];
  for (const key of REGION_ORDER) {
    const v = regions[key];
    if (v != null && Number.isFinite(v)) {
      parts.push(`${key}: ${v.toFixed(2)}`);
    }
  }
  return parts.length > 0 ? parts.join(" - ") : "No regional breakdown";
}

// ─── Filters ─────────────────────────────────────────────────────────────────
//
// TraceVisibility keyed by SeriesField. The mobile FilterDrawer exposes one
// toggle per importador-side concept (IPP, IPP_adjusted, ANP Reference,
// ANP Commercialization) plus the produtor analogues (Petrobras,
// Petrobras_adjusted). The ANP Reference / Commercialization toggles mirror
// between agents via traceVisible() in mobile/View.tsx.

export type TraceVisibility = Partial<Record<SeriesField, boolean>>;

export interface SubsidyTrackerFilters {
  /** Slider range expressed as [startIndex, endIndex] into the `datas` array. */
  sliderRange: [number, number];
  /** Per-trace visibility (mobile filter drawer toggles these). */
  traces: TraceVisibility;
}

// ─── Derived shapes ───────────────────────────────────────────────────────────

export interface SubsidyTrackerCurrent {
  field: SeriesField;
  label: string;
  color: string;
  value: number | null;
  date: string | null;
}

/** Extended current-value row including week-on-week change. */
export interface SubsidyTrackerWowRow extends SubsidyTrackerCurrent {
  /** Most recent non-null value in the window. */
  latestValue: number | null;
  /** Date of the latest non-null reading. */
  latestDate: string | null;
  /** Non-null reading whose date ≤ latestDate − 7 calendar days. */
  priorValue: number | null;
  /** Date of the prior reading. */
  priorDate: string | null;
  /**
   * Week-on-week % change: (latestValue − priorValue) / priorValue × 100.
   * Null when either side is missing or priorValue === 0.
   */
  wowPct: number | null;
}

export interface UseSubsidyTrackerData {
  rows: SubsidyTrackerRow[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
  filters: SubsidyTrackerFilters;
  setFilters: (next: Partial<SubsidyTrackerFilters>) => void;
  resetFilters: () => void;
  /** Unique sorted date strings >= MIN_DATE. */
  datas: string[];
  /** xMin / xMax computed from `sliderRange`. */
  xMin: string | null;
  xMax: string | null;
  /** Pre-built chart for the importador-agent view (full annotations + spike). */
  chartImporter: { data: PlotData[]; layout: Partial<Layout> };
  /** Pre-built chart for the produtor-agent view (full annotations + spike). */
  chartProducer: { data: PlotData[]; layout: Partial<Layout> };
  /** Latest non-null value + WoW snapshot per series (importador agent, 4 rows). */
  currentValuesImporter: SubsidyTrackerWowRow[];
  /** Latest non-null value + WoW snapshot per series (produtor agent, 4 rows). */
  currentValuesProducer: SubsidyTrackerWowRow[];
  /** Active subsidy for importador agent (Reference − Commercialization). */
  activeSubsidyImporter: number | null;
  /** Active subsidy for produtor agent (Reference − Commercialization). */
  activeSubsidyProducer: number | null;
  /** Export helpers — hooks own the busy state. */
  exportExcel: () => Promise<void>;
  exportCsv: () => void;
  excelLoading: boolean;
  csvLoading: boolean;
}

// ─── Utility helpers ─────────────────────────────────────────────────────────

export function fmtDateLabel(d: string): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = parseInt(d.slice(5, 7), 10);
  const day = parseInt(d.slice(8, 10), 10);
  return `${months[m - 1]} ${day}, ${d.slice(0, 4)}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Chart builder (desktop archetype) ───────────────────────────────────────
//
// Builds a single Plotly chart from the given series definitions:
//   - 4 line traces (`scatter` + `mode='lines'` + `connectgaps: true`)
//   - *_adjusted traces use `line.dash = 'dash'` (declared on SeriesDef)
//   - ANP Reference trace (detected via s.regionsField) carries `customdata`
//     with the regional breakdown for the hover tooltip
//   - End-of-line annotations stacked at the right edge with min-gap pushdown
//   - x range extended +30 days past the last point for label clearance

export function buildChart(
  rows: SubsidyTrackerRow[],
  xMin: string | null,
  xMax: string | null,
  traces: TraceVisibility,
  series: SeriesDef[],
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows
    .filter((r) => r.date >= MIN_DATE)
    .filter((r) => (!xMin || r.date >= xMin) && (!xMax || r.date <= xMax))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (filtered.length === 0) {
    return emptyPlot(420, "No data available");
  }

  const dates = filtered.map((r) => r.date);

  const referenceHoverTemplate =
    "<b>%{x}</b><br>" +
    "ANP Reference: R$ %{y:.2f}/L<br><br>" +
    "%{customdata}<extra></extra>";

  const visibleSeries = series.filter((s) => traces[s.field] !== false);

  const traceData: PlotData[] = visibleSeries.map((s) => {
    const y = filtered.map((r) => r[s.field] as number | null);
    const dash = s.dash ?? "solid";

    if (s.regionsField) {
      // ANP Reference trace — attach regional breakdown as customdata
      const regionCustomdata = filtered.map((r) =>
        formatRegions((r[s.regionsField!] as Record<string, number> | null) ?? null),
      );
      return {
        type: "scatter",
        mode: "lines",
        name: s.label,
        x: dates,
        y,
        line: { color: s.color, width: 2, shape: "linear", dash },
        connectgaps: true,
        customdata: regionCustomdata,
        hovertemplate: referenceHoverTemplate,
      } as unknown as PlotData;
    }

    return {
      type: "scatter",
      mode: "lines",
      name: s.label,
      x: dates,
      y,
      line: { color: s.color, width: 2, shape: "linear", dash },
      connectgaps: true,
      hovertemplate: `<b>%{x}</b><br>${s.label}: R$ %{y:.2f}/L<extra></extra>`,
    } as unknown as PlotData;
  });

  // End-of-line value annotations (right-column stack).
  const tips = visibleSeries
    .map((s, idx) => {
      for (let i = filtered.length - 1; i >= 0; i--) {
        const v = filtered[i][s.field] as number | null;
        if (v != null) {
          return { idx, series: s, value: v, date: filtered[i].date };
        }
      }
      return null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  let annotations: Partial<Annotations>[] = [];
  if (tips.length > 0) {
    // Anchor X = max last-non-null date across all visible series.
    const anchorX = tips.reduce(
      (m, t) => (t.date > m ? t.date : m),
      tips[0].date,
    );

    // Sort by value desc, tie-break by declared series order.
    const sorted = [...tips].sort(
      (a, b) => b.value - a.value || a.idx - b.idx,
    );

    // Min gap in data units — floor 0.10 BRL/L handles the all-equal edge case.
    const yVals = tips.map((t) => t.value);
    const yRange = Math.max(...yVals) - Math.min(...yVals);
    const minGap = Math.max(0.10, yRange * 0.025);

    // Walk top→bottom, pushing collisions downward.
    const displayY = new Map<number, number>();
    displayY.set(sorted[0].idx, sorted[0].value);
    for (let i = 1; i < sorted.length; i++) {
      const prevDisplay = displayY.get(sorted[i - 1].idx)!;
      const wantedDisplay = sorted[i].value;
      displayY.set(
        sorted[i].idx,
        Math.min(wantedDisplay, prevDisplay - minGap),
      );
    }

    annotations = tips.map((t) => ({
      x: anchorX,
      y: displayY.get(t.idx)!,
      xref: "x" as const,
      yref: "y" as const,
      xanchor: "left" as const,
      yanchor: "middle" as const,
      xshift: 8,
      text: t.value.toFixed(2),
      showarrow: false,
      font: { size: 11, color: t.series.color, family: "Arial" },
    }));
  }

  // Extend the x range by ~30 days past the last point so the annotations
  // have room to the right of the visible plot.
  const lastDate = filtered[filtered.length - 1].date;
  const xRangeEnd = addDays(lastDate, 30);
  const firstDate = filtered[0].date;

  return {
    data: traceData,
    layout: {
      ...COMMON_LAYOUT,
      hovermode: "x unified",
      xaxis: {
        ...AXIS_LINE,
        type: "date",
        tickformat: "%b-%y",
        hoverformat: "%b %d, %Y",
        tickangle: -90,
        range: [firstDate, xRangeEnd],
        showspikes: true,
        spikemode: "across",
        spikedash: "solid",
        spikecolor: "#555555",
        spikethickness: 1,
      },
      yaxis: {
        ...AXIS_LINE,
        tickformat: ".2f",
        title: {
          text: "BRL/Liter",
          font: { family: "Arial", size: 11, color: "#555" },
        },
        automargin: true,
      },
      legend: { orientation: "h", y: -0.25, x: 0.5, xanchor: "center" },
      height: 420,
      margin: { t: 20, b: 110, l: 65, r: 90 },
      annotations,
    },
  };
}

// ─── WoW snapshot builder ─────────────────────────────────────────────────────
//
// For each series: finds the latest non-null reading, then walks backward to
// find the most recent reading whose date ≤ latestDate − 7 calendar days.
// Returns wowPct = null when prior reading is unavailable.

export function buildCurrentValuesWithWoW(
  rows: SubsidyTrackerRow[],
  xMin: string | null,
  xMax: string | null,
  series: SeriesDef[],
): SubsidyTrackerWowRow[] {
  const scoped = rows
    .filter((r) => (!xMin || r.date >= xMin) && (!xMax || r.date <= xMax))
    .sort((a, b) => b.date.localeCompare(a.date)); // desc

  return series.map((s) => {
    // Latest non-null reading
    const latestRow = scoped.find((r) => r[s.field] != null);
    const latestValue = (latestRow?.[s.field] as number | null) ?? null;
    const latestDate = latestRow?.date ?? null;

    // Prior reading: most recent with date ≤ latestDate − 7 days
    let priorValue: number | null = null;
    let priorDate: string | null = null;
    if (latestDate != null) {
      const targetDate = addDays(latestDate, -7);
      const priorRow = scoped.find(
        (r) => r.date <= targetDate && r[s.field] != null,
      );
      priorValue = (priorRow?.[s.field] as number | null) ?? null;
      priorDate = priorRow?.date ?? null;
    }

    const wowPct =
      latestValue != null && priorValue != null && priorValue !== 0
        ? ((latestValue - priorValue) / priorValue) * 100
        : null;

    return {
      field: s.field,
      label: s.label,
      color: s.color,
      value: latestValue,
      date: latestDate,
      latestValue,
      latestDate,
      priorValue,
      priorDate,
      wowPct,
    };
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const DEFAULT_TRACE_VISIBILITY: TraceVisibility = {
  ipp: true,
  ipp_adjusted: true,
  petrobras: true,
  petrobras_adjusted: true,
  anp_reference_importador: true,
  anp_reference_produtor: true,
  anp_commercialization_importador: true,
  anp_commercialization_produtor: true,
};

/** 90-day default window from the latest available data point. */
function defaultSliderRange(datas: string[]): [number, number] {
  if (datas.length === 0) return [0, 0];
  const end = datas.length - 1;
  const latestDate = datas[end];
  const cutoffDate = addDays(latestDate, -90);
  const startIdx = Math.max(0, datas.findIndex((d) => d >= cutoffDate));
  return [startIdx, end];
}

export function useSubsidyTrackerData(): UseSubsidyTrackerData {
  const supabase = getSupabaseClient();

  const [rows, setRows] = useState<SubsidyTrackerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [filters, setFiltersState] = useState<SubsidyTrackerFilters>({
    sliderRange: [0, 0],
    traces: DEFAULT_TRACE_VISIBILITY,
  });
  const [excelLoading, setExcelLoading] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  const fetchIdRef = useRef(0);
  const fetchedRef = useRef(false);

  const fetchData = useCallback(() => {
    if (!supabase) return;
    const myId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    rpcGetSubsidyTrackerDiesel(supabase)
      .then((data) => {
        if (myId !== fetchIdRef.current) return;
        setRows(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (myId !== fetchIdRef.current) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  }, [supabase]);

  // Initial fetch.
  useEffect(() => {
    if (!supabase || fetchedRef.current) return;
    fetchedRef.current = true;
    fetchData();
  }, [supabase, fetchData]);

  // Stable partial-merge setter.
  const setFilters = useCallback((next: Partial<SubsidyTrackerFilters>) => {
    setFiltersState((prev) => ({
      ...prev,
      ...next,
      traces: { ...prev.traces, ...(next.traces ?? {}) },
    }));
  }, []);

  // Unique sorted date strings >= MIN_DATE.
  const datas = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.date >= MIN_DATE) seen.add(r.date);
    }
    return Array.from(seen).sort();
  }, [rows]);

  // Initialise slider range once datas are known (default last 90 days).
  useEffect(() => {
    if (datas.length === 0) return;
    setFiltersState((prev) => {
      // Only initialise once — keep user adjustments when rows refresh.
      if (prev.sliderRange[1] !== 0 || prev.sliderRange[0] !== 0) return prev;
      return { ...prev, sliderRange: defaultSliderRange(datas) };
    });
  }, [datas]);

  const xMin = datas[filters.sliderRange[0]] ?? null;
  const xMax = datas[filters.sliderRange[1]] ?? null;

  const resetFilters = useCallback(() => {
    if (datas.length === 0) return;
    setFiltersState({
      sliderRange: defaultSliderRange(datas),
      traces: DEFAULT_TRACE_VISIBILITY,
    });
  }, [datas]);

  const chartImporter = useMemo(
    () => buildChart(rows, xMin, xMax, filters.traces, SERIES_IMPORTADOR),
    [rows, xMin, xMax, filters.traces],
  );

  const chartProducer = useMemo(
    () => buildChart(rows, xMin, xMax, filters.traces, SERIES_PRODUTOR),
    [rows, xMin, xMax, filters.traces],
  );

  const currentValuesImporter = useMemo(
    () => buildCurrentValuesWithWoW(rows, xMin, xMax, SERIES_IMPORTADOR),
    [rows, xMin, xMax],
  );

  const currentValuesProducer = useMemo(
    () => buildCurrentValuesWithWoW(rows, xMin, xMax, SERIES_PRODUTOR),
    [rows, xMin, xMax],
  );

  const activeSubsidyImporter = useMemo(() => {
    const ref  = currentValuesImporter.find((c) => c.field === "anp_reference_importador")?.latestValue;
    const comm = currentValuesImporter.find((c) => c.field === "anp_commercialization_importador")?.latestValue;
    if (ref == null || comm == null) return null;
    return ref - comm;
  }, [currentValuesImporter]);

  const activeSubsidyProducer = useMemo(() => {
    const ref  = currentValuesProducer.find((c) => c.field === "anp_reference_produtor")?.latestValue;
    const comm = currentValuesProducer.find((c) => c.field === "anp_commercialization_produtor")?.latestValue;
    if (ref == null || comm == null) return null;
    return ref - comm;
  }, [currentValuesProducer]);

  const exportExcel = useCallback(async () => {
    setExcelLoading(true);
    try {
      await downloadGenericExcel({
        rows: rows as unknown as Record<string, unknown>[],
        filename: "subsidy_tracker_diesel",
        title: "Subsidy Tracker — Diesel (Importador + Produtor)",
        sheetName: "Diesel",
        mergeTitleCells: true,
        columns: [
          { header: "Date",                              key: "date",                              width: 12, align: "left"   },
          { header: "IPP",                               key: "ipp",                               width: 10, format: "0.00", align: "center" },
          { header: "IPP (adjusted)",                    key: "ipp_adjusted",                      width: 16, format: "0.00", align: "center" },
          { header: "Petrobras",                         key: "petrobras",                         width: 12, format: "0.00", align: "center" },
          { header: "Petrobras (adjusted)",              key: "petrobras_adjusted",                width: 20, format: "0.00", align: "center" },
          { header: "ANP Reference (Importador)",        key: "anp_reference_importador",          width: 26, format: "0.00", align: "center" },
          { header: "ANP Reference (Produtor)",          key: "anp_reference_produtor",            width: 26, format: "0.00", align: "center" },
          { header: "ANP Commercialization (Importador)", key: "anp_commercialization_importador", width: 32, format: "0.00", align: "center" },
          { header: "ANP Commercialization (Produtor)",   key: "anp_commercialization_produtor",   width: 32, format: "0.00", align: "center" },
        ],
      });
    } catch (e) {
      console.error("Excel export failed", e);
    } finally {
      setExcelLoading(false);
    }
  }, [rows]);

  const exportCsv = useCallback(() => {
    setCsvLoading(true);
    try {
      downloadCsv({
        rows: rows.map((r) => ({
          date: r.date,
          ipp: r.ipp,
          ipp_adjusted: r.ipp_adjusted,
          petrobras: r.petrobras,
          petrobras_adjusted: r.petrobras_adjusted,
          anp_reference_importador: r.anp_reference_importador,
          anp_reference_produtor: r.anp_reference_produtor,
          anp_commercialization_importador: r.anp_commercialization_importador,
          anp_commercialization_produtor: r.anp_commercialization_produtor,
        })) as unknown as Record<string, unknown>[],
        filename: "subsidy_tracker_diesel",
        columns: [
          "date",
          "ipp",
          "ipp_adjusted",
          "petrobras",
          "petrobras_adjusted",
          "anp_reference_importador",
          "anp_reference_produtor",
          "anp_commercialization_importador",
          "anp_commercialization_produtor",
        ],
      });
    } finally {
      setCsvLoading(false);
    }
  }, [rows]);

  return {
    rows,
    loading,
    error,
    refetch: fetchData,
    filters,
    setFilters,
    resetFilters,
    datas,
    xMin,
    xMax,
    chartImporter,
    chartProducer,
    currentValuesImporter,
    currentValuesProducer,
    activeSubsidyImporter,
    activeSubsidyProducer,
    exportExcel,
    exportCsv,
    excelLoading,
    csvLoading,
  };
}
