"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import BrandLogo from "../../../components/BrandLogo";
import PlotlyChart from "../../../components/PlotlyChart";
import SearchableMultiSelect from "../../../components/SearchableMultiSelect";
import DashboardHeader from "../../../components/dashboard/DashboardHeader";
import ChartSection from "../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../components/dashboard/BarrelLoading";
import SegmentedToggle from "../../../components/dashboard/SegmentedToggle";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot, PALETTE } from "../../../lib/plotlyDefaults";
import {
  rpcGetAnpCdpDepletionCampos,
  rpcGetAnpCdpDepletionScatter,
  rpcGetAnpCdpDepletionFieldAggregate,
  type AnpCdpDepletionPoint,
  type AnpCdpDepletionFieldPoint,
} from "../../../lib/rpc";

// ── View mode ─────────────────────────────────────────────────────────────────

type ViewMode = "well" | "field";

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "well",  label: "Per well" },
  { value: "field", label: "Field average" },
];

// ── X axis ────────────────────────────────────────────────────────────────────
// Calendar (default) plots NP against calendar date. % VOIP recovered plots
// NP against the share of the field's VOIP that has been recovered cumulatively.
// Both modes are supported in Per-well and Field-average views: in Per-well
// each point inherits its field's pct_voip for the corresponding month
// (`pct_voip_poco`), so all wells of a field share the same X scale as the
// Field-average view. Points with `pct_voip_poco = NULL` (no VOIP join) are
// dropped from the % VOIP plot but still rendered in Calendar mode.

type XMode = "calendar" | "voip";

const X_MODE_OPTIONS: { value: XMode; label: string }[] = [
  { value: "calendar", label: "Calendar" },
  { value: "voip",     label: "% VOIP recovered" },
];

// ── Plot style ────────────────────────────────────────────────────────────────
// Trace mode toggle shared by both views. Default is "markers+lines" because
// for a depletion curve the line carries the trend visually.

type LineStyle = "markers" | "markers+lines";

const LINE_STYLE_OPTIONS: { value: LineStyle; label: string }[] = [
  { value: "markers",       label: "Markers" },
  { value: "markers+lines", label: "Markers + lines" },
];

// Maps the toggle value to Plotly's `mode` string.
const plotlyMode = (style: LineStyle): "markers" | "lines+markers" =>
  style === "markers" ? "markers" : "lines+markers";

// Maximum number of fields plottable simultaneously in "Field average" mode.
const MAX_FIELDS_IN_FIELD_MODE = 20;

// Sort key for `(ano, mes)` tuples → number (ano*12 + mes).
const ymSort = (a: number, m: number) => a * 12 + m;

// ── Rolling depletion helper ──────────────────────────────────────────────────
//
// For each point t in a per-item time series, compute the depletion as
//   depletion_t = (avg(NP, recent window) − avg(NP, prior window)) / avg(NP, prior window)
// where:
//   - recent window  = the last N points up to and including t
//   - prior window   = the M points immediately before the recent window
// Points without a full N+M-point history (i.e. with insufficient back-history)
// are silently dropped.
//
// IMPORTANT: the windows are over the N most recent **available** points, not
// over N **calendar** months. ANP CDP can have gaps (well stopped for a month).
// Treating gaps as missing-data is acceptable for v1 — the alternative would be
// to fill missing months with zeros and skew the averages towards 0. A future
// iteration may move this computation server-side with calendar-aware windows.
type RollingDepletionInput = { ano: number; mes: number; np: number };
type RollingDepletionOutput = { ano: number; mes: number; depletion: number };

function rollingDepletion(
  items: RollingDepletionInput[],
  nRecent: number,
  nPrior: number,
): RollingDepletionOutput[] {
  if (nRecent < 1 || nPrior < 1) return [];
  if (items.length < nRecent + nPrior) return [];
  // Defensive: ensure ascending order by (ano, mes). The caller should already
  // sort, but the math is silent-broken if the assumption is violated.
  const sorted = items.slice().sort((a, b) => ymSort(a.ano, a.mes) - ymSort(b.ano, b.mes));
  const out: RollingDepletionOutput[] = [];
  for (let i = nRecent + nPrior - 1; i < sorted.length; i++) {
    const recent = sorted.slice(i - nRecent + 1, i + 1);
    const prior = sorted.slice(i - nRecent - nPrior + 1, i - nRecent + 1);
    if (recent.length !== nRecent || prior.length !== nPrior) continue;
    const sumR = recent.reduce((s, x) => s + x.np, 0);
    const sumP = prior.reduce((s, x) => s + x.np, 0);
    const avgR = sumR / recent.length;
    const avgP = sumP / prior.length;
    if (!Number.isFinite(avgR) || !Number.isFinite(avgP) || avgP === 0) continue;
    const dep = (avgR - avgP) / avgP;
    if (!Number.isFinite(dep)) continue;
    out.push({ ano: sorted[i].ano, mes: sorted[i].mes, depletion: dep });
  }
  return out;
}

// ── Chart builders ────────────────────────────────────────────────────────────

function buildPerWellChart(
  points: AnpCdpDepletionPoint[],
  selectedCampos: string[],
  lineStyle: LineStyle,
  xMode: XMode,
  recentMonths: number,
  priorMonths: number,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!selectedCampos.length) {
    return emptyPlot(
      460,
      "Select a field to plot rolling depletion.",
    );
  }
  if (!points.length) {
    return emptyPlot(460, "No data for the selected field.");
  }

  // Per-well mode: one trace per unique poco (in first-appearance order so
  // colors stay stable between renders).
  const seen: string[] = [];
  for (const p of points) {
    if (!seen.includes(p.poco)) seen.push(p.poco);
  }
  const mode = plotlyMode(lineStyle);
  const traces: PlotData[] = seen.map((poco, i) => {
    // Per-well rolling depletion is computed in calendar order. We keep the
    // full series (including points with null pct_voip_poco) so that gaps in
    // the VOIP join do not break the rolling computation; the % VOIP filtering
    // happens at the render step below.
    const fullSeries = points
      .filter((p) => p.poco === poco)
      .sort((a, b) => ymSort(a.ano, a.mes) - ymSort(b.ano, b.mes));
    const depletionByYm = new Map<number, number>();
    for (const d of rollingDepletion(
      fullSeries.map((p) => ({ ano: p.ano, mes: p.mes, np: p.np_bbl_mes })),
      recentMonths,
      priorMonths,
    )) {
      depletionByYm.set(ymSort(d.ano, d.mes), d.depletion);
    }

    // Each point that has a depletion value AND (in % VOIP mode) a non-null
    // pct_voip_poco is rendered. Points without a depletion (insufficient
    // history) are dropped. In % VOIP mode, points without VOIP also drop.
    const renderedPoints = fullSeries
      .map((p) => {
        const dep = depletionByYm.get(ymSort(p.ano, p.mes));
        if (dep === undefined) return null;
        if (xMode === "voip" && (p.pct_voip_poco === null || !Number.isFinite(p.pct_voip_poco))) {
          return null;
        }
        return { p, dep };
      })
      .filter((x): x is { p: AnpCdpDepletionPoint; dep: number } => x !== null);

    // For % VOIP mode, sort by pct_voip_poco so the line connects in VOIP order.
    const subset =
      xMode === "voip"
        ? renderedPoints.slice().sort(
            (a, b) => (a.p.pct_voip_poco ?? 0) - (b.p.pct_voip_poco ?? 0),
          )
        : renderedPoints;

    const color = PALETTE[i % PALETTE.length];
    return {
      type: "scattergl",
      mode,
      name: poco,
      x:
        xMode === "voip"
          ? subset.map(({ p }) => p.pct_voip_poco ?? 0)
          : subset.map(({ p }) => `${p.ano}-${String(p.mes).padStart(2, "0")}-01`),
      y: subset.map(({ dep }) => dep),
      customdata: subset.map(
        ({ p }) =>
          [p.poco, p.ano, p.mes, p.pct_voip_poco ?? 0] as [
            string,
            number,
            number,
            number,
          ],
      ),
      marker: { size: 4, opacity: 0.7, color },
      line: { color, width: 1 },
      hovertemplate:
        xMode === "voip"
          ? "<b>%{customdata[0]}</b><br>" +
            "Reference month: %{customdata[1]}-%{customdata[2]:02d}<br>" +
            "VOIP recovered: %{customdata[3]:.1%}<br>" +
            "Depletion: %{y:.2%}" +
            "<extra></extra>"
          : "<b>%{customdata[0]}</b><br>" +
            "Reference month: %{customdata[1]}-%{customdata[2]:02d}<br>" +
            "Depletion: %{y:.2%}" +
            "<extra></extra>",
    } as unknown as PlotData;
  });

  const xaxis: Partial<Layout["xaxis"]> =
    xMode === "voip"
      ? {
          ...AXIS_LINE,
          type: "linear",
          title: { text: "% of VOIP recovered" },
          tickformat: ",.1%",
          rangemode: "tozero",
        }
      : {
          ...AXIS_LINE,
          type: "date",
          title: { text: "Date" },
        };

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 460,
      margin: { t: 30, b: 60, l: 80, r: 30 },
      xaxis,
      yaxis: {
        ...AXIS_LINE,
        title: { text: `Depletion (rolling, ${recentMonths}m vs prior ${priorMonths}m)` },
        tickformat: ",.1%",
        zeroline: true,
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
  points: AnpCdpDepletionFieldPoint[],
  selectedCampos: string[],
  lineStyle: LineStyle,
  xMode: XMode,
  recentMonths: number,
  priorMonths: number,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!selectedCampos.length) {
    return emptyPlot(
      460,
      "Select one or more fields to plot rolling depletion.",
    );
  }
  if (!points.length) {
    return emptyPlot(460, "No data for the selected fields.");
  }

  // One trace per campo, in selection order. We always emit a trace per
  // selected campo (even if empty) so the legend matches the sidebar chips.
  const mode = plotlyMode(lineStyle);
  const traces: PlotData[] = selectedCampos.map((campo, i) => {
    // Compute rolling depletion in calendar order, then map back to render order.
    const fullSeries = points
      .filter((p) => p.campo === campo)
      .sort((a, b) => ymSort(a.ano, a.mes) - ymSort(b.ano, b.mes));
    const color = PALETTE[i % PALETTE.length];
    if (typeof window !== "undefined" && points.length > 0 && fullSeries.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[anp-cdp-depletion] field "${campo}" is selected but has no points in the RPC result; rendering empty trace.`,
      );
    }
    const depletionByYm = new Map<number, number>();
    for (const d of rollingDepletion(
      fullSeries.map((p) => ({ ano: p.ano, mes: p.mes, np: p.np_bbl_mes })),
      recentMonths,
      priorMonths,
    )) {
      depletionByYm.set(ymSort(d.ano, d.mes), d.depletion);
    }

    const renderedPoints = fullSeries
      .map((p) => {
        const dep = depletionByYm.get(ymSort(p.ano, p.mes));
        if (dep === undefined) return null;
        return { p, dep };
      })
      .filter((x): x is { p: AnpCdpDepletionFieldPoint; dep: number } => x !== null);

    const subset =
      xMode === "voip"
        ? renderedPoints.slice().sort((a, b) => a.p.pct_voip - b.p.pct_voip)
        : renderedPoints;

    return {
      type: "scatter",
      mode,
      name: campo,
      x:
        xMode === "voip"
          ? subset.map(({ p }) => p.pct_voip)
          : subset.map(({ p }) => `${p.ano}-${String(p.mes).padStart(2, "0")}-01`),
      y: subset.map(({ dep }) => dep),
      customdata: subset.map(
        ({ p }) =>
          [p.ano, p.mes, p.n_pocos, p.pct_voip, p.cumulative_oil_bbl] as [
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
        "Reference month: %{customdata[0]}-%{customdata[1]:02d}<br>" +
        "Depletion: %{y:.2%}<br>" +
        "Wells active: %{customdata[2]}<br>" +
        "VOIP recovered: %{customdata[3]:.1%}<br>" +
        "Cumulative oil: %{customdata[4]:,.0f} bbl" +
        "<extra></extra>",
    } as unknown as PlotData;
  });

  const xaxis: Partial<Layout["xaxis"]> =
    xMode === "voip"
      ? {
          ...AXIS_LINE,
          type: "linear",
          title: { text: "% of VOIP recovered" },
          tickformat: ",.1%",
          rangemode: "tozero",
        }
      : {
          ...AXIS_LINE,
          type: "date",
          title: { text: "Date" },
        };

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 460,
      margin: { t: 30, b: 60, l: 80, r: 30 },
      xaxis,
      yaxis: {
        ...AXIS_LINE,
        title: { text: `Depletion (rolling, ${recentMonths}m vs prior ${priorMonths}m)` },
        tickformat: ",.1%",
        zeroline: true,
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

// ── Number formatters ─────────────────────────────────────────────────────────

// Format NP values compactly: 1_500_000 → "1.5M bbl", 12_345 → "12.3k bbl".
const fmtNp = (v: number | undefined | null): string => {
  if (v === undefined || v === null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B bbl`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M bbl`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}k bbl`;
  return `${v.toFixed(0)} bbl`;
};

// Format signed delta percentage with 2 decimals; pick a sensible sign.
const fmtDelta = (
  v: number | null,
): { text: string; color: string } => {
  if (v === null || !Number.isFinite(v)) return { text: "—", color: "#888" };
  const sign = v > 0 ? "+" : v < 0 ? "" : "";
  // For NP: rising is good (green), falling is depletion (red).
  // This is INVERSE of BSW where falling is good.
  const color = v > 0 ? "#28a745" : v < 0 ? "#dc3545" : "#666";
  return { text: `${sign}${v.toFixed(2)}%`, color };
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpCdpDepletionPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp-depletion");
  const supabase = getSupabaseClient();

  const [campos, setCampos] = useState<string[]>([]);
  const [filtrosLoading, setFiltrosLoading] = useState(true);
  const [selectedCampos, setSelectedCampos] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("well");
  const [xMode, setXMode] = useState<XMode>("calendar");
  const [lineStyle, setLineStyle] = useState<LineStyle>("markers+lines");
  const [recentMonths, setRecentMonths] = useState<number>(12);
  const [priorMonths, setPriorMonths] = useState<number>(12);
  const [wellPoints,  setWellPoints]  = useState<AnpCdpDepletionPoint[]>([]);
  const [fieldPoints, setFieldPoints] = useState<AnpCdpDepletionFieldPoint[]>([]);

  // Effective X mode — both views now support Calendar and % VOIP recovered.
  // In Per-well, each point's pct_voip_poco inherits its field's VOIP fraction
  // for the corresponding month, so the X scale matches the Field-average view.
  const effectiveXMode: XMode = xMode;

  // ── Initial load: only the campos list ───────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const list = await rpcGetAnpCdpDepletionCampos(supabase);
      if (cancelled) return;
      setCampos(list);
      setFiltrosLoading(false);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // ── Reactive per-well fetch (debounced 400ms) ─────────────────────────────
  const { data: wellRefetched, loading: wellLoading } = useDebouncedFetch(
    async () => {
      if (!supabase) return [] as AnpCdpDepletionPoint[];
      if (viewMode !== "well") return [] as AnpCdpDepletionPoint[];
      if (selectedCampos.length === 0) return [] as AnpCdpDepletionPoint[];
      return rpcGetAnpCdpDepletionScatter(supabase, selectedCampos);
    },
    [supabase, selectedCampos, viewMode],
    { ms: 400, skipInitial: false },
  );

  useEffect(() => {
    if (wellRefetched !== null) setWellPoints(wellRefetched);
  }, [wellRefetched]);

  // ── Reactive field-average fetch (debounced 400ms) ────────────────────────
  const { data: fieldRefetched, loading: fieldLoading } = useDebouncedFetch(
    async () => {
      if (!supabase) return [] as AnpCdpDepletionFieldPoint[];
      if (viewMode !== "field") return [] as AnpCdpDepletionFieldPoint[];
      if (selectedCampos.length === 0) return [] as AnpCdpDepletionFieldPoint[];
      return rpcGetAnpCdpDepletionFieldAggregate(supabase, selectedCampos);
    },
    [supabase, selectedCampos, viewMode],
    { ms: 400, skipInitial: false },
  );

  useEffect(() => {
    if (fieldRefetched !== null) setFieldPoints(fieldRefetched);
  }, [fieldRefetched]);

  // Reset cached points when selection is empty so the empty state renders cleanly.
  useEffect(() => {
    if (selectedCampos.length === 0) {
      setWellPoints([]);
      setFieldPoints([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampos.length]);

  const chart = useMemo(() => {
    return viewMode === "well"
      ? buildPerWellChart(wellPoints, selectedCampos, lineStyle, effectiveXMode, recentMonths, priorMonths)
      : buildFieldAverageChart(fieldPoints, selectedCampos, lineStyle, effectiveXMode, recentMonths, priorMonths);
  }, [viewMode, wellPoints, fieldPoints, selectedCampos, lineStyle, effectiveXMode, recentMonths, priorMonths]);

  const chartLoading = viewMode === "well" ? wellLoading : fieldLoading;

  const fieldColor = (c: string): string => {
    const i = selectedCampos.indexOf(c);
    return i >= 0 ? PALETTE[i % PALETTE.length] : "#dcdcdc";
  };

  // Per-well mode: count unique wells in the currently fetched points.
  const uniqueWellCount = useMemo(() => {
    if (viewMode !== "well") return 0;
    if (!wellPoints.length) return 0;
    const set = new Set<string>();
    for (const p of wellPoints) set.add(p.poco);
    return set.size;
  }, [viewMode, wellPoints]);

  // ── Period comparison helper text ─────────────────────────────────────────
  // Resolves the absolute calendar months that the recent/prior windows map to,
  // based on the latest (ano, mes) in the currently fetched points. If any
  // selected item has a shorter history than `priorMonths`, surfaces a subtle
  // warning so the user knows the comparison is on a clipped window.
  const periodHelper = useMemo<{
    text: string;
    warning: string | null;
  } | null>(() => {
    const fmt = (ano: number, mes: number) =>
      `${ano}-${String(mes).padStart(2, "0")}`;

    // Pull the active points list based on viewMode.
    const activePoints =
      viewMode === "well"
        ? wellPoints.map((p) => ({ key: p.poco, ano: p.ano, mes: p.mes }))
        : fieldPoints.map((p) => ({ key: p.campo, ano: p.ano, mes: p.mes }));

    if (selectedCampos.length === 0 || activePoints.length === 0) {
      return null;
    }

    // Latest (ano, mes) across all selected items.
    let maxYm = -Infinity;
    let maxAno = 0;
    let maxMes = 0;
    for (const p of activePoints) {
      const ym = ymSort(p.ano, p.mes);
      if (ym > maxYm) {
        maxYm = ym;
        maxAno = p.ano;
        maxMes = p.mes;
      }
    }
    if (!Number.isFinite(maxYm)) return null;

    // Recent window: [recent_start ... recent_end == max].
    // Prior window:  [prior_start ... prior_end == recent_start - 1 month].
    const recentEndYm = maxYm;
    const recentStartYm = recentEndYm - (recentMonths - 1);
    const priorEndYm = recentStartYm - 1;
    const priorStartYm = priorEndYm - (priorMonths - 1);

    const ymToDate = (ym: number): { ano: number; mes: number } => {
      // ym = ano*12 + mes, with mes in 1..12.
      const ano = Math.floor((ym - 1) / 12);
      const mes = ((ym - 1) % 12) + 1;
      return { ano, mes };
    };

    const recentEnd = { ano: maxAno, mes: maxMes };
    const recentStart = ymToDate(recentStartYm);
    const priorEnd = ymToDate(priorEndYm);
    const priorStart = ymToDate(priorStartYm);

    const text =
      `Comparing last ${recentMonths} months (${fmt(recentStart.ano, recentStart.mes)} → ${fmt(recentEnd.ano, recentEnd.mes)}) ` +
      `vs prior ${priorMonths} months (${fmt(priorStart.ano, priorStart.mes)} → ${fmt(priorEnd.ano, priorEnd.mes)}).`;

    // Warning detection: find the earliest (ano, mes) per selected item and
    // check whether the prior window extends earlier than that item's history.
    const earliestByKey = new Map<string, number>();
    for (const p of activePoints) {
      const ym = ymSort(p.ano, p.mes);
      const cur = earliestByKey.get(p.key);
      if (cur === undefined || ym < cur) {
        earliestByKey.set(p.key, ym);
      }
    }

    let worstClipKey: string | null = null;
    let worstAvailable = -Infinity;
    let worstEarliestYm = 0;
    for (const [key, earliestYm] of earliestByKey) {
      if (earliestYm > priorStartYm) {
        // The item's history starts after the prior window's start → clipped.
        const available = priorEndYm - earliestYm + 1;
        if (available > worstAvailable || worstClipKey === null) {
          worstAvailable = available;
          worstClipKey = key;
          worstEarliestYm = earliestYm;
        }
      }
    }

    let warning: string | null = null;
    if (worstClipKey !== null) {
      const earliest = ymToDate(worstEarliestYm);
      const availableMonths = Math.max(0, worstAvailable);
      warning =
        `Prior window clipped to ${availableMonths} months for "${worstClipKey}" ` +
        `(data starts ${fmt(earliest.ano, earliest.mes)}) — limited window.`;
    }

    return { text, warning };
  }, [viewMode, wellPoints, fieldPoints, selectedCampos, recentMonths, priorMonths]);

  // ── Depletion comparison table ────────────────────────────────────────────
  // Built from the same `points` already in state — no extra RPC.
  // Per-well mode → 1 row per poco; Field-average mode → 1 row per campo.
  // Columns: Item | NP last month | Avg recent N | Avg prior M | Depletion% | YoY%
  const tableModel = useMemo(() => {
    type Row = {
      item: string;
      color: string;
      // Series of (ymKey, np) sorted ascending by year/month, where ymKey is YYYY-MM.
      series: { ym: string; np: number }[];
    };
    type Model = { rows: Row[] };
    const empty: Model = { rows: [] };

    const ymKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

    if (viewMode === "well") {
      if (!selectedCampos.length || !wellPoints.length) return empty;
      // Preserve first-appearance order of wells (matches chart legend).
      const seen: string[] = [];
      const byPoco = new Map<string, { ym: string; np: number }[]>();
      for (const p of wellPoints) {
        if (!seen.includes(p.poco)) {
          seen.push(p.poco);
          byPoco.set(p.poco, []);
        }
        byPoco.get(p.poco)!.push({ ym: ymKey(p.ano, p.mes), np: p.np_bbl_mes });
      }
      const rows: Row[] = seen.map((poco, i) => ({
        item: poco,
        color: PALETTE[i % PALETTE.length],
        series: (byPoco.get(poco) ?? []).slice().sort((a, b) => a.ym.localeCompare(b.ym)),
      }));
      return { rows };
    }

    // Field-average mode
    if (!selectedCampos.length || !fieldPoints.length) return empty;
    const rows: Row[] = selectedCampos.map((campo, i) => {
      const series = fieldPoints
        .filter((p) => p.campo === campo)
        .map((p) => ({ ym: ymKey(p.ano, p.mes), np: p.np_bbl_mes }))
        .sort((a, b) => a.ym.localeCompare(b.ym));
      return { item: campo, color: PALETTE[i % PALETTE.length], series };
    });
    return { rows };
  }, [viewMode, wellPoints, fieldPoints, selectedCampos]);

  // Compute the row metrics from a sorted ascending series and the recent/prior windows.
  const computeRowMetrics = (
    series: { ym: string; np: number }[],
    nRecent: number,
    nPrior: number,
  ): {
    last: number | null;
    avgRecent: number | null;
    avgPrior: number | null;
    depletion: number | null;
    yoy: number | null;
  } => {
    if (!series.length) {
      return { last: null, avgRecent: null, avgPrior: null, depletion: null, yoy: null };
    }
    const last = series[series.length - 1].np;

    // Recent window = last nRecent points (chronological tail).
    const recentSlice = series.slice(-nRecent);
    const avgRecent =
      recentSlice.length > 0
        ? recentSlice.reduce((s, x) => s + x.np, 0) / recentSlice.length
        : null;

    // Prior window = the nPrior points immediately preceding the recent slice.
    const priorEnd = series.length - recentSlice.length;
    const priorStart = Math.max(0, priorEnd - nPrior);
    const priorSlice = series.slice(priorStart, priorEnd);
    const avgPrior =
      priorSlice.length > 0
        ? priorSlice.reduce((s, x) => s + x.np, 0) / priorSlice.length
        : null;

    const depletion =
      avgRecent !== null && avgPrior !== null && avgPrior !== 0
        ? ((avgRecent - avgPrior) / avgPrior) * 100
        : null;

    // YoY: last NP vs NP from exactly 12 calendar months earlier.
    let yoy: number | null = null;
    const lastYm = series[series.length - 1].ym;
    const [ly, lm] = lastYm.split("-").map(Number);
    const yoyKey = `${ly - 1}-${String(lm).padStart(2, "0")}`;
    const match = series.find((s) => s.ym === yoyKey);
    if (match && match.np !== 0) {
      yoy = (last / match.np - 1) * 100;
    }
    return { last, avgRecent, avgPrior, depletion, yoy };
  };

  // Mode-aware setters. In Per-well mode the field filter behaves as a
  // single-select; in Field-average mode it caps at MAX_FIELDS_IN_FIELD_MODE.
  const handleModeChange = (next: ViewMode) => {
    setViewMode(next);
    if (next === "well" && selectedCampos.length > 1) {
      setSelectedCampos(selectedCampos.slice(0, 1));
    }
  };

  const handleCamposChange = (next: string[]) => {
    if (viewMode === "well") {
      if (next.length === 0) {
        setSelectedCampos([]);
        return;
      }
      const added = next.find((c) => !selectedCampos.includes(c));
      setSelectedCampos([added ?? next[next.length - 1]]);
      return;
    }
    if (next.length > MAX_FIELDS_IN_FIELD_MODE) {
      setSelectedCampos(next.slice(0, MAX_FIELDS_IN_FIELD_MODE));
      return;
    }
    setSelectedCampos(next);
  };

  const clampWindow = (raw: number): number => {
    if (!Number.isFinite(raw)) return 12;
    const n = Math.round(raw);
    if (n < 1) return 1;
    if (n > 60) return 60;
    return n;
  };

  if (visLoading || !visible) return null;

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ──────────────────────────────────────────────── */}
          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              {/* ── View-mode toggle ────────────────────────────────── */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">View</div>
                <SegmentedToggle<ViewMode>
                  options={VIEW_OPTIONS}
                  value={viewMode}
                  onChange={handleModeChange}
                />
              </div>

              {/* ── X axis toggle ───────────────────────────────────── */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">X axis</div>
                <SegmentedToggle<XMode>
                  options={X_MODE_OPTIONS}
                  value={xMode}
                  onChange={setXMode}
                />
              </div>

              {/* ── Plot-style toggle ───────────────────────────────── */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Plot style</div>
                <SegmentedToggle<LineStyle>
                  options={LINE_STYLE_OPTIONS}
                  value={lineStyle}
                  onChange={setLineStyle}
                />
              </div>

              {/* ── Period comparison ───────────────────────────────── */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period comparison</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <div style={{ flex: 1 }}>
                    <label
                      htmlFor="recent-window"
                      style={{
                        display: "block",
                        fontSize: 10,
                        color: "#666",
                        fontFamily: "Arial",
                        marginBottom: 2,
                      }}
                    >
                      Recent (m)
                    </label>
                    <input
                      id="recent-window"
                      type="number"
                      min={1}
                      max={60}
                      value={recentMonths}
                      onChange={(e) => setRecentMonths(clampWindow(Number(e.target.value)))}
                      style={{
                        width: "100%",
                        fontSize: 12,
                        fontFamily: "Arial",
                        padding: "4px 6px",
                        border: "1px solid #d8d8d8",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label
                      htmlFor="prior-window"
                      style={{
                        display: "block",
                        fontSize: 10,
                        color: "#666",
                        fontFamily: "Arial",
                        marginBottom: 2,
                      }}
                    >
                      Prior (m)
                    </label>
                    <input
                      id="prior-window"
                      type="number"
                      min={1}
                      max={60}
                      value={priorMonths}
                      onChange={(e) => setPriorMonths(clampWindow(Number(e.target.value)))}
                      style={{
                        width: "100%",
                        fontSize: 12,
                        fontFamily: "Arial",
                        padding: "4px 6px",
                        border: "1px solid #d8d8d8",
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </div>
                <div style={{
                  fontSize: 10,
                  color: "#888",
                  fontFamily: "Arial",
                  marginTop: 6,
                  lineHeight: 1.4,
                }}>
                  Recent vs prior windows for the chart Y axis and the table below (1–60 months). Points without a full N+M-point history are omitted.
                </div>
                {periodHelper === null ? (
                  <div style={{
                    fontSize: 11,
                    color: "#666",
                    fontFamily: "Arial",
                    marginTop: 6,
                    lineHeight: 1.4,
                  }}>
                    Select a field to see the comparison range.
                  </div>
                ) : (
                  <div style={{
                    fontSize: 11,
                    color: "#666",
                    fontFamily: "Arial",
                    marginTop: 6,
                    lineHeight: 1.4,
                  }}>
                    {periodHelper.text}
                    {periodHelper.warning !== null && (
                      <>
                        <br />
                        <span style={{ color: "#b8860b" }}>
                          {periodHelper.warning}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="sidebar-section-label">Filters</div>

              {/* Field — searchable multi-select */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">
                  Field{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    ({selectedCampos.length === 0 ? campos.length : selectedCampos.length}/{campos.length})
                  </span>
                </div>
                {!filtrosLoading && (
                  <SearchableMultiSelect
                    options={campos}
                    value={selectedCampos}
                    onChange={handleCamposChange}
                  />
                )}
                <div style={{
                  fontSize: 10,
                  color: "#888",
                  fontFamily: "Arial",
                  marginTop: 8,
                  lineHeight: 1.4,
                }}>
                  {viewMode === "well"
                    ? "Single-select: each well gets its own color in the chart legend."
                    : `Each field gets a chart color in selection order (up to ${MAX_FIELDS_IN_FIELD_MODE}).`}
                </div>
                {viewMode === "well" && selectedCampos.length === 1 && uniqueWellCount > 0 && (
                  <div style={{
                    fontSize: 10,
                    color: "#888",
                    fontFamily: "Arial",
                    marginTop: 4,
                    lineHeight: 1.4,
                  }}>
                    {uniqueWellCount} {uniqueWellCount === 1 ? "well" : "wells"} in this field
                  </div>
                )}
              </div>

              {/* Selected fields — colored chips */}
              {selectedCampos.length > 0 && (
                <div className="sidebar-filter-section">
                  <div className="sidebar-filter-label">
                    {viewMode === "well" && selectedCampos.length === 1
                      ? "Selected field"
                      : "Selected fields"}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {selectedCampos.map((c) => (
                      <span
                        key={c}
                        title={c}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          backgroundColor: "#f7f7f7",
                          border: "1px solid #ececec",
                          borderRadius: 999,
                          padding: "3px 10px 3px 8px",
                          fontFamily: "Arial",
                          fontSize: 11,
                          color: "#333",
                          maxWidth: "100%",
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            display: "inline-block",
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            backgroundColor: fieldColor(c),
                            flexShrink: 0,
                          }}
                        />
                        <span style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 160,
                        }}>
                          {c}
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Main content ────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="ANP CDP — Depletion"
                sub="Rolling depletion (recent vs prior windows of uptime-normalized NP) with comparison table"
              />

              {filtrosLoading ? (
                <BarrelLoading />
              ) : (
                <>
                  <ChartSection
                    title={
                      viewMode === "well"
                        ? selectedCampos.length === 1
                          ? effectiveXMode === "voip"
                            ? `Rolling depletion per well — ${selectedCampos[0]} (% of VOIP recovered)`
                            : `Rolling depletion per well — ${selectedCampos[0]}`
                          : effectiveXMode === "voip"
                            ? "Rolling depletion per well — % of VOIP recovered"
                            : "Rolling depletion per well"
                        : effectiveXMode === "voip"
                          ? "Rolling depletion — % of VOIP recovered"
                          : "Rolling depletion — calendar"
                    }
                    loading={chartLoading}
                    height={460}
                  >
                    <PlotlyChart
                      data={chart.data}
                      layout={chart.layout}
                      config={{ responsive: true, displayModeBar: false }}
                      style={{ width: "100%", height: 460 }}
                    />
                  </ChartSection>

                  {tableModel.rows.length > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <h3 className="section-title">Depletion comparison</h3>
                      <hr className="section-hr" />
                      <div
                        style={{
                          maxHeight: 400,
                          overflowY: "auto",
                          overflowX: "auto",
                          border: "1px solid #ececec",
                          borderRadius: 4,
                        }}
                      >
                        <table
                          className="table table-sm table-striped mb-0"
                          style={{ fontFamily: "Arial", fontSize: 12 }}
                        >
                          <thead
                            style={{
                              position: "sticky",
                              top: 0,
                              background: "#fff",
                              zIndex: 1,
                            }}
                          >
                            <tr>
                              <th
                                style={{
                                  textAlign: "left",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                Item
                              </th>
                              <th
                                style={{
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                NP last month
                              </th>
                              <th
                                style={{
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                Avg recent ({recentMonths}m)
                              </th>
                              <th
                                style={{
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                Avg prior ({priorMonths}m)
                              </th>
                              <th
                                style={{
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                Depletion %
                              </th>
                              <th
                                style={{
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                YoY %
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {tableModel.rows.map((row) => {
                              const m = computeRowMetrics(row.series, recentMonths, priorMonths);
                              const dep = fmtDelta(m.depletion);
                              const yoy = fmtDelta(m.yoy);
                              return (
                                <tr key={row.item}>
                                  <td
                                    style={{
                                      whiteSpace: "nowrap",
                                      maxWidth: 220,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                    title={row.item}
                                  >
                                    <span
                                      aria-hidden
                                      style={{
                                        display: "inline-block",
                                        width: 8,
                                        height: 8,
                                        borderRadius: "50%",
                                        backgroundColor: row.color,
                                        marginRight: 6,
                                        verticalAlign: "middle",
                                      }}
                                    />
                                    {row.item}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: "right",
                                      whiteSpace: "nowrap",
                                      fontVariantNumeric: "tabular-nums",
                                    }}
                                  >
                                    {fmtNp(m.last)}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: "right",
                                      whiteSpace: "nowrap",
                                      fontVariantNumeric: "tabular-nums",
                                    }}
                                  >
                                    {fmtNp(m.avgRecent)}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: "right",
                                      whiteSpace: "nowrap",
                                      fontVariantNumeric: "tabular-nums",
                                    }}
                                  >
                                    {fmtNp(m.avgPrior)}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: "right",
                                      whiteSpace: "nowrap",
                                      fontVariantNumeric: "tabular-nums",
                                      color: dep.color,
                                      fontWeight: 600,
                                    }}
                                  >
                                    {dep.text}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: "right",
                                      whiteSpace: "nowrap",
                                      fontVariantNumeric: "tabular-nums",
                                      color: yoy.color,
                                      fontWeight: 600,
                                    }}
                                  >
                                    {yoy.text}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
