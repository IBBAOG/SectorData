"use client";

// ─── Single "brain" hook for /anp-cdp-bsw (dual-view pattern) ────────────────
//
// Both desktop/View.tsx and mobile/View.tsx consume this hook. Neither View
// ever calls Supabase or derives chart traces on its own. All filter state,
// fetch orchestration (with debounce + race guard), color mapping, and table
// derivations live here.
//
// Scope: BSW (water cut) vs depletion proxy per field, on top of the
// `anp_cdp_producao` table (~1.8M rows). Two view modes:
//   • Per well     — months since first production (one trace per well)
//   • Field avg    — % of VOIP recovered (one trace per field, weighted)
//
// Binding sync rule (CLAUDE.md § Dual-view policy): meaningful changes to one
// View must land in the OTHER View in the same commit, OR the commit message
// must declare [desktop-only] / [mobile-only] with an explicit reason.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot, PALETTE } from "../../../lib/plotlyDefaults";
import { bblDiaToKbpd } from "../../../lib/units";
import {
  rpcGetAnpCdpBswCampos,
  rpcGetAnpCdpBswScatter,
  rpcGetAnpCdpBswFieldAggregate,
  type AnpCdpBswPoint,
  type AnpCdpBswFieldPoint,
} from "../../../lib/rpc";

// ─── Constants / types (exported for Views) ──────────────────────────────────

export const BRAND_ORANGE = "#FF5000";
export { PALETTE };

export type ViewMode = "well" | "field";
export type LineStyle = "markers" | "markers+lines";

export const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "well",  label: "Per well" },
  { value: "field", label: "Field average" },
];

export const LINE_STYLE_OPTIONS: { value: LineStyle; label: string }[] = [
  { value: "markers",       label: "Markers" },
  { value: "markers+lines", label: "Markers + lines" },
];

// Maps the toggle value to Plotly's `mode` string.
export const plotlyMode = (style: LineStyle): "markers" | "lines+markers" =>
  style === "markers" ? "markers" : "lines+markers";

// Maximum number of fields plottable simultaneously in "Field average" mode.
// Beyond this, the legend/colors become hard to distinguish. PALETTE recycles
// after 16 entries (palette index `i % PALETTE.length`), but allowing up to
// 20 selections keeps short bursts of comparison usable while still capping at
// a sane number.
export const MAX_FIELDS_IN_FIELD_MODE = 20;

export type { AnpCdpBswPoint, AnpCdpBswFieldPoint };

// 12-month BSW history table model — used by both Views.
export interface BswTableRow {
  item: string;
  color: string;
  /** BSW values keyed by `YYYY-MM`. Missing months are absent. */
  values: Record<string, number>;
}

export interface BswTableModel {
  months: string[];
  rows: BswTableRow[];
}

export interface UseAnpCdpBswData {
  // Visibility guard
  visible: boolean;
  visLoading: boolean;

  // Loading flags
  filtrosLoading: boolean;       // initial campos list
  chartLoading: boolean;         // active-view RPC in flight

  // Filter / view state
  campos: string[];
  selectedCampos: string[];
  viewMode: ViewMode;
  lineStyle: LineStyle;

  // Setters
  setSelectedCampos: (next: string[]) => void;
  handleModeChange: (next: ViewMode) => void;
  handleCamposChange: (next: string[]) => void;
  setLineStyle: (s: LineStyle) => void;

  // Raw data
  wellPoints: AnpCdpBswPoint[];
  fieldPoints: AnpCdpBswFieldPoint[];

  // Derived: chart, table, helpers
  chart: { data: PlotData[]; layout: Partial<Layout> };
  mobileChartTraces: PlotData[];
  tableModel: BswTableModel;
  uniqueWellCount: number;
  fieldColor: (c: string) => string;

  // Format helpers (Views call these from JSX)
  fmtBsw: (v: number | undefined) => string;
  fmtDelta: (v: number | null) => { text: string; color: string };
  computeDeltas: (
    months: string[],
    values: Record<string, number>,
  ) => { mom: number | null; ytd: number | null };
}

// ─── Chart builders (desktop / detailed) ─────────────────────────────────────

function buildPerWellChart(
  points: AnpCdpBswPoint[],
  selectedCampos: string[],
  lineStyle: LineStyle,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!selectedCampos.length) {
    return emptyPlot(460, "Select a field to plot BSW evolution.");
  }
  if (!points.length) {
    return emptyPlot(460, "No data for the selected field.");
  }

  // Per-well mode: one trace per unique poco (first-appearance order so colors
  // stay stable between renders).
  const seen: string[] = [];
  for (const p of points) {
    if (!seen.includes(p.poco)) seen.push(p.poco);
  }
  const mode = plotlyMode(lineStyle);
  const traces: PlotData[] = seen.map((poco, i) => {
    const subset = points.filter((p) => p.poco === poco);
    const color = PALETTE[i % PALETTE.length];
    return {
      type: "scattergl",
      mode,
      name: poco,
      x: subset.map((p) => p.mes_desde_t0),
      y: subset.map((p) => p.bsw),
      customdata: subset.map((p) => [p.poco, p.ano, p.mes] as [string, number, number]),
      marker: { size: 4, opacity: 0.7, color },
      line: { color, width: 1 },
      hovertemplate:
        "<b>%{customdata[0]}</b><br>" +
        "Reference month: %{customdata[1]}-%{customdata[2]:02d}<br>" +
        "BSW: %{y:.1%}<br>" +
        "Months since start: %{x}" +
        "<extra></extra>",
    } as unknown as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 460,
      margin: { t: 30, b: 60, l: 70, r: 30 },
      xaxis: {
        ...AXIS_LINE,
        title: { text: "Months since first production" },
        rangemode: "tozero",
      },
      yaxis: {
        ...AXIS_LINE,
        title: { text: "BSW (water cut)" },
        rangemode: "tozero",
        tickformat: ",.0%",
      },
      legend: {
        orientation: "v",
        x: 1.02,
        xanchor: "left",
        y: 1,
        yanchor: "top",
        itemsizing: "constant",
      },
      hovermode: "closest",
    },
  };
}

function buildFieldAverageChart(
  points: AnpCdpBswFieldPoint[],
  selectedCampos: string[],
  lineStyle: LineStyle,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!selectedCampos.length) {
    return emptyPlot(460, "Select one or more fields to plot BSW evolution.");
  }
  if (!points.length) {
    return emptyPlot(460, "No data for the selected fields.");
  }

  // One trace per campo (volume-weighted average across wells at each calendar
  // month). X axis is % of VOIP recovered (cumulative oil / VOIP). One trace
  // per selected campo (even empty subsets) so the legend matches sidebar
  // chips 1:1.
  const mode = plotlyMode(lineStyle);
  const traces: PlotData[] = selectedCampos.map((campo, i) => {
    const subset = points
      .filter((p) => p.campo === campo)
      .sort((a, b) => a.pct_voip - b.pct_voip);
    const color = PALETTE[i % PALETTE.length];
    if (typeof window !== "undefined" && points.length > 0 && subset.length === 0) {
      // Only warn when we actually received points but none for this campo.
      // eslint-disable-next-line no-console
      console.warn(
        `[anp-cdp-bsw] field "${campo}" is selected but has no points in the RPC result; rendering empty trace.`,
      );
    }
    return {
      type: "scatter",
      mode,
      name: campo,
      x: subset.map((p) => p.pct_voip),
      y: subset.map((p) => p.bsw),
      customdata: subset.map(
        (p) =>
          [p.n_pocos, bblDiaToKbpd(p.volume_total), p.ref_ano, p.ref_mes, p.cumulative_oil_bbl] as [
            number,
            number,
            number,
            number,
            number,
          ],
      ),
      line: { color, width: 2 },
      marker: { size: 6, color },
      hovertemplate:
        "<b>" + campo + "</b><br>" +
        "Reference month: %{customdata[2]}-%{customdata[3]:02d}<br>" +
        "VOIP recovered: %{x:.1%}<br>" +
        "BSW: %{y:.1%}<br>" +
        "Cumulative oil: %{customdata[4]:,.0f} bbl<br>" +
        "Wells active: %{customdata[0]}<br>" +
        "Daily volume: %{customdata[1]:,.1f} kbpd" +
        "<extra></extra>",
    } as unknown as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 460,
      margin: { t: 30, b: 60, l: 70, r: 30 },
      xaxis: {
        ...AXIS_LINE,
        title: { text: "% of VOIP recovered" },
        tickformat: ",.1%",
        rangemode: "tozero",
      },
      yaxis: {
        ...AXIS_LINE,
        title: { text: "BSW (water cut, volume-weighted)" },
        rangemode: "tozero",
        tickformat: ",.0%",
      },
      legend: {
        orientation: "v",
        x: 1.02,
        xanchor: "left",
        y: 1,
        yanchor: "top",
      },
      hovermode: "closest",
    },
  };
}

// ─── Mobile chart trace builder ──────────────────────────────────────────────
//
// Mobile uses MobileChart (its own layout); we only need to compose the
// `PlotData[]` array. Same logic as desktop builder but:
//   • No layout (MobileChart handles axes / font / margins).
//   • Smaller markers / lines so legibility on a ~360px chart stays high.
//   • Leader trace (first selected field) gets BRAND_ORANGE; followers use
//     the PALETTE rotated by selection index + 1 so the leader is always
//     visually privileged (mockup parity with stocks/anp-cdp mobile).

function buildMobileChart(
  wellPoints: AnpCdpBswPoint[],
  fieldPoints: AnpCdpBswFieldPoint[],
  selectedCampos: string[],
  viewMode: ViewMode,
  lineStyle: LineStyle,
): PlotData[] {
  if (!selectedCampos.length) return [];

  const mode = plotlyMode(lineStyle);

  if (viewMode === "well") {
    if (!wellPoints.length) return [];
    // Cap unique wells to 12 to keep the mobile legend / chart usable.
    const MOBILE_WELL_CAP = 12;
    const seen: string[] = [];
    for (const p of wellPoints) {
      if (!seen.includes(p.poco)) seen.push(p.poco);
      if (seen.length >= MOBILE_WELL_CAP) break;
    }
    return seen.map((poco, i) => {
      const subset = wellPoints.filter((p) => p.poco === poco);
      const color = i === 0 ? BRAND_ORANGE : PALETTE[(i + 1) % PALETTE.length];
      return {
        type: "scattergl",
        mode,
        name: poco,
        x: subset.map((p) => p.mes_desde_t0),
        y: subset.map((p) => p.bsw),
        marker: { size: 4, opacity: 0.75, color },
        line: { color, width: i === 0 ? 2 : 1 },
        hovertemplate: `${poco}: %{y:.1%} @ %{x} mo<extra></extra>`,
      } as unknown as PlotData;
    });
  }

  // Field-average mode
  if (!fieldPoints.length) return [];
  return selectedCampos.map((campo, i) => {
    const subset = fieldPoints
      .filter((p) => p.campo === campo)
      .sort((a, b) => a.pct_voip - b.pct_voip);
    const color = i === 0 ? BRAND_ORANGE : PALETTE[(i + 1) % PALETTE.length];
    return {
      type: "scatter",
      mode,
      name: campo,
      x: subset.map((p) => p.pct_voip),
      y: subset.map((p) => p.bsw),
      line: { color, width: i === 0 ? 2.2 : 1.4 },
      marker: { size: 5, color },
      hovertemplate: `${campo}: %{y:.1%} @ %{x:.1%}<extra></extra>`,
    } as unknown as PlotData;
  });
}

// ─── Format helpers ──────────────────────────────────────────────────────────

const fmtBsw = (v: number | undefined): string =>
  v === undefined || v === null || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(1)}%`;

const fmtDelta = (
  v: number | null,
): { text: string; color: string } => {
  if (v === null || !Number.isFinite(v)) return { text: "—", color: "#888" };
  const sign = v > 0 ? "+" : v < 0 ? "" : "";
  // Green when BSW falls (less water = good), red when it rises.
  const color = v < 0 ? "#28a745" : v > 0 ? "#dc3545" : "#666";
  return { text: `${sign}${v.toFixed(2)}%`, color };
};

const computeDeltas = (
  months: string[],
  values: Record<string, number>,
): { mom: number | null; ytd: number | null } => {
  if (!months.length) return { mom: null, ytd: null };
  const tKey = months[months.length - 1];
  const tVal = values[tKey];
  if (tVal === undefined || tVal === 0) return { mom: null, ytd: null };

  let mom: number | null = null;
  if (months.length >= 2) {
    const prevKey = months[months.length - 2];
    const prevVal = values[prevKey];
    if (prevVal !== undefined && prevVal !== 0) {
      const [ty, tm] = tKey.split("-").map(Number);
      const [py, pm] = prevKey.split("-").map(Number);
      const adjacent =
        (ty === py && tm === pm + 1) || (ty === py + 1 && tm === 1 && pm === 12);
      if (adjacent) {
        mom = (tVal / prevVal - 1) * 100;
      }
    }
  }

  const tYear = tKey.split("-")[0];
  const sameYearMonths = months
    .filter((k) => k.startsWith(`${tYear}-`))
    .sort();
  let ytd: number | null = null;
  if (sameYearMonths.length >= 2) {
    const baseKey = sameYearMonths[0] === tKey ? null : sameYearMonths[0];
    if (baseKey) {
      const baseVal = values[baseKey];
      if (baseVal !== undefined && baseVal !== 0) {
        ytd = (tVal / baseVal - 1) * 100;
      }
    }
  }
  return { mom, ytd };
};

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAnpCdpBswData(): UseAnpCdpBswData {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp-bsw");
  const supabase = getSupabaseClient();

  const [campos, setCampos] = useState<string[]>([]);
  const [filtrosLoading, setFiltrosLoading] = useState(true);
  const [selectedCampos, setSelectedCampos] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("well");
  const [lineStyle, setLineStyle] = useState<LineStyle>("markers+lines");
  const [wellPoints,  setWellPoints]  = useState<AnpCdpBswPoint[]>([]);
  const [fieldPoints, setFieldPoints] = useState<AnpCdpBswFieldPoint[]>([]);

  // ── Initial load: only the campos list (alphabetical, VOIP-published) ────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const list = await rpcGetAnpCdpBswCampos(supabase);
      if (cancelled) return;
      setCampos(list);
      setFiltrosLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive per-well fetch (debounced 400ms) ────────────────────────────
  const { data: wellRefetched, loading: wellLoading } = useDebouncedFetch(
    async () => {
      if (!supabase) return [] as AnpCdpBswPoint[];
      if (viewMode !== "well") return [] as AnpCdpBswPoint[];
      if (selectedCampos.length === 0) return [] as AnpCdpBswPoint[];
      return rpcGetAnpCdpBswScatter(supabase, selectedCampos);
    },
    [supabase, selectedCampos, viewMode],
    { ms: 400, skipInitial: false },
  );

  useEffect(() => {
    if (wellRefetched !== null) setWellPoints(wellRefetched);
  }, [wellRefetched]);

  // ── Reactive field-average fetch (debounced 400ms) ───────────────────────
  const { data: fieldRefetched, loading: fieldLoading } = useDebouncedFetch(
    async () => {
      if (!supabase) return [] as AnpCdpBswFieldPoint[];
      if (viewMode !== "field") return [] as AnpCdpBswFieldPoint[];
      if (selectedCampos.length === 0) return [] as AnpCdpBswFieldPoint[];
      return rpcGetAnpCdpBswFieldAggregate(supabase, selectedCampos);
    },
    [supabase, selectedCampos, viewMode],
    { ms: 400, skipInitial: false },
  );

  useEffect(() => {
    if (fieldRefetched !== null) setFieldPoints(fieldRefetched);
  }, [fieldRefetched]);

  // Reset cached points when selection is empty so the empty state renders
  // cleanly.
  useEffect(() => {
    if (selectedCampos.length === 0) {
      setWellPoints([]);
      setFieldPoints([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampos.length]);

  // ── Derived: desktop chart (full layout) ─────────────────────────────────
  const chart = useMemo(() => {
    return viewMode === "well"
      ? buildPerWellChart(wellPoints, selectedCampos, lineStyle)
      : buildFieldAverageChart(fieldPoints, selectedCampos, lineStyle);
  }, [viewMode, wellPoints, fieldPoints, selectedCampos, lineStyle]);

  // ── Derived: mobile chart traces (layout-less) ───────────────────────────
  const mobileChartTraces = useMemo(
    () => buildMobileChart(wellPoints, fieldPoints, selectedCampos, viewMode, lineStyle),
    [wellPoints, fieldPoints, selectedCampos, viewMode, lineStyle],
  );

  const chartLoading = viewMode === "well" ? wellLoading : fieldLoading;

  const fieldColor = useCallback(
    (c: string): string => {
      const i = selectedCampos.indexOf(c);
      return i >= 0 ? PALETTE[i % PALETTE.length] : "#dcdcdc";
    },
    [selectedCampos],
  );

  // ── Derived: 12-month BSW history table ──────────────────────────────────
  const tableModel = useMemo<BswTableModel>(() => {
    const empty: BswTableModel = { months: [], rows: [] };
    const ymKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

    if (viewMode === "well") {
      if (!selectedCampos.length || !wellPoints.length) return empty;
      const allKeys = new Set<string>();
      for (const p of wellPoints) allKeys.add(ymKey(p.ano, p.mes));
      const months = Array.from(allKeys).sort().slice(-12);
      const monthSet = new Set(months);

      const seen: string[] = [];
      const byPoco = new Map<string, Record<string, number>>();
      for (const p of wellPoints) {
        if (!seen.includes(p.poco)) {
          seen.push(p.poco);
          byPoco.set(p.poco, {});
        }
        const k = ymKey(p.ano, p.mes);
        if (monthSet.has(k)) {
          byPoco.get(p.poco)![k] = p.bsw;
        }
      }
      const rows: BswTableRow[] = seen.map((poco, i) => ({
        item: poco,
        color: PALETTE[i % PALETTE.length],
        values: byPoco.get(poco) ?? {},
      }));
      return { months, rows };
    }

    // Field-average mode
    if (!selectedCampos.length || !fieldPoints.length) return empty;
    const allKeys = new Set<string>();
    for (const p of fieldPoints) allKeys.add(ymKey(p.ref_ano, p.ref_mes));
    const months = Array.from(allKeys).sort().slice(-12);
    const monthSet = new Set(months);

    const rows: BswTableRow[] = selectedCampos.map((campo, i) => {
      const values: Record<string, number> = {};
      for (const p of fieldPoints) {
        if (p.campo !== campo) continue;
        const k = ymKey(p.ref_ano, p.ref_mes);
        if (monthSet.has(k)) values[k] = p.bsw;
      }
      return { item: campo, color: PALETTE[i % PALETTE.length], values };
    });
    return { months, rows };
  }, [viewMode, wellPoints, fieldPoints, selectedCampos]);

  // Per-well mode: count unique wells in the currently fetched points so the
  // Views can hint at the legend size for the selected field.
  const uniqueWellCount = useMemo(() => {
    if (viewMode !== "well") return 0;
    if (!wellPoints.length) return 0;
    const set = new Set<string>();
    for (const p of wellPoints) set.add(p.poco);
    return set.size;
  }, [viewMode, wellPoints]);

  // ── Mode-aware setters ────────────────────────────────────────────────────
  const handleModeChange = useCallback((next: ViewMode) => {
    setViewMode(next);
    setSelectedCampos((prev) => {
      if (next === "well" && prev.length > 1) {
        return prev.slice(0, 1);
      }
      return prev;
    });
  }, []);

  const handleCamposChange = useCallback((next: string[]) => {
    setSelectedCampos((prev) => {
      if (viewMode === "well") {
        if (next.length === 0) return [];
        // Single-select: prefer the newly added field.
        const added = next.find((c) => !prev.includes(c));
        return [added ?? next[next.length - 1]];
      }
      // Field-average mode: enforce the plot cap.
      if (next.length > MAX_FIELDS_IN_FIELD_MODE) {
        return next.slice(0, MAX_FIELDS_IN_FIELD_MODE);
      }
      return next;
    });
  }, [viewMode]);

  return {
    visible,
    visLoading,
    filtrosLoading,
    chartLoading,
    campos,
    selectedCampos,
    viewMode,
    lineStyle,
    setSelectedCampos,
    handleModeChange,
    handleCamposChange,
    setLineStyle,
    wellPoints,
    fieldPoints,
    chart,
    mobileChartTraces,
    tableModel,
    uniqueWellCount,
    fieldColor,
    fmtBsw,
    fmtDelta,
    computeDeltas,
  };
}
