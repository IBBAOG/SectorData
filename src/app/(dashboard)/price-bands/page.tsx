"use client";

import { useEffect, useMemo, useState } from "react";
import type { Annotations, Layout, PlotData } from "plotly.js";

import NavBar from "../../../components/NavBar";
import PlotlyChart from "../../../components/PlotlyChart";
import { getSupabaseClient } from "../../../lib/supabaseClient";
import { rpcGetPriceBandsData, type PriceBandsRow } from "../../../lib/rpc";

// ── Colors ────────────────────────────────────────────────────────────────────

const COLOR_IMPORT  = "#E8611A";   // orange  — IBBA/BBA Import Parity
const COLOR_EXPORT  = "#1a1a1a";   // black   — IBBA/BBA Export Parity
const COLOR_PETRO   = "#4ECDC4";   // teal    — Petrobras Price

// ── Chart builder ─────────────────────────────────────────────────────────────

interface SeriesDef {
  label: string;
  field: keyof PriceBandsRow;
  color: string;
  dash: "solid" | "dash";
  shape: "linear" | "hv";
  width: number;
}

function buildPriceBandsChart(
  rows: PriceBandsRow[],
  product: "Gasoline" | "Diesel"
): { data: PlotData[]; layout: Partial<Layout> } {
  const filtered = rows
    .filter((r) => r.product === product)
    .sort((a, b) => a.date.localeCompare(b.date));

  const seriesDefs: SeriesDef[] =
    product === "Gasoline"
      ? [
          { label: "IBBA - Import Parity",  field: "bba_import_parity",  color: COLOR_IMPORT, dash: "solid", shape: "linear", width: 1.5 },
          { label: "IBBA - Export Parity",  field: "bba_export_parity",  color: COLOR_EXPORT, dash: "solid", shape: "linear", width: 1.5 },
          { label: "Petrobras Price",        field: "petrobras_price",    color: COLOR_PETRO,  dash: "solid", shape: "hv",     width: 2   },
        ]
      : [
          { label: "BBA - Import Parity",            field: "bba_import_parity",           color: COLOR_IMPORT, dash: "solid", shape: "linear", width: 1.5 },
          { label: "BBA - Import Parity w/ subsidy", field: "bba_import_parity_w_subsidy", color: COLOR_IMPORT, dash: "dash",  shape: "linear", width: 1.5 },
          { label: "BBA - Export Parity",            field: "bba_export_parity",           color: COLOR_EXPORT, dash: "solid", shape: "linear", width: 1.5 },
          { label: "Petrobras Price",                field: "petrobras_price",             color: COLOR_PETRO,  dash: "solid", shape: "hv",     width: 2   },
        ];

  const dates = filtered.map((r) => r.date);

  const traces: PlotData[] = seriesDefs.map((s) => {
    const yVals = filtered.map((r) => r[s.field] as number | null);
    return {
      type: "scatter",
      mode: "lines",
      name: s.label,
      x: dates,
      y: yVals,
      line: { color: s.color, dash: s.dash, shape: s.shape, width: s.width },
      hovertemplate: `%{fullData.name}: R$ %{y:.2f}<extra></extra>`,
    } as unknown as PlotData;
  });

  // End-of-line annotations (last non-null value per series)
  const annotations: Partial<Annotations>[] = seriesDefs.flatMap((s) => {
    for (let i = filtered.length - 1; i >= 0; i--) {
      const val = filtered[i][s.field] as number | null;
      if (val != null) {
        return [
          {
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
          },
        ];
      }
    }
    return [];
  });

  const layout: Partial<Layout> = {
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    font: { family: "Arial", size: 12, color: "#000000" },
    xaxis: {
      type: "date",
      tickformat: "%b-%y",
      tickangle: -90,
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
    margin: { t: 20, b: 110, l: 65, r: 85 },
    annotations,
  };

  return { data: traces, layout };
}

// ── Badge component ───────────────────────────────────────────────────────────

function PctBadge({
  pct,
  vs,
  outlined,
}: {
  pct: number;
  vs: string;
  outlined?: boolean;
}) {
  const sign = pct >= 0 ? "+" : "";
  const label = `${sign}${pct.toFixed(1)}% vs. ${vs}`;

  if (outlined) {
    return (
      <span
        style={{
          border: "1px solid #1a1a1a",
          color: "#1a1a1a",
          background: "white",
          borderRadius: 4,
          padding: "2px 8px",
          fontSize: 12,
          fontFamily: "Arial",
          marginLeft: 8,
          fontWeight: 600,
        }}
      >
        {label}
      </span>
    );
  }

  return (
    <span
      style={{
        background: COLOR_IMPORT,
        color: "white",
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 12,
        fontFamily: "Arial",
        marginLeft: 8,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
  );
}

// ── Chart title with badges ───────────────────────────────────────────────────

function ChartHeader({
  product,
  rows,
}: {
  product: "Gasoline" | "Diesel";
  rows: PriceBandsRow[];
}) {
  // Find last row with all three relevant values
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const last = sorted.find(
    (r) => r.petrobras_price != null && r.bba_import_parity != null && r.bba_export_parity != null
  );

  const pctIpp =
    last && last.petrobras_price != null && last.bba_import_parity != null
      ? ((last.petrobras_price / last.bba_import_parity) - 1) * 100
      : null;

  const pctEpp =
    last && last.petrobras_price != null && last.bba_export_parity != null
      ? ((last.petrobras_price / last.bba_export_parity) - 1) * 100
      : null;

  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 8, marginTop: 24 }}>
      <span
        style={{
          fontFamily: "Arial",
          fontSize: 14,
          fontWeight: 700,
          color: "#1a1a1a",
        }}
      >
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
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const gasolineRows = useMemo(
    () => rows.filter((r) => r.product === "Gasoline"),
    [rows]
  );
  const dieselRows = useMemo(
    () => rows.filter((r) => r.product === "Diesel"),
    [rows]
  );

  const gasolineChart = useMemo(
    () => buildPriceBandsChart(rows, "Gasoline"),
    [rows]
  );
  const dieselChart = useMemo(
    () => buildPriceBandsChart(rows, "Diesel"),
    [rows]
  );

  return (
    <div>
      <NavBar />

      <div className="container-fluid" style={{ padding: "0 24px" }}>
        <div className="row" style={{ marginTop: 24 }}>
          <div className="col-12">
            <h5 className="section-title" style={{ marginBottom: 4 }}>
              PRICE BANDS
            </h5>
            <hr className="section-hr" style={{ marginBottom: 0 }} />

            {loading ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  height: 300,
                }}
              >
                <div className="spinner-border text-secondary" role="status">
                  <span className="visually-hidden">Loading…</span>
                </div>
              </div>
            ) : (
              <>
                {/* Gasoline chart */}
                <ChartHeader product="Gasoline" rows={gasolineRows} />
                <PlotlyChart
                  data={gasolineChart.data}
                  layout={gasolineChart.layout}
                />

                {/* Diesel chart */}
                <ChartHeader product="Diesel" rows={dieselRows} />
                <PlotlyChart
                  data={dieselChart.data}
                  layout={dieselChart.layout}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
