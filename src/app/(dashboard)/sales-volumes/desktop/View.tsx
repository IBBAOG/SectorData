"use client";

// Desktop view — verbatim move of the former page.tsx.
// All data / filter / RPC logic lives in ../useSalesVolumesData.ts.
// This file owns only the desktop UX (sidebar + multi-column grid).

import type { Layout, PlotData } from "plotly.js";
import { useMemo } from "react";

import NavBar from "../../../../components/NavBar";
import BrandLogo from "../../../../components/BrandLogo";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import PlotlyChart from "../../../../components/PlotlyChart";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import SegmentedToggle from "../../../../components/dashboard/SegmentedToggle";
import ExportPanel from "../../../../components/dashboard/ExportPanel";
import ExportModal from "../../../../components/dashboard/ExportModal";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import CheckList from "../../../../components/CheckList";
import SearchableMultiSelect from "../../../../components/SearchableMultiSelect";
import RegionStateFilter from "../../../../components/RegionStateFilter";
import {
  useSalesVolumesData,
  SV_MODE_OPTIONS,
  BIG3_MEMBERS,
  COLORS_BIG3,
  COLORS_IND,
  ALL_PLAYERS_IND,
  ALL_PLAYERS_BIG3,
  buildSvComparisonData,
  type SvMode,
  type SvCompRow,
} from "../useSalesVolumesData";
import type { MsSerieRow } from "../../../../lib/rpc";

// ─── Pure helpers (no hooks) ─────────────────────────────────────────────────

const _NO_DATA = "No data for the selected filters.";

function emptyPlot(height = 300): { data: PlotData[]; layout: Partial<Layout> } {
  return {
    data: [],
    layout: {
      paper_bgcolor: "white",
      plot_bgcolor: "white",
      xaxis: { visible: false },
      yaxis: { visible: false },
      annotations: [
        {
          text: _NO_DATA,
          xref: "paper",
          yref: "paper",
          showarrow: false,
          font: { size: 13, family: "Arial", color: "#888" },
        },
      ],
      height,
      margin: { t: 20, b: 30, l: 10, r: 10 },
    },
  };
}

function buildSalesVolumeLine(params: {
  serieRows: MsSerieRow[];
  produto: string;
  segmento?: string | null;
  players: string[];
  big3: boolean;
  xMin?: string | null;
  xMax?: string | null;
  groupBy?: "classificacao" | "agente_regulado";
  colorsOverride?: Record<string, string>;
}): { data: PlotData[]; layout: Partial<Layout> } {
  const {
    serieRows,
    produto,
    segmento = null,
    players,
    big3,
    xMin,
    xMax,
    groupBy = "classificacao",
    colorsOverride,
  } = params;
  if (!serieRows || serieRows.length === 0) return emptyPlot(300);

  let rows = serieRows.filter((r) => r.nome_produto === produto);
  if (segmento) rows = rows.filter((r) => r.segmento === segmento);
  if (rows.length === 0) return emptyPlot(300);

  const groupMap = new Map<string, number>();
  for (const r of rows) {
    let classificacao =
      groupBy === "agente_regulado"
        ? (r.agente_regulado ?? r.classificacao)
        : r.classificacao;
    if (big3 && groupBy !== "agente_regulado")
      classificacao = (BIG3_MEMBERS as readonly string[]).includes(classificacao)
        ? "Big-3"
        : classificacao;
    const key = `${String(r.date)}|${classificacao}`;
    groupMap.set(key, (groupMap.get(key) ?? 0) + Number(r.quantidade ?? 0));
  }

  const grouped: Array<{ date: string; classificacao: string; volume: number }> = [];
  for (const [key, qty] of groupMap.entries()) {
    const [date, classificacao] = key.split("|");
    if (!players.includes(classificacao)) continue;
    grouped.push({ date, classificacao, volume: qty });
  }
  if (grouped.length === 0) return emptyPlot(300);

  grouped.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const yVals = grouped.map((g) => g.volume);
  const yMin = Math.min(...yVals);
  const yMax = Math.max(...yVals);
  const spread = yMax - yMin > 0 ? yMax - yMin : 1.0;
  const pad = spread * 0.2;
  const yLo = Math.max(0, yMin - pad);
  const yHi = yMax + pad;

  const ultimaData = grouped[grouped.length - 1].date;
  const colorsMap = colorsOverride ?? (big3 ? COLORS_BIG3 : COLORS_IND);

  const traces: PlotData[] = [];
  const annotations: Array<{
    x: string; y: number; text: string; showarrow: false;
    xanchor: "left"; xshift: number; yanchor: "middle";
    font: { family: string; size: number; color: string };
  }> = [];

  for (const player of players) {
    const series = grouped.filter((g) => g.classificacao === player);
    if (series.length === 0) continue;
    traces.push({
      type: "scatter",
      mode: "lines",
      x: series.map((s) => s.date),
      y: series.map((s) => s.volume),
      name: player,
      line: { width: 2.5, color: colorsMap[player] ?? "#000000" },
      hovertemplate: "%{fullData.name}: %{y:,.1f} thousand m³<extra></extra>",
    } as PlotData);

    const last = series.find((s) => s.date === ultimaData);
    if (last) {
      annotations.push({
        x: ultimaData, y: last.volume, text: last.volume.toFixed(1),
        showarrow: false, xanchor: "left", xshift: 6, yanchor: "middle",
        font: { family: "Arial", size: 12, color: colorsMap[player] ?? "#000000" },
      });
    }
  }

  const allDates = traces.flatMap((t) => (t.x as string[]) ?? []).sort();
  const dataMin = allDates[0];
  const dataMax = allDates[allDates.length - 1];

  return {
    data: traces,
    layout: {
      title: { text: "" },
      margin: { t: 10, b: 80, l: 60, r: 75 },
      font: { family: "Arial", size: 12, color: "#000000" },
      yaxis: {
        title: { text: "Volume (thousand m³)" },
        range: [yLo, yHi], nticks: 10, showgrid: false,
        zeroline: false, showline: true, linecolor: "#000000", linewidth: 1,
      },
      xaxis: {
        title: { text: "" }, tickformat: "%b-%y", tickangle: -90,
        tickmode: "auto", nticks: 12, automargin: true,
        showgrid: false, zeroline: false, showline: true,
        linecolor: "#000000", linewidth: 1, type: "date",
        range: [xMin ?? dataMin, xMax ?? dataMax],
        showspikes: true, spikemode: "across" as const,
        spikedash: "solid", spikecolor: "#555555", spikethickness: 1,
      },
      legend: { orientation: "h", yanchor: "top", y: -0.28, xanchor: "center", x: 0.5 },
      hoverlabel: {
        bgcolor: "rgba(255,255,255,0.95)", bordercolor: "rgba(180,180,180,0.5)",
        font: { family: "Arial", color: "#1a1a1a", size: 12 }, namelength: -1,
      },
      plot_bgcolor: "white", paper_bgcolor: "white", height: 300,
      hovermode: "x unified", annotations,
    },
  };
}

function ComparisonTable({ rows, colors }: { rows: SvCompRow[]; colors: Record<string, string> }) {
  void colors; // accepted for API symmetry with Market Share
  const fmt = (v: number | null) => v === null ? "—" : (v > 0 ? "+" : "") + v.toFixed(1);
  const cellStyle = (v: number | null) => ({
    backgroundColor: v === null ? "transparent" : v > 0 ? "#C6E8D9" : v < 0 ? "#FFDDCC" : "transparent",
    color: v === null ? "#bbb" : "#1a1a1a",
    textAlign: "center" as const, padding: "2px 10px", fontSize: 11,
    fontFamily: "Arial", whiteSpace: "nowrap" as const, fontWeight: 400, border: "none",
  });
  const thStyle = {
    fontFamily: "Arial", fontSize: 10, fontWeight: 700, color: "#ffffff",
    backgroundColor: "#000512", textAlign: "center" as const, padding: "4px 10px", border: "none",
  };
  return (
    <table style={{ borderCollapse: "collapse", width: "100%", margin: "6px 0 0 0", tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: "30%" }} />
        <col style={{ width: "17.5%" }} />
        <col style={{ width: "17.5%" }} />
        <col style={{ width: "17.5%" }} />
        <col style={{ width: "17.5%" }} />
      </colgroup>
      <thead>
        <tr>
          <th style={{ ...thStyle, textAlign: "left" as const, paddingLeft: 8 }}>Volume Var. (thousand m³)</th>
          <th style={thStyle}>MoM</th>
          <th style={thStyle}>QTD</th>
          <th style={thStyle}>YoY</th>
          <th style={thStyle}>YTD</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.player} style={i === rows.length - 1 ? { borderBottom: "2px solid #d0d0d0" } : {}}>
            <td style={{ fontFamily: "Arial", fontSize: 11, color: "#1a1a1a", fontWeight: 400, padding: "2px 12px 2px 8px", whiteSpace: "nowrap" as const, border: "none" }}>{row.player}</td>
            <td style={cellStyle(row.mom)}>{fmt(row.mom)}</td>
            <td style={cellStyle(row.q3m)}>{fmt(row.q3m)}</td>
            <td style={cellStyle(row.yoy)}>{fmt(row.yoy)}</td>
            <td style={cellStyle(row.ytd)}>{fmt(row.ytd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Desktop View ─────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("sales");

  const sv = useSalesVolumesData();

  const {
    serieRows, opcoes, datas, seriesLoading,
    ottoCycleRows, players, chartColors, groupBy, big3, latestDate,
    regioesAll, ufsAll, mercadosAll,
    sliderRange, setSliderRange,
    mode, setMode,
    competidoresSelected, setCompetidoresSelected,
    regioesSelected, setRegioesSelected,
    ufsSelected, setUfsSelected,
    applyFilters, clearFilters,
    exportOpen, openExportModal, closeExportModal,
    exportRange, setExportRange,
    exportRegioes, setExportRegioes,
    exportUfs, setExportUfs,
    exportMercados, setExportMercados,
    exportFilters, fetchExportCount,
    excelLoading, csvLoading, onExportExcel, onExportCsv,
    showToast,
  } = sv;

  // Players list for the sidebar competitor filter (from live series data).
  const othersPlayersSidebar = useMemo(() => {
    const seen = new Set<string>();
    for (const r of serieRows) if (r.agente_regulado) seen.add(r.agente_regulado);
    return Array.from(seen).sort();
  }, [serieRows]);

  const playersOptions: string[] =
    mode === "Big-3" ? ALL_PLAYERS_BIG3 :
    mode === "Others" ? othersPlayersSidebar :
    ALL_PLAYERS_IND;

  const charts = useMemo(() => {
    const common = { players, big3, xMin: null as string | null, xMax: null as string | null, groupBy, colorsOverride: chartColors };
    return {
      dieselRetail: buildSalesVolumeLine({ serieRows, produto: "Diesel B",         segmento: "Retail", ...common }),
      dieselB2B:    buildSalesVolumeLine({ serieRows, produto: "Diesel B",         segmento: "B2B",    ...common }),
      dieselTrR:    buildSalesVolumeLine({ serieRows, produto: "Diesel B",         segmento: "TRR",    ...common }),
      dieselTotal:  buildSalesVolumeLine({ serieRows, produto: "Diesel B",         segmento: null,     ...common }),
      gasRetail:    buildSalesVolumeLine({ serieRows, produto: "Gasolina C",       segmento: "Retail", ...common }),
      gasB2B:       buildSalesVolumeLine({ serieRows, produto: "Gasolina C",       segmento: "B2B",    ...common }),
      gasTotal:     buildSalesVolumeLine({ serieRows, produto: "Gasolina C",       segmento: null,     ...common }),
      ethRetail:    buildSalesVolumeLine({ serieRows, produto: "Etanol Hidratado", segmento: "Retail", ...common }),
      ethB2B:       buildSalesVolumeLine({ serieRows, produto: "Etanol Hidratado", segmento: "B2B",    ...common }),
      ethTotal:     buildSalesVolumeLine({ serieRows, produto: "Etanol Hidratado", segmento: null,     ...common }),
      ottoRetail:   buildSalesVolumeLine({ serieRows: ottoCycleRows, produto: "Otto-Cycle", segmento: "Retail", ...common }),
      ottoB2B:      buildSalesVolumeLine({ serieRows: ottoCycleRows, produto: "Otto-Cycle", segmento: "B2B",    ...common }),
      ottoTotal:    buildSalesVolumeLine({ serieRows: ottoCycleRows, produto: "Otto-Cycle", segmento: null,     ...common }),
    };
  }, [serieRows, ottoCycleRows, players, big3, groupBy, chartColors]);

  const compData = useMemo(() => {
    if (!latestDate) return null;
    return {
      dieselRetail: buildSvComparisonData(serieRows, "Diesel B", "Retail", players, big3, latestDate, groupBy),
      dieselB2B:    buildSvComparisonData(serieRows, "Diesel B", "B2B",    players, big3, latestDate, groupBy),
      dieselTrR:    buildSvComparisonData(serieRows, "Diesel B", "TRR",    players, big3, latestDate, groupBy),
      dieselTotal:  buildSvComparisonData(serieRows, "Diesel B", null,     players, big3, latestDate, groupBy),
      gasRetail:    buildSvComparisonData(serieRows, "Gasolina C", "Retail", players, big3, latestDate, groupBy),
      gasB2B:       buildSvComparisonData(serieRows, "Gasolina C", "B2B",   players, big3, latestDate, groupBy),
      gasTotal:     buildSvComparisonData(serieRows, "Gasolina C", null,    players, big3, latestDate, groupBy),
      ethRetail:    buildSvComparisonData(serieRows, "Etanol Hidratado", "Retail", players, big3, latestDate, groupBy),
      ethB2B:       buildSvComparisonData(serieRows, "Etanol Hidratado", "B2B",   players, big3, latestDate, groupBy),
      ethTotal:     buildSvComparisonData(serieRows, "Etanol Hidratado", null,    players, big3, latestDate, groupBy),
      ottoRetail:   buildSvComparisonData(ottoCycleRows, "Otto-Cycle", "Retail", players, big3, latestDate, groupBy),
      ottoB2B:      buildSvComparisonData(ottoCycleRows, "Otto-Cycle", "B2B",   players, big3, latestDate, groupBy),
      ottoTotal:    buildSvComparisonData(ottoCycleRows, "Otto-Cycle", null,    players, big3, latestDate, groupBy),
    };
  }, [serieRows, ottoCycleRows, players, big3, latestDate, groupBy]);

  if (!opcoes) return <></>;
  if (visLoading || !visible) return <></>;

  const fmtMonthLabel = (d: string) => {
    try {
      const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${MONTHS[parseInt(d.slice(5,7),10)-1]}, ${d.slice(0,4)}`;
    } catch { return d; }
  };

  return (
    <div>
      <NavBar />

      {showToast && (
        <div
          className="alert alert-success"
          role="alert"
          style={{ fontFamily: "Arial", fontSize: 13, padding: "10px 14px", border: "none", boxShadow: "0 2px 10px rgba(0,0,0,0.08)" }}
        >
          Filters applied!
        </div>
      )}

      <div className="container-fluid g-0">
        <div className="row g-0">
          {/* ── Sidebar ─────────────────────────────────────────────────────── */}
          <div className="col-xxl-2 col-md-3 p-0" style={{ display: "flex", flexDirection: "column" }}>
            <div id="sidebar">
              <div style={{ textAlign: "center" }}><BrandLogo variant="sidebar" /></div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                <PeriodSlider dates={datas} value={sliderRange} onChange={setSliderRange} sliderId="sv-slider-period" fmtLabel={fmtMonthLabel} />
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">View Mode</div>
                <SegmentedToggle
                  options={SV_MODE_OPTIONS.map((m) => ({ value: m, label: m }))}
                  value={mode}
                  onChange={(v) => setMode(v as SvMode)}
                />
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Competitors</div>
                {mode === "Others" ? (
                  <SearchableMultiSelect options={playersOptions} value={competidoresSelected} onChange={setCompetidoresSelected} />
                ) : (
                  <CheckList label="Competitors" options={playersOptions} value={competidoresSelected} onChange={setCompetidoresSelected} allLabel="All" clearLabel="Clear" />
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Region / State</div>
                <RegionStateFilter regioes={regioesAll} ufs={ufsAll} selectedRegioes={regioesSelected} selectedUfs={ufsSelected} onRegioesChange={setRegioesSelected} onUfsChange={setUfsSelected} />
              </div>

              <div className="row g-1 mt-1">
                <div className="col-6"><button type="button" className="btn btn-apply" onClick={applyFilters}>Apply</button></div>
                <div className="col-6"><button type="button" className="btn btn-clear" onClick={clearFilters}>Clear</button></div>
              </div>
            </div>
          </div>

          {/* ── Main content ────────────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="Brazil Fuel Distribution Sales Volumes"
                sub="Temporal evolution of sales volume by distributor (thousand m³)"
                lang="en"
                hideDivider
                rightSlot={
                  <ExportPanel
                    actions={[
                      { kind: "excel", label: "formatted data .xl", disabled: seriesLoading || excelLoading || csvLoading, onClick: openExportModal },
                      { kind: "csv",   label: "all data .csv",      disabled: seriesLoading || excelLoading || csvLoading, onClick: openExportModal },
                    ]}
                  />
                }
              />

              {seriesLoading ? <BarrelLoading /> : (
                <>
                  {/* ── Diesel B ──────────────────────────────────────────── */}
                  <div style={{ marginBottom: 10 }}><div className="section-title" style={{ color: "#1a1a1a" }}>Diesel B</div><hr className="section-hr" /></div>
                  <div className="row g-3">
                    <div className="col-md-6"><div className="chart-container">
                      <div className="section-title" style={{ fontSize: 15 }}>Retail</div><hr className="section-hr" />
                      <PlotlyChart data={charts.dieselRetail.data} layout={charts.dieselRetail.layout} config={{ displayModeBar: false }} style={{ width: "100%", height: 300 }} />
                      {compData && <ComparisonTable rows={compData.dieselRetail} colors={chartColors} />}
                    </div></div>
                    <div className="col-md-6"><div className="chart-container">
                      <div className="section-title" style={{ fontSize: 15 }}>B2B</div><hr className="section-hr" />
                      <PlotlyChart data={charts.dieselB2B.data} layout={charts.dieselB2B.layout} config={{ displayModeBar: false }} style={{ width: "100%", height: 300 }} />
                      {compData && <ComparisonTable rows={compData.dieselB2B} colors={chartColors} />}
                    </div></div>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6"><div className="chart-container">
                      <div className="section-title" style={{ fontSize: 15 }}>TRR</div><hr className="section-hr" />
                      <PlotlyChart data={charts.dieselTrR.data} layout={charts.dieselTrR.layout} config={{ displayModeBar: false }} style={{ width: "100%", height: 300 }} />
                      {compData && <ComparisonTable rows={compData.dieselTrR} colors={chartColors} />}
                    </div></div>
                    <div className="col-md-6"><div className="chart-container">
                      <div className="section-title" style={{ fontSize: 15 }}>Total</div><hr className="section-hr" />
                      <PlotlyChart data={charts.dieselTotal.data} layout={charts.dieselTotal.layout} config={{ displayModeBar: false }} style={{ width: "100%", height: 300 }} />
                      {compData && <ComparisonTable rows={compData.dieselTotal} colors={chartColors} />}
                    </div></div>
                  </div>

                  <hr style={{ borderTop: "1px solid #e0e0e0", margin: "20px 0" }} />

                  {/* ── Gasoline C ────────────────────────────────────────── */}
                  <div style={{ marginBottom: 10 }}><div className="section-title" style={{ color: "#1a1a1a" }}>Gasoline C</div><hr className="section-hr" /></div>
                  <div className="row g-3">
                    <div className="col-md-6"><div className="chart-container">
                      <div className="section-title" style={{ fontSize: 15 }}>Retail</div><hr className="section-hr" />
                      <PlotlyChart data={charts.gasRetail.data} layout={charts.gasRetail.layout} config={{ displayModeBar: false }} style={{ width: "100%", height: 300 }} />
                      {compData && <ComparisonTable rows={compData.gasRetail} colors={chartColors} />}
                    </div></div>
                    <div className="col-md-6"><div className="chart-container">
                      <div className="section-title" style={{ fontSize: 15 }}>B2B</div><hr className="section-hr" />
                      <PlotlyChart data={charts.gasB2B.data} layout={charts.gasB2B.layout} config={{ displayModeBar: false }} style={{ width: "100%", height: 300 }} />
                      {compData && <ComparisonTable rows={compData.gasB2B} colors={chartColors} />}
                    </div></div>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6"><div className="chart-container">
                      <div className="section-title" style={{ fontSize: 15 }}>Total</div><hr className="section-hr" />
                      <PlotlyChart data={charts.gasTotal.data} layout={charts.gasTotal.layout} config={{ displayModeBar: false }} style={{ width: "100%", height: 300 }} />
                      {compData && <ComparisonTable rows={compData.gasTotal} colors={chartColors} />}
                    </div></div>
                  </div>

                  <hr style={{ borderTop: "1px solid #e0e0e0", margin: "20px 0" }} />

                  {/* ── Hydrous Ethanol ───────────────────────────────────── */}
                  <div style={{ marginBottom: 10 }}><div className="section-title" style={{ color: "#1a1a1a" }}>Hydrous Ethanol</div><hr className="section-hr" /></div>
                  <div className="row g-3">
                    <div className="col-md-6"><div className="chart-container">
                      <div className="section-title" style={{ fontSize: 15 }}>Retail</div><hr className="section-hr" />
                      <PlotlyChart data={charts.ethRetail.data} layout={charts.ethRetail.layout} config={{ displayModeBar: false }} style={{ width: "100%", height: 300 }} />
                      {compData && <ComparisonTable rows={compData.ethRetail} colors={chartColors} />}
                    </div></div>
                    <div className="col-md-6"><div className="chart-container">
                      <div className="section-title" style={{ fontSize: 15 }}>B2B</div><hr className="section-hr" />
                      <PlotlyChart data={charts.ethB2B.data} layout={charts.ethB2B.layout} config={{ displayModeBar: false }} style={{ width: "100%", height: 300 }} />
                      {compData && <ComparisonTable rows={compData.ethB2B} colors={chartColors} />}
                    </div></div>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6"><div className="chart-container">
                      <div className="section-title" style={{ fontSize: 15 }}>Total</div><hr className="section-hr" />
                      <PlotlyChart data={charts.ethTotal.data} layout={charts.ethTotal.layout} config={{ displayModeBar: false }} style={{ width: "100%", height: 300 }} />
                      {compData && <ComparisonTable rows={compData.ethTotal} colors={chartColors} />}
                    </div></div>
                  </div>

                  <hr style={{ borderTop: "1px solid #e0e0e0", margin: "20px 0" }} />

                  {/* ── Otto-Cycle ────────────────────────────────────────── */}
                  <div style={{ marginBottom: 10 }}><div className="section-title" style={{ color: "#1a1a1a" }}>Otto-Cycle</div><hr className="section-hr" /></div>
                  <div className="row g-3">
                    <div className="col-md-6"><div className="chart-container">
                      <div className="section-title" style={{ fontSize: 15 }}>Retail</div><hr className="section-hr" />
                      <PlotlyChart data={charts.ottoRetail.data} layout={charts.ottoRetail.layout} config={{ displayModeBar: false }} style={{ width: "100%", height: 300 }} />
                      {compData && <ComparisonTable rows={compData.ottoRetail} colors={chartColors} />}
                    </div></div>
                    <div className="col-md-6"><div className="chart-container">
                      <div className="section-title" style={{ fontSize: 15 }}>B2B</div><hr className="section-hr" />
                      <PlotlyChart data={charts.ottoB2B.data} layout={charts.ottoB2B.layout} config={{ displayModeBar: false }} style={{ width: "100%", height: 300 }} />
                      {compData && <ComparisonTable rows={compData.ottoB2B} colors={chartColors} />}
                    </div></div>
                  </div>
                  <div className="row g-3">
                    <div className="col-md-6"><div className="chart-container">
                      <div className="section-title" style={{ fontSize: 15 }}>Total</div><hr className="section-hr" />
                      <PlotlyChart data={charts.ottoTotal.data} layout={charts.ottoTotal.layout} config={{ displayModeBar: false }} style={{ width: "100%", height: 300 }} />
                      {compData && <ComparisonTable rows={compData.ottoTotal} colors={chartColors} />}
                    </div></div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Export Modal ───────────────────────────────────────────────────────── */}
      <ExportModal
        open={exportOpen}
        onClose={closeExportModal}
        title="Export — Sales Volumes"
        datasetKey="vendas"
        currentFilters={exportFilters}
        countFetcher={fetchExportCount}
        excelBusy={excelLoading}
        csvBusy={csvLoading}
        loadingLabel={excelLoading ? "Generating Excel..." : "Downloading CSV..."}
        onExportExcel={onExportExcel}
        onExportCsv={onExportCsv}
        filters={
          <div style={{ display: "flex", flexDirection: "column", gap: 14, fontFamily: "Arial" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Period</div>
              {datas.length > 0 && (
                <PeriodSlider dates={datas} value={exportRange} onChange={setExportRange} sliderId="sv-export-slider" fmtLabel={fmtMonthLabel} />
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Regions</div>
                <CheckList label="Regions" options={regioesAll} value={exportRegioes} onChange={setExportRegioes} allLabel="All" clearLabel="Clear" />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>States</div>
                <SearchableMultiSelect options={ufsAll} value={exportUfs} onChange={setExportUfs} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: "0.4px" }}>Markets</div>
              <CheckList label="Markets" options={mercadosAll} value={exportMercados} onChange={setExportMercados} allLabel="All" clearLabel="Clear" />
            </div>
          </div>
        }
      />
    </div>
  );
}
