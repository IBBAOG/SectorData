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

import { useMemo, useState } from "react";
import type { Annotations, Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import { useModuleVisibilityGuard } from "../../../hooks/useModuleVisibilityGuard";
import { useRpcResult } from "../../../hooks/useRpcResult";
import PlotlyChart from "../../../components/PlotlyChart";
import DashboardHeader from "../../../components/dashboard/DashboardHeader";
import ExportPanel from "../../../components/dashboard/ExportPanel";
import BarrelLoading from "../../../components/dashboard/BarrelLoading";
import DataErrorBoundary from "../../../components/dashboard/DataErrorBoundary";
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

// Hardcoded floor for the chart window — no UI to change this.
const MIN_DATE = "2026-02-01";

// ── Regional hover formatter ──────────────────────────────────────────────────
// Produces a single-line breakdown e.g.
//   "NORTE: 5.21 - NORDESTE: 5.30 - CENTRO-OESTE: 5.15 - SUDESTE: 5.21 - SUL: 5.18"
// for points that have a `regions` payload; returns the explicit
// "No regional breakdown" sentinel otherwise so the hover never renders blank
// or `NaN` cells.
const REGION_ORDER = [
  "NORTE",
  "NORDESTE",
  "CENTRO-OESTE",
  "SUDESTE",
  "SUL",
] as const;

function formatRegions(regions: Record<string, number | null> | null): string {
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

// ── Chart builder ─────────────────────────────────────────────────────────────

function buildChart(
  rows: SubsidyTrackerRow[],
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows
    .filter((r) => r.date >= MIN_DATE)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (filtered.length === 0) {
    return emptyPlot(420, "No data available");
  }

  const dates = filtered.map((r) => r.date);

  // ── Regional hover for ANP Reference ────────────────────────────────────
  // We pre-build the breakdown string per point. Plotly's hovertemplate cannot
  // conditionally suppress its own substitution lines, so feeding it raw
  // `regions` objects (with possible null entries for days that have no ETL
  // extraction yet) produces blank/NaN cells. Building the string up front
  // keeps a single `%{customdata}` token and renders the explicit
  // "No regional breakdown" sentinel for null days.
  const regionCustomdata = filtered.map((r) => formatRegions(r.regions ?? null));

  const referenceHover =
    "<b>%{x}</b><br>" +
    "ANP Reference: R$ %{y:.2f}/L<br><br>" +
    "%{customdata}<extra></extra>";

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
        hovertemplate: referenceHover,
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

  // ── End-of-line value annotations ───────────────────────────────────────
  // For each trace, find the last non-null point and render a small label
  // anchored to the right of it. Labels sit exactly at each line's Y value;
  // if two values overlap because they're equal, that's acceptable.
  const annotations: Partial<Annotations>[] = SERIES.flatMap((s) => {
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
          text: val.toFixed(2),
          showarrow: false,
          font: { size: 11, color: s.color, family: "Arial" },
        }];
      }
    }
    return [];
  });

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
      margin: { t: 20, b: 110, l: 65, r: 90 },
      annotations,
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SubsidyTrackerPage() {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("subsidy-tracker");
  const supabase = getSupabaseClient();

  const [excelLoading, setExcelLoading] = useState(false);
  const [csvLoading, setCsvLoading]     = useState(false);

  // RPC fetch with explicit error state. Replaces the previous
  // `useDebouncedFetch` usage so that failures surface via `<DataErrorBoundary>`
  // instead of freezing the page in its loading state (CLAUDE.md pegadinha #2).
  const {
    data: rows,
    loading: rpcLoading,
    error: rpcError,
    refetch: rpcRefetch,
  } = useRpcResult<SubsidyTrackerRow[]>(
    async () => {
      if (!supabase) return [];
      return rpcGetSubsidyTrackerDiesel(supabase);
    },
    [supabase],
    [],
  );

  // First-load spinner is shown while the very first fetch is in flight AND
  // we have no rows yet. Subsequent refetches keep the existing chart visible.
  const initialLoading = rpcLoading && rows.length === 0 && rpcError == null;

  const chart = useMemo(() => buildChart(rows), [rows]);

  if (visLoading || !visible) return null;

  return (
    <div>
      <NavBar />

      <div className="container-fluid g-0 p-4">
        <DashboardHeader
          title="Subsidy Tracker"
          sub="Diesel — ANP Reference & Commercialization Price vs IPP & Petrobras (BRL/Liter)"
          lang="en"
          rightSlot={
            <ExportPanel
              actions={[
                {
                  kind: "excel",
                  label: "formatted data .xl",
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

        <DataErrorBoundary
          error={rpcError}
          loading={rpcLoading}
          retry={rpcRefetch}
        >
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
        </DataErrorBoundary>
      </div>
    </div>
  );
}
