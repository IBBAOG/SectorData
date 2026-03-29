"use client";

import { useEffect, useMemo, useState } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import {
  rpcGetDgMarginsData,
  rpcGetDgMarginsFilters,
  type DgMarginsRow,
} from "../../../lib/rpc";
import { downloadDgMarginsExcel } from "../../../lib/exportExcel";

// ── Constants ─────────────────────────────────────────────────────────────────

const FUEL_TYPES = ["Diesel B", "Gasoline C"] as const;

const STACK_COLORS: Record<string, string> = {
  base_fuel:                        "#0A2647",
  biofuel_component:                "#144272",
  federal_tax:                      "#205295",
  state_tax:                        "#73C6A1",
  distribution_and_resale_margin:   "#FF5000",
};

const FUEL_LINE_COLORS: Record<string, string> = {
  "Diesel B":   "#FF5000",
  "Gasoline C": "#205295",
};

// Order = bottom-to-top in the stacked area
const COMPONENTS: { key: keyof DgMarginsRow; label: string }[] = [
  { key: "base_fuel",                        label: "Base Fuel" },
  { key: "biofuel_component",                label: "Biofuel" },
  { key: "federal_tax",                      label: "Federal Tax" },
  { key: "state_tax",                        label: "State Tax" },
  { key: "distribution_and_resale_margin",   label: "Dist. & Resale Margin" },
];

const COMMON_LAYOUT: Partial<Layout> = {
  paper_bgcolor: "white",
  plot_bgcolor:  "white",
  font: { family: "Arial", size: 12, color: "#000000" },
  hoverlabel: {
    bgcolor:     "rgba(255, 255, 255, 0.95)",
    bordercolor: "rgba(180, 180, 180, 0.5)",
    font: { family: "Arial", color: "#1a1a1a", size: 12 },
    namelength: -1,
  },
};

// ── Chart builders ────────────────────────────────────────────────────────────

function emptyPlot(height = 300): { data: PlotData[]; layout: Partial<Layout> } {
  return {
    data: [],
    layout: {
      ...COMMON_LAYOUT,
      xaxis: { visible: false },
      yaxis: { visible: false },
      height,
      margin: { t: 20, b: 30, l: 10, r: 10 },
      annotations: [
        {
          text: "No data for the selected filters.",
          xref: "paper",
          yref: "paper",
          showarrow: false,
          font: { size: 13, family: "Arial", color: "#888" },
        },
      ],
    },
  };
}

function buildStackedAreaChart(
  rows: DgMarginsRow[],
  fuelType: string,
  orderedWeeks: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  const fuelRows = rows.filter((r) => r.fuel_type === fuelType);
  if (fuelRows.length === 0) return emptyPlot(350);

  // Sort by the provided week order
  const weekIdx = (w: string) => orderedWeeks.indexOf(w);
  const sorted = [...fuelRows].sort((a, b) => weekIdx(a.week) - weekIdx(b.week));
  const xWeeks = sorted.map((r) => r.week);

  const traces: PlotData[] = COMPONENTS.map((comp) => ({
    type: "scatter",
    mode: "lines",
    name: comp.label,
    x: xWeeks,
    y: sorted.map((r) => Number(r[comp.key] ?? 0)),
    stackgroup: "one",
    line: { width: 0.5, color: STACK_COLORS[comp.key] },
    fillcolor: STACK_COLORS[comp.key],
    hovertemplate: `${comp.label}: %{y:.2f} R$/L<extra></extra>`,
  } as PlotData));

  // Total as dashed line on top (no stackgroup)
  traces.push({
    type: "scatter",
    mode: "lines",
    name: "Total",
    x: xWeeks,
    y: sorted.map((r) => Number(r.total ?? 0)),
    line: { dash: "dash", width: 2, color: "#1a1a1a" },
    hovertemplate: "Total: %{y:.2f} R$/L<extra></extra>",
  } as PlotData);

  const layout: Partial<Layout> = {
    ...COMMON_LAYOUT,
    height: 350,
    margin: { t: 10, b: 80, l: 60, r: 20 },
    hovermode: "x unified",
    yaxis: {
      title: { text: "R$/litro" },
      showgrid: false,
      zeroline: false,
      showline: true,
      linecolor: "#000000",
      linewidth: 1,
    },
    xaxis: {
      type: "category",
      categoryorder: "array",
      categoryarray: orderedWeeks,
      tickangle: -90,
      automargin: true,
      showgrid: false,
      zeroline: false,
      showline: true,
      linecolor: "#000000",
      linewidth: 1,
      showspikes: true,
      spikemode: "across" as const,
      spikedash: "solid",
      spikecolor: "#555555",
      spikethickness: 1,
    },
    legend: {
      orientation: "h",
      yanchor: "top",
      y: -0.28,
      xanchor: "center",
      x: 0.5,
    },
  };

  return { data: traces, layout };
}

function buildTotalLineChart(
  rows: DgMarginsRow[],
  selectedFuels: string[],
  orderedWeeks: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (rows.length === 0) return emptyPlot(280);

  const traces: PlotData[] = selectedFuels.map((ft) => {
    const fuelRows = [...rows.filter((r) => r.fuel_type === ft)].sort(
      (a, b) => orderedWeeks.indexOf(a.week) - orderedWeeks.indexOf(b.week),
    );
    return {
      type: "scatter",
      mode: "lines",
      name: ft,
      x: fuelRows.map((r) => r.week),
      y: fuelRows.map((r) => Number(r.total ?? 0)),
      line: { width: 2.5, color: FUEL_LINE_COLORS[ft] ?? "#000000" },
      hovertemplate: `${ft} Total: %{y:.2f} R$/L<extra></extra>`,
    } as PlotData;
  });

  if (traces.every((t) => (t.x as unknown[]).length === 0)) return emptyPlot(280);

  const layout: Partial<Layout> = {
    ...COMMON_LAYOUT,
    height: 280,
    margin: { t: 10, b: 80, l: 60, r: 20 },
    hovermode: "x unified",
    yaxis: {
      title: { text: "R$/litro" },
      showgrid: false,
      zeroline: false,
      showline: true,
      linecolor: "#000000",
      linewidth: 1,
    },
    xaxis: {
      type: "category",
      categoryorder: "array",
      categoryarray: orderedWeeks,
      tickangle: -90,
      automargin: true,
      showgrid: false,
      zeroline: false,
      showline: true,
      linecolor: "#000000",
      linewidth: 1,
    },
    legend: {
      orientation: "h",
      yanchor: "top",
      y: -0.28,
      xanchor: "center",
      x: 0.5,
    },
  };

  return { data: traces, layout };
}

// ── Page component ────────────────────────────────────────────────────────────

export default function DieselGasolineMarginsPage() {
  const supabase = getSupabaseClient();

  const [loading, setLoading]             = useState(true);
  const [allRows, setAllRows]             = useState<DgMarginsRow[]>([]);
  const [weeks, setWeeks]                 = useState<string[]>([]);
  const [weekRange, setWeekRange]         = useState<[number, number]>([0, 0]);
  const [selectedFuels, setSelectedFuels] = useState<string[]>([...FUEL_TYPES]);

  // Load data on mount
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    (async () => {
      const [filters, data] = await Promise.all([
        rpcGetDgMarginsFilters(supabase),
        rpcGetDgMarginsData(supabase),
      ]);
      if (cancelled) return;
      const w = filters.weeks;
      setWeeks(w);
      setWeekRange([0, Math.max(0, w.length - 1)]);
      setAllRows(data);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [supabase]);

  // Filtered rows by week range + selected fuel types
  const filteredRows = useMemo(() => {
    if (weeks.length === 0) return [];
    const [lo, hi] = weekRange;
    const visibleWeeks = new Set(weeks.slice(lo, hi + 1));
    return allRows.filter(
      (r) => selectedFuels.includes(r.fuel_type) && visibleWeeks.has(r.week),
    );
  }, [allRows, selectedFuels, weekRange, weeks]);

  // Ordered weeks for charts (only those in range)
  const visibleWeeks = useMemo(
    () => weeks.slice(weekRange[0], weekRange[1] + 1),
    [weeks, weekRange],
  );

  // Toggle fuel type checkbox
  function toggleFuel(ft: string) {
    setSelectedFuels((prev) =>
      prev.includes(ft) ? prev.filter((f) => f !== ft) : [...prev, ft],
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const colClass = selectedFuels.length === 1 ? "col-12" : "col-lg-6";

  return (
    <>
      <NavBar />

      <div className="container-fluid py-3">
        <h5 style={{ fontFamily: "Arial", fontWeight: 700, color: "#000512", marginBottom: 16 }}>
          Diesel &amp; Gasoline Margins
        </h5>

        {/* ── Filter row ────────────────────────────────────────────────── */}
        <div className="row align-items-end g-3 mb-3">

          {/* Fuel type checkboxes */}
          <div className="col-auto">
            <div
              style={{
                fontFamily: "Arial", fontSize: 11, color: "#888",
                marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em",
              }}
            >
              Fuel Type
            </div>
            <div className="d-flex gap-3">
              {FUEL_TYPES.map((ft) => (
                <div key={ft} className="form-check mb-0">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={`fuel-${ft}`}
                    checked={selectedFuels.includes(ft)}
                    onChange={() => toggleFuel(ft)}
                  />
                  <label
                    className="form-check-label"
                    htmlFor={`fuel-${ft}`}
                    style={{
                      fontFamily: "Arial", fontSize: 13,
                      color: FUEL_LINE_COLORS[ft], fontWeight: 600,
                    }}
                  >
                    {ft}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Start week */}
          <div className="col-auto">
            <label
              htmlFor="week-start"
              style={{
                fontFamily: "Arial", fontSize: 11, color: "#888",
                display: "block", marginBottom: 4,
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}
            >
              Start Week
            </label>
            <select
              id="week-start"
              className="form-select form-select-sm"
              style={{ fontFamily: "Arial", fontSize: 13, minWidth: 110 }}
              value={weekRange[0]}
              onChange={(e) => {
                const v = Number(e.target.value);
                setWeekRange([v, Math.max(v, weekRange[1])]);
              }}
            >
              {weeks.map((w, i) => (
                <option key={w} value={i}>{w}</option>
              ))}
            </select>
          </div>

          {/* End week */}
          <div className="col-auto">
            <label
              htmlFor="week-end"
              style={{
                fontFamily: "Arial", fontSize: 11, color: "#888",
                display: "block", marginBottom: 4,
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}
            >
              End Week
            </label>
            <select
              id="week-end"
              className="form-select form-select-sm"
              style={{ fontFamily: "Arial", fontSize: 13, minWidth: 110 }}
              value={weekRange[1]}
              onChange={(e) => {
                const v = Number(e.target.value);
                setWeekRange([Math.min(weekRange[0], v), v]);
              }}
            >
              {weeks.map((w, i) => (
                <option key={w} value={i}>{w}</option>
              ))}
            </select>
          </div>

          {/* Export button */}
          <div className="col-auto ms-auto">
            <button
              className="btn btn-outline-secondary btn-sm"
              style={{ fontFamily: "Arial", fontSize: 12 }}
              disabled={loading || filteredRows.length === 0}
              onClick={() => downloadDgMarginsExcel(filteredRows)}
            >
              Export Excel
            </button>
          </div>
        </div>

        {/* ── Content ──────────────────────────────────────────────────── */}
        {loading ? (
          <div className="d-flex justify-content-center align-items-center" style={{ height: 300 }}>
            <div className="spinner-border text-secondary" role="status">
              <span className="visually-hidden">Loading…</span>
            </div>
          </div>
        ) : (
          <>
            {/* Stacked area charts — one per selected fuel type */}
            {selectedFuels.length > 0 && (
              <div className="row mb-4">
                {selectedFuels.map((ft) => {
                  const { data, layout } = buildStackedAreaChart(filteredRows, ft, visibleWeeks);
                  return (
                    <div key={ft} className={colClass}>
                      <div
                        style={{
                          fontFamily: "Arial", fontSize: 13, fontWeight: 600,
                          color: FUEL_LINE_COLORS[ft], marginBottom: 4,
                        }}
                      >
                        {ft} — Price Composition (R$/litro)
                      </div>
                      <PlotlyChart
                        data={data}
                        layout={layout}
                        config={{ responsive: true, displayModeBar: false }}
                        style={{ width: "100%", height: 350 }}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Total comparison line chart */}
            {selectedFuels.length > 0 && (() => {
              const { data, layout } = buildTotalLineChart(filteredRows, selectedFuels, visibleWeeks);
              return (
                <div className="row">
                  <div className="col-12">
                    <div
                      style={{
                        fontFamily: "Arial", fontSize: 13, fontWeight: 600,
                        color: "#1a1a1a", marginBottom: 4,
                      }}
                    >
                      Total Price Comparison (R$/litro)
                    </div>
                    <PlotlyChart
                      data={data}
                      layout={layout}
                      config={{ responsive: true, displayModeBar: false }}
                      style={{ width: "100%", height: 280 }}
                    />
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </>
  );
}
