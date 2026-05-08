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
  rpcGetAnpCdpBswCampos,
  rpcGetAnpCdpBswScatter,
  rpcGetAnpCdpBswFieldAggregate,
  type AnpCdpBswPoint,
  type AnpCdpBswFieldPoint,
} from "../../../lib/rpc";

// ── View mode ─────────────────────────────────────────────────────────────────

type ViewMode = "well" | "field";

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "well",  label: "Per well" },
  { value: "field", label: "Field average" },
];

// ── Plot style ────────────────────────────────────────────────────────────────
// Trace mode toggle shared by both views. Default is "markers+lines" because
// it carries more information (trend visible) than markers-only.

type LineStyle = "markers" | "markers+lines";

const LINE_STYLE_OPTIONS: { value: LineStyle; label: string }[] = [
  { value: "markers",       label: "Markers" },
  { value: "markers+lines", label: "Markers + lines" },
];

// Maps the toggle value to Plotly's `mode` string.
const plotlyMode = (style: LineStyle): "markers" | "lines+markers" =>
  style === "markers" ? "markers" : "lines+markers";

// Maximum number of fields plottable simultaneously in "Field average" mode.
// Beyond this, the legend/colors become hard to distinguish and the chart
// loses its narrative value. PALETTE recycles after 16 entries (palette index
// `i % PALETTE.length`), but allowing up to 20 selections keeps short bursts
// of comparison usable while still capping at a sane number.
const MAX_FIELDS_IN_FIELD_MODE = 20;

// ── Chart builders ────────────────────────────────────────────────────────────

function buildPerWellChart(
  points: AnpCdpBswPoint[],
  selectedCampos: string[],
  lineStyle: LineStyle,
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!selectedCampos.length) {
    return emptyPlot(
      460,
      "Select a field to plot BSW evolution.",
    );
  }
  if (!points.length) {
    return emptyPlot(460, "No data for the selected field.");
  }

  // Per-well mode: one trace per unique poco (in first-appearance order so
  // colors stay stable between renders). Single field is selected at a time
  // in this mode, so the legend shows the wells of that field.
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
        range: [0, 1],
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
    return emptyPlot(
      460,
      "Select one or more fields to plot BSW evolution.",
    );
  }
  if (!points.length) {
    return emptyPlot(460, "No data for the selected fields.");
  }

  // One trace per campo (volume-weighted average across wells at each
  // calendar month). X axis is % of VOIP recovered — cumulative oil divided
  // by the field's VOIP (Volume Original In Place, from anp_voip). This is
  // a more physical/geological X than raw time and lets fields of very
  // different sizes be compared on the same depletion curve.
  // Trace mode is driven by the shared "Plot style" toggle (markers vs
  // markers+lines). Renderer stays as plain `scatter` (SVG) — volume is low
  // and SVG lines are crisper than scattergl.
  // We always emit one trace per selected campo (in selection order), even
  // when its `subset` is empty, so the legend matches the sidebar chips 1:1
  // and the user can never silently lose a field from the chart. Empty
  // subsets render as legend-only entries with no markers/lines.
  const mode = plotlyMode(lineStyle);
  const traces: PlotData[] = selectedCampos.map((campo, i) => {
    const subset = points
      .filter((p) => p.campo === campo)
      .sort((a, b) => a.pct_voip - b.pct_voip);
    const color = PALETTE[i % PALETTE.length];
    if (typeof window !== "undefined" && points.length > 0 && subset.length === 0) {
      // Only warn when we actually received points but none for this campo —
      // this signals a server/client mismatch worth investigating, not the
      // expected pre-fetch empty state.
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
          [p.n_pocos, p.volume_total, p.ref_ano, p.ref_mes, p.cumulative_oil_bbl] as [
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
        "Daily volume: %{customdata[1]:,.0f} bbl/d" +
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
        range: [0, 1],
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AnpCdpBswPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-cdp-bsw");
  const supabase = getSupabaseClient();

  // Offshore-only field list (PreSal + PosSal). Sourced from the dedicated
  // `get_anp_cdp_bsw_campos` RPC so the sidebar dropdown never shows onshore
  // fields that aren't relevant for this dashboard's BSW analysis.
  const [campos, setCampos] = useState<string[]>([]);
  const [filtrosLoading, setFiltrosLoading] = useState(true);
  const [selectedCampos, setSelectedCampos] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("well");
  const [lineStyle, setLineStyle] = useState<LineStyle>("markers+lines");
  const [wellPoints,  setWellPoints]  = useState<AnpCdpBswPoint[]>([]);
  const [fieldPoints, setFieldPoints] = useState<AnpCdpBswFieldPoint[]>([]);

  // ── Initial load: only the offshore campos list ──────────────────────────
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

  // ── Reactive per-well fetch (debounced 400ms) ─────────────────────────────
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

  // ── Reactive field-average fetch (debounced 400ms) ────────────────────────
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
  // cleanly. We intentionally don't depend on the cache arrays themselves to
  // avoid an infinite update loop.
  useEffect(() => {
    if (selectedCampos.length === 0) {
      setWellPoints([]);
      setFieldPoints([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampos.length]);

  const chart = useMemo(() => {
    return viewMode === "well"
      ? buildPerWellChart(wellPoints, selectedCampos, lineStyle)
      : buildFieldAverageChart(fieldPoints, selectedCampos, lineStyle);
  }, [viewMode, wellPoints, fieldPoints, selectedCampos, lineStyle]);

  const chartLoading = viewMode === "well" ? wellLoading : fieldLoading;

  const fieldColor = (c: string): string => {
    const i = selectedCampos.indexOf(c);
    return i >= 0 ? PALETTE[i % PALETTE.length] : "#dcdcdc";
  };

  // ── 12-month BSW history table ────────────────────────────────────────────
  // Rebuilt from the same `points` already used by the chart — no extra RPC.
  // Per-well mode → 1 row per poco; Field-average mode → 1 row per campo.
  // Columns: Item + last 12 `YYYY-MM` (chronological) + MoM% + YTD%.
  const tableModel = useMemo(() => {
    type Row = {
      item: string;
      color: string;
      // BSW values keyed by `YYYY-MM`. Missing months are absent.
      values: Record<string, number>;
    };
    type Model = { months: string[]; rows: Row[] };
    const empty: Model = { months: [], rows: [] };

    const ymKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

    if (viewMode === "well") {
      if (!selectedCampos.length || !wellPoints.length) return empty;
      const allKeys = new Set<string>();
      for (const p of wellPoints) allKeys.add(ymKey(p.ano, p.mes));
      const months = Array.from(allKeys).sort().slice(-12);
      const monthSet = new Set(months);

      // Preserve first-appearance order of wells (matches chart legend).
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
      // Field is single-select in well mode → all wells share the field's color
      // index. We keep PALETTE color per well based on first-appearance order.
      // We intentionally KEEP wells whose data is older than the 12-month window
      // (their `values` map is empty) so the user always sees every well that
      // actually appears in the chart — the table renders "—" placeholders.
      const rows: Row[] = seen.map((poco, i) => ({
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

    // We map over `selectedCampos` (not over `fieldPoints`) so EVERY selected
    // field always produces a row, even if (a) the RPC returned no points for
    // that field or (b) all of its points are older than the 12-month window
    // formed by the union of months across the other selected fields. This
    // matches the chart legend 1:1 and prevents "field disappears from table"
    // surprises when one field's data ends earlier than the rest of the selection.
    const rows: Row[] = selectedCampos.map((campo, i) => {
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

  // Format BSW value (0..1) as percentage with 1 decimal.
  const fmtBsw = (v: number | undefined): string =>
    v === undefined || v === null || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(1)}%`;

  // Format signed delta percentage (already in %, e.g. +2.45) with 2 decimals.
  const fmtDelta = (
    v: number | null,
  ): { text: string; color: string } => {
    if (v === null || !Number.isFinite(v)) return { text: "—", color: "#888" };
    const sign = v > 0 ? "+" : v < 0 ? "" : "";
    // Green when BSW falls (less water = good), red when it rises.
    const color = v < 0 ? "#28a745" : v > 0 ? "#dc3545" : "#666";
    return { text: `${sign}${v.toFixed(2)}%`, color };
  };

  // Compute MoM% and YTD% for a row given the active months window.
  const computeDeltas = (
    months: string[],
    values: Record<string, number>,
  ): { mom: number | null; ytd: number | null } => {
    if (!months.length) return { mom: null, ytd: null };
    const tKey = months[months.length - 1];
    const tVal = values[tKey];
    if (tVal === undefined || tVal === 0) return { mom: null, ytd: null };

    // MoM: t vs t-1 (calendar previous month). t-1 must be exactly one month
    // earlier in calendar terms — use months[length-2] only if it is.
    let mom: number | null = null;
    if (months.length >= 2) {
      const prevKey = months[months.length - 2];
      const prevVal = values[prevKey];
      if (prevVal !== undefined && prevVal !== 0) {
        // Confirm calendar adjacency.
        const [ty, tm] = tKey.split("-").map(Number);
        const [py, pm] = prevKey.split("-").map(Number);
        const adjacent =
          (ty === py && tm === pm + 1) || (ty === py + 1 && tm === 1 && pm === 12);
        if (adjacent) {
          mom = (tVal / prevVal - 1) * 100;
        }
      }
    }

    // YTD: t vs January (or earliest available month) of t's calendar year.
    const tYear = tKey.split("-")[0];
    const sameYearMonths = months
      .filter((k) => k.startsWith(`${tYear}-`))
      .sort();
    let ytd: number | null = null;
    if (sameYearMonths.length >= 2) {
      // Prefer January if available; otherwise first month of the same year.
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

  // Per-well mode: count unique wells in the currently fetched points so the
  // sidebar can hint at the legend size for the selected field.
  const uniqueWellCount = useMemo(() => {
    if (viewMode !== "well") return 0;
    if (!wellPoints.length) return 0;
    const set = new Set<string>();
    for (const p of wellPoints) set.add(p.poco);
    return set.size;
  }, [viewMode, wellPoints]);

  // Mode-aware setters. In Per-well mode the field filter behaves as a
  // single-select: picking a 2nd field replaces the first, and switching
  // from Field-average → Per-well trims the selection to the first field.
  // In Field-average mode the selection is capped at MAX_FIELDS_IN_FIELD_MODE
  // (older selections are kept; new picks beyond the cap are dropped).
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
      // Single-select: prefer the newly added field (the one not in the
      // previous selection); fall back to the last entry if no diff is
      // detectable (e.g. user used "Select all").
      const added = next.find((c) => !selectedCampos.includes(c));
      setSelectedCampos([added ?? next[next.length - 1]]);
      return;
    }
    // Field-average mode: enforce the plot cap. If the user exceeds it (e.g.
    // via "Select all"), keep the first MAX_FIELDS_IN_FIELD_MODE entries.
    if (next.length > MAX_FIELDS_IN_FIELD_MODE) {
      setSelectedCampos(next.slice(0, MAX_FIELDS_IN_FIELD_MODE));
      return;
    }
    setSelectedCampos(next);
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

              {/* ── View-mode toggle (pill) ─────────────────────────── */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">View</div>
                <SegmentedToggle<ViewMode>
                  options={VIEW_OPTIONS}
                  value={viewMode}
                  onChange={handleModeChange}
                />
              </div>

              {/* ── Plot-style toggle (shared by both views) ────────── */}
              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Plot style</div>
                <SegmentedToggle<LineStyle>
                  options={LINE_STYLE_OPTIONS}
                  value={lineStyle}
                  onChange={setLineStyle}
                />
              </div>

              <div className="sidebar-section-label">Filters</div>

              {/* Field — searchable multi-select (offshore: Pre-Salt + Post-Salt) */}
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
                title="ANP CDP — BSW by Well"
                sub="Water cut (BSW) vs months since first production, by well"
              />

              {filtrosLoading ? (
                <BarrelLoading />
              ) : (
                <>
                  <ChartSection
                    title={
                      viewMode === "well"
                        ? selectedCampos.length === 1
                          ? `BSW evolution per well — ${selectedCampos[0]}`
                          : "BSW evolution per well"
                        : "BSW evolution — % of VOIP recovered (volume-weighted)"
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
                      <h3 className="section-title">Recent BSW history (last 12 months)</h3>
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
                              {tableModel.months.map((m) => (
                                <th
                                  key={m}
                                  style={{
                                    textAlign: "right",
                                    whiteSpace: "nowrap",
                                    borderBottom: "2px solid #888",
                                  }}
                                >
                                  {m}
                                </th>
                              ))}
                              <th
                                style={{
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                MoM%
                              </th>
                              <th
                                style={{
                                  textAlign: "right",
                                  whiteSpace: "nowrap",
                                  borderBottom: "2px solid #888",
                                }}
                              >
                                YTD%
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {tableModel.rows.map((row) => {
                              const { mom, ytd } = computeDeltas(tableModel.months, row.values);
                              const momFmt = fmtDelta(mom);
                              const ytdFmt = fmtDelta(ytd);
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
                                  {tableModel.months.map((m) => (
                                    <td
                                      key={m}
                                      style={{
                                        textAlign: "right",
                                        whiteSpace: "nowrap",
                                        fontVariantNumeric: "tabular-nums",
                                      }}
                                    >
                                      {fmtBsw(row.values[m])}
                                    </td>
                                  ))}
                                  <td
                                    style={{
                                      textAlign: "right",
                                      whiteSpace: "nowrap",
                                      fontVariantNumeric: "tabular-nums",
                                      color: momFmt.color,
                                      fontWeight: 600,
                                    }}
                                  >
                                    {momFmt.text}
                                  </td>
                                  <td
                                    style={{
                                      textAlign: "right",
                                      whiteSpace: "nowrap",
                                      fontVariantNumeric: "tabular-nums",
                                      color: ytdFmt.color,
                                      fontWeight: 600,
                                    }}
                                  >
                                    {ytdFmt.text}
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
