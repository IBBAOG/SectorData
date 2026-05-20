"use client";

// Desktop view for /anp-ppi — verbatim move of the original page.tsx body,
// with all data plumbing replaced by reads from useAnpPpiData.
//
// Binding sync rule: any meaningful change here (new filter, chart, KPI, copy)
// must land in mobile/View.tsx in the SAME commit, or the commit message must
// declare [desktop-only] with an explicit reason. See CLAUDE.md § Dual-view.

import { useMemo } from "react";
import type { Layout, PlotData } from "plotly.js";

import NavBar from "../../../../components/NavBar";
import BrandLogo from "../../../../components/BrandLogo";
import PlotlyChart from "../../../../components/PlotlyChart";
import DashboardHeader from "../../../../components/dashboard/DashboardHeader";
import MultiSelectFilter from "../../../../components/dashboard/MultiSelectFilter";
import PeriodSlider from "../../../../components/dashboard/PeriodSlider";
import ChartSection from "../../../../components/dashboard/ChartSection";
import BarrelLoading from "../../../../components/dashboard/BarrelLoading";
import ExportPanel from "../../../../components/dashboard/ExportPanel";
import { useModuleVisibilityGuard } from "../../../../hooks/useModuleVisibilityGuard";
import { COMMON_LAYOUT, AXIS_LINE, emptyPlot } from "../../../../lib/plotlyDefaults";
import { downloadGenericExcel } from "../../../../lib/exportExcel";
import { downloadCsv } from "../../../../lib/exportCsv";
import type { AnpPpiSerieRow, AnpPpiLocaisRow } from "../../../../lib/rpc";

import {
  useAnpPpiData,
  PRODUTO_INFO,
  ALL_PRODUTOS,
} from "../useAnpPpiData";

// ── Chart helpers ──────────────────────────────────────────────────────────────

function buildMediaChart(
  rows: AnpPpiSerieRow[],
  produtos: string[],
  yearRange: [number, number],
  allYears: number[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!allYears.length) return emptyPlot(300);
  const yMin = allYears[yearRange[0]];
  const yMax = allYears[yearRange[1]];
  const filtered = rows.filter((r) => {
    if (!r.data_fim) return false;
    const year = parseInt(r.data_fim.slice(0, 4));
    return year >= yMin && year <= yMax && produtos.includes(r.produto);
  });
  if (!filtered.length) return emptyPlot(300);

  const byProduto: Record<string, AnpPpiSerieRow[]> = {};
  for (const r of filtered) (byProduto[r.produto] ??= []).push(r);

  const traces: PlotData[] = produtos
    .filter((p) => byProduto[p])
    .map((p) => {
      const info = PRODUTO_INFO[p];
      const data = byProduto[p].sort((a, b) => a.data_fim.localeCompare(b.data_fim));
      return {
        type: "scatter", mode: "lines",
        name: info?.label ?? p,
        x: data.map((r) => r.data_fim),
        y: data.map((r) => r.preco_medio),
        line: { width: 2, color: info?.color ?? "#999" },
        hovertemplate: `${info?.label ?? p}: R$ %{y:.4f}<extra></extra>`,
      } as PlotData;
    });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 300,
      margin: { t: 10, b: 50, l: 70, r: 30 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "R$ / L (or kg)" } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0 },
    },
  };
}

function buildLocaisChart(
  rows: AnpPpiLocaisRow[],
): { data: PlotData[]; layout: Partial<Layout> } {
  if (!rows.length) return emptyPlot(320);

  const byLocal: Record<string, AnpPpiLocaisRow[]> = {};
  for (const r of rows) (byLocal[r.local] ??= []).push(r);

  const locais = Object.keys(byLocal).sort();
  const palette = [
    "#E53935","#1E88E5","#43A047","#FB8C00","#8E24AA",
    "#00ACC1","#D81B60","#6D4C41","#F4511E","#039BE5",
    "#7CB342","#FFB300","#546E7A","#AB47BC","#26A69A",
    "#EC407A",
  ];

  const traces: PlotData[] = locais.map((local, i) => {
    const data = byLocal[local].sort((a, b) => a.data_fim.localeCompare(b.data_fim));
    return {
      type: "scatter", mode: "lines",
      name: local,
      x: data.map((r) => r.data_fim),
      y: data.map((r) => r.preco),
      line: { width: 1.5, color: palette[i % palette.length] },
      hovertemplate: `${local}: R$ %{y:.4f}<extra></extra>`,
    } as PlotData;
  });

  return {
    data: traces,
    layout: {
      ...COMMON_LAYOUT,
      height: 320,
      margin: { t: 10, b: 50, l: 70, r: 10 },
      hovermode: "x unified",
      yaxis: { ...AXIS_LINE, title: { text: "R$ / L (or kg)" } },
      xaxis: { ...AXIS_LINE, type: "date" as const },
      legend: { orientation: "h", yanchor: "bottom", y: 1.01, xanchor: "left", x: 0, font: { size: 10 } },
    },
  };
}

// ── View ──────────────────────────────────────────────────────────────────────

export default function DesktopView(): React.ReactElement {
  const { visible, loading: visLoading } = useModuleVisibilityGuard("anp-ppi");

  const {
    allSerie, locaisRows, allYears,
    loading, locaisLoading,
    excelLoading, setExcelLoading,
    filters, setFilters, toggleProduto,
    yMin, yMax, hasYears,
  } = useAnpPpiData();

  const { selectedProdutos, yearRange, detailProduto } = filters;

  const mediaChart = useMemo(
    () => buildMediaChart(allSerie, selectedProdutos, yearRange, allYears),
    [allSerie, selectedProdutos, yearRange, allYears],
  );

  const locaisChart = useMemo(
    () => buildLocaisChart(locaisRows),
    [locaisRows],
  );

  if (visLoading || !visible) return <></>;

  return (
    <div>
      <NavBar />
      <div className="container-fluid g-0">
        <div className="row g-0">

          {/* ── Sidebar ───────────────────────────────────────────────── */}
          <div className="col-xxl-2 col-md-3 p-0">
            <div id="sidebar">
              <div style={{ textAlign: "center" }}>
                <BrandLogo variant="sidebar" />
              </div>
              <hr style={{ borderTop: "1px solid #f0f0f0", marginBottom: 14 }} />

              <div className="sidebar-section-label">Filters</div>

              <MultiSelectFilter
                label="Product"
                items={ALL_PRODUTOS}
                selected={selectedProdutos}
                onToggle={toggleProduto}
                swatch={(p) => PRODUTO_INFO[p].color}
                itemLabel={(p) => PRODUTO_INFO[p].label}
                idPrefix="ppi"
                counterTotal={ALL_PRODUTOS.length}
              />

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Period</div>
                {!loading && hasYears && (
                  <PeriodSlider
                    years={allYears}
                    value={yearRange}
                    onChange={(v) => setFilters({ yearRange: v })}
                  />
                )}
              </div>

              <div className="sidebar-filter-section">
                <div className="sidebar-filter-label">Detail by Location — Product</div>
                <select
                  className="form-select form-select-sm"
                  value={detailProduto}
                  onChange={(e) => setFilters({ detailProduto: e.target.value })}
                  style={{ fontFamily: "Arial", fontSize: 12 }}
                >
                  {ALL_PRODUTOS.map((p) => (
                    <option key={p} value={p}>{PRODUTO_INFO[p].label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── Main content ──────────────────────────────────────────── */}
          <div className="col-xxl-10 col-md-9">
            <div id="page-content">
              <DashboardHeader
                title="ANP — Import Parity Prices (PPI)"
                sub="Weekly parity prices published by ANP, by product and delivery location"
                period={hasYears && yMin != null && yMax != null ? [yMin, yMax] : null}
                rightSlot={
                  <ExportPanel
                    actions={[
                      {
                        kind: "excel",
                        label: "formatted data .xl",
                        busy: excelLoading,
                        loadingLabel: "Generating Excel...",
                        disabled: loading || allSerie.length === 0 || excelLoading,
                        onClick: async () => {
                          setExcelLoading(true);
                          try {
                            await downloadGenericExcel<AnpPpiSerieRow>({
                              rows: allSerie,
                              filename: "ANP-PPI",
                              title: "ANP — Import Parity Prices (National Average)",
                              sheetName: "PPI Avg.",
                              columns: [
                                { key: "data_inicio", header: "Start" },
                                { key: "data_fim",    header: "End" },
                                { key: "produto",     header: "Product",    width: 22 },
                                { key: "preco_medio", header: "Avg. Price", format: "0.0000" },
                                { key: "unidade",     header: "Unit" },
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
                        disabled: loading || allSerie.length === 0,
                        onClick: () => {
                          downloadCsv({
                            rows: allSerie as unknown as Record<string, unknown>[],
                            filename: "ANP-PPI",
                          });
                        },
                      },
                    ]}
                  />
                }
              />

              {loading ? (
                <BarrelLoading />
              ) : (
                <>
                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title="PPI — National Average (R$/L or R$/kg)"
                        height={300}
                      >
                        <PlotlyChart
                          data={mediaChart.data}
                          layout={mediaChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 300 }}
                        />
                      </ChartSection>
                    </div>
                  </div>

                  <div className="row mb-2">
                    <div className="col-12">
                      <ChartSection
                        title={`PPI by Location — ${PRODUTO_INFO[detailProduto]?.label ?? detailProduto}`}
                        loading={locaisLoading}
                        height={320}
                      >
                        <PlotlyChart
                          data={locaisChart.data}
                          layout={locaisChart.layout}
                          config={{ responsive: true, displayModeBar: false }}
                          style={{ width: "100%", height: 320 }}
                        />
                      </ChartSection>
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
