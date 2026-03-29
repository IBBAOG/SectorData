"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout, PlotData } from "plotly.js";
import Slider from "rc-slider";
import type { SliderProps } from "rc-slider";
import "rc-slider/assets/index.css";

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

const STACK_COLORS: Record<string, string> = {
  base_fuel:                       "#C8C8C8",
  biofuel_component:               "#9A9A9A",
  federal_tax:                     "#6B6B6B",
  state_tax:                       "#73C6A1",
  distribution_and_resale_margin:  "#FF5000",
};

const MARGIN_LINE_COLORS: Record<string, string> = {
  "Diesel B":   "#FF5000",
  "Gasoline C": "#1a1a1a",
};

// Stacked chart order: bottom → top
const STACK_COMPONENTS: { key: keyof DgMarginsRow; label: string }[] = [
  { key: "base_fuel",                      label: "Base Fuel" },
  { key: "biofuel_component",              label: "Biofuel" },
  { key: "federal_tax",                    label: "Federal Tax" },
  { key: "state_tax",                      label: "State Tax" },
  { key: "distribution_and_resale_margin", label: "Dist. & Resale Margin" },
];

// Table order: most relevant first
const TABLE_COMPONENTS: { key: keyof DgMarginsRow; label: string }[] = [
  { key: "distribution_and_resale_margin", label: "Dist. & Resale Margin" },
  { key: "state_tax",                      label: "State Tax" },
  { key: "federal_tax",                    label: "Federal Tax" },
  { key: "biofuel_component",              label: "Biofuel" },
  { key: "base_fuel",                      label: "Base Fuel" },
  { key: "total",                          label: "Total" },
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

const XAXIS_BASE = {
  type: "category" as const,
  categoryorder: "array" as const,
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
};

const YAXIS_BASE = {
  showgrid: false,
  zeroline: false,
  showline: true,
  linecolor: "#000000",
  linewidth: 1,
  tickformat: ".2f",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── Week helpers ──────────────────────────────────────────────────────────────

function parseWeek(weekStr: string): { weekNum: number; year: number } | null {
  const parts = weekStr.split("/");
  if (parts.length !== 2) return null;
  const weekNum = parseInt(parts[0], 10);
  const year    = parseInt(parts[1], 10);
  if (isNaN(weekNum) || isNaN(year)) return null;
  return { weekNum, year };
}

/** "13/2026" → "Week 13 — March 24 to March 30" (ISO 8601) */
function weekToDateRange(weekStr: string): string {
  const parsed = parseWeek(weekStr);
  if (!parsed) return weekStr;
  const { weekNum, year } = parsed;

  // Jan 4 is always in ISO week 1
  const jan4 = new Date(year, 0, 4);
  const dow   = jan4.getDay() || 7;            // 1=Mon … 7=Sun
  const week1Mon = new Date(year, 0, 4 - dow + 1);

  const weekStart = new Date(week1Mon);
  weekStart.setDate(week1Mon.getDate() + (weekNum - 1) * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  return (
    `Week ${weekNum} — ` +
    `${MONTHS[weekStart.getMonth()]} ${weekStart.getDate()} ` +
    `to ${MONTHS[weekEnd.getMonth()]} ${weekEnd.getDate()}`
  );
}

// ── WeekSlider (mirrors PeriodSlider, adapted for week strings) ───────────────

function WeekSlider(props: {
  weeks: string[];
  value: [number, number];
  onChange: (next: [number, number]) => void;
}) {
  const { weeks, value, onChange } = props;

  const [dragging, setDragging] = useState(false);
  const [localRange, setLocalRange] = useState<[number, number]>(value);
  const prevValue = useRef(value);

  if (!dragging && (prevValue.current[0] !== value[0] || prevValue.current[1] !== value[1])) {
    prevValue.current = value;
    setLocalRange(value);
  }

  const displayRange = dragging ? localRange : value;

  // Year marks: first occurrence of each year in the data
  const marks = useMemo(() => {
    type Mark = { label: string; style: { fontSize: string; color: string } };
    const m: Record<number, Mark> = {};
    const seen = new Set<string>();
    weeks.forEach((w, i) => {
      const p = parseWeek(w);
      if (!p) return;
      const yr = String(p.year);
      if (!seen.has(yr)) {
        m[i] = { label: yr, style: { fontSize: "10px", color: "#888" } };
        seen.add(yr);
      }
    });
    return m;
  }, [weeks]);

  const handleChange = useCallback(
    (v: number | number[]) => {
      const arr = Array.isArray(v) ? v : [localRange[0], localRange[1]];
      setLocalRange([arr[0] as number, arr[1] as number]);
    },
    [localRange],
  );

  const handleBeforeChange = useCallback(() => setDragging(true), []);

  const handleAfterChange = useCallback(
    (v: number | number[]) => {
      const arr  = Array.isArray(v) ? v : [localRange[0], localRange[1]];
      const final: [number, number] = [arr[0] as number, arr[1] as number];
      setDragging(false);
      setLocalRange(final);
      prevValue.current = final;
      onChange(final);
    },
    [localRange, onChange],
  );

  if (!weeks || weeks.length === 0) return null;

  const rangeProps = {
    min: 0,
    max: weeks.length - 1,
    value: displayRange,
    step: 1,
    marks,
    onChange: handleChange,
    onChangeComplete: handleAfterChange,
    onBeforeChange: handleBeforeChange,
    handleRender: (node: React.ReactElement, info: { value: number }) => {
      const label = weeks[info.value] ?? "";
      return React.cloneElement(node, {}, (
        <span className="slider-handle-label">{label}</span>
      ));
    },
  } satisfies SliderProps;

  return (
    <div style={{ marginBottom: 16, marginTop: 32, paddingLeft: 18, paddingRight: 18 }}>
      <Slider range {...rangeProps} />
    </div>
  );
}

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
      annotations: [{
        text: "No data for the selected filters.",
        xref: "paper", yref: "paper",
        showarrow: false,
        font: { size: 13, family: "Arial", color: "#888" },
      }],
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

  const sorted = [...fuelRows].sort(
    (a, b) => orderedWeeks.indexOf(a.week) - orderedWeeks.indexOf(b.week),
  );
  const xWeeks = sorted.map((r) => r.week);

  const traces: PlotData[] = STACK_COMPONENTS.map((comp) => ({
    type: "scatter",
    mode: "lines",
    name: comp.label,
    x: xWeeks,
    y: sorted.map((r) => Number(r[comp.key] ?? 0)),
    stackgroup: "one",
    line: { width: 0.5, color: STACK_COLORS[comp.key] },
    fillcolor: STACK_COLORS[comp.key],
    hovertemplate: `${comp.label}: %{y:.2f} BRL/L<extra></extra>`,
  } as PlotData));

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 350,
      margin: { t: 10, b: 80, l: 65, r: 20 },
      hovermode: "x unified",
      yaxis: { ...YAXIS_BASE, title: { text: "BRL/litro" } },
      xaxis: { ...XAXIS_BASE, categoryarray: orderedWeeks },
      legend: {
        orientation: "h", yanchor: "top", y: -0.28, xanchor: "center", x: 0.5,
      },
    },
  };
}

function buildMarginComparisonChart(
  rows: DgMarginsRow[],
  orderedWeeks: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (rows.length === 0) return emptyPlot(280);

  const traces: PlotData[] = (["Diesel B", "Gasoline C"] as const).map((ft) => {
    const fuelRows = [...rows.filter((r) => r.fuel_type === ft)].sort(
      (a, b) => orderedWeeks.indexOf(a.week) - orderedWeeks.indexOf(b.week),
    );
    return {
      type: "scatter",
      mode: "lines",
      name: ft,
      x: fuelRows.map((r) => r.week),
      y: fuelRows.map((r) => Number(r.distribution_and_resale_margin ?? 0)),
      line: { width: 2.5, color: MARGIN_LINE_COLORS[ft] },
      hovertemplate: `${ft}: %{y:.2f} BRL/L<extra></extra>`,
    } as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 280,
      margin: { t: 10, b: 80, l: 65, r: 20 },
      hovermode: "x unified",
      yaxis: { ...YAXIS_BASE, title: { text: "BRL/litro" } },
      xaxis: { ...XAXIS_BASE, categoryarray: orderedWeeks },
      legend: {
        orientation: "h", yanchor: "top", y: -0.28, xanchor: "center", x: 0.5,
      },
    },
  };
}

// ── Weekly variations table ───────────────────────────────────────────────────

function VariationsTable({
  fuelType,
  allRows,
  allWeeks,
  latestVisibleWeek,
}: {
  fuelType: string;
  allRows: DgMarginsRow[];
  allWeeks: string[];
  latestVisibleWeek: string | null;
}) {
  if (!latestVisibleWeek) return null;

  const byWeek = new Map(
    allRows.filter((r) => r.fuel_type === fuelType).map((r) => [r.week, r]),
  );

  const latestIdx = allWeeks.indexOf(latestVisibleWeek);
  const latest = byWeek.get(latestVisibleWeek) ?? null;
  const prev1  = byWeek.get(allWeeks[latestIdx - 1] ?? "") ?? null;
  const prev4  = byWeek.get(allWeeks[latestIdx - 4] ?? "") ?? null;

  if (!latest) return null;

  const fmt = (v: unknown) =>
    v === null || v === undefined ? "—" : Number(v).toFixed(2);

  const fmtDelta = (v: number | null) => {
    if (v === null) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(2);
  };

  const delta = (
    a: DgMarginsRow | null,
    b: DgMarginsRow | null,
    key: keyof DgMarginsRow,
  ): number | null => {
    if (!a || !b) return null;
    const va = a[key] as number | null;
    const vb = b[key] as number | null;
    if (va === null || vb === null) return null;
    return Number(va) - Number(vb);
  };

  const cellStyle = (v: number | null) => ({
    textAlign: "center" as const,
    padding: "2px 10px",
    fontSize: 11,
    fontFamily: "Arial",
    whiteSpace: "nowrap" as const,
    fontWeight: 400,
    backgroundColor:
      v === null ? "transparent" : v > 0 ? "#C6E8D9" : v < 0 ? "#FFDDCC" : "transparent",
    color: v === null ? "#bbb" : "#1a1a1a",
    border: "none",
  });

  const thStyle = {
    fontFamily: "Arial",
    fontSize: 10,
    fontWeight: 700,
    color: "#ffffff",
    backgroundColor: "#000512",
    textAlign: "center" as const,
    padding: "4px 10px",
    border: "none",
  };

  return (
    <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: "40%" }} />
        <col style={{ width: "20%" }} />
        <col style={{ width: "20%" }} />
        <col style={{ width: "20%" }} />
      </colgroup>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: "left" as const, paddingLeft: 8 }}>
            {fuelType} — {latestVisibleWeek}
          </th>
          <th style={thStyle}>BRL/L</th>
          <th style={thStyle}>WoW</th>
          <th style={thStyle}>−4 Weeks</th>
        </tr>
      </thead>
      <tbody>
        {TABLE_COMPONENTS.map((comp, i) => {
          const wow = delta(latest, prev1, comp.key);
          const m4w = delta(latest, prev4, comp.key);
          return (
            <tr
              key={comp.key}
              style={i === TABLE_COMPONENTS.length - 1 ? { borderBottom: "2px solid #d0d0d0" } : {}}
            >
              <td style={{
                fontFamily: "Arial", fontSize: 11,
                color: "#1a1a1a",
                fontWeight: comp.key === "total" ? 700 : 400,
                padding: "2px 12px 2px 8px",
                whiteSpace: "nowrap" as const,
                border: "none",
              }}>
                {comp.label}
              </td>
              <td style={{
                textAlign: "center" as const, padding: "2px 10px",
                fontSize: 11, fontFamily: "Arial",
                color: "#1a1a1a", border: "none",
              }}>
                {fmt(latest[comp.key])}
              </td>
              <td style={cellStyle(wow)}>{fmtDelta(wow)}</td>
              <td style={cellStyle(m4w)}>{fmtDelta(m4w)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DieselGasolineMarginsPage() {
  const supabase = getSupabaseClient();

  const [loading, setLoading]     = useState(true);
  const [allRows, setAllRows]     = useState<DgMarginsRow[]>([]);
  const [weeks, setWeeks]         = useState<string[]>([]);
  const [weekRange, setWeekRange] = useState<[number, number]>([0, 0]);

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

  const filteredRows = useMemo(() => {
    if (weeks.length === 0) return [];
    const visibleSet = new Set(weeks.slice(weekRange[0], weekRange[1] + 1));
    return allRows.filter((r) => visibleSet.has(r.week));
  }, [allRows, weekRange, weeks]);

  const visibleWeeks = useMemo(
    () => weeks.slice(weekRange[0], weekRange[1] + 1),
    [weeks, weekRange],
  );

  const latestVisibleWeek = visibleWeeks[visibleWeeks.length - 1] ?? null;

  // Week translator labels
  const startLabel = weeks[weekRange[0]] ? weekToDateRange(weeks[weekRange[0]]) : null;
  const endLabel   = latestVisibleWeek ? weekToDateRange(latestVisibleWeek) : null;

  const marginChart  = useMemo(() => buildMarginComparisonChart(filteredRows, visibleWeeks), [filteredRows, visibleWeeks]);
  const dieselChart  = useMemo(() => buildStackedAreaChart(filteredRows, "Diesel B",   visibleWeeks), [filteredRows, visibleWeeks]);
  const gaslineChart = useMemo(() => buildStackedAreaChart(filteredRows, "Gasoline C", visibleWeeks), [filteredRows, visibleWeeks]);

  return (
    <>
      <NavBar />
      <div className="container-fluid py-3">

        {/* ── Page title ──────────────────────────────────────────────── */}
        <div className="section-title" style={{ color: "#1a1a1a" }}>
          Diesel &amp; Gasoline Margins
        </div>
        <hr className="section-hr" />

        {/* ── Week slider ─────────────────────────────────────────────── */}
        {!loading && weeks.length > 0 && (
          <div style={{ maxWidth: 720 }}>
            <WeekSlider weeks={weeks} value={weekRange} onChange={setWeekRange} />
          </div>
        )}

        {/* ── Week translator ─────────────────────────────────────────── */}
        {startLabel && endLabel && (
          <div style={{
            fontFamily: "Arial", fontSize: 12, color: "#555",
            marginBottom: 12, marginTop: 4,
          }}>
            {startLabel === endLabel
              ? startLabel
              : `${startLabel}  →  ${endLabel}`}
          </div>
        )}

        {/* ── Export ──────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 20 }}>
          <button
            className="btn btn-outline-secondary btn-sm"
            style={{ fontFamily: "Arial", fontSize: 12 }}
            disabled={loading || filteredRows.length === 0}
            onClick={() => downloadDgMarginsExcel(filteredRows)}
          >
            Export Excel
          </button>
        </div>

        {/* ── Content ─────────────────────────────────────────────────── */}
        {loading ? (
          <div className="d-flex justify-content-center align-items-center" style={{ height: 300 }}>
            <div className="spinner-border text-secondary" role="status">
              <span className="visually-hidden">Loading…</span>
            </div>
          </div>
        ) : (
          <>
            {/* 1 ── Distribution & Resale Margin comparison */}
            <div className="row mb-2">
              <div className="col-12">
                <div className="chart-container">
                  <div className="section-title" style={{ fontSize: 13 }}>
                    Distribution &amp; Resale Margin (BRL/litro)
                  </div>
                  <hr className="section-hr" />
                  <PlotlyChart
                    data={marginChart.data}
                    layout={marginChart.layout}
                    config={{ responsive: true, displayModeBar: false }}
                    style={{ width: "100%", height: 280 }}
                  />
                </div>
              </div>
            </div>

            {/* 2 ── Stacked area charts side by side */}
            <div className="row mb-2">
              <div className="col-lg-6">
                <div className="chart-container">
                  <div className="section-title" style={{ fontSize: 13 }}>
                    Diesel B — Price Composition (BRL/litro)
                  </div>
                  <hr className="section-hr" />
                  <PlotlyChart
                    data={dieselChart.data}
                    layout={dieselChart.layout}
                    config={{ responsive: true, displayModeBar: false }}
                    style={{ width: "100%", height: 350 }}
                  />
                </div>
              </div>
              <div className="col-lg-6">
                <div className="chart-container">
                  <div className="section-title" style={{ fontSize: 13 }}>
                    Gasoline C — Price Composition (BRL/litro)
                  </div>
                  <hr className="section-hr" />
                  <PlotlyChart
                    data={gaslineChart.data}
                    layout={gaslineChart.layout}
                    config={{ responsive: true, displayModeBar: false }}
                    style={{ width: "100%", height: 350 }}
                  />
                </div>
              </div>
            </div>

            {/* 3 ── Weekly variations tables side by side */}
            <div className="row mb-2">
              <div className="col-lg-6">
                <div className="chart-container">
                  <div className="section-title" style={{ fontSize: 13 }}>
                    Weekly Variations — Diesel B
                  </div>
                  <hr className="section-hr" />
                  <VariationsTable
                    fuelType="Diesel B"
                    allRows={allRows}
                    allWeeks={weeks}
                    latestVisibleWeek={latestVisibleWeek}
                  />
                </div>
              </div>
              <div className="col-lg-6">
                <div className="chart-container">
                  <div className="section-title" style={{ fontSize: 13 }}>
                    Weekly Variations — Gasoline C
                  </div>
                  <hr className="section-hr" />
                  <VariationsTable
                    fuelType="Gasoline C"
                    allRows={allRows}
                    allWeeks={weeks}
                    latestVisibleWeek={latestVisibleWeek}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
