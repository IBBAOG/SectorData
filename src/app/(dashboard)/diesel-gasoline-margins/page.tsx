"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout, PlotData } from "plotly.js";
import Slider from "rc-slider";
import type { SliderProps } from "rc-slider";
import "rc-slider/assets/index.css";

import NavBar from "../../../components/NavBar";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
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
  base_fuel:                       "#1a1a1a",   // black
  biofuel_component:               "#73C6A1",   // green
  federal_tax:                     "#9A9A9A",   // medium gray
  state_tax:                       "#C8C8C8",   // light gray
  distribution_and_resale_margin:  "#FF5000",   // orange
};

// Annotation colors — ensure readability on white background
const ANNOT_COLORS: Record<string, string> = {
  base_fuel:                       "#1a1a1a",
  biofuel_component:               "#3d8a6e",
  federal_tax:                     "#555555",
  state_tax:                       "#888888",
  distribution_and_resale_margin:  "#FF5000",
};

const MARGIN_LINE_COLORS: Record<string, string> = {
  "Diesel B":   "#FF5000",
  "Gasoline C": "#1a1a1a",
};

// Stacked chart order: bottom → top
const STACK_COMPONENTS: { key: keyof DgMarginsRow }[] = [
  { key: "base_fuel" },
  { key: "biofuel_component" },
  { key: "federal_tax" },
  { key: "state_tax" },
  { key: "distribution_and_resale_margin" },
];

// Human-readable label per fuel type
function compLabel(key: string, fuelType: string): string {
  if (key === "base_fuel")         return fuelType === "Diesel B" ? "Diesel A"           : "Gasoline A";
  if (key === "biofuel_component") return fuelType === "Diesel B" ? "Biodiesel"           : "An. Ethanol";
  if (key === "federal_tax")       return "Federal Tax";
  if (key === "state_tax")         return "State Tax";
  if (key === "distribution_and_resale_margin") return "Dist. & Resale Margin";
  return key;
}

// Table component order (most relevant first)
const TABLE_KEYS: (keyof DgMarginsRow)[] = [
  "distribution_and_resale_margin",
  "state_tax",
  "federal_tax",
  "biofuel_component",
  "base_fuel",
  "total",
];

const COMMON_LAYOUT: Partial<Layout> = {
  paper_bgcolor: "white",
  plot_bgcolor:  "white",
  font: { family: "Arial", size: 12, color: "#000000" },
  hoverlabel: {
    bgcolor:     "rgba(255,255,255,0.95)",
    bordercolor: "rgba(180,180,180,0.5)",
    font: { family: "Arial", color: "#1a1a1a", size: 12 },
    namelength: -1,
  },
};

const XAXIS_BASE = {
  type:         "category" as const,
  categoryorder:"array"    as const,
  tickangle:    -90,
  automargin:   true,
  showgrid:     false,
  zeroline:     false,
  showline:     true,
  linecolor:    "#000000",
  linewidth:    1,
  showspikes:   true,
  spikemode:    "across"   as const,
  spikedash:    "solid",
  spikecolor:   "#555555",
  spikethickness: 1,
};

const YAXIS_BASE = {
  showgrid:     false,
  zeroline:     false,
  showline:     true,
  linecolor:    "#000000",
  linewidth:    1,
  tickformat:   ".2f",
};

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const MONTHS_SHORT = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];

// ── Week helpers ──────────────────────────────────────────────────────────────

function parseWeek(w: string): { weekNum: number; year: number } | null {
  const p = w.split("/");
  if (p.length !== 2) return null;
  const weekNum = parseInt(p[0], 10);
  const year    = parseInt(p[1], 10);
  return isNaN(weekNum) || isNaN(year) ? null : { weekNum, year };
}

/** "13/2026" → "Week 13 — March 24 to March 30" (ISO 8601) */
function weekToDateRange(weekStr: string): string {
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

/** Strips "Week X — " prefix — returns only date range with year (for tooltips/badges) */
function weekToDateOnly(weekStr: string): string {
  return weekToDateRange(weekStr).replace(/^Week \d+ — /, "");
}

/** "15/2026" → "Apr 11, 2026" (last day = Saturday of that week, Mon–Sat convention) */
function weekLastDay(weekStr: string): string {
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
function weekLastDayShort(weekStr: string): string {
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

// ── WeekSlider ────────────────────────────────────────────────────────────────

function WeekSlider(props: {
  weeks: string[];
  value: [number, number];
  onChange: (next: [number, number]) => void;
}) {
  const { weeks, value, onChange } = props;

  const [dragging, setDragging] = useState(false);
  const [localRange, setLocalRange] = useState<[number, number]>(value);
  const prevValue   = useRef(value);
  const trackRef    = useRef<HTMLDivElement>(null);

  if (!dragging && (prevValue.current[0] !== value[0] || prevValue.current[1] !== value[1])) {
    prevValue.current = value;
    setLocalRange(value);
  }

  const displayRange = dragging ? localRange : value;

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
  const handleAfterChange  = useCallback(
    (v: number | number[]) => {
      const arr = Array.isArray(v) ? v : [localRange[0], localRange[1]];
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
    handleRender: (node: React.ReactElement, info: { value: number; index?: number }) => {
      const weekStr     = weeks[info.value] ?? "";
      const isLeft      = (info.index ?? 0) === 0;
      // Pixel-based overlap detection: compute actual gap in pixels between handles.
      // Label width ≈ 60px (font-size 10px, ~7 chars + padding). Overlap when gap < 60px.
      const trackWidth  = trackRef.current?.clientWidth ?? 0;
      const totalSteps  = Math.max(1, weeks.length - 1);
      const gapPx       = trackWidth > 0
        ? ((displayRange[1] - displayRange[0]) / totalSteps) * trackWidth
        : Infinity;
      const tooClose    = gapPx < 60;
      const labelTransform = tooClose
        ? isLeft ? "translateX(-98%)" : "translateX(-2%)"
        : "translateX(-50%)";
      return React.cloneElement(node, {}, (
        <span>
          {/* while dragging: full date range floats above the handle label */}
          {dragging && (
            <span style={{
              position:    "absolute",
              bottom:      "calc(100% + 30px)",
              left:        "50%",
              transform:   "translateX(-50%)",
              background:  "rgba(26,26,26,0.88)",
              color:       "#fff",
              padding:     "3px 8px",
              borderRadius: 4,
              fontSize:    9,
              fontFamily:  "Arial",
              whiteSpace:  "nowrap",
              pointerEvents: "none",
              boxShadow:   "0 1px 6px rgba(0,0,0,0.25)",
              lineHeight:  1.4,
            }}>
              {weekLastDay(weekStr)}
            </span>
          )}
          <span className="slider-handle-label" style={{ transform: labelTransform }}>
            {weekLastDayShort(weekStr)}
          </span>
        </span>
      ));
    },
  } satisfies SliderProps;

  return (
    <div ref={trackRef} style={{ marginBottom: 16, marginTop: 32, paddingLeft: 18, paddingRight: 18 }}>
      <Slider range {...rangeProps} />
    </div>
  );
}

// ── Chart builders ────────────────────────────────────────────────────────────

function emptyPlot(h = 300): { data: PlotData[]; layout: Partial<Layout> } {
  return {
    data: [],
    layout: {
      ...COMMON_LAYOUT,
      xaxis: { visible: false }, yaxis: { visible: false },
      height: h, margin: { t: 20, b: 30, l: 10, r: 10 },
      annotations: [{
        text: "No data for the selected filters.",
        xref: "paper", yref: "paper", showarrow: false,
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
  const xWeeks  = sorted.map((r) => weekLastDay(r.week));
  const lastRow = sorted[sorted.length - 1];
  const lastX   = xWeeks[xWeeks.length - 1];

  const traces: PlotData[] = STACK_COMPONENTS.map((comp) => ({
    type: "scatter", mode: "lines",
    name: compLabel(comp.key as string, fuelType),
    x: xWeeks,
    y: sorted.map((r) => Number(r[comp.key] ?? 0)),
    stackgroup: "one",
    line:      { width: 0.5, color: STACK_COLORS[comp.key as string] },
    fillcolor: STACK_COLORS[comp.key as string],
    hovertemplate: `${compLabel(comp.key as string, fuelType)}: %{y:.2f} BRL/L<extra></extra>`,
  } as PlotData));

  // Compute cumulative sums for annotations at last point
  let cum = 0;
  const annotations: object[] = STACK_COMPONENTS.map((comp) => {
    const val = Number(lastRow[comp.key] ?? 0);
    const midY = cum + val / 2;
    cum += val;
    return {
      x: lastX, y: midY,
      text: val.toFixed(2),
      showarrow: false,
      xanchor: "left", xshift: 6,
      yanchor: "middle",
      font: { family: "Arial", size: 10, color: ANNOT_COLORS[comp.key as string] },
    };
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 350,
      margin: { t: 40, b: 80, l: 65, r: 75 },
      hovermode: "x unified",
      yaxis: { ...YAXIS_BASE, title: { text: "BRL/litro" } },
      xaxis: { ...XAXIS_BASE, categoryarray: orderedWeeks.map(weekLastDay) },
      legend: { orientation: "h", yanchor: "bottom", y: 1.02, xanchor: "left", x: 0 },
      annotations: annotations as Layout["annotations"],
    },
  };
}

function buildMarginComparisonChart(
  rows: DgMarginsRow[],
  orderedWeeks: string[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (rows.length === 0) return emptyPlot(280);

  const annotations: object[] = [];

  const traces: PlotData[] = (["Diesel B", "Gasoline C"] as const).map((ft) => {
    const fuelRows = [...rows.filter((r) => r.fuel_type === ft)].sort(
      (a, b) => orderedWeeks.indexOf(a.week) - orderedWeeks.indexOf(b.week),
    );
    const xs = fuelRows.map((r) => weekLastDay(r.week));
    const ys = fuelRows.map((r) => Number(r.distribution_and_resale_margin ?? 0));

    if (xs.length > 0) {
      const lastX = xs[xs.length - 1];
      const lastY = ys[ys.length - 1];
      annotations.push({
        x: lastX, y: lastY,
        text: lastY.toFixed(2),
        showarrow: false,
        xanchor: "left", xshift: 6,
        yanchor: "middle",
        font: { family: "Arial", size: 11, color: MARGIN_LINE_COLORS[ft] },
      });
    }

    return {
      type: "scatter", mode: "lines",
      name: ft, x: xs, y: ys,
      line: { width: 2.5, color: MARGIN_LINE_COLORS[ft] },
      hovertemplate: `${ft}: %{y:.2f} BRL/L<extra></extra>`,
    } as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 280,
      margin: { t: 40, b: 80, l: 65, r: 75 },
      hovermode: "x unified",
      yaxis: { ...YAXIS_BASE, title: { text: "BRL/litro" } },
      xaxis: { ...XAXIS_BASE, categoryarray: orderedWeeks.map(weekLastDay) },
      legend: { orientation: "h", yanchor: "bottom", y: 1.02, xanchor: "left", x: 0 },
      annotations: annotations as Layout["annotations"],
    },
  };
}

// ── Weekly variations table ───────────────────────────────────────────────────

function VariationsTable({
  fuelType, allRows, allWeeks, latestVisibleWeek,
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

  // QTD: first week of the current quarter
  let qtdRow: DgMarginsRow | null = null;
  const latestParsed = parseWeek(latestVisibleWeek);
  if (latestParsed) {
    const { weekNum, year } = latestParsed;
    const jan4 = new Date(year, 0, 4);
    const dow  = jan4.getDay() || 7;
    const w1Mon = new Date(year, 0, 4 - dow + 1);
    const wkStart = new Date(w1Mon);
    wkStart.setDate(w1Mon.getDate() + (weekNum - 1) * 7);
    const qStartMonth = Math.floor(wkStart.getMonth() / 3) * 3;
    const quarterStart = new Date(year, qStartMonth, 1);
    for (const w of allWeeks) {
      const p = parseWeek(w);
      if (!p || p.year !== year) continue;
      const j4 = new Date(p.year, 0, 4);
      const d  = j4.getDay() || 7;
      const wm = new Date(p.year, 0, 4 - d + 1);
      const ws = new Date(wm);
      ws.setDate(wm.getDate() + (p.weekNum - 1) * 7);
      if (ws >= quarterStart) {
        const row = byWeek.get(w);
        if (row) { qtdRow = row; break; }
      }
    }
  }

  // YoY: same week number, previous year
  let yoyRow: DgMarginsRow | null = null;
  if (latestParsed) {
    const { weekNum, year } = latestParsed;
    yoyRow = byWeek.get(`${weekNum}/${year - 1}`) ?? null;
  }

  if (!latest) return null;

  const delta = (
    a: DgMarginsRow | null, b: DgMarginsRow | null, key: keyof DgMarginsRow,
  ): { abs: number | null; pct: number | null } => {
    if (!a || !b) return { abs: null, pct: null };
    const va = Number(a[key]);
    const vb = Number(b[key]);
    if (isNaN(va) || isNaN(vb)) return { abs: null, pct: null };
    const abs = va - vb;
    const pct = vb !== 0 ? (abs / Math.abs(vb)) * 100 : null;
    return { abs, pct };
  };

  const fmtAbs = (v: number | null) =>
    v === null ? null : (v > 0 ? "+" : "") + v.toFixed(2);
  const fmtPct = (v: number | null) =>
    v === null ? null : (v > 0 ? "+" : "") + v.toFixed(1) + "%";

  const cellBg = (v: number | null) =>
    v === null ? "transparent" : v > 0 ? "#C6E8D9" : v < 0 ? "#FFDDCC" : "transparent";

  const thStyle: React.CSSProperties = {
    fontFamily: "Arial", fontSize: 10, fontWeight: 700,
    color: "#ffffff", backgroundColor: "#000512",
    textAlign: "center", padding: "4px 6px", border: "none",
  };
  const tdCenter: React.CSSProperties = {
    textAlign: "center", padding: "2px 4px",
    fontSize: 10, fontFamily: "Arial", color: "#1a1a1a",
    whiteSpace: "nowrap", fontWeight: 400, border: "none",
    lineHeight: 1.3,
  };

  const COLS = [
    { label: "WoW",       ref: prev1  },
    { label: "−4 Weeks",  ref: prev4  },
    { label: "QTD",       ref: qtdRow },
    { label: "YoY",       ref: yoyRow },
  ];

  return (
    <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: "28%" }} />
        <col style={{ width: "12%" }} />
        <col style={{ width: "15%" }} />
        <col style={{ width: "15%" }} />
        <col style={{ width: "15%" }} />
        <col style={{ width: "15%" }} />
      </colgroup>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: "left", paddingLeft: 8 }}>
            {fuelType} · {weekLastDay(latestVisibleWeek)}
          </th>
          <th style={thStyle}>BRL/L</th>
          {COLS.map((c) => <th key={c.label} style={thStyle}>{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {TABLE_KEYS.map((key, i) => {
          const isTotal = key === "total";
          return (
            <tr key={key} style={i === TABLE_KEYS.length - 1 ? { borderBottom: "2px solid #d0d0d0" } : {}}>
              <td style={{
                fontFamily: "Arial", fontSize: 11, color: "#1a1a1a",
                fontWeight: isTotal ? 700 : 400,
                padding: "2px 12px 2px 8px", whiteSpace: "nowrap", border: "none",
              }}>
                {key === "total" ? "Total" : compLabel(key as string, fuelType)}
              </td>
              <td style={{ ...tdCenter, fontWeight: isTotal ? 700 : 400, fontSize: 11 }}>
                {Number(latest[key]).toFixed(2)}
              </td>
              {COLS.map(({ label, ref }) => {
                const { abs, pct } = delta(latest, ref, key);
                const absStr = fmtAbs(abs);
                const pctStr = fmtPct(pct);
                return (
                  <td key={label} style={{
                    ...tdCenter,
                    backgroundColor: cellBg(abs),
                    color: abs === null ? "#bbb" : "#1a1a1a",
                    fontWeight: isTotal ? 700 : 400,
                  }}>
                    {absStr === null ? "—" : (
                      <>
                        <div>{absStr}</div>
                        {pctStr && (
                          <div style={{ fontSize: 8.5, color: "#666", lineHeight: 1.2 }}>
                            {pctStr}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Elegant week period display ───────────────────────────────────────────────

function WeekPeriodBadge({
  weeks, weekRange,
}: {
  weeks: string[];
  weekRange: [number, number];
}) {
  if (weeks.length === 0) return null;
  const startW = weeks[weekRange[0]];
  const endW   = weeks[weekRange[1]];
  const startLabel = weekToDateRange(startW);
  const endLabel   = weekToDateRange(endW);
  const single = weekRange[0] === weekRange[1];

  return (
    <div style={{
      background:   "#fafafa",
      border:       "1px solid #e8e8e8",
      borderLeft:   "3px solid #FF5000",
      borderRadius: "0 8px 8px 0",
      padding:      "10px 14px",
      marginTop:    4,
    }}>
      <div style={{
        fontSize: 9, color: "#aaa", fontFamily: "Arial",
        textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 6,
      }}>
        Selected Period
      </div>

      {single ? (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#FF5000", fontFamily: "Arial" }}>
            {weekLastDay(startW)}
          </div>
          <div style={{ fontSize: 10, color: "#555", fontFamily: "Arial", marginTop: 2, lineHeight: 1.4 }}>
            {startLabel.replace(/^Week \d+ — /, "")}
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#FF5000", fontFamily: "Arial" }}>{weekLastDay(startW)}</span>
            <span style={{ fontSize: 10, color: "#bbb" }}>→</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#FF5000", fontFamily: "Arial" }}>{weekLastDay(endW)}</span>
          </div>
          <div style={{ fontSize: 10, color: "#555", fontFamily: "Arial", lineHeight: 1.5 }}>
            <div>{startLabel.replace(/^Week \d+ — /, "")}</div>
            <div>{endLabel.replace(/^Week \d+ — /, "")}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DieselGasolineMarginsPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("diesel-gasoline-margins");
  const supabase = getSupabaseClient();

  const [loading, setLoading]         = useState(true);
  const [allRows, setAllRows]         = useState<DgMarginsRow[]>([]);
  const [weeks, setWeeks]             = useState<string[]>([]);
  const [weekRange, setWeekRange]     = useState<[number, number]>([0, 0]);
  const [excelLoading, setExcelLoading] = useState(false);

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
    const vis = new Set(weeks.slice(weekRange[0], weekRange[1] + 1));
    return allRows.filter((r) => vis.has(r.week));
  }, [allRows, weekRange, weeks]);

  const visibleWeeks = useMemo(
    () => weeks.slice(weekRange[0], weekRange[1] + 1),
    [weeks, weekRange],
  );

  const latestVisibleWeek = visibleWeeks[visibleWeeks.length - 1] ?? null;

  const marginChart  = useMemo(() => buildMarginComparisonChart(filteredRows, visibleWeeks), [filteredRows, visibleWeeks]);
  const dieselChart  = useMemo(() => buildStackedAreaChart(filteredRows, "Diesel B",   visibleWeeks), [filteredRows, visibleWeeks]);
  const gasolineChart = useMemo(() => buildStackedAreaChart(filteredRows, "Gasoline C", visibleWeeks), [filteredRows, visibleWeeks]);

  if (visLoading || !visible) return null;

  return (
    <div>
      <NavBar />

      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ───────────────────────────────────────────────── */}
          <div className="col-2 p-0" style={{ display: "flex", flexDirection: "column" }}>
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <img src="/logo.png" alt="Itaú BBA" style={{ width: "100%", maxWidth: 300, marginBottom: 16 }} />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!loading && weeks.length > 0 && (
                  <WeekSlider weeks={weeks} value={weekRange} onChange={setWeekRange} />
                )}
                {!loading && weeks.length > 0 && (
                  <WeekPeriodBadge weeks={weeks} weekRange={weekRange} />
                )}
              </div>

            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-10">
            <div id="page-content">

              {/* Page header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div className="page-header-title">
                  Diesel &amp; Gasoline Margins
                  {latestVisibleWeek ? ` — ${weekLastDay(latestVisibleWeek)}` : ""}
                </div>
                <div style={{ position: "relative", minWidth: 160, flexShrink: 0 }}>
                  <div style={{ border: "1px solid #d0d0d0", borderRadius: 6, padding: "10px 16px", backgroundColor: "#fafafa" }}>
                    <div style={{ fontFamily: "Arial", fontSize: 11, fontWeight: 700, color: "#1a1a1a", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Export Data
                    </div>
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={async () => {
                        setExcelLoading(true);
                        try {
                          await downloadDgMarginsExcel(filteredRows);
                        } catch (e) {
                          console.error("Excel export failed", e);
                        } finally {
                          setExcelLoading(false);
                        }
                      }}
                      disabled={loading || filteredRows.length === 0 || excelLoading}
                      style={{ fontFamily: "Arial" }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" style={{ marginRight: 5, verticalAlign: "middle" }} xmlns="http://www.w3.org/2000/svg">
                        <rect x="2" y="2" width="20" height="20" rx="3" fill="#217346"/>
                        <text x="4" y="17" fontFamily="Arial" fontWeight="bold" fontSize="12" fill="#ffffff">X</text>
                      </svg>
                      formatted data .xl
                    </button>
                  </div>
                </div>
              </div>

              {loading ? (
                <div className="d-flex justify-content-center my-5">
                  <img src="/barrel_loading.png" alt="Carregando..." width={160} height={160} />
                </div>
              ) : (
                <>
                  {/* 1 ── Distribution & Resale Margin comparison line chart */}
                  <div className="row mb-2">
                    <div className="col-12">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 14 }}>
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

                  {/* 2 ── Weekly variations tables (above stacked charts) */}
                  <div className="row mb-2">
                    <div className="col-lg-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 14 }}>
                          Diesel B — Variations
                        </div>
                        <hr className="section-hr" />
                        <div style={{ margin: "0 70px" }}>
                          <VariationsTable
                            fuelType="Diesel B"
                            allRows={allRows}
                            allWeeks={weeks}
                            latestVisibleWeek={latestVisibleWeek}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="col-lg-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 14 }}>
                          Gasoline C — Variations
                        </div>
                        <hr className="section-hr" />
                        <div style={{ margin: "0 70px" }}>
                          <VariationsTable
                            fuelType="Gasoline C"
                            allRows={allRows}
                            allWeeks={weeks}
                            latestVisibleWeek={latestVisibleWeek}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 3 ── Stacked area charts */}
                  <div className="row mb-2">
                    <div className="col-lg-6">
                      <div className="chart-container">
                        <div className="section-title" style={{ fontSize: 14 }}>
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
                        <div className="section-title" style={{ fontSize: 14 }}>
                          Gasoline C — Price Composition (BRL/litro)
                        </div>
                        <hr className="section-hr" />
                        <PlotlyChart
                          data={gasolineChart.data}
                          layout={gasolineChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 350 }}
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
