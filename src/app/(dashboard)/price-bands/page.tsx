"use client";

import { useEffect, useMemo, useState } from "react";
import type { Annotations, Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import PeriodSlider from "../../../components/PeriodSlider";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { rpcGetPriceBandsData, type PriceBandsRow } from "../../../lib/rpc";
import { downloadPriceBandsExcel } from "../../../lib/exportExcel";

// ── Colors ────────────────────────────────────────────────────────────────────

const COLOR_IMPORT = "#E8611A";  // orange — IBBA/BBA Import Parity
const COLOR_EXPORT = "#1a1a1a";  // black  — IBBA/BBA Export Parity
const COLOR_PETRO  = "#4ECDC4";  // teal   — Petrobras Price

// ── Types ─────────────────────────────────────────────────────────────────────

interface SeriesDef {
  label: string;
  field: keyof PriceBandsRow;
  color: string;
  dash: "solid" | "dash";
  shape: "linear" | "hv";
  width: number;
}

const GAS_SERIES: SeriesDef[] = [
  { label: "IBBA - Import Parity", field: "bba_import_parity", color: COLOR_IMPORT, dash: "solid", shape: "linear", width: 1.5 },
  { label: "IBBA - Export Parity", field: "bba_export_parity", color: COLOR_EXPORT, dash: "solid", shape: "linear", width: 1.5 },
  { label: "Petrobras Price",      field: "petrobras_price",   color: COLOR_PETRO,  dash: "solid", shape: "hv",     width: 2   },
];

const DSL_SERIES: SeriesDef[] = [
  { label: "BBA - Import Parity",            field: "bba_import_parity",           color: COLOR_IMPORT, dash: "solid", shape: "linear", width: 1.5 },
  { label: "BBA - Import Parity w/ subsidy", field: "bba_import_parity_w_subsidy", color: COLOR_IMPORT, dash: "dash",  shape: "linear", width: 1.5 },
  { label: "BBA - Export Parity",            field: "bba_export_parity",           color: COLOR_EXPORT, dash: "solid", shape: "linear", width: 1.5 },
  { label: "Petrobras Price",                field: "petrobras_price",             color: COLOR_PETRO,  dash: "solid", shape: "hv",     width: 2   },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const SUBSIDY_CUTOFF = "2026-03-12";

function fmtPct(ptbr: number | null, ref: number | null): string {
  if (ptbr == null || ref == null || ref === 0) return "—";
  const pct = (ptbr / ref - 1) * 100;
  return (pct >= 0 ? "+" : "") + Math.round(pct) + "%";
}

function fmtDateLabel(d: string): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = parseInt(d.slice(5, 7), 10);
  const day = parseInt(d.slice(8, 10), 10);
  return `${months[m - 1]} ${day}, ${d.slice(0, 4)}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function generateDailyDates(from: string, to: string): string[] {
  const dates: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

const COMMON_LAYOUT_BASE: Partial<Layout> = {
  paper_bgcolor: "white",
  plot_bgcolor:  "white",
  font: { family: "Arial", size: 12, color: "#000000" },
  hovermode: "x unified",
  hoverlabel: {
    bgcolor: "rgba(255,255,255,0.95)",
    bordercolor: "rgba(180,180,180,0.5)",
    font: { family: "Arial", color: "#1a1a1a", size: 12 },
    namelength: -1,
  },
};

function downloadCsv(rows: PriceBandsRow[], filename: string) {
  if (!rows || rows.length === 0) return;
  const cols = Object.keys(rows[0]) as (keyof PriceBandsRow)[];
  const escapeCell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return `"${s.replaceAll('"', '""')}"`;
  };
  const csvLines = [cols.join(",")].concat(
    rows.map((r) => cols.map((c) => escapeCell(r[c])).join(",")),
  );
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Price Bands chart (with slider range) ─────────────────────────────────────

function buildPriceBandsChart(
  rows: PriceBandsRow[],
  product: "Gasoline" | "Diesel",
  xMin: string | null,
  xMax: string | null
): { data: PlotData[]; layout: Partial<Layout> } {
  const seriesDefs = product === "Gasoline" ? GAS_SERIES : DSL_SERIES;

  const filtered = rows
    .filter((r) => r.product === product)
    .filter((r) => (!xMin || r.date >= xMin) && (!xMax || r.date <= xMax))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (filtered.length === 0) {
    return { data: [], layout: { ...COMMON_LAYOUT_BASE, height: 380, annotations: [{ text: "No data for the selected period.", xref: "paper", yref: "paper", showarrow: false, font: { size: 13, family: "Arial", color: "#888" } }] } };
  }

  const dates = filtered.map((r) => r.date);

  // Pre-format % strings for Petrobras tooltip (pre-formatting avoids Plotly precision bugs)
  const pctCustomdata = filtered.map((r) => {
    const ptbr = r.petrobras_price as number | null;
    const ipp  = r.bba_import_parity as number | null;
    const epp  = r.bba_export_parity as number | null;
    const ippStr = fmtPct(ptbr, ipp);
    const eppStr = fmtPct(ptbr, epp);

    if (product === "Diesel") {
      const sub = r.bba_import_parity_w_subsidy as number | null;
      const subsidyLine =
        r.date >= SUBSIDY_CUTOFF && sub != null
          ? `vs. IPP w/ sub: ${fmtPct(ptbr, sub)}<br>`
          : "";
      return [ippStr, eppStr, subsidyLine];
    }
    return [ippStr, eppStr];
  });

  const petrobrasTemplate =
    product === "Diesel"
      ? `vs. IPP: %{customdata[0]}<br>` +
        `vs. EPP: %{customdata[1]}<br>` +
        `%{customdata[2]}` +
        `%{fullData.name}: %{y:.2f}<extra></extra>`
      : `vs. IPP: %{customdata[0]}<br>` +
        `vs. EPP: %{customdata[1]}<br>` +
        `%{fullData.name}: %{y:.2f}<extra></extra>`;

  const traces: PlotData[] = seriesDefs.map((s) => {
    const isPetrobras = s.field === "petrobras_price";
    return {
      type: "scatter",
      mode: "lines",
      name: s.label,
      x: dates,
      y: filtered.map((r) => r[s.field] as number | null),
      line: { color: s.color, dash: s.dash, shape: s.shape, width: s.width },
      ...(isPetrobras
        ? { customdata: pctCustomdata, hovertemplate: petrobrasTemplate }
        : { hovertemplate: `%{fullData.name}: %{y:.2f}<extra></extra>` }),
    } as unknown as PlotData;
  });

  const annotations: Partial<Annotations>[] = seriesDefs.flatMap((s) => {
    for (let i = filtered.length - 1; i >= 0; i--) {
      const val = filtered[i][s.field] as number | null;
      if (val != null) {
        return [{ x: filtered[i].date, y: val, xanchor: "left" as const, yanchor: "middle" as const, text: val.toFixed(2), showarrow: false, font: { size: 11, color: s.color, family: "Arial" }, xref: "x" as const, yref: "y" as const, xshift: 6 }];
      }
    }
    return [];
  });

  const xRangeEnd = addDays(filtered[filtered.length - 1].date, 45);

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT_BASE,
      xaxis: { type: "date", tickformat: "%b-%y", tickangle: -90, range: [filtered[0].date, xRangeEnd], showgrid: false, showline: true, linecolor: "#000000", linewidth: 1, showspikes: true, spikemode: "across", spikedash: "solid", spikecolor: "#555555", spikethickness: 1 },
      yaxis: { showgrid: true, gridcolor: "#e8e8e8", showline: true, linecolor: "#000000", linewidth: 1, tickformat: ".2f", title: { text: "BRL/litro", font: { family: "Arial", size: 11, color: "#555" } }, automargin: true },
      legend: { orientation: "h", y: -0.3, x: 0.5, xanchor: "center" },
      height: 380,
      margin: { t: 20, b: 110, l: 65, r: 55 },
      annotations,
    },
  };
}

// ── YTD Average Price chart (fixed to current year) ───────────────────────────

function buildYtdChart(
  rows: PriceBandsRow[],
  product: "Gasoline" | "Diesel"
): { data: PlotData[]; layout: Partial<Layout> } {
  const year = new Date().getFullYear();
  const seriesDefs = product === "Gasoline" ? GAS_SERIES : DSL_SERIES;

  const yearRows = rows
    .filter((r) => r.product === product && r.date.startsWith(`${year}-`))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (yearRows.length === 0) {
    return { data: [], layout: { ...COMMON_LAYOUT_BASE, height: 360 } };
  }

  const lastRow    = yearRows[yearRows.length - 1];
  const lastDate   = lastRow.date;
  const yearEnd    = `${year}-12-31`;
  const projDates  = generateDailyDates(addDays(lastDate, 1), yearEnd);

  const traces: PlotData[] = [];

  for (const s of seriesDefs) {
    // ── Actual cumulative average ──────────────────────────────────────────
    let cumSum = 0;
    let count  = 0;
    const actualDates: string[] = [];
    const actualAvgs:  number[] = [];

    for (const r of yearRows) {
      const val = r[s.field] as number | null;
      if (val == null) continue;
      cumSum += val;
      count++;
      actualDates.push(r.date);
      actualAvgs.push(cumSum / count);
    }

    if (actualDates.length === 0) continue;

    // For Petrobras trace: attach cumAvg IPP and EPP as customdata for tooltip (pre-formatted strings)
    const isPetrobras = s.field === "petrobras_price";
    let ytdCustomdata: [string, string][] | undefined;
    if (isPetrobras) {
      let cumIpp = 0, cumEpp = 0, cntIpp = 0, cntEpp = 0;
      ytdCustomdata = yearRows.map((r) => {
        const ipp = r.bba_import_parity as number | null;
        const epp = r.bba_export_parity as number | null;
        if (ipp != null) { cumIpp += ipp; cntIpp++; }
        if (epp != null) { cumEpp += epp; cntEpp++; }
        return [cntIpp > 0 ? cumIpp / cntIpp : null, cntEpp > 0 ? cumEpp / cntEpp : null];
      }).filter((_, i) => (yearRows[i][s.field] as number | null) != null)
        .map((pair, i) => {
          const avgPtbr = actualAvgs[i];
          return [fmtPct(avgPtbr, pair[0]), fmtPct(avgPtbr, pair[1])] as [string, string];
        });
    }

    traces.push({
      type: "scatter",
      mode: "lines",
      name: s.label,
      x: actualDates,
      y: actualAvgs,
      line: { color: s.color, dash: s.dash === "dash" ? "dash" : "solid", shape: "linear", width: s.width },
      ...(isPetrobras && ytdCustomdata
        ? {
            customdata: ytdCustomdata,
            hovertemplate:
              `vs. IPP avg: %{customdata[0]}<br>` +
              `vs. EPP avg: %{customdata[1]}<br>` +
              `%{fullData.name}: %{y:.2f}<extra></extra>`,
          }
        : { hovertemplate: `%{fullData.name}: %{y:.2f}<extra></extra>` }),
    } as unknown as PlotData);

    // ── Projection (dashed extension, no legend entry) ─────────────────────
    if (projDates.length > 0) {
      const lastPrice = lastRow[s.field] as number | null;
      if (lastPrice == null) continue;

      let projSum   = cumSum;
      let projCount = count;
      const projX: string[] = [lastDate];   // connect to last actual point
      const projY: number[] = [cumSum / count];

      for (const d of projDates) {
        projSum   += lastPrice;
        projCount += 1;
        projX.push(d);
        projY.push(projSum / projCount);
      }

      traces.push({
        type: "scatter",
        mode: "lines",
        name: s.label + " (proj.)",
        x: projX,
        y: projY,
        line: { color: s.color, dash: "dot", shape: "linear", width: s.width },
        showlegend: false,
        hovertemplate: `%{fullData.name}: %{y:.2f}<extra></extra>`,
      } as unknown as PlotData);
    }
  }

  // End-of-year projected value annotation
  const annotations: Partial<Annotations>[] = seriesDefs.flatMap((s) => {
    const lastPrice = lastRow[s.field] as number | null;
    if (lastPrice == null) return [];
    // Rebuild final projected cumAvg
    const yearRowsForS = yearRows.filter((r) => (r[s.field] as number | null) != null);
    if (yearRowsForS.length === 0) return [];
    const cumSum = yearRowsForS.reduce((acc, r) => acc + (r[s.field] as number), 0);
    const count  = yearRowsForS.length;
    const remainingDays = projDates.length;
    const finalAvg = (cumSum + remainingDays * lastPrice) / (count + remainingDays);
    return [{
      x: yearEnd,
      y: finalAvg,
      xanchor: "left" as const,
      yanchor: "middle" as const,
      text: finalAvg.toFixed(2),
      showarrow: false,
      font: { size: 11, color: s.color, family: "Arial" },
      xref: "x" as const,
      yref: "y" as const,
      xshift: 6,
    }];
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT_BASE,
      xaxis: { type: "date", tickformat: "%b", tickangle: -45, range: [`${year}-01-01`, addDays(yearEnd, 30)], showgrid: false, showline: true, linecolor: "#000000", linewidth: 1, showspikes: true, spikemode: "across", spikecolor: "#555555", spikethickness: 1, spikedash: "solid" },
      yaxis: { showgrid: true, gridcolor: "#e8e8e8", showline: true, linecolor: "#000000", linewidth: 1, tickformat: ".2f", title: { text: "BRL/litro", font: { family: "Arial", size: 11, color: "#555" } }, automargin: true },
      legend: { orientation: "h", y: -0.28, x: 0.5, xanchor: "center" },
      height: 360,
      margin: { t: 20, b: 100, l: 65, r: 55 },
      annotations,
    },
  };
}

// ── Badge component ───────────────────────────────────────────────────────────

function PctBadge({ pct, vs, outlined }: { pct: number; vs: string; outlined?: boolean }) {
  const sign  = pct >= 0 ? "+" : "";
  const label = `${sign}${pct.toFixed(0)}% vs. ${vs}`;
  if (outlined) {
    return <span style={{ border: "1px solid #1a1a1a", color: "#1a1a1a", background: "white", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontFamily: "Arial", marginLeft: 8, fontWeight: 600 }}>{label}</span>;
  }
  return <span style={{ background: COLOR_IMPORT, color: "white", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontFamily: "Arial", marginLeft: 8, fontWeight: 600 }}>{label}</span>;
}

// ── Chart header with product label + badges ──────────────────────────────────

function ChartHeader({ product, rows, xMax }: { product: "Gasoline" | "Diesel"; rows: PriceBandsRow[]; xMax: string | null }) {
  // Use last row within the selected filter range
  const scoped = xMax ? rows.filter((r) => r.date <= xMax) : rows;
  const sorted = [...scoped].sort((a, b) => b.date.localeCompare(a.date));
  const last = sorted.find(
    (r) => r.petrobras_price != null && r.bba_import_parity != null && r.bba_export_parity != null
  );
  const pctIpp = last ? ((last.petrobras_price! / last.bba_import_parity!)  - 1) * 100 : null;
  const pctEpp = last ? ((last.petrobras_price! / last.bba_export_parity!) - 1) * 100 : null;

  // Diesel: subsidy badge (only from SUBSIDY_CUTOFF onwards)
  const lastSubsidy = product === "Diesel"
    ? sorted.find((r) => r.date >= SUBSIDY_CUTOFF && r.petrobras_price != null && r.bba_import_parity_w_subsidy != null)
    : null;
  const pctSub = lastSubsidy
    ? ((lastSubsidy.petrobras_price! / lastSubsidy.bba_import_parity_w_subsidy!) - 1) * 100
    : null;

  return (
    <div style={{ marginTop: 16, marginBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0, marginBottom: 4 }}>
        <span style={{ fontFamily: "Arial", fontSize: 14, fontWeight: 700, color: "#FF5000" }}>{product}:</span>
        {pctIpp != null && <PctBadge pct={pctIpp} vs="IPP" />}
        {pctEpp != null && <PctBadge pct={pctEpp} vs="EPP" outlined />}
        {pctSub != null && <PctBadge pct={pctSub} vs="IPP w/ sub" />}
        {last && (
          <span style={{ fontFamily: "Arial", fontSize: 11, color: "#999", marginLeft: 10 }}>
            Last data: {fmtDateLabel(last.date)}
          </span>
        )}
      </div>
      <hr style={{ borderTop: "1px solid #ccc", margin: "0 0 6px 0" }} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const DEFAULT_START = "2023-06-01";

export default function PriceBandsPage() {
  const supabase = getSupabaseClient();
  const [rows,         setRows]         = useState<PriceBandsRow[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [sliderRange,  setSliderRange]  = useState<[number, number]>([0, 0]);
  const [resetHovered, setResetHovered] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const [csvLoading,   setCsvLoading]   = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const data = await rpcGetPriceBandsData(supabase);
      if (!cancelled) { setRows(data); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const datas = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) seen.add(r.date);
    return Array.from(seen).sort();
  }, [rows]);

  useEffect(() => {
    if (datas.length === 0) return;
    const startIdx = Math.max(0, datas.findIndex((d) => d >= DEFAULT_START));
    setSliderRange([startIdx, datas.length - 1]);
  }, [datas.length]);

  const xMin = datas[sliderRange[0]] ?? null;
  const xMax = datas[sliderRange[1]] ?? null;

  function resetFilters() {
    if (datas.length === 0) return;
    const startIdx = Math.max(0, datas.findIndex((d) => d >= DEFAULT_START));
    setSliderRange([startIdx, datas.length - 1]);
  }

  const gasolineRows = useMemo(() => rows.filter((r) => r.product === "Gasoline"), [rows]);
  const dieselRows   = useMemo(() => rows.filter((r) => r.product === "Diesel"),   [rows]);

  const gasolineChart = useMemo(() => buildPriceBandsChart(rows, "Gasoline", xMin, xMax), [rows, xMin, xMax]);
  const dieselChart   = useMemo(() => buildPriceBandsChart(rows, "Diesel",   xMin, xMax), [rows, xMin, xMax]);
  const gasolineYtd   = useMemo(() => buildYtdChart(rows, "Gasoline"),                    [rows]);
  const dieselYtd     = useMemo(() => buildYtdChart(rows, "Diesel"),                      [rows]);

  const year = new Date().getFullYear();

  return (
    <div>
      <NavBar />

      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ────────────────────────────────────────────────── */}
          <div className="col-2 p-0" style={{ display: "flex", flexDirection: "column" }}>
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <img src="/logo.png" alt="Itaú BBA" style={{ width: "100%", maxWidth: 300, marginBottom: 16 }} />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!loading && datas.length > 0 && (
                  <PeriodSlider datas={datas} value={sliderRange} onChange={setSliderRange} sliderId="pb-slider-period" />
                )}
              </div>

              <div className="row g-1 mt-1">
                <div className="col-12">
                  <button
                    type="button"
                    className="btn btn-clear"
                    onClick={resetFilters}
                    disabled={loading}
                    onMouseEnter={() => setResetHovered(true)}
                    onMouseLeave={() => setResetHovered(false)}
                    style={{
                      transition: "background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease",
                      ...(resetHovered ? { backgroundColor: "#6c6c6c", color: "#fff", borderColor: "#6c6c6c" } : {}),
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Main content ───────────────────────────────────────────── */}
          <div className="col-10">
            <div id="page-content">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <div>
                  <div className="page-header-title">Brazil Fuel Price Bands</div>
                  <div className="page-header-sub">BBA Import/Export Parity vs. Petrobras reference price (R$/L)</div>
                </div>

                <div style={{ position: "relative", minWidth: 180 }}>
                  {(excelLoading || csvLoading) && (
                    <div style={{ position: "absolute", top: 0, right: 0, zIndex: 20, border: "1px solid #e0e0e0", borderRadius: 12, padding: "24px 32px", backgroundColor: "rgba(255,255,255,0.97)", backdropFilter: "blur(8px)", boxShadow: "0 8px 32px rgba(0,0,0,0.12)", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                      <img src="/barrel_loading.png" alt="Carregando..." width={120} height={120} />
                      <span style={{ fontFamily: "Arial", fontSize: 13, fontWeight: 600, color: "#555", letterSpacing: "0.3px" }}>
                        {excelLoading ? "Gerando Excel..." : "Baixando CSV..."}
                      </span>
                    </div>
                  )}
                  <div style={{ border: "1px solid #d0d0d0", borderRadius: 6, padding: "10px 16px", backgroundColor: "#fafafa" }}>
                    <div style={{ fontFamily: "Arial", fontSize: 11, fontWeight: 700, color: "#1a1a1a", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Export Data
                    </div>
                    <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={async () => {
                          setExcelLoading(true);
                          try {
                            await downloadPriceBandsExcel(rows);
                          } catch (e) {
                            console.error("Excel export failed", e);
                          } finally {
                            setExcelLoading(false);
                          }
                        }}
                        disabled={rows.length === 0 || loading || excelLoading}
                        style={{ fontFamily: "Arial" }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" style={{ marginRight: 5, verticalAlign: "middle" }} xmlns="http://www.w3.org/2000/svg">
                          <rect x="2" y="2" width="20" height="20" rx="3" fill="#217346"/>
                          <text x="4" y="17" fontFamily="Arial" fontWeight="bold" fontSize="12" fill="#ffffff">X</text>
                        </svg>
                        formated data .xl
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={async () => {
                          setCsvLoading(true);
                          try {
                            downloadCsv(rows, "price_bands.csv");
                          } finally {
                            setCsvLoading(false);
                          }
                        }}
                        disabled={rows.length === 0 || loading || csvLoading}
                        style={{ fontFamily: "Arial" }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" style={{ marginRight: 5, verticalAlign: "middle" }} xmlns="http://www.w3.org/2000/svg">
                          <rect x="3" y="2" width="18" height="20" rx="2" fill="#1565C0"/>
                          <rect x="6" y="7" width="12" height="1.5" rx="0.75" fill="#ffffff"/>
                          <rect x="6" y="11" width="12" height="1.5" rx="0.75" fill="#ffffff"/>
                          <rect x="6" y="15" width="8" height="1.5" rx="0.75" fill="#ffffff"/>
                        </svg>
                        all data .csv
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 1: Price Bands (slider-controlled) */}
              <h5 className="section-title" style={{ marginBottom: 4 }}>Price Bands</h5>
              <hr className="section-hr" style={{ marginBottom: 0 }} />

              {loading ? (
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300 }}>
                  <div className="spinner-border text-secondary" role="status">
                    <span className="visually-hidden">Loading…</span>
                  </div>
                </div>
              ) : (
                <>
                  {/* Price Bands — side by side */}
                  <div className="row g-3">
                    <div className="col-6">
                      <ChartHeader product="Gasoline" rows={gasolineRows} xMax={xMax} />
                      <PlotlyChart data={gasolineChart.data} layout={gasolineChart.layout} config={{ displayModeBar: false }} />
                    </div>
                    <div className="col-6">
                      <ChartHeader product="Diesel" rows={dieselRows} xMax={xMax} />
                      <PlotlyChart data={dieselChart.data} layout={dieselChart.layout} config={{ displayModeBar: false }} />
                    </div>
                  </div>

                  {/* Section 2: YTD Average Price */}
                  <h5 className="section-title" style={{ marginBottom: 4, marginTop: 32 }}>
                    {`YTD Average Price (${year})`}
                  </h5>
                  <hr className="section-hr" style={{ marginBottom: 0 }} />
                  <div style={{ marginBottom: 6, marginTop: 4 }}>
                    <span style={{ fontFamily: "Arial", fontSize: 11, color: "#888" }}>
                      Solid: actual cumulative average · Dotted: projection assuming today&apos;s prices hold through Dec 31
                    </span>
                  </div>

                  {/* YTD — side by side */}
                  <div className="row g-3">
                    <div className="col-6">
                      <div style={{ marginTop: 16, marginBottom: 0 }}>
                        <span style={{ fontFamily: "Arial", fontSize: 14, fontWeight: 700, color: "#FF5000" }}>Gasoline</span>
                        <hr style={{ borderTop: "1px solid #ccc", margin: "4px 0 6px 0" }} />
                      </div>
                      <PlotlyChart data={gasolineYtd.data} layout={gasolineYtd.layout} config={{ displayModeBar: false }} />
                    </div>
                    <div className="col-6">
                      <div style={{ marginTop: 16, marginBottom: 0 }}>
                        <span style={{ fontFamily: "Arial", fontSize: 14, fontWeight: 700, color: "#FF5000" }}>Diesel</span>
                        <hr style={{ borderTop: "1px solid #ccc", margin: "4px 0 6px 0" }} />
                      </div>
                      <PlotlyChart data={dieselYtd.data} layout={dieselYtd.layout} config={{ displayModeBar: false }} />
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
