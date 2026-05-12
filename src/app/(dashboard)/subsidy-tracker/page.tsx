"use client";

// ──────────────────────────────────────────────────────────────────────────────
// /subsidy-tracker — Federal diesel subsidy tracker.
//
// Single Plotly chart with 4 line traces (IPP / ANP Reference / ANP
// Commercialization / Petrobras) for Diesel, in BRL/Liter. The ANP Reference
// trace exposes the 5 regional breakdown values via Plotly `customdata` for a
// rich hover tooltip; the difference between Reference and Commercialization
// equals the subsidy vigente on each date (~R$ 0,32 → R$ 1,52 jump on
// 2026-04-07 is correct, not a bug).
//
// Tier 1 export (Excel + CSV direct download — small dataset).
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import type { Annotations, Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import BrandLogo from "../../../components/BrandLogo";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useDebouncedFetch } from "../../../hooks/useDebouncedFetch";
import PlotlyChart from "../../../components/PlotlyChart";
import DashboardHeader from "../../../components/dashboard/DashboardHeader";
import PeriodSlider from "../../../components/dashboard/PeriodSlider";
import ExportPanel from "../../../components/dashboard/ExportPanel";
import BarrelLoading from "../../../components/dashboard/BarrelLoading";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import {
  rpcGetSubsidyTrackerDiesel,
  type SubsidyTrackerRow,
} from "../../../lib/rpc";
import { downloadGenericExcel } from "../../../lib/exportExcel";
import { downloadCsv } from "../../../lib/exportCsv";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../lib/plotlyDefaults";

// ── Colors (locked by sub-PRD — do not change without coordination) ──────────

const COLOR_IPP   = "#111111"; // black
const COLOR_REF   = "#F59E0B"; // orange  — ANP Reference
const COLOR_COMM  = "#B91C1C"; // dark red — ANP Commercialization
const COLOR_PETRO = "#0F766E"; // teal    — Petrobras

// ── Types ─────────────────────────────────────────────────────────────────────

type SeriesField = "ipp" | "anp_reference" | "anp_commercialization" | "petrobras";

interface SeriesDef {
  label: string;
  field: SeriesField;
  color: string;
}

const SERIES: SeriesDef[] = [
  { label: "IPP",                   field: "ipp",                   color: COLOR_IPP   },
  { label: "ANP Reference",         field: "anp_reference",         color: COLOR_REF   },
  { label: "ANP Commercialization", field: "anp_commercialization", color: COLOR_COMM  },
  { label: "Petrobras",             field: "petrobras",             color: COLOR_PETRO },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Default selection = last 90 days within the available range.
const DEFAULT_WINDOW_DAYS = 90;

// ── Chart builder ─────────────────────────────────────────────────────────────

function buildChart(
  rows: SubsidyTrackerRow[],
  xMin: string | null,
  xMax: string | null,
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows
    .filter((r) => (!xMin || r.date >= xMin) && (!xMax || r.date <= xMax))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (filtered.length === 0) {
    return emptyPlot(420, "No data available");
  }

  const dates = filtered.map((r) => r.date);

  // ── Regional hover for ANP Reference ────────────────────────────────────
  // Customdata is per-point: { NORTE, NORDESTE, "CENTRO-OESTE", SUDESTE, SUL }
  // or null when the day has no ETL extraction yet. Plotly's hovertemplate
  // can't conditionally suppress lines, so we pre-build the breakdown text
  // per point and fall back to a single string when `regions` is null.
  const regionCustomdata = filtered.map((r) => r.regions ?? null);

  const referenceHoverWith = (
    "<b>%{x}</b><br>" +
    "ANP Reference: R$ %{y:.2f}/L<br><br>" +
    "NORTE: %{customdata.NORTE:.2f}<br>" +
    "NORDESTE: %{customdata.NORDESTE:.2f}<br>" +
    "CENTRO-OESTE: %{customdata['CENTRO-OESTE']:.2f}<br>" +
    "SUDESTE: %{customdata.SUDESTE:.2f}<br>" +
    "SUL: %{customdata.SUL:.2f}<extra></extra>"
  );

  // Default hover when `regions` is null on every visible point.
  const referenceHoverDefault =
    "<b>%{x}</b><br>ANP Reference: R$ %{y:.2f}/L<extra></extra>";

  const anyRegions = regionCustomdata.some((r) => r != null);

  const traces: PlotData[] = SERIES.map((s) => {
    const y = filtered.map((r) => r[s.field] as number | null);

    if (s.field === "anp_reference") {
      return {
        type: "scatter",
        mode: "lines",
        name: s.label,
        x: dates,
        y,
        line: { color: s.color, width: 2, shape: "linear" },
        connectgaps: true,
        customdata: regionCustomdata,
        hovertemplate: anyRegions ? referenceHoverWith : referenceHoverDefault,
      } as unknown as PlotData;
    }

    return {
      type: "scatter",
      mode: "lines",
      name: s.label,
      x: dates,
      y,
      line: { color: s.color, width: 2, shape: "linear" },
      connectgaps: true,
      hovertemplate: `<b>%{x}</b><br>${s.label}: R$ %{y:.2f}/L<extra></extra>`,
    } as unknown as PlotData;
  });

  // ── End-of-line value annotations (replicating price-bands pattern) ────
  // For each trace, find the last non-null point and render a small label
  // anchored to the right of it. To minimise overlap when two values are
  // close, we offset `yshift` by ±10 per trace index.
  const annotations: Partial<Annotations>[] = SERIES.flatMap((s, idx) => {
    for (let i = filtered.length - 1; i >= 0; i--) {
      const val = filtered[i][s.field] as number | null;
      if (val != null) {
        return [{
          x: filtered[i].date,
          y: val,
          xref: "x" as const,
          yref: "y" as const,
          xanchor: "left" as const,
          yanchor: "middle" as const,
          xshift: 8,
          yshift: (idx - (SERIES.length - 1) / 2) * 10, // collision-aware vertical offset
          text: val.toFixed(2),
          showarrow: false,
          font: { size: 11, color: s.color, family: "Arial" },
        }];
      }
    }
    return [];
  });

  const xRangeEnd = addDays(filtered[filtered.length - 1].date, 30);

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      hovermode: "x unified",
      xaxis: {
        ...AXIS_LINE,
        type: "date",
        tickformat: "%b-%y",
        hoverformat: "%b %d, %Y",
        tickangle: -90,
        range: [filtered[0].date, xRangeEnd],
        showspikes: true,
        spikemode: "across",
        spikedash: "solid",
        spikecolor: "#555555",
        spikethickness: 1,
      },
      yaxis: {
        ...AXIS_LINE,
        tickformat: ".2f",
        title: { text: "BRL/Liter", font: { family: "Arial", size: 11, color: "#555" } },
        automargin: true,
      },
      legend: { orientation: "h", y: -0.25, x: 0.5, xanchor: "center" },
      height: 480,
      margin: { t: 20, b: 110, l: 65, r: 65 },
      annotations,
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SubsidyTrackerPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("subsidy-tracker");
  const supabase = getSupabaseClient();

  const [initialLoading, setInitialLoading] = useState(true);
  const [sliderRange, setSliderRange] = useState<[number, number]>([0, 0]);
  const [resetHovered, setResetHovered] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const [csvLoading, setCsvLoading]     = useState(false);

  // Debounced RPC fetch with in-flight cancellation. The fetchFn closes over
  // the supabase client; we re-run whenever the client is (re)created.
  const { data: fetchedRows } = useDebouncedFetch<SubsidyTrackerRow[]>(
    async () => {
      if (!supabase) return [];
      return rpcGetSubsidyTrackerDiesel(supabase);
    },
    [supabase],
    { ms: 400 },
  );

  const rows: SubsidyTrackerRow[] = useMemo(() => fetchedRows ?? [], [fetchedRows]);

  // Flip initialLoading off after the first resolved fetch (data may legitimately
  // be []).
  useEffect(() => {
    if (fetchedRows !== null) setInitialLoading(false);
  }, [fetchedRows]);

  const dates = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) seen.add(r.date);
    return Array.from(seen).sort();
  }, [rows]);

  // Default selection: last 90 days (or full range if shorter).
  useEffect(() => {
    if (dates.length === 0) return;
    const endIdx = dates.length - 1;
    const cutoff = addDays(dates[endIdx], -DEFAULT_WINDOW_DAYS);
    const startIdx = Math.max(0, dates.findIndex((d) => d >= cutoff));
    setSliderRange([startIdx === -1 ? 0 : startIdx, endIdx]);
  }, [dates.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const xMin = dates[sliderRange[0]] ?? null;
  const xMax = dates[sliderRange[1]] ?? null;

  function resetFilters() {
    if (dates.length === 0) return;
    const endIdx = dates.length - 1;
    const cutoff = addDays(dates[endIdx], -DEFAULT_WINDOW_DAYS);
    const startIdx = Math.max(0, dates.findIndex((d) => d >= cutoff));
    setSliderRange([startIdx === -1 ? 0 : startIdx, endIdx]);
  }

  const chart = useMemo(() => buildChart(rows, xMin, xMax), [rows, xMin, xMax]);

  if (visLoading || !visible) return null;

  return (
    <div>
      <NavBar />

      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ────────────────────────────────────────────────── */}
          <div className="col-xxl-2 col-md-3 p-0" style={{ display: "flex", flexDirection: "column" }}>
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!initialLoading && dates.length > 0 && (
                  <PeriodSlider
                    dates={dates}
                    value={sliderRange}
                    onChange={setSliderRange}
                    sliderId="st-slider-period"
                  />
                )}
              </div>

              <div className="row g-1 mt-1">
                <div className="col-12">
                  <button
                    type="button"
                    className="btn btn-clear"
                    onClick={resetFilters}
                    disabled={initialLoading}
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
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="Subsidy Tracker"
                sub="Diesel — ANP Reference & Commercialization Price vs IPP & Petrobras (BRL/Liter)"
                lang="en"
                hideDivider
                rightSlot={
                  <ExportPanel
                    actions={[
                      {
                        kind: "excel",
                        label: "formated data .xl",
                        busy: excelLoading,
                        loadingLabel: "Generating Excel...",
                        disabled: rows.length === 0 || initialLoading || excelLoading,
                        onClick: async () => {
                          setExcelLoading(true);
                          try {
                            await downloadGenericExcel({
                              rows: rows as unknown as Record<string, unknown>[],
                              filename: "subsidy_tracker_diesel",
                              title: "Subsidy Tracker — Diesel",
                              sheetName: "Diesel",
                              mergeTitleCells: true,
                              columns: [
                                { header: "Date",                  key: "date",                  width: 12, align: "left"   },
                                { header: "IPP",                   key: "ipp",                   width: 12, format: "0.00", align: "center" },
                                { header: "ANP Reference",         key: "anp_reference",         width: 16, format: "0.00", align: "center" },
                                { header: "ANP Commercialization", key: "anp_commercialization", width: 22, format: "0.00", align: "center" },
                                { header: "Petrobras",             key: "petrobras",             width: 12, format: "0.00", align: "center" },
                              ],
                            });
                          } catch (e) {
                            console.error("Excel export failed", e);
                          } finally {
                            setExcelLoading(false);
                          }
                        },
                      },
                      {
                        kind: "csv",
                        label: "all data .csv",
                        busy: csvLoading,
                        loadingLabel: "Downloading CSV...",
                        disabled: rows.length === 0 || initialLoading || csvLoading,
                        onClick: async () => {
                          setCsvLoading(true);
                          try {
                            downloadCsv({
                              rows: rows.map((r) => ({
                                date: r.date,
                                ipp: r.ipp,
                                anp_reference: r.anp_reference,
                                anp_commercialization: r.anp_commercialization,
                                petrobras: r.petrobras,
                              })) as unknown as Record<string, unknown>[],
                              filename: "subsidy_tracker_diesel",
                              columns: ["date", "ipp", "anp_reference", "anp_commercialization", "petrobras"],
                            });
                          } finally {
                            setCsvLoading(false);
                          }
                        },
                      },
                    ]}
                  />
                }
              />

              {/* Section: Subsidy Tracker chart */}
              <h5 className="section-title" style={{ marginBottom: 4, color: "#000000" }}>
                Diesel Subsidy Tracker
              </h5>
              <hr className="section-hr" style={{ marginBottom: 0 }} />

              {initialLoading ? (
                <BarrelLoading />
              ) : (
                <div style={{ marginTop: 16 }}>
                  <PlotlyChart
                    data={chart.data}
                    layout={chart.layout}
                    config={{ displayModeBar: false }}
                  />
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
