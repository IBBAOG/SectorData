"use client";

import { useEffect, useMemo, useState } from "react";
import type { Annotations, Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import PeriodSlider from "../../../components/PeriodSlider";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { rpcGetPriceBandsData, type PriceBandsRow } from "../../../lib/rpc";

// ── Colors ────────────────────────────────────────────────────────────────────

const COLOR_IMPORT = "#E8611A";  // orange  — IBBA/BBA Import Parity
const COLOR_EXPORT = "#1a1a1a";  // black   — IBBA/BBA Export Parity
const COLOR_PETRO  = "#4ECDC4";  // teal    — Petrobras Price

// ── Chart builder ─────────────────────────────────────────────────────────────

interface SeriesDef {
  label: string;
  field: keyof PriceBandsRow;
  color: string;
  dash: "solid" | "dash";
  shape: "linear" | "hv";
  width: number;
}

/** Add 45 days to a YYYY-MM-DD date string (for right-axis padding). */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildPriceBandsChart(
  rows: PriceBandsRow[],
  product: "Gasoline" | "Diesel",
  xMin: string | null,
  xMax: string | null
): { data: PlotData[]; layout: Partial<Layout> } {
  const allFiltered = rows
    .filter((r) => r.product === product)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Apply date range from slider
  const filtered = allFiltered.filter((r) => {
    if (xMin && r.date < xMin) return false;
    if (xMax && r.date > xMax) return false;
    return true;
  });

  if (filtered.length === 0) {
    return {
      data: [],
      layout: {
        paper_bgcolor: "white",
        plot_bgcolor: "white",
        height: 400,
        annotations: [{ text: "No data for the selected period.", xref: "paper", yref: "paper", showarrow: false, font: { size: 13, family: "Arial", color: "#888" } }],
      },
    };
  }

  const seriesDefs: SeriesDef[] =
    product === "Gasoline"
      ? [
          { label: "IBBA - Import Parity", field: "bba_import_parity",  color: COLOR_IMPORT, dash: "solid", shape: "linear", width: 1.5 },
          { label: "IBBA - Export Parity", field: "bba_export_parity",  color: COLOR_EXPORT, dash: "solid", shape: "linear", width: 1.5 },
          { label: "Petrobras Price",       field: "petrobras_price",    color: COLOR_PETRO,  dash: "solid", shape: "hv",     width: 2   },
        ]
      : [
          { label: "BBA - Import Parity",            field: "bba_import_parity",           color: COLOR_IMPORT, dash: "solid", shape: "linear", width: 1.5 },
          { label: "BBA - Import Parity w/ subsidy", field: "bba_import_parity_w_subsidy", color: COLOR_IMPORT, dash: "dash",  shape: "linear", width: 1.5 },
          { label: "BBA - Export Parity",            field: "bba_export_parity",           color: COLOR_EXPORT, dash: "solid", shape: "linear", width: 1.5 },
          { label: "Petrobras Price",                field: "petrobras_price",             color: COLOR_PETRO,  dash: "solid", shape: "hv",     width: 2   },
        ];

  const dates = filtered.map((r) => r.date);

  const traces: PlotData[] = seriesDefs.map((s) => ({
    type: "scatter",
    mode: "lines",
    name: s.label,
    x: dates,
    y: filtered.map((r) => r[s.field] as number | null),
    line: { color: s.color, dash: s.dash, shape: s.shape, width: s.width },
    hovertemplate: `%{fullData.name}: R$ %{y:.2f}<extra></extra>`,
  } as unknown as PlotData));

  // End-of-line annotations (last non-null value per series)
  const annotations: Partial<Annotations>[] = seriesDefs.flatMap((s) => {
    for (let i = filtered.length - 1; i >= 0; i--) {
      const val = filtered[i][s.field] as number | null;
      if (val != null) {
        return [{
          x: filtered[i].date,
          y: val,
          xanchor: "left" as const,
          yanchor: "middle" as const,
          text: val.toFixed(2),
          showarrow: false,
          font: { size: 11, color: s.color, family: "Arial" },
          xref: "x" as const,
          yref: "y" as const,
          xshift: 6,
        }];
      }
    }
    return [];
  });

  // Pad x-axis right edge by 45 days to accommodate end-of-line labels
  const xStart = filtered[0].date;
  const xEnd   = filtered[filtered.length - 1].date;
  const xRangeEnd = addDays(xEnd, 45);

  const layout: Partial<Layout> = {
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    font: { family: "Arial", size: 12, color: "#000000" },
    xaxis: {
      type: "date",
      tickformat: "%b-%y",
      tickangle: -90,
      range: [xStart, xRangeEnd],
      showgrid: false,
      showline: true,
      linecolor: "#000000",
      linewidth: 1,
      showspikes: true,
      spikemode: "across",
      spikedash: "solid",
      spikecolor: "#555555",
      spikethickness: 1,
    },
    yaxis: {
      showgrid: true,
      gridcolor: "#e8e8e8",
      showline: true,
      linecolor: "#000000",
      linewidth: 1,
      tickprefix: "R$ ",
      automargin: true,
    },
    legend: {
      orientation: "h",
      y: -0.3,
      x: 0.5,
      xanchor: "center",
    },
    hovermode: "x unified",
    hoverlabel: {
      bgcolor: "rgba(255,255,255,0.95)",
      bordercolor: "rgba(180,180,180,0.5)",
      font: { family: "Arial", color: "#1a1a1a", size: 12 },
      namelength: -1,
    },
    height: 400,
    margin: { t: 20, b: 110, l: 65, r: 55 },
    annotations,
  };

  return { data: traces, layout };
}

// ── Badge component ───────────────────────────────────────────────────────────

function PctBadge({ pct, vs, outlined }: { pct: number; vs: string; outlined?: boolean }) {
  const sign = pct >= 0 ? "+" : "";
  const label = `${sign}${pct.toFixed(1)}% vs. ${vs}`;
  if (outlined) {
    return (
      <span style={{ border: "1px solid #1a1a1a", color: "#1a1a1a", background: "white", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontFamily: "Arial", marginLeft: 8, fontWeight: 600 }}>
        {label}
      </span>
    );
  }
  return (
    <span style={{ background: COLOR_IMPORT, color: "white", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontFamily: "Arial", marginLeft: 8, fontWeight: 600 }}>
      {label}
    </span>
  );
}

// ── Chart title with badges ───────────────────────────────────────────────────

function ChartHeader({ product, rows }: { product: "Gasoline" | "Diesel"; rows: PriceBandsRow[] }) {
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const last = sorted.find(
    (r) => r.petrobras_price != null && r.bba_import_parity != null && r.bba_export_parity != null
  );
  const pctIpp = last ? ((last.petrobras_price! / last.bba_import_parity!) - 1) * 100 : null;
  const pctEpp = last ? ((last.petrobras_price! / last.bba_export_parity!) - 1) * 100 : null;

  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 8, marginTop: 24 }}>
      <span style={{ fontFamily: "Arial", fontSize: 14, fontWeight: 700, color: "#1a1a1a" }}>
        {product}:
      </span>
      {pctIpp != null && <PctBadge pct={pctIpp} vs="IPP" />}
      {pctEpp != null && <PctBadge pct={pctEpp} vs="EPP" outlined />}
    </div>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

export default function PriceBandsPage() {
  const supabase = getSupabaseClient();
  const [rows, setRows] = useState<PriceBandsRow[]>([]);
  const [loading, setLoading] = useState(true);

  const DEFAULT_START = "2023-06-01";

  // Slider state (indices into datas[])
  const [sliderRange, setSliderRange] = useState<[number, number]>([0, 0]);

  // Load all data once
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const data = await rpcGetPriceBandsData(supabase);
      if (!cancelled) {
        setRows(data);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // Unique sorted dates (daily) from the loaded rows
  const datas = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) seen.add(r.date);
    return Array.from(seen).sort();
  }, [rows]);

  // When data first loads, default start = Jun 2023 (or closest), end = last date
  useEffect(() => {
    if (datas.length === 0) return;
    const startIdx = Math.max(0, datas.findIndex((d) => d >= DEFAULT_START));
    setSliderRange([startIdx, datas.length - 1]);
  }, [datas.length]);

  // x-axis range derived directly from slider — updates immediately on drag end
  const xMin = datas[sliderRange[0]] ?? null;
  const xMax = datas[sliderRange[1]] ?? null;

  function clearFilters() {
    if (datas.length === 0) return;
    const startIdx = Math.max(0, datas.findIndex((d) => d >= DEFAULT_START));
    setSliderRange([startIdx, datas.length - 1]);
  }

  const gasolineRows = useMemo(() => rows.filter((r) => r.product === "Gasoline"), [rows]);
  const dieselRows   = useMemo(() => rows.filter((r) => r.product === "Diesel"),   [rows]);

  const gasolineChart = useMemo(() => buildPriceBandsChart(rows, "Gasoline", xMin, xMax), [rows, xMin, xMax]);
  const dieselChart   = useMemo(() => buildPriceBandsChart(rows, "Diesel",   xMin, xMax), [rows, xMin, xMax]);

  return (
    <div>
      <NavBar />

      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ──────────────────────────────────────────────────── */}
          <div className="col-2 p-0" style={{ display: "flex", flexDirection: "column" }}>
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <img
                  src="/logo.png"
                  alt="Itaú BBA"
                  style={{ width: "100%", maxWidth: 300, marginBottom: 16 }}
                />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!loading && datas.length > 0 && (
                  <PeriodSlider
                    datas={datas}
                    value={sliderRange}
                    onChange={setSliderRange}
                    sliderId="pb-slider-period"
                  />
                )}
              </div>

              <div className="row g-1 mt-1">
                <div className="col-12">
                  <button type="button" className="btn btn-clear" onClick={clearFilters} disabled={loading}>
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Main content ─────────────────────────────────────────────── */}
          <div className="col-10">
            <div id="page-content">
              <div style={{ marginBottom: 12 }}>
                <div className="page-header-title">Brazil Fuel Price Bands</div>
                <div className="page-header-sub">
                  BBA Import/Export Parity vs. Petrobras reference price (R$/L)
                </div>
              </div>

              <h5 className="section-title" style={{ marginBottom: 4 }}>
                PRICE BANDS
              </h5>
              <hr className="section-hr" style={{ marginBottom: 0 }} />

              {loading ? (
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300 }}>
                  <div className="spinner-border text-secondary" role="status">
                    <span className="visually-hidden">Loading…</span>
                  </div>
                </div>
              ) : (
                <>
                  <ChartHeader product="Gasoline" rows={gasolineRows} />
                  <PlotlyChart data={gasolineChart.data} layout={gasolineChart.layout} />

                  <ChartHeader product="Diesel" rows={dieselRows} />
                  <PlotlyChart data={dieselChart.data} layout={dieselChart.layout} />
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
